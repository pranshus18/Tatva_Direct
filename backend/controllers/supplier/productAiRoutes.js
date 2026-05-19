/** Supplier routes: productAi */
import {
  buildIdentityBundle,
  buildSpecificationTemplateFromFields,
  decideOnboardingAction,
  extractSpecificationPairsFromDescription,
  extractSpecificationValuesFromDescription,
  getContractErrorMessage,
  onboardingAutoApproveThreshold,
  parseSpecificationsObject,
  parseWithSchema,
  scoreOnboardingConfidence,
  supplierProductAiEnhanceSchema,
  supplierProductAnalyzeImageSchema,
  supplierProductExtractSpecificationsSchema,
  validateSpecValues
} from './supplierImports.js';

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
      brandRaw: productName
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

// Analyze product images to extract product name and category (min 3 images for reliable vision)
router.post('/products/analyze-image', authenticateToken, async (req, res) => {
  try {
    const { images, imageBase64, imageUrl, provider = 'auto' } = parseWithSchema(
      supplierProductAnalyzeImageSchema,
      req.body || {}
    );

    const MIN_IMAGES = 3;

    /** @type {{ base64: string, mimeType: string }[]} */
    let visionImages = [];

    if (Array.isArray(images) && images.length > 0) {
      visionImages = images
        .map((img) => {
          const raw = img?.data ?? img?.base64 ?? img?.imageBase64;
          const mimeType = (img?.mimeType || img?.mime || 'image/jpeg').toString();
          if (!raw || typeof raw !== 'string') return null;
          return { base64: raw.replace(/^data:image\/\w+;base64,/, ''), mimeType };
        })
        .filter(Boolean);

      if (visionImages.length < MIN_IMAGES) {
        return res.status(400).json({
          status: 'error',
          message: `Please upload at least ${MIN_IMAGES} product photos (different angles or details — e.g. front, side, label) so AI can identify the product reliably.`
        });
      }
    } else if (imageBase64 || imageUrl) {
      return res.status(400).json({
        status: 'error',
        message: `Please upload at least ${MIN_IMAGES} product photos instead of one. Multiple angles help AI detect name and category accurately.`
      });
    } else {
      return res.status(400).json({
        status: 'error',
        message: 'No images provided. Add at least 3 product photos.'
      });
    }

    // Get API keys from environment variables
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    // Determine which provider to use
    let selectedProvider = provider;
    if (provider === 'auto') {
      // Auto-select: prioritize Gemini > OpenAI > Claude
      if (geminiApiKey) selectedProvider = 'gemini';
      else if (openaiApiKey) selectedProvider = 'openai';
      else if (anthropicApiKey) selectedProvider = 'claude';
      else {
        return res.status(400).json({
          status: 'error',
          message: 'No AI API keys configured. Please set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY in environment variables.'
        });
      }
    }

    // Validate API key for selected provider
    if (selectedProvider === 'openai' && !openaiApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'OpenAI API key not configured. Please set OPENAI_API_KEY in environment variables.'
      });
    }
    if (selectedProvider === 'gemini' && !geminiApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Gemini API key not configured. Please set GEMINI_API_KEY in environment variables.'
      });
    }
    if (selectedProvider === 'claude' && !anthropicApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Claude API key not configured. Please set ANTHROPIC_API_KEY in environment variables.'
      });
    }

    // Initialize fetch
    let fetch;
    try {
      if (typeof globalThis.fetch === 'function') {
        fetch = globalThis.fetch;
      } else {
        const nodeFetch = await import('node-fetch');
        fetch = nodeFetch.default;
      }
    } catch (error) {
      console.error('Failed to load fetch:', error);
      throw new Error('Fetch API not available');
    }

    // Optionally load existing categories only to give AI examples (not to restrict it)
    const { data: categories } = await supabase
      .from('categories')
      .select('name, display_name')
      .eq('is_active', true);
    
    const categoryExamples = (categories || []).map(cat => cat.display_name || cat.name).join(', ');

    // Build prompt for vision AI (multiple images of the same product).
    const prompt = `You are given ${visionImages.length} photos of the SAME construction / building material product (different angles or details). Analyze them together and identify:
1. Product Name: A clear, concise product name (e.g., "Portland Cement OPC 53", "TMT Steel Bar 12mm", "Red Clay Brick")
2. Category: A short category name describing this construction material (for example: ${categoryExamples || 'steel, cement, aggregates, masonry, electrical, plumbing, hardware'}).

IMPORTANT:
- Use ALL images together — labels, texture, shape, and packaging may appear in different shots
- The product name should be specific and professional (include brand/model if visible, dimensions if applicable)
- The category should be concise and reusable for grouping similar products (1–3 words)
- You MAY reuse one of the example categories or output a NEW category if it fits better
- Return ONLY valid JSON with no additional text

Return this JSON structure:
{
  "productName": "exact product name inferred from the images",
  "category": "one of the categories from the list"
}`;

    let aiResponse;
    let result;

    // Call the appropriate AI provider with vision capabilities
    if (selectedProvider === 'openai') {
      const userContent = [
        { type: 'text', text: prompt },
        ...visionImages.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
        }))
      ];

      const openaiUrl = 'https://api.openai.com/v1/chat/completions';
      const response = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that analyzes product images for construction materials. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: userContent
            }
          ],
          max_tokens: 300
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('OpenAI Vision API error:', errorData);
        throw new Error('OpenAI Vision API service unavailable');
      }

      const data = await response.json();
      aiResponse = data.choices?.[0]?.message?.content?.trim();
      
      if (!aiResponse) {
        throw new Error('No response from OpenAI Vision API');
      }

    } else if (selectedProvider === 'gemini') {
      const configuredGeminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-pro').trim();
      const modelCandidates = [
        { name: configuredGeminiModel, apiVersion: 'v1beta' },
        { name: `models/${configuredGeminiModel}`, apiVersion: 'v1beta' },
        { name: 'gemini-2.5-flash', apiVersion: 'v1beta' },
        { name: 'models/gemini-2.5-flash', apiVersion: 'v1beta' },
        { name: 'gemini-2.0-flash', apiVersion: 'v1beta' },
        { name: 'models/gemini-2.0-flash', apiVersion: 'v1beta' },
        { name: 'gemini-1.5-flash', apiVersion: 'v1beta' },
        { name: 'models/gemini-1.5-flash', apiVersion: 'v1beta' },
        { name: 'gemini-1.5-flash', apiVersion: 'v1' },
        { name: 'models/gemini-1.5-flash', apiVersion: 'v1' }
      ].filter((c, idx, arr) =>
        c.name && arr.findIndex((x) => x.name === c.name && x.apiVersion === c.apiVersion) === idx
      );

      const geminiParts = [{ text: prompt }];
      for (const img of visionImages) {
        geminiParts.push({
          inline_data: {
            mime_type: img.mimeType.includes('/') ? img.mimeType : 'image/jpeg',
            data: img.base64
          }
        });
      }

      let lastGeminiReason = '';
      for (const candidate of modelCandidates) {
        const geminiModel = candidate.name;
        const apiVersion = candidate.apiVersion || 'v1beta';
        const geminiUrl = geminiModel.startsWith('models/')
          ? `https://generativelanguage.googleapis.com/${apiVersion}/${geminiModel}:generateContent?key=${geminiApiKey}`
          : `https://generativelanguage.googleapis.com/${apiVersion}/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: geminiParts
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json'
            }
          })
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error(`Gemini Vision API error (${geminiModel}, ${apiVersion}):`, errorData);
          lastGeminiReason = `HTTP ${response.status}`;
          continue;
        }

        const data = await response.json();
        const finishReason = data?.candidates?.[0]?.finishReason || '';
        const blockReason = data?.promptFeedback?.blockReason || '';
        const safety = Array.isArray(data?.candidates?.[0]?.safetyRatings)
          ? data.candidates[0].safetyRatings.map((s) => `${s.category}:${s.probability}`).join(', ')
          : '';
        const textFromParts = (data?.candidates || [])
          .flatMap((c) => c?.content?.parts || [])
          .map((p) => (typeof p?.text === 'string' ? p.text.trim() : ''))
          .find(Boolean);

        // Skip partial/non-JSON Gemini outputs and try next fallback model.
        // Example observed output: "Here is the JSON requested:" with no JSON body.
        const cleanedText = String(textFromParts || '')
          .replace(/```json/gi, '```')
          .replace(/```/g, '')
          .trim();
        const looksLikeJsonPayload =
          (cleanedText.includes('{') && cleanedText.includes('}')) ||
          /["']?(productName|product_name|name|category|category_name)["']?\s*[:=]/i.test(cleanedText);
        const looksLikePartialPreamble =
          /^here\s+is\s+the\s+json\s+requested/i.test(cleanedText) && !cleanedText.includes('{');

        if (textFromParts && looksLikeJsonPayload && !looksLikePartialPreamble) {
          aiResponse = textFromParts;
          break;
        }

        lastGeminiReason = [blockReason, finishReason, safety].filter(Boolean).join(' | ');
        console.warn(`Gemini empty response (${geminiModel})`, {
          blockReason,
          finishReason,
          safety,
          preview: cleanedText.slice(0, 120)
        });
      }

      if (!aiResponse) {
        throw new Error(
          lastGeminiReason
            ? `No response from Gemini Vision API (${lastGeminiReason})`
            : 'No response from Gemini Vision API'
        );
      }

    } else if (selectedProvider === 'claude') {
      const claudeUrl = 'https://api.anthropic.com/v1/messages';
      const claudeMedia = (mime) =>
        mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp' ? mime : 'image/jpeg';

      const claudeContent = [
        ...visionImages.map((img) => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: claudeMedia(img.mimeType),
            data: img.base64
          }
        })),
        { type: 'text', text: prompt }
      ];

      const response = await fetch(claudeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: claudeContent
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Claude Vision API error:', errorData);
        throw new Error('Claude Vision API service unavailable');
      }

      const data = await response.json();
      aiResponse = data.content?.[0]?.text?.trim();
      
      if (!aiResponse) {
        throw new Error('No response from Claude Vision API');
      }
    }

    // Parse AI response
    try {
      // If provider already returned an object, use it directly
      if (aiResponse && typeof aiResponse === 'object') {
        result = aiResponse;
      } else {
        const text = String(aiResponse || '').trim();
        const cleaned = text
          .replace(/```json/gi, '```')
          .replace(/```/g, '')
          .trim();

        // 1) Try direct JSON.parse on full text
        try {
          result = JSON.parse(cleaned);
        } catch {
          // 2) Try to extract the first JSON object from the text
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
          } else {
            // 3) Fallback: parse free-form key/value outputs
            const matchValue = (patterns) => {
              for (const p of patterns) {
                const m = cleaned.match(p);
                if (m?.[1]) return String(m[1]).trim();
              }
              return null;
            };

            const fallbackName = matchValue([
              /(?:^|\n)\s*["']?productName["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?product_name["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?name["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*(?:Product\s*Name|Product)\s*[:=-]\s*(.+?)\s*(?:\n|$)/i
            ]);

            const fallbackCategory = matchValue([
              /(?:^|\n)\s*["']?category["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?categoryName["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?category_name["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*(?:Category)\s*[:=-]\s*(.+?)\s*(?:\n|$)/i
            ]);

            if (fallbackName || fallbackCategory) {
              result = {
                productName: fallbackName,
                category: fallbackCategory
              };
            } else {
              throw new Error('No JSON or recognizable productName/category fields in AI response');
            }
          }
        }
      }

      // Normalize common alternate keys from model outputs.
      if (!result?.productName && (result?.product_name || result?.name || result?.product)) {
        result.productName = result.product_name || result.name || result.product;
      }
      if (!result?.category && (result?.category_name || result?.categoryName || result?.productCategory)) {
        result.category = result.category_name || result.categoryName || result.productCategory;
      }

      if (result?.productName != null) result.productName = String(result.productName).trim();
      if (result?.category != null) result.category = String(result.category).trim();
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      console.error('Parse error details:', parseError);
      throw new Error('Failed to parse AI response as JSON');
    }

    res.json({
      status: 'success',
      productName: result.productName || null,
      // Do NOT force category to existing ones: allow new categories from AI.
      // The /products endpoint will auto-create the category if it doesn't exist.
      category: (result.category || '').trim() || null,
      provider: selectedProvider,
      rawResponse: result
    });

  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Image analysis error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to analyze image. Please try again.'
    });
  }
});
}
