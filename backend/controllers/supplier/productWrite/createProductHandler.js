import {
  buildIdentityBundle,
  buildSupplierVariantIdentity,
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
  loadEffectiveSupplierChainProfile,
  normalizeGtin,
  normalizeText,
  onboardingAutoApproveThreshold,
  resolveSupplierProductBrandGuard,
  scoreOnboardingConfidence,
  shouldAutoApproveSupplierOfferOnCreate,
  hasSupplierSpecificationChangesFromCatalog,
  validateSpecValues
} from '../supplierImports.js';
import { sanitizeImageUrls } from '../shared/productHelpers.js';
import { resolveSupplierOfferDisplayImages, syncCatalogProductImages } from '../../../services/productImageService.js';
import { syncCatalogProductSnapshotFromOffers } from '../../../services/catalogOfferSnapshotService.js';
import {
  createBaseProductIfNeeded,
  ensureCategoryAndUnit,
  findCanonicalProductFromIdentifiers,
  findExistingProductCandidate,
  reopenRejectedCatalogProductForResubmit
} from '../../../services/supplierProductWriteService.js';
import { resolveCatalogBaselineSpecifications } from '../../../services/supplierCatalogHelpersService.js';
import {
  resolveStableVariantIdentityFromExistingOffers,
  syncOfferAttributesWithSpecifications
} from '../../../services/productIdentityService.js';
import {
  fetchCanonicalVariantMrp,
  validateSupplierVariantMrpConsistency,
  formatVariantMrpMismatchMessage
} from '../../../services/variantMrpService.js';
import { parseSupplierStockQuantity } from '../../../utils/parseSupplierStockQuantity.js';
import {
  MIN_SUPPLIER_PRODUCT_PHOTOS,
  validateMinSupplierProductPhotos
} from '../../../utils/supplierProductPhotos.js';
import { validateProductUnitCompatibility } from '../../../utils/productUnitCompatibility.js';
import {
  validateSupplierCategorySpecificationFillComplete
} from '../../../services/supplierProductUpdateValidation.js';
import { notifyServiceProvidersForFulfilledBoqRequests } from '../../../services/serviceProviderRequestNotificationService.js';

