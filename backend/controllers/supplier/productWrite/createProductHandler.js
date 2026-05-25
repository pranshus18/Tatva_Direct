import {
  brandIsAllowedForSupplier,
  buildIdentityBundle,
  buildSupplierVariantIdentity,
  buildVariantAsinLikeId,
  crypto,
  decideOnboardingAction,
  ensureBrandApprovedOrRequest,
  findAdmins,
  findUserBasicById,
  getContractErrorMessage,
  insertNotification,
  insertNotifications,
  isCatalogGuardrailsEnabled,
  isValidGtin,
  normalizeGtin,
  normalizeText,
  onboardingAutoApproveThreshold,
  scoreOnboardingConfidence,
  shouldMoveToPendingForSpecChange,
  validateSpecValues
} from '../supplierImports.js';
import { sanitizeImageUrls } from '../shared/productHelpers.js';
import {
  createBaseProductIfNeeded,
  ensureCategoryAndUnit,
  findCanonicalProductFromIdentifiers,
  findExistingProductCandidate
} from '../../../services/supplierProductWriteService.js';

export function buildSupplierProductCreateHandler(ctx) {
  const {
    supabase,
    resolveTaxRatesForProductCreate,
    upsertModelSpecProfile,
    loadSpecTemplateForCategory
  } = ctx;

  return async function supplierProductCreateHandler(req, res) {
    try {
      const { category, unit, outlet_id, brandModel, lsa, hsnCode, catalogProductId, ...otherData } = req.body;
      const requestSpecs =
        otherData.specifications && typeof otherData.specifications === 'object' && !Array.isArray(otherData.specifications)
          ? { ...otherData.specifications }
          : {};
      const posLookupGsku = String(otherData.gsku || otherData.pos_lookup_code || '').trim();
      if (posLookupGsku) requestSpecs.gsku = posLookupGsku;
      const explicitBarcode = String(otherData.barcode || '').trim();
      const normalizedImageUrls = sanitizeImageUrls(otherData.images);
      const brandInput = String(otherData.brand || requestSpecs?.brand || brandModel || '').trim();
      const mpnInput = '';
      const gtinInput = normalizeGtin(
        otherData.gtin || requestSpecs?.gtin || requestSpecs?.upc || requestSpecs?.ean || ''
      );

      if (gtinInput && !isValidGtin(gtinInput)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid GTIN. Use 8, 12, 13, or 14 digit numeric code.'
        });
      }

      const resolvedBarcodeForPos = (explicitBarcode || gtinInput || posLookupGsku || '').trim() || null;

      const canonicalProductFromIdentifier = await findCanonicalProductFromIdentifiers(supabase, {
        gtinInput,
        resolvedBarcodeForPos
      });

      const effectiveBrandInput =
        canonicalProductFromIdentifier?.brand && String(canonicalProductFromIdentifier.brand).trim()
          ? String(canonicalProductFromIdentifier.brand).trim()
          : brandInput;

      const brandGuard = brandIsAllowedForSupplier(req.user?.profile, effectiveBrandInput);
      if (!brandGuard.allowed) {
        return res.status(403).json({
          status: 'error',
          message:
            brandGuard.reason === 'brand_required'
              ? 'Brand is required because you have selected brands in your profile. Please enter a brand that matches your profile.'
              : 'You can only add products for brands you selected in your profile.',
          allowedBrands: brandGuard.declared || []
        });
      }

      const brandApproval = await ensureBrandApprovedOrRequest({
        supabase,
        brandName: effectiveBrandInput,
        requesterUserId: req.userId
      });

      if (!brandApproval.ok) {
        return res.status(403).json({
          status: 'error',
          code: brandApproval.code,
          message: brandApproval.message,
          brand: brandApproval.brand
            ? {
                id: brandApproval.brand.id,
                name: brandApproval.brand.name,
                status: brandApproval.brand.status,
                rejection_reason: brandApproval.brand.rejection_reason || null
              }
            : null
        });
      }

      const taxValidation = await resolveTaxRatesForProductCreate({
        input: otherData,
        preferredProductId: String(catalogProductId || '').trim() || canonicalProductFromIdentifier?.id || null,
        categoryName: category
      });
      if (!taxValidation.ok) {
        return res.status(400).json({
          status: 'error',
          message: taxValidation.message
        });
      }
      const { igstRate, cgstRate, sgstRate } = taxValidation.data;

      const { categoryName, unitName } = await ensureCategoryAndUnit(supabase, {
        category,
        unit,
        reqUserId: req.userId
      });

      let normalizedSpecs = requestSpecs;
      const productNameRaw = otherData.name?.trim() || '';
      const productName = productNameRaw.toLowerCase();
      let identityBundle = buildIdentityBundle({
        name: otherData.name,
        category,
        brand: effectiveBrandInput,
        gtin: gtinInput,
        mpn: mpnInput,
        unit,
        brandModel,
        sku: requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '',
        packSize: requestSpecs?.packSize || requestSpecs?.pack_size || '',
        specifications: normalizedSpecs
      });

      if (isCatalogGuardrailsEnabled()) {
        const { template, fields } = await loadSpecTemplateForCategory(categoryName || category, null);
        if (template && Array.isArray(fields) && fields.length > 0) {
          const validation = validateSpecValues(fields, normalizedSpecs);
          if (validation.errors.length > 0) {
            return res.status(400).json({
              status: 'error',
              message: 'Specification validation failed',
              errors: validation.errors
            });
          }
          normalizedSpecs = validation.allowed;
          identityBundle = buildIdentityBundle({
            name: otherData.name,
            category,
            brand: effectiveBrandInput,
            gtin: gtinInput,
            mpn: mpnInput,
            unit,
            brandModel,
            sku: requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '',
            packSize: requestSpecs?.packSize || requestSpecs?.pack_size || '',
            specifications: normalizedSpecs
          });
        }
      }

      if (posLookupGsku) normalizedSpecs = { ...normalizedSpecs, gsku: posLookupGsku };

      const selectedCatalogProductId = String(catalogProductId || '').trim();
      const existingProduct = await findExistingProductCandidate(supabase, {
        selectedCatalogProductId,
        canonicalProductFromIdentifier,
        identityBundle,
        productName,
        productNameRaw,
        categoryName,
        normalizeText
      });

      const baseProductResult = await createBaseProductIfNeeded(supabase, {
        existingProduct,
        otherData,
        categoryName,
        unitName,
        normalizedImageUrls,
        normalizedSpecs,
        reqUserId: req.userId,
        identityBundle,
        resolvedBarcodeForPos
      });
      if (baseProductResult.error) {
        return res.status(400).json({
          status: 'error',
          message: baseProductResult.error.message || 'Error creating product'
        });
      }
      const { productId, catalogAsin, isNewProduct } = baseProductResult;

      let parentProductForVariant = existingProduct;
      if (
        !parentProductForVariant?.specifications ||
        typeof parentProductForVariant.specifications !== 'object'
      ) {
        const { data: parentRow } = await supabase
          .from('products')
          .select('specifications, asin')
          .eq('id', productId)
          .maybeSingle();
        parentProductForVariant = parentRow || { specifications: normalizedSpecs };
      }
      const variantIdentityBundle = buildSupplierVariantIdentity(
        {
          unit,
          brandModel,
          gtin: gtinInput,
          mpn: mpnInput,
          sku: requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '',
          packSize: requestSpecs?.packSize || requestSpecs?.pack_size || '',
          specifications: normalizedSpecs
        },
        parentProductForVariant
      );

      const currentLocation = (otherData.location || '').trim();
      const { data: existingSupplierProduct } = await supabase
        .from('supplier_products')
        .select('*')
        .eq('product_id', productId)
        .eq('supplier_id', req.userId)
        .eq('location', currentLocation)
        .eq('variant_key', variantIdentityBundle.variantKey)
        .maybeSingle();
      if (existingSupplierProduct) {
        return res.status(400).json({
          status: 'error',
          message: 'You have already added this exact product variation for this location. Please update the existing entry instead.'
        });
      }

      const parsedPrice = parseFloat(otherData.price);
      const parsedStock = parseInt(otherData.stock);
      const parsedMinOrderQty = parseInt(otherData.min_order_quantity);
      const { data: approvedVariantOffer } = await supabase
        .from('supplier_products')
        .select('id')
        .eq('product_id', productId)
        .eq('variant_key', variantIdentityBundle.variantKey)
        .eq('status', 'approved')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      const selectedCatalogSpecs =
        existingProduct?.specifications &&
        typeof existingProduct.specifications === 'object' &&
        !Array.isArray(existingProduct.specifications)
          ? existingProduct.specifications
          : {};
      const selectedCatalogIsApproved = String(existingProduct?.status || '').toLowerCase() === 'approved';
      const selectedProductSpecsChanged = !!selectedCatalogProductId && shouldMoveToPendingForSpecChange({
        specificationsProvided: true,
        currentSpecs: selectedCatalogSpecs,
        nextSpecs: normalizedSpecs
      });
      const shouldBeApproved = Boolean(
        approvedVariantOffer ||
        (selectedCatalogProductId && selectedCatalogIsApproved && !selectedProductSpecsChanged)
      );
      const variantAsin = buildVariantAsinLikeId(
        catalogAsin || identityBundle.asinLikeId,
        variantIdentityBundle.variantKey
      );

      const supplierProductData = {
        product_id: productId,
        supplier_id: req.userId,
        price: isNaN(parsedPrice) ? 0 : parsedPrice,
        stock: isNaN(parsedStock) ? 0 : parsedStock,
        min_order_quantity: isNaN(parsedMinOrderQty) || parsedMinOrderQty < 1 ? 1 : parsedMinOrderQty,
        location: currentLocation,
        outlet_id: outlet_id || null,
        status: shouldBeApproved ? 'approved' : 'pending',
        is_active: shouldBeApproved ? true : false,
        igst_rate: igstRate,
        cgst_rate: cgstRate,
        sgst_rate: sgstRate,
        variant_key: variantIdentityBundle.variantKey,
        variant_asin: variantAsin,
        attributes: {
          description: otherData.description || '',
          specifications: otherData.specifications || normalizedSpecs,
          name: otherData.name,
          category: category,
          brandModel: (brandModel || '').toString().trim(),
          brand: effectiveBrandInput,
          mpn: mpnInput,
          gtin: gtinInput,
          lsa: (lsa || '').toString().trim(),
          hsnCode: (hsnCode || '').toString().trim(),
          sku: (requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '').toString().trim(),
          packSize: (requestSpecs?.packSize || requestSpecs?.pack_size || '').toString().trim(),
          unit: (unit || '').toString().trim(),
          variantAttributes: variantIdentityBundle.variant.variantAttributes,
          igstRate,
          cgstRate,
          sgstRate,
          tags: otherData.tags || [],
          images: normalizedImageUrls
        }
      };

      const { data: newSupplierProduct, error: supplierProductError } = await supabase
        .from('supplier_products')
        .insert(supplierProductData)
        .select()
        .single();
      if (supplierProductError) {
        return res.status(400).json({
          status: 'error',
          message: supplierProductError.message || 'Error creating supplier product entry'
        });
      }

      if (isCatalogGuardrailsEnabled()) {
        try {
          const familyKeySeed = `${identityBundle.catalog.brand || ''}|${identityBundle.catalog.category || categoryName || ''}|${identityBundle.catalog.name || productNameRaw || ''}`.toLowerCase().trim();
          const familyKey = familyKeySeed ? crypto.createHash('sha256').update(familyKeySeed).digest('hex') : null;
          let familyId = existingProduct?.family_id || null;
          if (!familyId && familyKey) {
            const { data: existingFamily } = await supabase
              .from('product_families')
              .select('id')
              .eq('normalized_family_key', familyKey)
              .maybeSingle();
            if (existingFamily?.id) familyId = existingFamily.id;
          }
          const { template, fields } = await loadSpecTemplateForCategory(categoryName, familyId);
          const specValidation = fields.length > 0
            ? validateSpecValues(fields, otherData.specifications || requestSpecs || {})
            : { allowed: (otherData.specifications || requestSpecs || {}), errors: [], unknownKeys: [] };
          const confidenceScore = scoreOnboardingConfidence({
            identityBundle,
            validationErrors: specValidation.errors,
            unknownKeys: specValidation.unknownKeys
          });
          const finalDecision = decideOnboardingAction(confidenceScore, onboardingAutoApproveThreshold);
          if (finalDecision !== 'auto_linked') {
            await supabase.from('product_requests').insert({
              requested_by: req.userId,
              supplier_id: req.userId,
              source: 'supplier',
              status: 'new',
              category: categoryName || null,
              normalized_input: { name: otherData.name || '', category: categoryName, identityBundle },
              ai_prefill: { templateId: template?.id || null, values: specValidation.allowed },
              confidence_score: confidenceScore,
              resolved_product_id: productId
            });
          }
        } catch (guardrailError) {
          console.log('Guardrails metadata write failed:', guardrailError?.message || guardrailError);
        }
      }

      await upsertModelSpecProfile({
        category: categoryName || category,
        modelRaw: mpnInput || brandModel,
        specifications: normalizedSpecs,
        actorUserId: req.userId
      });

      const { data: completeProduct } = await supabase
        .from('products')
        .select(`*, supplier_products!inner(*)`)
        .eq('id', productId)
        .eq('supplier_products.supplier_id', req.userId)
        .eq('supplier_products.location', currentLocation)
        .eq('supplier_products.variant_key', variantIdentityBundle.variantKey)
        .single();

      const responseProduct = {
        ...completeProduct,
        price: completeProduct?.supplier_products?.[0]?.price,
        stock: completeProduct?.supplier_products?.[0]?.stock,
        location: completeProduct?.supplier_products?.[0]?.location,
        min_order_quantity: completeProduct?.supplier_products?.[0]?.min_order_quantity,
        status: completeProduct?.supplier_products?.[0]?.status,
        is_active: completeProduct?.supplier_products?.[0]?.is_active,
        supplier_id: req.userId,
        variantKey: completeProduct?.supplier_products?.[0]?.variant_key || variantIdentityBundle.variantKey,
        variantAsin: completeProduct?.supplier_products?.[0]?.variant_asin || variantAsin
      };

      const { data: supplier } = await findUserBasicById(req.userId, supabase);
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: admins } = await findAdmins(adminEmail, supabase);
      if (admins?.length) {
        const notifications = admins.map((admin) => ({
          user_id: admin.id,
          type: shouldBeApproved ? 'supplier_edit' : 'product_approval',
          title: shouldBeApproved
            ? `Supplier Updated Inventory: ${responseProduct.name}`
            : `Product/Variant Pending Approval: ${responseProduct.name}`,
          message: shouldBeApproved
            ? `${supplier?.name || 'Supplier'} added inventory for "${responseProduct.name}".`
            : `${supplier?.name} (${supplier?.company || supplier?.email}) added "${responseProduct.name}" with variant specifications that require your approval.`,
          related_product_id: productId,
          related_supplier_id: supplier?.id || req.userId,
          metadata: { productId, supplierId: req.userId, variantKey: variantIdentityBundle.variantKey },
          is_read: false
        }));
        await insertNotifications(notifications, supabase);
      }

      if (!isNewProduct && responseProduct?.requested_by_service_provider_id) {
        await insertNotification(
          {
            user_id: responseProduct.requested_by_service_provider_id,
            type: 'system',
            title: `Supplier added your requested product: ${responseProduct.name}`,
            message: `${supplier?.name || 'A supplier'} added "${responseProduct.name}".`,
            related_product_id: productId,
            related_supplier_id: req.userId,
            metadata: { productId, source: 'service_provider_request_fulfilled' }
          },
          supabase
        );
      }

      return res.status(201).json({
        status: 'success',
        message: shouldBeApproved
          ? 'Product added successfully and is immediately available.'
          : 'Product added successfully and is pending admin approval for this variant.',
        product: responseProduct
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Add product error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  };
}

