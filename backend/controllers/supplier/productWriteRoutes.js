/** Supplier routes: productWrite */
import {
  brandIsAllowedForSupplier,
  buildIdentityBundle,
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
  maybeNotifyInventoryBelowMov,
  normalizeGtin,
  normalizeText,
  normalizeVariantAttributes,
  onboardingAutoApproveThreshold,
  parseWithSchema,
  scoreOnboardingConfidence,
  shouldMoveToPendingForSpecChange,
  supplierProductCreateSchema,
  supplierProductDeleteSchema,
  supplierProductUpdateSchema,
  validateSpecValues
} from './supplierImports.js';
import {
  sanitizeImageUrls,
  validateAndNormalizeTaxRates
} from './shared/productHelpers.js';

export function registerSupplierProductWriteRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    resolveTaxRatesForProductCreate,
    upsertModelSpecProfile,
    loadSpecTemplateForCategory
  } = ctx;

router.post('/products', authenticateToken, async (req, res) => {
  try {
    req.body = parseWithSchema(supplierProductCreateSchema, req.body || {});
    const { category, unit, outlet_id, brandModel, lsa, hsnCode, catalogProductId, ...otherData } = req.body;
    const requestSpecs =
      otherData.specifications && typeof otherData.specifications === 'object' && !Array.isArray(otherData.specifications)
        ? { ...otherData.specifications }
        : {};
    const posLookupGsku = String(otherData.gsku || otherData.pos_lookup_code || '').trim();
    if (posLookupGsku) requestSpecs.gsku = posLookupGsku;
    const explicitBarcode = String(otherData.barcode || '').trim();
    const normalizedImageUrls = sanitizeImageUrls(otherData.images);
    const brandInput = String(
      otherData.brand || requestSpecs?.brand || brandModel || ''
    ).trim();
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

    // POS "GSKU" mode matches products.barcode, specifications.gsku, or products.gtin
    const resolvedBarcodeForPos = (explicitBarcode || gtinInput || posLookupGsku || '').trim() || null;

    // If the supplier provided a strong identifier (GTIN/barcode/GSKU), try to resolve an existing
    // APPROVED catalog product early. This makes approvals global: once any supplier's product is approved,
    // other suppliers can add offers immediately without creating new pending brand/product approvals.
    let canonicalProductFromIdentifier = null;
    if (gtinInput) {
      const { data: byGtin } = await supabase
        .from('products')
        .select('id, status, brand, gtin, barcode, name, category, specifications')
        .eq('gtin', gtinInput)
        .maybeSingle();
      if (byGtin) canonicalProductFromIdentifier = byGtin;
    }
    if (!canonicalProductFromIdentifier && resolvedBarcodeForPos) {
      const { data: byBarcode } = await supabase
        .from('products')
        .select('id, status, brand, gtin, barcode, name, category, specifications')
        .eq('barcode', resolvedBarcodeForPos)
        .maybeSingle();
      if (byBarcode) canonicalProductFromIdentifier = byBarcode;
    }

    // If we found a canonical product by identifier, treat its brand as the source of truth.
    // This prevents "new supplier typed slightly different brand" from creating a new pending brand.
    const effectiveBrandInput =
      canonicalProductFromIdentifier?.brand && String(canonicalProductFromIdentifier.brand).trim()
        ? String(canonicalProductFromIdentifier.brand).trim()
        : brandInput;

    // Brand lock: if supplier declared brands in profile, allow only those brands
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

    // Brand approval gate: brand must be admin-approved BEFORE any product can be submitted.
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
    
    // Ensure category exists (create if it doesn't)
    let categoryName = category?.trim().toLowerCase();
    if (categoryName) {
      let { data: categoryDoc } = await supabase
        .from('categories')
        .select('*')
        .eq('name', categoryName)
        .single();
      
      if (!categoryDoc) {
        const { data: newCategory } = await supabase
          .from('categories')
          .insert({
          name: categoryName,
            display_name: category.trim(),
            created_by: req.userId
          })
          .select()
          .single();
        categoryDoc = newCategory;
      }
    }
    
    // Ensure unit exists (create if it doesn't)
    let unitName = unit?.trim().toLowerCase();
    if (unitName) {
      let { data: unitDoc } = await supabase
        .from('units')
        .select('*')
        .eq('name', unitName)
        .single();
      
      if (!unitDoc) {
        const { data: newUnit } = await supabase
          .from('units')
          .insert({
          name: unitName,
            display_name: unit.trim(),
            created_by: req.userId
          })
          .select()
          .single();
        unitDoc = newUnit;
      }
    }
    
    // Normalize specifications for comparison (sort keys and stringify)
    let normalizedSpecs = requestSpecs;
    const specsString = JSON.stringify(
      Object.keys(normalizedSpecs)
        .sort()
        .reduce((obj, key) => {
          obj[key] = normalizedSpecs[key];
          return obj;
        }, {})
    );
    
    // Build Amazon-style identity bundle once and reuse it.
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

    // Guardrail: allow only admin-defined specification keys for this category when template exists.
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

    // Spec guardrails drop unknown keys; always keep POS lookup code on the catalog row
    if (posLookupGsku) {
      normalizedSpecs = { ...normalizedSpecs, gsku: posLookupGsku };
    }
    
    // Amazon-style catalog matching priority:
    // 1) GTIN exact
    // 2) Brand + MPN exact
    // 3) catalog_key fallback
    // 4) legacy name+category compatibility
    let existingProduct = null;

    // If frontend selected an existing product from search suggestions, honor that directly.
    const selectedCatalogProductId = String(catalogProductId || '').trim();
    if (selectedCatalogProductId) {
      const { data: bySelectedId } = await supabase
        .from('products')
        .select('id, status, brand, gtin, barcode, name, category, asin, catalog_key, specifications')
        .eq('id', selectedCatalogProductId)
        .maybeSingle();
      if (bySelectedId) {
        existingProduct = bySelectedId;
      }
    }

    // If identifier already resolved a canonical product, use it as the top-priority match.
    // This is the strongest "same product" signal and supports global approvals.
    if (!existingProduct && canonicalProductFromIdentifier) {
      existingProduct = canonicalProductFromIdentifier;
      console.log(`✅ Found existing product by identifier lookup:`, {
        id: existingProduct.id,
        status: existingProduct.status,
        brand: existingProduct.brand,
        gtin: existingProduct.gtin,
        barcode: existingProduct.barcode
      });
    }
    if (!existingProduct && identityBundle.catalog.gtin) {
      const { data: byGtin } = await supabase
        .from('products')
        .select('*')
        .eq('gtin', identityBundle.catalog.gtin)
        .maybeSingle();
      if (byGtin) {
        existingProduct = byGtin;
        console.log(`✅ Found existing product by GTIN: ${identityBundle.catalog.gtin}`);
      }
    }

    if (!existingProduct && identityBundle.catalog.brand && identityBundle.catalog.mpn) {
      const { data: byBrandMpn } = await supabase
        .from('products')
        .select('*')
        .eq('brand', identityBundle.catalog.brand)
        .eq('mpn', identityBundle.catalog.mpn)
        .maybeSingle();
      if (byBrandMpn) {
        existingProduct = byBrandMpn;
        console.log(`✅ Found existing product by brand+MPN`);
      }
    }

    if (!existingProduct && identityBundle.catalogKey) {
      const { data: byCatalogKey } = await supabase
        .from('products')
        .select('*')
        .eq('catalog_key', identityBundle.catalogKey)
        .maybeSingle();
      if (byCatalogKey) {
        existingProduct = byCatalogKey;
        console.log(`✅ Found existing product by catalog_key`);
      }
    }

    if (!existingProduct && productName && categoryName) {
      // Legacy fallback for old rows without identity columns.
      const { data: productsByName, error: nameSearchError } = await supabase
        .from('products')
        .select('*')
        .eq('category', categoryName)
        .ilike('name', productNameRaw);

      if (!nameSearchError && productsByName && productsByName.length > 0) {
        // If multiple matches, prefer exact match, otherwise take first
        const exactMatch = productsByName.find(p => 
          normalizeText(p.name) === normalizeText(productNameRaw)
        );
        existingProduct = exactMatch || productsByName[0];
        console.log(`✅ Found existing product by name+category:`, {
          id: existingProduct.id,
          name: existingProduct.name,
          category: existingProduct.category,
          status: existingProduct.status
        });
      } else {
        // If no exact match, try normalized comparison for all products in category
        const { data: allCategoryProducts, error: categoryError } = await supabase
          .from('products')
          .select('*')
          .eq('category', categoryName);
        
        if (!categoryError && allCategoryProducts && allCategoryProducts.length > 0) {
          const normalizedInputName = normalizeText(productNameRaw);
          const match = allCategoryProducts.find(p => {
            const normalizedProductName = normalizeText(p.name);
            return normalizedProductName === normalizedInputName;
          });
          
          if (match) {
            existingProduct = match;
            console.log(`✅ Found existing product by normalized name+category:`, {
              id: existingProduct.id,
              name: existingProduct.name,
              category: existingProduct.category,
              status: existingProduct.status
            });
          }
        }
      }
    }
    
    let productId;
    let catalogAsin;
    let isNewProduct = false;
    
    // If existing product found, use its ID (same product ID for same product)
    if (existingProduct) {
      productId = existingProduct.id;
      catalogAsin = existingProduct.asin || identityBundle.asinLikeId;
      console.log(`🔄 Product already exists with ID: ${productId}. Adding supplier-specific data.`);

      // Backward-compatibility: older/shared products may have `supplier_id` null.
      // Admin UI expects `products.supplier_id` to show who submitted the product,
      // so fill it only if it's currently missing.
      if (!existingProduct.supplier_id) {
        try {
          await supabase
            .from('products')
            .update({ supplier_id: req.userId })
            .eq('id', productId)
            .is('supplier_id', null);
        } catch (e) {
          // Don't block adding supplier_products if this update fails.
          console.log('⚠️ Failed to backfill products.supplier_id:', e?.message || e);
        }
      }

      // Backfill identity columns for legacy products where possible.
      try {
        const patch = {};
        if (!existingProduct.asin) patch.asin = identityBundle.asinLikeId;
        if (!existingProduct.gtin && identityBundle.catalog.gtin) patch.gtin = identityBundle.catalog.gtin;
        if (!existingProduct.mpn && identityBundle.catalog.mpn) patch.mpn = identityBundle.catalog.mpn;
        if (!existingProduct.brand && identityBundle.catalog.brand) patch.brand = identityBundle.catalog.brand;
        if (!existingProduct.catalog_key) patch.catalog_key = identityBundle.catalogKey;
        if (!existingProduct.barcode && resolvedBarcodeForPos) patch.barcode = resolvedBarcodeForPos;

        if (Object.keys(patch).length > 0) {
          await supabase.from('products').update(patch).eq('id', productId);
        }
      } catch (e) {
        console.log('⚠️ Failed to backfill product identity columns:', e?.message || e);
      }
    } else {
      // Create new product with shared data only.
      // NOTE: The products table still has NOT NULL constraints on price, stock and location,
      // so we also populate those fields from the first supplier's data to satisfy the constraint.
      const basePrice = otherData.price !== undefined ? parseFloat(otherData.price) : 0;
      const baseStock = otherData.stock !== undefined ? parseInt(otherData.stock) : 0;
      const baseMinOrderQty = otherData.min_order_quantity !== undefined
        ? parseInt(otherData.min_order_quantity)
        : 1;
      const baseLocation = (otherData.location || '').trim() || 'Not specified';
    
    const productData = {
        name: otherData.name,
        description: otherData.description || '',
      category: categoryName,
      unit: unitName,
        images: normalizedImageUrls,
        specifications: normalizedSpecs,
        // Used by admin UI / legacy joins. Authoritative values for offers live in `supplier_products`.
        supplier_id: req.userId,
        // These fields are primarily used for backward compatibility; the authoritative
        // supplier-specific values now live in supplier_products.
        price: isNaN(basePrice) ? 0 : basePrice,
        stock: isNaN(baseStock) ? 0 : baseStock,
        min_order_quantity: isNaN(baseMinOrderQty) || baseMinOrderQty < 1 ? 1 : baseMinOrderQty,
        location: baseLocation
      };
      
      console.log(`📦 Creating new product with shared data`);

      // Persist Amazon-style identity signals.
      productData.asin = identityBundle.asinLikeId;
      productData.gtin = identityBundle.catalog.gtin || null;
      productData.mpn = identityBundle.catalog.mpn || null;
      productData.brand = identityBundle.catalog.brand || null;
      productData.catalog_key = identityBundle.catalogKey;
      if (resolvedBarcodeForPos) productData.barcode = resolvedBarcodeForPos;
    
    const { data: newProduct, error: createError } = await supabase
      .from('products')
      .insert(productData)
      .select()
      .single();
    
    if (createError) {
      console.error('Product creation error:', createError);
      return res.status(400).json({
        status: 'error',
        message: createError.message || 'Error creating product'
      });
    }
    
      productId = newProduct.id;
      catalogAsin = newProduct.asin || identityBundle.asinLikeId;
      isNewProduct = true;
    console.log(`✅ Product created successfully:`, {
      id: newProduct.id,
        name: newProduct.name
      });
    }
    
    // Check if exact supplier variant already exists for this supplier/product/location.
    const currentLocation = (otherData.location || '').trim();
    const { data: existingSupplierProduct } = await supabase
      .from('supplier_products')
      .select('*')
      .eq('product_id', productId)
      .eq('supplier_id', req.userId)
      .eq('location', currentLocation)
      .eq('variant_key', identityBundle.variantKey)
      .maybeSingle();
    
    if (existingSupplierProduct) {
      return res.status(400).json({
        status: 'error',
        message: 'You have already added this exact product variation for this location. Please update the existing entry instead.'
      });
    }
    
    // Create supplier_products entry with supplier-specific data
    // IMPORTANT: If this is a brand new product (first supplier to add it), 
    // the supplier entry should be pending admin approval.
    // If the product already exists (other suppliers have it, regardless of their status),
    // auto-approve this supplier's entry since the product is already in the system.
    const parsedPrice = parseFloat(otherData.price);
    const parsedStock = parseInt(otherData.stock);
    const parsedMinOrderQty = parseInt(otherData.min_order_quantity);

    // Approval rule:
    // - Auto-approve only when this exact variant_key is already approved in the catalog offers.
    // - If specs differ (new variant_key), keep pending for admin review even if base product is approved.
    const { data: approvedVariantOffer } = await supabase
      .from('supplier_products')
      .select('id')
      .eq('product_id', productId)
      .eq('variant_key', identityBundle.variantKey)
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
    const variantAsin = buildVariantAsinLikeId(catalogAsin || identityBundle.asinLikeId, identityBundle.variantKey);

    const supplierProductData = {
      product_id: productId,
      supplier_id: req.userId,
      price: isNaN(parsedPrice) ? 0 : parsedPrice,
      stock: isNaN(parsedStock) ? 0 : parsedStock,
      min_order_quantity: isNaN(parsedMinOrderQty) || parsedMinOrderQty < 1 ? 1 : parsedMinOrderQty,
      location: currentLocation,
      outlet_id: outlet_id || null,
      // Approved only if the shared product is approved by admin.
      status: shouldBeApproved ? 'approved' : 'pending',
      is_active: shouldBeApproved ? true : false,
      igst_rate: igstRate,
      cgst_rate: cgstRate,
      sgst_rate: sgstRate,
      variant_key: identityBundle.variantKey,
      variant_asin: variantAsin,
      // Store supplier-specific extended data so we always keep their version
      // of the product, even if the shared products row is the same.
      attributes: {
        // Supplier-specific description (can differ from base product)
        description: otherData.description || '',
        // Supplier-specific specifications (if they provided their own)
        specifications: otherData.specifications || normalizedSpecs,
        // Raw name/category they sent (for audit)
        name: otherData.name,
        category: category,
        // Supplier-provided combined brand/model string (e.g., "ACC OPC 53 - 50kg")
        brandModel: (brandModel || '').toString().trim(),
        // Canonical brand + manufacturer part number used for catalog matching.
        brand: effectiveBrandInput,
        mpn: mpnInput,
        gtin: gtinInput,
        // Supplier-provided LSA code/value for inventory tracking
        lsa: (lsa || '').toString().trim(),
        // Supplier-provided HSN code for exact GST determination
        hsnCode: (hsnCode || '').toString().trim(),
        // Optional identifiers used to compute variation identity.
        sku: (requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '').toString().trim(),
        packSize: (requestSpecs?.packSize || requestSpecs?.pack_size || '').toString().trim(),
        unit: (unit || '').toString().trim(),
        // Admin-defined category specification values used for variation uniqueness.
        variantAttributes: identityBundle.variant.variantAttributes,
        // Any extra fields we might care about later can be added here
        igstRate,
        cgstRate,
        sgstRate,
        tags: otherData.tags || [],
        images: normalizedImageUrls
      }
    };
    
    console.log(`📦 Creating supplier_products entry for product: ${productId}, supplier: ${req.userId}`);

    const { data: newSupplierProduct, error: supplierProductError } = await supabase
      .from('supplier_products')
      .insert(supplierProductData)
      .select()
      .single();
    
    if (supplierProductError) {
      console.error('Supplier product creation error:', supplierProductError);
      
      // Check if error is due to unique constraint violation (supplier already has this product)
      if (supplierProductError.code === '23505' || supplierProductError.message?.includes('duplicate') || supplierProductError.message?.includes('unique')) {
        return res.status(400).json({
          status: 'error',
          message: 'This exact product variation already exists for the same location. Please update the existing entry instead.'
        });
      }
      
      // If this was a new product, we might want to clean it up, but for now just return error
      return res.status(400).json({
        status: 'error',
        message: supplierProductError.message || 'Error creating supplier product entry'
      });
    }
    
    console.log(`✅ Supplier product entry created successfully:`, {
      id: newSupplierProduct.id,
      productId: newSupplierProduct.product_id,
      supplierId: newSupplierProduct.supplier_id,
      price: newSupplierProduct.price,
      status: newSupplierProduct.status
    });

    // Guardrails path: upsert canonical family/variant refs and queue uncertain rows for review.
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
          if (existingFamily?.id) {
            familyId = existingFamily.id;
          } else {
            const { data: createdFamily } = await supabase
              .from('product_families')
              .insert({
                canonical_name: otherData.name || 'Unnamed Product',
                brand: identityBundle.catalog.brand || null,
                category: categoryName || 'uncategorized',
                model_line: (brandModel || '').toString().trim() || null,
                normalized_family_key: familyKey,
                status: 'active',
                created_by: req.userId
              })
              .select('id')
              .single();
            familyId = createdFamily?.id || null;
          }
        }

        let productVariantId = null;
        if (familyId) {
          const { data: existingVariant } = await supabase
            .from('product_variants')
            .select('id')
            .eq('family_id', familyId)
            .eq('variant_key', identityBundle.variantKey)
            .maybeSingle();

          if (existingVariant?.id) {
            productVariantId = existingVariant.id;
          } else {
            const { data: createdVariant } = await supabase
              .from('product_variants')
              .insert({
                family_id: familyId,
                product_id: productId,
                variant_name: otherData.name || null,
                variant_key: identityBundle.variantKey,
                variant_asin: variantAsin,
                gtin: identityBundle.catalog.gtin || null,
                mpn: identityBundle.catalog.mpn || null,
                brand: identityBundle.catalog.brand || null,
                unit: unitName || null,
                pack_size: requestSpecs?.packSize || requestSpecs?.pack_size || null,
                canonical_attributes: identityBundle.variant.variantAttributes || {},
                status: shouldBeApproved ? 'approved' : 'review_pending',
                created_by: req.userId
              })
              .select('id')
              .single();
            productVariantId = createdVariant?.id || null;
          }
        }

        if (familyId) {
          await supabase
            .from('products')
            .update({ family_id: familyId, variant_id: productVariantId || null })
            .eq('id', productId);
        }
        if (productVariantId) {
          await supabase
            .from('supplier_products')
            .update({ product_variant_id: productVariantId, price_updated_at: new Date().toISOString() })
            .eq('id', newSupplierProduct.id);
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

        let requestId = null;
        if (finalDecision !== 'auto_linked') {
          const { data: createdRequest } = await supabase
            .from('product_requests')
            .insert({
              requested_by: req.userId,
              supplier_id: req.userId,
              source: 'supplier',
              status: 'new',
              category: categoryName || null,
              normalized_input: {
                name: otherData.name || '',
                category: categoryName,
                identityBundle
              },
              ai_prefill: {
                templateId: template?.id || null,
                values: specValidation.allowed
              },
              confidence_score: confidenceScore,
              resolved_product_id: productId,
              resolved_variant_id: productVariantId
            })
            .select('id')
            .single();
          requestId = createdRequest?.id || null;
        }

        await supabase
          .from('product_ingestion_runs')
          .insert({
            request_id: requestId,
            supplier_id: req.userId,
            provider: 'manual',
            model: 'supplier_portal',
            prompt_version: 'v1',
            input_payload: {
              body: req.body,
              templateId: template?.id || null
            },
            extracted_payload: otherData.specifications || requestSpecs || {},
            validated_payload: specValidation.allowed || {},
            confidence_score: confidenceScore,
            validation_errors: specValidation.errors || [],
            final_decision: finalDecision,
            actor_id: req.userId
          });
      } catch (guardrailError) {
        console.log('⚠️ Guardrails metadata write failed:', guardrailError?.message || guardrailError);
      }
    }

    if (!isCatalogGuardrailsEnabled()) {
      // Backward compatibility mode: keep syncing legacy catalog commercial fields.
      try {
        await supabase
          .from('products')
          .update({
            price: newSupplierProduct.price,
            stock: newSupplierProduct.stock,
            min_order_quantity: newSupplierProduct.min_order_quantity,
            location: newSupplierProduct.location,
            supplier_id: req.userId
          })
          .eq('id', productId);
        console.log('✅ Synced legacy products.price/stock from supplier_products (create)');
      } catch (e) {
        console.log('⚠️ Failed to sync legacy products price/stock (create):', e?.message || e);
      }
    }

    // Persist model-level shared specification profile so other suppliers
    // see the same model keys/values next time they add this model.
    await upsertModelSpecProfile({
      category: categoryName || category,
      modelRaw: mpnInput || brandModel,
      specifications: normalizedSpecs,
      actorUserId: req.userId
    });
    
    // Fetch the complete product with supplier data for response
    const { data: completeProduct, error: fetchError } = await supabase
      .from('products')
      .select(`
        *,
        supplier_products!inner(*)
      `)
      .eq('id', productId)
      .eq('supplier_products.supplier_id', req.userId)
      .eq('supplier_products.location', currentLocation)
        .eq('supplier_products.variant_key', identityBundle.variantKey)
      .single();
    
    let responseProduct;

    if (fetchError) {
      // Fallback: fetch product and supplier_products separately
      const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();
      
      const { data: supplierProduct } = await supabase
        .from('supplier_products')
        .select('*')
        .eq('product_id', productId)
        .eq('supplier_id', req.userId)
        .eq('location', currentLocation)
        .eq('variant_key', identityBundle.variantKey)
        .maybeSingle();
      
      // Combine for response
      responseProduct = {
        ...product,
        price: supplierProduct?.price,
        stock: supplierProduct?.stock,
        igst_rate: supplierProduct?.igst_rate ?? supplierProduct?.attributes?.igstRate ?? null,
        cgst_rate: supplierProduct?.cgst_rate ?? supplierProduct?.attributes?.cgstRate ?? null,
        sgst_rate: supplierProduct?.sgst_rate ?? supplierProduct?.attributes?.sgstRate ?? null,
        location: supplierProduct?.location,
        min_order_quantity: supplierProduct?.min_order_quantity,
        status: supplierProduct?.status,
        is_active: supplierProduct?.is_active,
        supplier_id: req.userId,
        variantKey: supplierProduct?.variant_key || identityBundle.variantKey,
        variantAsin: supplierProduct?.variant_asin || variantAsin,
        brandModel: supplierProduct?.attributes?.brandModel,
        lsa: supplierProduct?.attributes?.lsa,
        hsnCode: supplierProduct?.attributes?.hsnCode,
        images:
          sanitizeImageUrls(supplierProduct?.attributes?.images).length > 0
            ? sanitizeImageUrls(supplierProduct?.attributes?.images)
            : sanitizeImageUrls(product?.images)
      };
      
      console.log(`✅ Product and supplier data combined successfully`);
    } else {
      // If we got completeProduct from join query, use that
      responseProduct = {
        ...completeProduct,
        price: completeProduct.supplier_products[0]?.price,
        stock: completeProduct.supplier_products[0]?.stock,
        igst_rate:
          completeProduct.supplier_products[0]?.igst_rate ??
          completeProduct.supplier_products[0]?.attributes?.igstRate ??
          null,
        cgst_rate:
          completeProduct.supplier_products[0]?.cgst_rate ??
          completeProduct.supplier_products[0]?.attributes?.cgstRate ??
          null,
        sgst_rate:
          completeProduct.supplier_products[0]?.sgst_rate ??
          completeProduct.supplier_products[0]?.attributes?.sgstRate ??
          null,
        location: completeProduct.supplier_products[0]?.location,
        min_order_quantity: completeProduct.supplier_products[0]?.min_order_quantity,
        status: completeProduct.supplier_products[0]?.status,
        is_active: completeProduct.supplier_products[0]?.is_active,
        supplier_id: req.userId,
        variantKey: completeProduct.supplier_products[0]?.variant_key || identityBundle.variantKey,
        variantAsin: completeProduct.supplier_products[0]?.variant_asin || variantAsin,
        brandModel: completeProduct.supplier_products[0]?.attributes?.brandModel,
        lsa: completeProduct.supplier_products[0]?.attributes?.lsa,
        hsnCode: completeProduct.supplier_products[0]?.attributes?.hsnCode,
        images:
          sanitizeImageUrls(completeProduct.supplier_products[0]?.attributes?.images).length > 0
            ? sanitizeImageUrls(completeProduct.supplier_products[0]?.attributes?.images)
            : sanitizeImageUrls(completeProduct?.images)
      };
    }

    // Get supplier info for notifications
    const { data: supplier } = await findUserBasicById(req.userId, supabase);

    // Notify admins for approvals when product/variant is pending review.
    if (!shouldBeApproved) {
      // Create notification for all admins
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: admins } = await findAdmins(adminEmail, supabase);

      if (admins && admins.length > 0) {
        const notifications = admins.map((admin) => ({
          user_id: admin.id,
          type: 'product_approval',
          title: `Product/Variant Pending Approval: ${responseProduct.name}`,
          message: `${supplier?.name} (${supplier?.company || supplier?.email}) added "${responseProduct.name}" with variant specifications that require your approval.`,
          related_product_id: productId,
          related_supplier_id: supplier?.id || req.userId,
          metadata: {
            productName: responseProduct.name,
            productDescription: responseProduct.description,
            productCategory: responseProduct.category,
            productPrice: responseProduct.price,
            productUnit: responseProduct.unit,
            productStock: responseProduct.stock,
            productLocation: responseProduct.location,
            productMinOrderQuantity: responseProduct.min_order_quantity,
            productSpecifications: responseProduct.specifications,
            supplierName: supplier?.name,
            supplierEmail: supplier?.email,
            supplierCompany: supplier?.company,
            productId: productId,
            isExistingProduct: !isNewProduct,
            variantKey: identityBundle.variantKey
          },
          is_read: false
        }));

        if (notifications.length > 0) {
          await insertNotifications(notifications, supabase);
          console.log(`Created ${notifications.length} admin approval notification(s) for pending product/variant`);
        }
      }
    } else {
      // Product already exists in the catalog; still notify admins that this supplier
      // added/updated an inventory offer for it (so admin can review latest stock/price).
      try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
        const { data: admins } = await findAdmins(adminEmail, supabase);

        if (admins && admins.length > 0) {
          const notifications = admins.map((admin) => ({
            user_id: admin.id,
            type: 'supplier_edit',
            title: `Supplier Updated Inventory: ${responseProduct.name}`,
            message: `${supplier?.name || 'Supplier'} added inventory for "${responseProduct.name}" (Price: ₹${
              responseProduct.price ?? 0
            }, Stock: ${responseProduct.stock ?? 0}, Location: ${
              responseProduct.location || 'N/A'
            }).`,
            related_product_id: productId,
            related_supplier_id: supplier?.id || req.userId,
            metadata: {
              productId,
              productName: responseProduct.name,
              supplierId: req.userId,
              supplierName: supplier?.name,
              price: responseProduct.price ?? 0,
              stock: responseProduct.stock ?? 0,
              location: responseProduct.location || null,
              minOrderQuantity: responseProduct.min_order_quantity ?? null,
              status: responseProduct.status ?? null
            },
            is_read: false
          }));

          await insertNotifications(notifications, supabase);
          console.log(`Created ${notifications.length} admin notification(s) for supplier inventory offer (existing product)`);
        }
      } catch (notifErr) {
        console.log('⚠️ Failed to notify admins for supplier inventory offer:', notifErr?.message || notifErr);
      }
    }

    // If this product was originally requested by a service provider, notify them
    // that a supplier has now added it and it is available in the marketplace.
    if (!isNewProduct && responseProduct && responseProduct.requested_by_service_provider_id) {
      try {
        await insertNotification({
            user_id: responseProduct.requested_by_service_provider_id,
            type: 'system',
            title: `Supplier added your requested product: ${responseProduct.name}`,
            message: `${supplier?.name || 'A supplier'} (${supplier?.company || supplier?.email || ''}) has added the product "${responseProduct.name}". You can now use this product in your BOQs and purchase orders.`,
            related_product_id: productId,
            related_supplier_id: req.userId,
            metadata: {
              productId: productId,
              productName: responseProduct.name,
              productCategory: responseProduct.category,
              productUnit: responseProduct.unit,
              supplierId: req.userId,
              supplierName: supplier?.name,
              supplierCompany: supplier?.company,
              source: 'service_provider_request_fulfilled'
            }
          }, supabase);
        console.log(
          `Notified service provider ${responseProduct.requested_by_service_provider_id} that supplier ${req.userId} added requested product ${productId}`
        );
      } catch (spNotifError) {
        console.error(
          'Failed to create notification for service provider about requested product being added:',
          spNotifError
        );
      }
    }

    // Determine the appropriate success message
    let successMessage;
    if (!shouldBeApproved) {
      successMessage = 'Product added successfully and is pending admin approval for this variant.';
    } else {
      successMessage = 'Product added successfully and is immediately available.';
    }
    
    res.status(201).json({ 
      status: 'success',
      message: successMessage,
      product: responseProduct,
      nextStep: {
        type: 'bcov_setup',
        supplierProductId: responseProduct?.supplier_product_id || null,
        variantKey: responseProduct?.variantKey || null,
        variantAsin: responseProduct?.variantAsin || null,
        brand: String(
          responseProduct?.brandModel ||
          responseProduct?.brand ||
          responseProduct?.specifications?.brandModel ||
          responseProduct?.specifications?.brand ||
          ''
        ).trim(),
        productName: String(responseProduct?.name || '').trim()
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Add product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Update product (supports both shared product data and supplier-specific inventory)
router.put('/products/:id', authenticateToken, async (req, res) => {
  try {
    req.body = parseWithSchema(supplierProductUpdateSchema, req.body || {});
    const id = req.params.id;
    console.log(`[Supplier Inventory] PUT /api/supplier/products/${id} by supplier ${req.userId}`, {
      bodyKeys: Object.keys(req.body || {}),
      price: req.body?.price,
      stock: req.body?.stock,
      location: req.body?.location
    });

    // ============================
    // 1) Try to treat ID as supplier_products.id (inventory update)
    // ============================
    const { data: supplierProduct, error: supplierProductError } = await supabase
      .from('supplier_products')
      .select('*')
      .eq('id', id)
      .eq('supplier_id', req.userId)
      .maybeSingle();

    if (supplierProduct) {
      console.log(`Updating supplier_products entry ${id} for supplier ${req.userId}:`, {
        location: req.body.location,
        price: req.body.price,
        stock: req.body.stock
      });

      // Build update object for supplier_products
      const parsedPrice = parseFloat(req.body.price);
      const parsedStock = parseInt(req.body.stock);
      const parsedMinOrderQty = parseInt(
        req.body.min_order_quantity !== undefined
          ? req.body.min_order_quantity
          : supplierProduct.min_order_quantity || 1
      );
      const taxFieldsProvided =
        req.body.igst_rate !== undefined ||
        req.body.igstRate !== undefined ||
        req.body.cgst_rate !== undefined ||
        req.body.cgstRate !== undefined ||
        req.body.sgst_rate !== undefined ||
        req.body.sgstRate !== undefined;

      const updateSupplierProductData = {};

      if (req.body.price !== undefined) {
        updateSupplierProductData.price = Number.isFinite(parsedPrice)
          ? parsedPrice
          : supplierProduct.price;
        updateSupplierProductData.price_updated_at = new Date().toISOString();
      }

      if (req.body.stock !== undefined) {
        updateSupplierProductData.stock =
          Number.isInteger(parsedStock) && parsedStock >= 0
            ? parsedStock
            : supplierProduct.stock;
      }

      if (req.body.location !== undefined) {
        const newLocation = (req.body.location || '').trim();
        updateSupplierProductData.location = newLocation || supplierProduct.location;
      }

      if (req.body.min_order_quantity !== undefined) {
        updateSupplierProductData.min_order_quantity =
          Number.isInteger(parsedMinOrderQty) && parsedMinOrderQty > 0
            ? parsedMinOrderQty
            : supplierProduct.min_order_quantity || 1;
      }

      if (taxFieldsProvided) {
        const taxValidation = validateAndNormalizeTaxRates(req.body);
        if (!taxValidation.ok) {
          return res.status(400).json({
            status: 'error',
            message: taxValidation.message
          });
        }
        updateSupplierProductData.igst_rate = taxValidation.data.igstRate;
        updateSupplierProductData.cgst_rate = taxValidation.data.cgstRate;
        updateSupplierProductData.sgst_rate = taxValidation.data.sgstRate;
      }

      // Update supplier-specific attributes (description, specifications)
      const existingAttributes = supplierProduct.attributes || {};
      const updatedAttributes = { ...existingAttributes };

      if (req.body.description !== undefined) {
        updatedAttributes.description = req.body.description;
      }

      // Variant-level listing fields (shared products row is the same for all variants)
      if (req.body.name !== undefined) {
        updatedAttributes.listingName = (req.body.name || '').toString().trim();
      }
      if (req.body.brand !== undefined) {
        updatedAttributes.brand = (req.body.brand || '').toString().trim();
      }
      if (req.body.gtin !== undefined) {
        const g = normalizeGtin(req.body.gtin || '');
        if (g && !isValidGtin(g)) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid GTIN. Use 8, 12, 13, or 14 digit numeric code.'
          });
        }
        updatedAttributes.gtin = g || null;
      }
      if (req.body.mpn !== undefined) {
        updatedAttributes.mpn = (req.body.mpn || '').toString().trim();
      }

      if (req.body.specifications !== undefined) {
        updatedAttributes.specifications =
          req.body.specifications || existingAttributes.specifications || {};
      }

      if (req.body.brandModel !== undefined) {
        updatedAttributes.brandModel = (req.body.brandModel || '').toString().trim();
      }

      if (req.body.lsa !== undefined) {
        updatedAttributes.lsa = (req.body.lsa || '').toString().trim();
      }
      if (req.body.hsnCode !== undefined || req.body.hsn_code !== undefined) {
        const rawHsnCode = req.body.hsnCode !== undefined ? req.body.hsnCode : req.body.hsn_code;
        updatedAttributes.hsnCode = (rawHsnCode || '').toString().trim();
      }
      if (req.body.sku !== undefined || req.body.skuNo !== undefined || req.body.gsku !== undefined) {
        updatedAttributes.sku = (
          req.body.skuNo !== undefined ? req.body.skuNo : req.body.sku !== undefined ? req.body.sku : req.body.gsku
        || '').toString().trim();
      }
      if (req.body.packSize !== undefined || req.body.pack_size !== undefined) {
        updatedAttributes.packSize = (
          req.body.packSize !== undefined ? req.body.packSize : req.body.pack_size
        || '').toString().trim();
      }
      if (req.body.unit !== undefined) {
        updatedAttributes.unit = (req.body.unit || '').toString().trim();
      }
      if (req.body.images !== undefined) {
        updatedAttributes.images = sanitizeImageUrls(req.body.images);
      }

      const nextSpecifications = req.body.specifications !== undefined
        ? (req.body.specifications || {})
        : (existingAttributes.specifications || {});
      updatedAttributes.variantAttributes = normalizeVariantAttributes(nextSpecifications);

      const specificationsChanged = shouldMoveToPendingForSpecChange({
        specificationsProvided: req.body.specifications !== undefined,
        currentSpecs: existingAttributes.specifications || {},
        nextSpecs: nextSpecifications || {}
      });

      if (Object.keys(updatedAttributes).length > 0) {
        if (taxFieldsProvided) {
          updatedAttributes.igstRate = updateSupplierProductData.igst_rate;
          updatedAttributes.cgstRate = updateSupplierProductData.cgst_rate;
          updatedAttributes.sgstRate = updateSupplierProductData.sgst_rate;
        }
        updateSupplierProductData.attributes = updatedAttributes;
      }

      // Brand lock on inventory updates: do not allow changing/setting brandModel outside declared brands
      if (req.body.brandModel !== undefined) {
        const nextBrand = updatedAttributes.brandModel;
        const brandGuard = brandIsAllowedForSupplier(req.user?.profile, nextBrand);
        if (!brandGuard.allowed) {
          return res.status(403).json({
            status: 'error',
            message:
              brandGuard.reason === 'brand_required'
                ? 'Brand is required because you have selected brands in your profile.'
                : 'You can only update inventory for brands you selected in your profile.',
            allowedBrands: brandGuard.declared || []
          });
        }
      }

      // Recompute variation identity for uniqueness checks.
      const candidateLocation = req.body.location !== undefined
        ? ((req.body.location || '').trim() || supplierProduct.location)
        : supplierProduct.location;
      const variantIdentity = buildIdentityBundle({
        unit: req.body.unit !== undefined ? req.body.unit : updatedAttributes.unit,
        brandModel: updatedAttributes.brandModel,
        sku: updatedAttributes.sku,
        packSize: updatedAttributes.packSize,
        specifications: nextSpecifications
      });
      updateSupplierProductData.variant_key = variantIdentity.variantKey;
      const { data: productIdentity } = await supabase
        .from('products')
        .select('asin')
        .eq('id', supplierProduct.product_id)
        .maybeSingle();
      updateSupplierProductData.variant_asin = buildVariantAsinLikeId(
        productIdentity?.asin || '',
        variantIdentity.variantKey
      );

      // Prevent duplicate exact variation rows when location/attributes change.
      const { data: duplicateVariant } = await supabase
        .from('supplier_products')
        .select('id')
        .eq('product_id', supplierProduct.product_id)
        .eq('supplier_id', req.userId)
        .eq('location', candidateLocation)
        .eq('variant_key', variantIdentity.variantKey)
        .neq('id', id)
        .maybeSingle();

      if (duplicateVariant) {
        return res.status(400).json({
          status: 'error',
          message: 'An identical product variation already exists for this location. Update that offer instead.'
        });
      }

      // Any supplier spec change must go back through admin approval workflow.
      // This enforces controlled variant changes even on previously approved offers.
      let movedToPendingForSpecReview = false;
      if (specificationsChanged) {
        movedToPendingForSpecReview = true;
        updateSupplierProductData.status = 'pending';
        updateSupplierProductData.is_active = false;
        updateSupplierProductData.approved_by = null;
        updateSupplierProductData.approved_at = null;
        updateSupplierProductData.rejection_reason = null;
      }

      // Only perform update if there's something to change
      if (Object.keys(updateSupplierProductData).length === 0) {
        return res.json({
          status: 'success',
          message: 'No changes detected',
          product: supplierProduct
        });
      }

      const { data: updatedSupplierProduct, error: spUpdateError } = await supabase
        .from('supplier_products')
        .update(updateSupplierProductData)
        .eq('id', id)
        .eq('supplier_id', req.userId)
        .select('*')
        .single();

      if (spUpdateError || !updatedSupplierProduct) {
        console.error('Supplier product update error:', spUpdateError);
        return res.status(400).json({
          status: 'error',
          message: spUpdateError?.code === '23505'
            ? 'This exact product variation already exists for the selected location.'
            : (spUpdateError?.message || 'Failed to update product')
        });
      }

      if (req.body.stock !== undefined) {
        const prevS = parseInt(supplierProduct.stock, 10) || 0;
        const newS = parseInt(updatedSupplierProduct.stock, 10) || 0;
        if (newS !== prevS) {
          void maybeNotifyInventoryBelowMov({
            supplierId: req.userId,
            supplierProductId: updatedSupplierProduct.id,
            previousStock: prevS,
            newStock: newS,
            quantityChange: newS - prevS
          });
        }
      }

      // Fetch shared product data to return a combined object
      const { data: baseProduct, error: baseProductError } = await supabase
        .from('products')
        .select('*')
        .eq('id', updatedSupplierProduct.product_id)
        .single();

      if (baseProductError || !baseProduct) {
        console.error('Failed to fetch base product for updated supplier product:', baseProductError);
      }

      await upsertModelSpecProfile({
        category: req.body.category || baseProduct?.category,
        modelRaw: req.body.mpn || updatedAttributes.brandModel || baseProduct?.mpn,
        specifications: nextSpecifications,
        actorUserId: req.userId
      });

    if (!isCatalogGuardrailsEnabled()) {
      // Legacy: mirror one offer onto products — only safe when this supplier has a single offer
      // for that catalog id (otherwise variants overwrite each other on the shared row).
      try {
        const { data: siblingOffers } = await supabase
          .from('supplier_products')
          .select('id')
          .eq('product_id', updatedSupplierProduct.product_id)
          .eq('supplier_id', req.userId)
          .neq('status', 'rejected');
        if ((siblingOffers || []).length <= 1) {
          await supabase
            .from('products')
            .update({
              price: updatedSupplierProduct.price,
              stock: updatedSupplierProduct.stock,
              min_order_quantity: updatedSupplierProduct.min_order_quantity,
              location: updatedSupplierProduct.location,
              supplier_id: updatedSupplierProduct.supplier_id || req.userId
            })
            .eq('id', updatedSupplierProduct.product_id);
          console.log('✅ Synced legacy products.price/stock from supplier_products update');
        }
      } catch (e) {
        console.log('⚠️ Failed to sync legacy products.price/stock:', e?.message || e);
      }
    }

      const ra = updatedSupplierProduct.attributes || {};
      const responseProduct = {
        ...(baseProduct || {}),
        name:
          (ra.listingName != null && String(ra.listingName).trim() !== '')
            ? String(ra.listingName).trim()
            : baseProduct?.name,
        description:
          ra.description !== undefined && ra.description !== null && String(ra.description) !== ''
            ? ra.description
            : baseProduct?.description ?? '',
        brand: ra.brand || baseProduct?.brand,
        gtin: ra.gtin || baseProduct?.gtin,
        mpn: ra.mpn || baseProduct?.mpn,
        specifications: {
          ...(typeof baseProduct?.specifications === 'object' ? baseProduct.specifications : {}),
          ...(typeof ra.specifications === 'object' ? ra.specifications : {})
        },
        brandModel: updatedSupplierProduct.attributes?.brandModel,
        lsa: updatedSupplierProduct.attributes?.lsa,
        hsnCode: updatedSupplierProduct.attributes?.hsnCode,
        price: updatedSupplierProduct.price,
        stock: updatedSupplierProduct.stock,
        igst_rate: updatedSupplierProduct.igst_rate ?? updatedSupplierProduct.attributes?.igstRate ?? null,
        cgst_rate: updatedSupplierProduct.cgst_rate ?? updatedSupplierProduct.attributes?.cgstRate ?? null,
        sgst_rate: updatedSupplierProduct.sgst_rate ?? updatedSupplierProduct.attributes?.sgstRate ?? null,
        location: updatedSupplierProduct.location,
        min_order_quantity: updatedSupplierProduct.min_order_quantity,
        status: updatedSupplierProduct.status,
        is_active: updatedSupplierProduct.is_active,
        supplier_id: updatedSupplierProduct.supplier_id,
        supplier_product_id: updatedSupplierProduct.id,
        variantKey: updatedSupplierProduct.variant_key,
        variantAsin: updatedSupplierProduct.variant_asin,
        images:
          sanitizeImageUrls(updatedSupplierProduct.attributes?.images).length > 0
            ? sanitizeImageUrls(updatedSupplierProduct.attributes?.images)
            : sanitizeImageUrls(baseProduct?.images)
      };

      console.log(
        `Supplier product ${updatedSupplierProduct.id} updated successfully. New location: "${updatedSupplierProduct.location}"`
      );

      // Notify admins about supplier inventory/tracking updates.
      // This branch updates `supplier_products` directly, which previously had no admin notification.
      try {
        const changes = [];

        // Price/stock/location/min order
        if (supplierProduct.price !== updatedSupplierProduct.price) {
          changes.push(`Price: ₹${supplierProduct.price} → ₹${updatedSupplierProduct.price}`);
        }
        if (supplierProduct.stock !== updatedSupplierProduct.stock) {
          changes.push(`Stock: ${supplierProduct.stock} → ${updatedSupplierProduct.stock}`);
        }
        if (supplierProduct.location !== updatedSupplierProduct.location) {
          changes.push(`Location: "${supplierProduct.location}" → "${updatedSupplierProduct.location}"`);
        }
        if (supplierProduct.min_order_quantity !== updatedSupplierProduct.min_order_quantity) {
          changes.push(
            `Min Order Qty: ${supplierProduct.min_order_quantity} → ${updatedSupplierProduct.min_order_quantity}`
          );
        }

        // Tracking attributes stored inside attributes JSONB
        const oldAttrs = supplierProduct.attributes || {};
        const newAttrs = updatedSupplierProduct.attributes || {};
        if ((oldAttrs.brandModel || '') !== (newAttrs.brandModel || '')) {
          changes.push(`BrandModel: ${oldAttrs.brandModel || '-'} → ${newAttrs.brandModel || '-'}`);
        }
        if ((oldAttrs.lsa || '') !== (newAttrs.lsa || '')) {
          changes.push(`LSA: ${oldAttrs.lsa || '-'} → ${newAttrs.lsa || '-'}`);
        }
        if (specificationsChanged) {
          changes.push('Specifications changed (requires admin approval)');
        }

        // If we couldn't infer changes (e.g., no actual diff), don't spam.
        if (changes.length > 0) {
          const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
          const { data: admins } = await findAdmins(adminEmail, supabase);

          const { data: supplier } = await findUserBasicById(req.userId, supabase);

          if (admins && admins.length > 0) {
            const title = `Supplier Updated Inventory: ${responseProduct.name}`;
            const message = `${supplier?.name || 'Supplier'} updated "${responseProduct.name}". Changes: ${changes.join(
              ', '
            )}`;

            const notifications = admins.map((admin) => ({
              user_id: admin.id,
              type: 'supplier_edit',
              title,
              message,
              related_product_id: updatedSupplierProduct.product_id,
              related_supplier_id: req.userId,
              metadata: {
                productId: updatedSupplierProduct.product_id,
                supplierId: req.userId,
                supplierName: supplier?.name,
                productName: responseProduct.name,
                changes,
                price: updatedSupplierProduct.price,
                stock: updatedSupplierProduct.stock,
                location: updatedSupplierProduct.location,
                minOrderQuantity: updatedSupplierProduct.min_order_quantity,
                status: updatedSupplierProduct.status,
                isActive: updatedSupplierProduct.is_active
              },
              is_read: false
            }));

            await insertNotifications(notifications, supabase);
            console.log(`Created ${notifications.length} admin notification(s) for supplier inventory update`);
          }
        }
      } catch (notifErr) {
        console.log('⚠️ Failed to notify admins about supplier inventory update:', notifErr?.message || notifErr);
      }

      // Separate high-priority approval notification when specs changed.
      if (movedToPendingForSpecReview) {
        try {
          const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
          const { data: admins } = await findAdmins(adminEmail, supabase);
          const { data: supplier } = await findUserBasicById(req.userId, supabase);
          if (admins && admins.length > 0) {
            const notifications = admins.map((admin) => ({
              user_id: admin.id,
              type: 'product_approval',
              title: `Spec Change Pending Approval: ${responseProduct.name}`,
              message: `${supplier?.name || 'Supplier'} updated specifications for "${responseProduct.name}". Review and approve this updated variant before it is active again.`,
              related_product_id: updatedSupplierProduct.product_id,
              related_supplier_id: req.userId,
              metadata: {
                productId: updatedSupplierProduct.product_id,
                supplierId: req.userId,
                supplierName: supplier?.name || null,
                supplierProductId: updatedSupplierProduct.id,
                variantKey: updatedSupplierProduct.variant_key,
                newSpecifications: nextSpecifications
              },
              is_read: false
            }));
            await insertNotifications(notifications, supabase);
          }
        } catch (approvalNotifErr) {
          console.log('⚠️ Failed to notify admins for spec-change approval:', approvalNotifErr?.message || approvalNotifErr);
        }
      }

      return res.json({
        status: 'success',
        message: movedToPendingForSpecReview
          ? 'Specifications updated. Product is now pending admin approval.'
          : 'Product updated successfully',
        product: responseProduct,
        nextStep: {
          type: 'bcov_setup',
          supplierProductId: responseProduct?.supplier_product_id || null,
          variantKey: responseProduct?.variantKey || null,
          variantAsin: responseProduct?.variantAsin || null,
          brand: String(
            responseProduct?.brandModel ||
              responseProduct?.brand ||
              responseProduct?.specifications?.brandModel ||
              responseProduct?.specifications?.brand ||
              ''
          ).trim(),
          productName: String(responseProduct?.name || '').trim()
        }
      });
    }

    if (supplierProductError && supplierProductError.code && supplierProductError.code !== 'PGRST116') {
      console.error('Error checking supplier_products for update:', supplierProductError);
    }

    // ============================
    // 2) Fallback: treat ID as products.id (backward compatibility)
    // ============================

    // Get the old product data before updating
    const { data: oldProduct, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !oldProduct) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found' 
      });
    }

    // Optional permission check: if product has a supplier_id, ensure it matches
    if (oldProduct.supplier_id && oldProduct.supplier_id !== req.userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to update this product'
      });
    }

    const { data: variantOffersForProduct } = await supabase
      .from('supplier_products')
      .select('id')
      .eq('product_id', id)
      .eq('supplier_id', req.userId)
      .neq('status', 'rejected');
    if ((variantOffersForProduct || []).length > 1) {
      return res.status(400).json({
        status: 'error',
        message:
          'This catalog item has multiple variants on your account. Edit each variant from its own row so changes stay on that Variant TSIN only (do not update using the shared product id).'
      });
    }
    
    console.log(`Updating base product ${id} with data:`, {
      location: req.body.location,
      price: req.body.price,
      stock: req.body.stock,
      name: req.body.name
    });
    
    // Prepare update data
    const updateData = {
      ...req.body,
      specifications: req.body.specifications || oldProduct.specifications || {}
    };
    const legacySpecificationsChanged = shouldMoveToPendingForSpecChange({
      specificationsProvided: req.body.specifications !== undefined,
      currentSpecs: oldProduct.specifications || {},
      nextSpecs: updateData.specifications || {}
    });
    
    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.supplier_id;
    delete updateData.status; // Status can only be changed by admin
    delete updateData.approved_by;
    delete updateData.approved_at;
    // Supplier-only tracking fields belong in supplier_products.attributes, not products table.
    delete updateData.brandModel;
    delete updateData.lsa;
    delete updateData.hsnCode;
    delete updateData.hsn_code;
    delete updateData.brand_model;
    
    const { data: product, error: updateError } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (updateError || !product) {
      console.error('Base product update error:', updateError);
      return res.status(400).json({ 
        status: 'error',
        message: updateError?.message || 'Failed to update product' 
      });
    }

    if (legacySpecificationsChanged) {
      await supabase
        .from('supplier_products')
        .update({
          status: 'pending',
          is_active: false,
          approved_by: null,
          approved_at: null,
          rejection_reason: null
        })
        .eq('product_id', product.id)
        .eq('supplier_id', req.userId);
    }
    
    // Get supplier info
    const { data: supplier } = await supabase
      .from('users')
      .select('name, email, company')
      .eq('id', req.userId)
      .single();
    
    // Track what changed
    const changes = [];
    if (oldProduct.name !== product.name) {
      changes.push(`Name: "${oldProduct.name}" → "${product.name}"`);
    }
    if (parseFloat(oldProduct.price) !== parseFloat(product.price)) {
      changes.push(`Price: ₹${oldProduct.price} → ₹${product.price}`);
    }
    if (oldProduct.stock !== product.stock) {
      changes.push(`Stock: ${oldProduct.stock} → ${product.stock}`);
    }
    if (oldProduct.category !== product.category) {
      changes.push(`Category: "${oldProduct.category}" → "${product.category}"`);
    }
    if (oldProduct.unit !== product.unit) {
      changes.push(`Unit: "${oldProduct.unit}" → "${product.unit}"`);
    }
    if (oldProduct.location !== product.location) {
      changes.push(`Location: "${oldProduct.location}" → "${product.location}"`);
    }
    if (oldProduct.description !== product.description) {
      changes.push(`Description updated`);
    }
    if (legacySpecificationsChanged) {
      changes.push('Specifications changed (requires admin approval)');
    }
    
    // Create notifications for all admins if there are changes
    if (changes.length > 0) {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: admins } = await findAdmins(adminEmail, supabase);
      
      if (admins && admins.length > 0) {
        const notifications = admins.map(admin => ({
          user_id: admin.id,
          type: 'supplier_edit',
          title: `Supplier Edited Product: ${product.name}`,
          message: `${supplier?.name} (${supplier?.company || supplier?.email}) edited product "${product.name}". Changes: ${changes.join(', ')}`,
          related_product_id: product.id,
          related_supplier_id: supplier?.id || req.userId,
          metadata: {
            productName: product.name,
            supplierName: supplier?.name,
            supplierEmail: supplier?.email,
            supplierCompany: supplier?.company,
            changes: changes,
            oldData: {
              name: oldProduct.name,
              price: oldProduct.price,
              stock: oldProduct.stock,
              category: oldProduct.category,
              unit: oldProduct.unit,
              location: oldProduct.location
            },
            newData: {
              name: product.name,
              price: product.price,
              stock: product.stock,
              category: product.category,
              unit: product.unit,
              location: product.location
            }
          },
          is_read: false
        }));
      
        if (notifications.length > 0) {
          await insertNotifications(notifications, supabase);
          console.log(`Created ${notifications.length} admin notification(s) for product edit`);
        }
      }
    }
    
    console.log(`Base product ${product.id} updated successfully. New location: "${product.location}"`);
    
    res.json({
      status: 'success',
      message: legacySpecificationsChanged
        ? 'Specifications updated. Product is now pending admin approval.'
        : 'Product updated successfully',
      product,
      nextStep: {
        type: 'bcov_setup',
        supplierProductId: null,
        variantKey: null,
        variantAsin: null,
        brand: String(
          product?.brand ||
            product?.specifications?.brandModel ||
            product?.specifications?.brand ||
            ''
        ).trim(),
        productName: String(product?.name || '').trim()
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Delete product (supplier-specific entry, supports multiple locations)
router.delete('/products/:id', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierProductDeleteSchema, req.body || {});
    const supplierProductId = req.params.id;

    // Look up the supplier_products row to get product_id and validate ownership
    const { data: supplierProduct, error: fetchError } = await supabase
      .from('supplier_products')
      .select('id, product_id, supplier_id')
      .eq('id', supplierProductId)
      .single();

    if (fetchError || !supplierProduct) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found for this supplier'
      });
    }

    // Ensure the entry belongs to the current supplier
    if (supplierProduct.supplier_id !== req.userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to delete this product entry'
      });
    }

    const productId = supplierProduct.product_id;

    // Delete ONLY this supplier-specific entry from supplier_products
    const { data: deletedRows, error: spError } = await supabase
      .from('supplier_products')
      .delete()
      .eq('id', supplierProductId)
      .eq('supplier_id', req.userId)
      .select('id');
    
    if (spError) {
      console.error('Supplier product delete error:', spError);
      return res.status(400).json({
        status: 'error',
        message: spError.message || 'Failed to delete supplier product'
      });
    }

    // If no row was deleted, this product is not owned by this supplier
    if (!deletedRows || deletedRows.length === 0) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found for this supplier'
      });
      }

    // Optional cleanup: if no supplier_products remain for this product,
    // and the original products row is now orphaned, we can delete it.
    const { count, error: countError } = await supabase
      .from('supplier_products')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);

    if (!countError && (count || 0) === 0) {
      // No more supplier-specific entries; safe to delete the shared product row
      await supabase
        .from('products')
        .delete()
        .eq('id', productId);
    }
    
    res.json({ 
      status: 'success',
      message: 'Product deleted successfully' 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Delete product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Get supplier orders
}