export function buildSupplierProductCreateHandler(ctx) {
  const {
    supabase,
    resolveTaxRatesForProductCreate,
    upsertModelSpecProfile,
    loadSpecTemplateForCategory,
    resolveAdminSpecificationTemplate
  } = ctx;

  return async function supplierProductCreateHandler(req, res) {
    try {
      const { category, unit, outlet_id, brandModel, lsa, hsnCode, catalogProductId, ...otherData } = req.body;

      if (!String(category || '').trim()) {
        return res.status(400).json({
          status: 'error',
          code: 'category_required',
          message: 'Category is required.',
          missingFields: ['category']
        });
      }
      const requestSpecs =
        otherData.specifications && typeof otherData.specifications === 'object' && !Array.isArray(otherData.specifications)
          ? { ...otherData.specifications }
          : {};
      const posLookupGsku = String(otherData.gsku || otherData.pos_lookup_code || '').trim();
      if (posLookupGsku) requestSpecs.gsku = posLookupGsku;
      const explicitBarcode = String(otherData.barcode || '').trim();
      const normalizedImageUrls = sanitizeImageUrls(otherData.images);
      const photoValidation = validateMinSupplierProductPhotos(normalizedImageUrls);
      if (!photoValidation.ok) {
        return res.status(400).json({
          status: 'error',
          code: 'product_photos_required',
          message: photoValidation.message,
          missingFields: photoValidation.missingFields,
          photoCount: photoValidation.count,
          minPhotos: MIN_SUPPLIER_PRODUCT_PHOTOS
        });
      }

      const unitCompatibility = validateProductUnitCompatibility({
        unit,
        productName: otherData.name,
        category
      });
      if (!unitCompatibility.ok && unitCompatibility.severity === 'error') {
        return res.status(400).json({
          status: 'error',
          code: unitCompatibility.code || 'unit_incompatible',
          message: unitCompatibility.message,
          missingFields: ['unit'],
          suggestedUnits: unitCompatibility.suggestedUnits
        });
      }
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

      const catalogBrand =
        canonicalProductFromIdentifier?.brand && String(canonicalProductFromIdentifier.brand).trim()
          ? String(canonicalProductFromIdentifier.brand).trim()
          : '';

      const effectiveProfile = await loadEffectiveSupplierChainProfile(req.userId, req.user?.profile || {});
      const brandResolution = resolveSupplierProductBrandGuard(effectiveProfile, {
        selectedBrand: brandInput,
        catalogBrand
      });
      if (!brandResolution.allowed) {
        const guard = brandResolution.guard || {};
        return res.status(403).json({
          status: 'error',
          message:
            guard.reason === 'brand_required'
              ? 'Brand is required because you have selected brands in your profile. Please enter a brand that matches your profile.'
              : 'You can only add products for brands you selected in Select yourself (Step 1). Open Select yourself, save your brand, complete supply-chain role if needed, then try again.',
          allowedBrands: guard.declared || []
        });
      }

      const effectiveBrandInput = brandResolution.brand || brandInput || catalogBrand;

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

      const categoryTemplateValidation = await validateSupplierCategorySpecificationFillComplete(
        resolveAdminSpecificationTemplate,
        {
          categoryName: categoryName || category,
          modelRaw: productNameRaw,
          brandRaw: effectiveBrandInput,
          specifications: normalizedSpecs
        }
      );
      if (!categoryTemplateValidation.ok) {
        return res.status(400).json({
          status: 'error',
          code: 'specifications_required',
          message:
            categoryTemplateValidation.message ||
            'Please complete all specification values for the selected category.',
          missingFields: categoryTemplateValidation.missingFields || ['specifications'],
          errors: categoryTemplateValidation.errors || []
        });
      }

      const selectedCatalogProductId = String(catalogProductId || '').trim();
      const existingMatch = await findExistingProductCandidate(supabase, {
        selectedCatalogProductId,
        canonicalProductFromIdentifier,
        identityBundle,
        productName,
        productNameRaw,
        categoryName,
        normalizeText
      });
      const existingProduct = existingMatch?.product || null;
      const matchStrength = existingMatch?.matchStrength || 'none';

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

      await reopenRejectedCatalogProductForResubmit(supabase, productId);

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

      const [{ data: existingOffersForProduct }, productVariantsResult] = await Promise.all([
        supabase
          .from('supplier_products')
          .select('id, supplier_id, location, status, is_active, variant_key, variant_asin, attributes, unit')
          .eq('product_id', productId)
          .limit(200),
        supabase
          .from('product_variants')
          .select('id, product_id, variant_key, variant_asin, canonical_attributes, status, unit, pack_size')
          .eq('product_id', productId)
          .limit(200)
      ]);
      const existingProductVariants = productVariantsResult?.error
        ? []
        : productVariantsResult?.data || [];

      const catalogSpecsForVariantReuse =
        parentProductForVariant?.specifications || existingProduct?.specifications || {};
      const specsUnchangedFromCatalog =
        !isNewProduct && Boolean(existingProduct)
          ? !hasSupplierSpecificationChangesFromCatalog({
              catalogSpecs: catalogSpecsForVariantReuse,
              supplierSpecs: normalizedSpecs
            })
          : false;

      const stableVariantIdentity = resolveStableVariantIdentityFromExistingOffers({
        parentAsin: catalogAsin || identityBundle.asinLikeId || parentProductForVariant?.asin || '',
        parentProduct: parentProductForVariant,
        computedIdentity: variantIdentityBundle,
        existingOffers: existingOffersForProduct || [],
        existingProductVariants,
        offerSpecifications: normalizedSpecs,
        catalogSpecifications: catalogSpecsForVariantReuse,
        specsUnchangedFromCatalog
      });
      const resolvedVariantKey = stableVariantIdentity.variantKey || variantIdentityBundle.variantKey;
      const variantAsin = stableVariantIdentity.variantAsin;

      const currentLocation = (otherData.location || '').trim();
      const existingSupplierProduct =
        (existingOffersForProduct || []).find(
          (row) =>
            String(row.supplier_id) === String(req.userId) &&
            String(row.location || '').trim() === currentLocation &&
            String(row.variant_key || '').trim() === String(resolvedVariantKey || '').trim()
        ) || null;
      const resubmittingRejectedOffer =
        existingSupplierProduct &&
        String(existingSupplierProduct.status || '').toLowerCase() === 'rejected';
      if (existingSupplierProduct && !resubmittingRejectedOffer) {
        return res.status(400).json({
          status: 'error',
          message: 'You have already added this exact product variation for this location. Please update the existing entry instead.'
        });
      }

      const parsedPrice = parseFloat(otherData.price);
      const parsedStock = parseSupplierStockQuantity(otherData.stock);
      const parsedMinOrderQty = parseInt(otherData.min_order_quantity);

      if (otherData.price !== undefined && resolvedVariantKey) {
        const canonicalMrp = await fetchCanonicalVariantMrp(supabase, {
          productId,
          variantKey: resolvedVariantKey
        });
        const variantMrpValidation = validateSupplierVariantMrpConsistency({
          body: { price: otherData.price },
          canonicalMrp
        });
        if (!variantMrpValidation.ok) {
          return res.status(403).json({
            status: 'error',
            code: variantMrpValidation.code || 'variant_mrp_mismatch',
            message:
              variantMrpValidation.message ||
              formatVariantMrpMismatchMessage(variantMrpValidation.canonicalMrp),
            missingFields: variantMrpValidation.missingFields || ['price'],
            canonicalMrp: variantMrpValidation.canonicalMrp
          });
        }
      }

      const approvedVariantOffer = (existingOffersForProduct || []).find(
        (row) =>
          String(row.variant_key || '').trim() === String(resolvedVariantKey || '').trim() &&
          String(row.status || '').toLowerCase() === 'approved' &&
          row.is_active !== false
      );
      // Any approved offer for this catalog product means the product is already live —
      // a different variant from another (or the same) supplier must not re-enter approval.
      const anyApprovedOfferForProduct = (existingOffersForProduct || []).find(
        (row) => String(row.status || '').toLowerCase() === 'approved'
      );
      const catalogProductStatus =
        existingProduct?.status ||
        (isNewProduct ? 'pending' : null);
      let resolvedCatalogStatus = catalogProductStatus;
      if (!resolvedCatalogStatus || String(resolvedCatalogStatus).toLowerCase() === 'rejected') {
        const { data: catalogRow } = await supabase
          .from('products')
          .select('status')
          .eq('id', productId)
          .maybeSingle();
        resolvedCatalogStatus = catalogRow?.status || 'pending';
      }
      const catalogBaselineSpecs =
        !isNewProduct && existingProduct
          ? await resolveCatalogBaselineSpecifications(supabase, {
              productId,
              catalogSpecs:
                parentProductForVariant?.specifications || existingProduct?.specifications || {},
              variantKey: resolvedVariantKey
            })
          : {};
      const hasSpecificationChanges =
        !isNewProduct && existingProduct
          ? hasSupplierSpecificationChangesFromCatalog({
              catalogSpecs: catalogBaselineSpecs,
              supplierSpecs: normalizedSpecs
            })
          : false;
      const shouldBeApproved = shouldAutoApproveSupplierOfferOnCreate({
        hasApprovedSameVariantOffer: Boolean(approvedVariantOffer?.id),
        catalogProductStatus: resolvedCatalogStatus,
        hasAnyApprovedOfferForProduct: Boolean(anyApprovedOfferForProduct?.id),
        // New catalog rows are always pending; only confirmed re-lists may auto-approve.
        matchStrength: isNewProduct ? 'none' : matchStrength,
        hasSpecificationChanges
      });

      const supplierProductData = {
        product_id: productId,
        supplier_id: req.userId,
        price: isNaN(parsedPrice) ? 0 : parsedPrice,
        stock: parsedStock == null ? 0 : parsedStock,
        min_order_quantity: isNaN(parsedMinOrderQty) || parsedMinOrderQty < 1 ? 1 : parsedMinOrderQty,
        location: currentLocation,
        outlet_id: outlet_id || null,
        status: shouldBeApproved ? 'approved' : 'pending',
        is_active: shouldBeApproved ? true : false,
        igst_rate: igstRate,
        cgst_rate: cgstRate,
        sgst_rate: sgstRate,
        variant_key: resolvedVariantKey,
        variant_asin: variantAsin,
        attributes: syncOfferAttributesWithSpecifications({
          supplierDescription: String(otherData.description || '').trim(),
          description: String(otherData.description || '').trim(),
          specifications: otherData.specifications || normalizedSpecs,
          // Keep the supplier's submitted title on the offer so the portal never silently
          // rewrites it to a different catalog product's name after a weak attach.
          name: otherData.name,
          listingName: String(otherData.name || '').trim(),
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
          igstRate,
          cgstRate,
          sgstRate,
          tags: otherData.tags || [],
          images: normalizedImageUrls
        })
      };

      const { data: newSupplierProduct, error: supplierProductError } = resubmittingRejectedOffer
        ? await supabase
            .from('supplier_products')
            .update({
              ...supplierProductData,
              approved_by: null,
              approved_at: null,
              rejection_reason: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingSupplierProduct.id)
            .eq('supplier_id', req.userId)
            .select()
            .single()
        : await supabase
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

      void syncCatalogProductSnapshotFromOffers(supabase, productId).catch((syncError) => {
        console.error('[CatalogSnapshot] create product sync failed:', syncError?.message || syncError);
      });

      if (normalizedImageUrls.length > 0) {
        await syncCatalogProductImages(supabase, productId, normalizedImageUrls);
      }

      const { data: baseProduct } = await supabase
        .from('products')
        .select(
          'id, name, description, category, unit, brand, gtin, mpn, specifications, images, asin, status, requested_by_service_provider_id'
        )
        .eq('id', productId)
        .single();

      const createdOffer = newSupplierProduct;
      const supplierSubmittedDescription = String(otherData.description || '').trim();
      const submittedName = String(otherData.name || '').trim();
      const responseProduct = {
        ...(baseProduct || {}),
        // Prefer the name the supplier just typed for this row, not a shared catalog rename.
        name: submittedName || baseProduct?.name || 'Product',
        supplierDescription: supplierSubmittedDescription,
        publishedDescription: '',
        description: supplierSubmittedDescription,
        price: createdOffer?.price,
        stock: createdOffer?.stock,
        location: createdOffer?.location,
        min_order_quantity: createdOffer?.min_order_quantity,
        status: createdOffer?.status,
        is_active: createdOffer?.is_active,
        supplier_id: req.userId,
        supplier_product_id: createdOffer?.id || newSupplierProduct?.id,
        variantKey: createdOffer?.variant_key || resolvedVariantKey,
        variantAsin: createdOffer?.variant_asin || variantAsin,
        // Only images uploaded for this offer — never catalog history from prior listings.
        images: resolveSupplierOfferDisplayImages(normalizedImageUrls, baseProduct?.images)
      };

      if (isCatalogGuardrailsEnabled()) {
        void (async () => {
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
        })();
      }

      void upsertModelSpecProfile({
        category: categoryName || category,
        modelRaw: mpnInput || brandModel,
        specifications: normalizedSpecs,
        actorUserId: req.userId
      }).catch((err) => console.log('upsertModelSpecProfile failed:', err?.message || err));

      void (async () => {
        try {
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
              metadata: { productId, supplierId: req.userId, variantKey: resolvedVariantKey },
              is_read: false
            }));
            await insertNotifications(notifications, supabase);
          }

          let alreadyNotifiedSpId = null;
          if (responseProduct?.requested_by_service_provider_id) {
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
              supabase,
              { skipEmail: true }
            );
            alreadyNotifiedSpId = responseProduct.requested_by_service_provider_id;
          }

          await notifyServiceProvidersForFulfilledBoqRequests({
            db: supabase,
            product: responseProduct,
            supplier: { id: req.userId, ...(supplier || {}) },
            alreadyNotifiedUserId: alreadyNotifiedSpId
          });
        } catch (notifErr) {
          console.log('Product create notifications failed:', notifErr?.message || notifErr);
        }
      })();

      return res.status(resubmittingRejectedOffer ? 200 : 201).json({
        status: 'success',
        message: shouldBeApproved
          ? 'Product added successfully and is immediately available.'
          : resubmittingRejectedOffer
            ? 'Product resubmitted successfully and is pending admin approval.'
            : hasSpecificationChanges
              ? 'Product added successfully. Specification changes require admin approval before this listing goes live.'
              : 'Product added successfully and is pending admin approval.',
        product: responseProduct,
        requiresAdminApproval: !shouldBeApproved,
        specificationChangesDetected: hasSpecificationChanges
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

