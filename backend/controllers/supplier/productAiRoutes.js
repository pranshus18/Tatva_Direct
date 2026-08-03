/** Supplier routes: productAi */
import {
  buildIdentityBundle,
  buildSpecificationTemplateFromFields,
  decideOnboardingAction,
  extractSpecificationPairsFromDescription,
  extractSpecificationValuesFromDescription,
  getContractErrorMessage,
  isValidGtin,
  normalizeGtin,
  onboardingAutoApproveThreshold,
  parseSpecificationsObject,
  parseWithSchema,
  scoreOnboardingConfidence,
  supplierProductAiEnhanceSchema,
  supplierProductAnalyzeImageSchema,
  supplierProductExtractSpecificationsSchema,
  validateSpecValues
} from './supplierImports.js';
import { analyzeSupplierProductImages } from '../../services/productImageAnalysisService.js';

export function registerSupplierProductAiRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    resolveAdminSpecificationTemplate,
    loadSpecTemplateForCategory
  } = ctx;

router.post('/products/ai-enhance', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierProductAiEnhanceSchema, req.body || {});
    const { category, familyId, specifications = {}, provider = 'manual' } = payloadInput;
    if (!category) {
      return res.status(400).json({
        status: 'error',
        message: 'category is required'
      });
    }

    const { template, fields } = await loadSpecTemplateForCategory(category, familyId || null);
    if (!template || fields.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No active specification template found for this category/model'
      });
    }

    const validated = validateSpecValues(fields, specifications || {});
    const identityBundle = buildIdentityBundle({
      name: payloadInput.name || '',
      category,
      brand: payloadInput.brand || '',
      gtin: payloadInput.gtin || '',
      mpn: payloadInput.mpn || '',
      specifications: validated.allowed
    });
    const confidenceScore = scoreOnboardingConfidence({
      identityBundle,
      validationErrors: validated.errors,
      unknownKeys: validated.unknownKeys
    });
    const decision = decideOnboardingAction(confidenceScore, onboardingAutoApproveThreshold);

    const fieldSkeleton = {};
    for (const field of fields) {
      const key = (field.field_key || '').toString().trim();
      if (!key) continue;
      fieldSkeleton[key] = validated.allowed[key] ?? null;
    }

    await supabase.from('product_ingestion_runs').insert({
      supplier_id: req.userId,
      provider: ['gemini', 'openai', 'claude'].includes(provider) ? provider : 'manual',
      model: provider === 'manual' ? 'supplier_prefill' : provider,
      prompt_version: 'v1',
      input_payload: { category, familyId: familyId || null, specifications },
      extracted_payload: specifications || {},
      validated_payload: fieldSkeleton,
      confidence_score: confidenceScore,
      validation_errors: validated.errors || [],
      final_decision: decision,
      actor_id: req.userId
    });

    res.json({
      status: 'success',
      template: {
        id: template.id,
        name: template.name,
        category: template.category
      },
      specifications: fieldSkeleton,
      unknownKeys: validated.unknownKeys,
      validationErrors: validated.errors,
      confidenceScore,
      recommendedAction: decision
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Supplier AI enhance error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to generate AI specification prefill'
    });
  }
});

// Load admin spec template keys OR extract specification values from description via AI.
router.post('/products/extract-specifications', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(supplierProductExtractSpecificationsSchema, req.body || {});
    const category = String(payload.category || '').trim().toLowerCase();
    const description = String(payload.description || '').trim();
    const productName = String(payload.productName || '').trim();
    const provider = payload.provider || 'auto';
    const existingSpecifications = parseSpecificationsObject(payload.existingSpecifications) || {};

    if (!category) {
      return res.status(400).json({
        status: 'error',
        message: 'category is required'
      });
    }

    if (description) {
      const templateKeys = Object.keys(existingSpecifications);
      if (templateKeys.length > 0) {
        const aiResult = await extractSpecificationValuesFromDescription({
          description,
          category,
          productName,
          existingSpecifications,
          provider,
          blockOnCategoryMismatch: false
        });
        return res.status(aiResult.status === 'error' ? 400 : 200).json(aiResult);
      }

      const aiResult = await extractSpecificationPairsFromDescription({
        description,
        category,
        productName,
        provider
      });
      return res.status(aiResult.status === 'error' ? 400 : 200).json(aiResult);
    }

    const adminTemplate = await resolveAdminSpecificationTemplate({
      categoryName: category,
      modelRaw: productName,
      brandRaw: productName,
      keysOnly: true
    });

    if (Object.keys(adminTemplate).length > 0) {
      return res.json({
        status: 'success',
        source: 'admin_template',
        specifications: adminTemplate
      });
    }

    const { template, fields } = await loadSpecTemplateForCategory(category, payload.familyId || null);
    if (!template || fields.length === 0) {
      return res.status(404).json({
        status: 'error',
        message:
          'No specification template found. Add a description and use Extract Specifications, or ask admin to configure category specs.'
      });
    }

    const specifications = buildSpecificationTemplateFromFields(fields);
    const schema = (fields || []).map((field) => ({
      key: field.field_key,
      displayName: field.display_name,
      dataType: field.data_type,
      isRequired: !!field.is_required,
      enumValues: field.enum_values || [],
      allowedUnits: field.allowed_units || [],
      minValue: field.min_value,
      maxValue: field.max_value
    }));

    return res.json({
      status: 'success',
      source: 'spec_template',
      template: {
        id: template.id,
        name: template.name,
        category: template.category
      },
      specifications,
      schema
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Extract specifications error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to extract specifications'
    });
  }
});

// Analyze product images to extract product name and category (min 3 images for reliable vision).
// Uses deterministic Gemini + shared cache so identical photos return the same fields for every supplier.
router.post('/products/analyze-image', authenticateToken, async (req, res) => {
  try {
    const { images } = parseWithSchema(supplierProductAnalyzeImageSchema, req.body || {});

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Gemini API key not configured. Please set GEMINI_API_KEY in environment variables.'
      });
    }

    const { data: categories } = await supabase
      .from('categories')
      .select('name, display_name')
      .eq('is_active', true);

    const payload = await analyzeSupplierProductImages({
      supabase,
      images,
      categories: categories || [],
      geminiApiKey
    });

    return res.json(payload);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    if (Number(error?.statusCode) === 400) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    console.error('Image analysis error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to analyze image. Please try again.'
    });
  }
});
}
