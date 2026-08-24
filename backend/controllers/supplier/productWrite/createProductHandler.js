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
  maybeNotifyInventoryBelowMov,
  normalizeGtin,
  normalizeText,
  onboardingAutoApproveThreshold,
  resolveSupplierProductBrandGuard,
  SUPPLIER_ROLE_REQUIRED_FOR_PRODUCT_CODE,
  SUPPLIER_ROLE_REQUIRED_FOR_PRODUCT_MESSAGE,
  scoreOnboardingConfidence,
  shouldAutoApproveSupplierOfferOnCreate,
  hasSupplierSpecificationChangesFromCatalog,
  findBestMatchingApprovedOfferForSpecs,
  retainCatalogCompatibleSpecifications,
  validateSpecValues,
  specificationsWithMeaningfulValuesOnly
} from '../supplierImports.js';
import { sanitizeImageUrls, validateAndNormalizeTaxRates } from '../shared/productHelpers.js';
import { resolveSupplierOfferDisplayImages, syncCatalogProductImages } from '../../../services/productImageService.js';
import { syncCatalogProductSnapshotFromOffers } from '../../../services/catalogOfferSnapshotService.js';
import { clearOrphanedSupplierBcovLevelsBeforeNewOffer } from '../../../services/supplierBcovService.js';
import {
  createBaseProductIfNeeded,
  ensureCategoryAndUnit,
  findCanonicalProductFromIdentifiers,
  findExistingProductCandidate,
  reopenRejectedCatalogProductForResubmit
} from '../../../services/supplierProductWriteService.js';
import { resolveCatalogBaselineSpecifications, extractOfferSpecificationsFromRow } from '../../../services/supplierCatalogHelpersService.js';
import {
  resolveStableVariantIdentityFromExistingOffers,
  syncOfferAttributesWithSpecifications,
  isPersistableProductBarcode,
  buildVariantAsinLikeId
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
  validateSupplierCategorySpecificationFillComplete,
  validateSupplierOfferSpecificationFillComplete
} from '../../../services/supplierProductUpdateValidation.js';
import { notifyServiceProvidersForFulfilledBoqRequests } from '../../../services/serviceProviderRequestNotificationService.js';
import {
  DUPLICATE_SUPPLIER_VARIANT_MESSAGE,
  findOwnOfferForUniqueConflict,
  findOwnOfferForVariantLocation,
  isExistingOfferUpdatableOnCreate,
  isPgUniqueViolation,
  isSupplierOfferUniqueViolation,
  loadOwnSupplierOffersForProduct,
  looksLikePostgresConstraintError,
  canonicalSupplierOfferLocation,
  recoverOwnOfferAfterUniqueViolation,
  toCatalogProductWriteErrorResponse,
  toSupplierOfferWriteErrorResponse
} from '../../../utils/supplierOfferUniqueness.js';

export function buildSupplierProductCreateHandler(ctx) {
  const {
    supabase,
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
      const explicitBarcode = String(
        otherData.barcode || requestSpecs?.barcode || requestSpecs?.Barcode || ''
      ).trim();
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
      let gtinInput = normalizeGtin(
        otherData.gtin || requestSpecs?.gtin || requestSpecs?.upc || requestSpecs?.ean || ''
      );

      if (gtinInput && !isValidGtin(gtinInput)) {
        if (
          !isPersistableProductBarcode(gtinInput, {
            name: otherData.name,
            description: otherData.description
          })
        ) {
          gtinInput = '';
        } else {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid GTIN. Use 8, 12, 13, or 14 digit numeric code.'
          });
        }
      }

      const barcodeCandidates = [explicitBarcode, gtinInput, posLookupGsku];
      const resolvedBarcodeForPos =
        barcodeCandidates.find((candidate) =>
          isPersistableProductBarcode(candidate, {
            name: otherData.name,
            description: otherData.description
          })
        ) || null;

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
        const roleRequired = guard.reason === SUPPLIER_ROLE_REQUIRED_FOR_PRODUCT_CODE;
        return res.status(403).json({
          status: 'error',
          code: roleRequired
            ? SUPPLIER_ROLE_REQUIRED_FOR_PRODUCT_CODE
            : guard.reason || 'brand_not_allowed',
          message: roleRequired
            ? SUPPLIER_ROLE_REQUIRED_FOR_PRODUCT_MESSAGE
            : guard.reason === 'brand_required'
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

      const taxValidation = validateAndNormalizeTaxRates(otherData);
      if (!taxValidation.ok) {
        return res.status(400).json({
          status: 'error',
          message: taxValidation.message
        });
      }
      const clientSentTax = [
        otherData.igst_rate,
        otherData.igstRate,
        otherData.cgst_rate,
        otherData.cgstRate,
        otherData.sgst_rate,
        otherData.sgstRate
      ].some((value) => value !== undefined && value !== null && String(value).trim() !== '');
      // Catalog-only create must not inherit category GST. Otherwise Product COV
      // treats Inventory as complete before the supplier fills step 2.
      const { igstRate, cgstRate, sgstRate } = clientSentTax
        ? taxValidation.data
        : { igstRate: null, cgstRate: null, sgstRate: null };

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
      const isConfirmedCatalogAttach =
        Boolean(selectedCatalogProductId) ||
        String(matchStrength || '').toLowerCase() === 'explicit' ||
        String(matchStrength || '').toLowerCase() === 'strong';

      // Strip unrelated category defaults before variant identity / approval checks.
      if (isConfirmedCatalogAttach && existingProduct) {
        const ownSpecs =
          existingProduct?.specifications &&
          typeof existingProduct.specifications === 'object' &&
          !Array.isArray(existingProduct.specifications)
            ? existingProduct.specifications
            : {};
        if (Object.keys(ownSpecs).length > 0) {
          normalizedSpecs = retainCatalogCompatibleSpecifications(ownSpecs, normalizedSpecs);
        }
      }

      // Re-listing an existing catalog product: require that product's own filled keys,
      // not the whole category template (Computer Accessories mouse defaults ≠ headphones).
      let categoryTemplateValidation = { ok: true, missingFields: [], errors: [], message: '' };
      if (isConfirmedCatalogAttach && existingProduct?.id) {
        categoryTemplateValidation = await validateSupplierOfferSpecificationFillComplete(supabase, {
          productId: existingProduct.id,
          specifications: normalizedSpecs
        });
      } else {
        categoryTemplateValidation = await validateSupplierCategorySpecificationFillComplete(
          resolveAdminSpecificationTemplate,
          {
            categoryName: categoryName || category,
            modelRaw: productNameRaw,
            brandRaw: effectiveBrandInput,
            specifications: normalizedSpecs
          }
        );
      }
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

      normalizedSpecs = specificationsWithMeaningfulValuesOnly(normalizedSpecs);
      if (posLookupGsku) normalizedSpecs = { ...normalizedSpecs, gsku: posLookupGsku };

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
        return res.status(400).json(
          baseProductResult.publicError || toCatalogProductWriteErrorResponse(baseProductResult.error)
        );
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

      const [offersResult, productVariantsResult, ownOffersResult] = await Promise.all([
        supabase
          .from('supplier_products')
          .select(
            'id, supplier_id, location, outlet_id, status, is_active, variant_key, variant_asin, attributes'
          )
          .eq('product_id', productId)
          .limit(200),
        supabase
          .from('product_variants')
          .select('id, product_id, variant_key, variant_asin, canonical_attributes, status, unit, pack_size')
          .eq('product_id', productId)
          .limit(200),
        loadOwnSupplierOffersForProduct(supabase, {
          productId,
          supplierId: req.userId
        })
      ]);
      if (offersResult?.error) {
        console.warn(
          '[SupplierProductCreate] existing offers lookup failed:',
          offersResult.error.message || offersResult.error
        );
      }
      if (ownOffersResult?.error) {
        console.warn(
          '[SupplierProductCreate] own offers lookup failed:',
          ownOffersResult.error.message || ownOffersResult.error
        );
      }
      const existingOffersForProduct = offersResult?.error ? [] : offersResult?.data || [];
      const existingProductVariants = productVariantsResult?.error
        ? []
        : productVariantsResult?.data || [];
      const ownOffersForProduct = ownOffersResult?.rows || [];

      const catalogSpecsForVariantReuse =
        parentProductForVariant?.specifications || existingProduct?.specifications || {};
      const catalogHasFilledSpecs = Object.values(catalogSpecsForVariantReuse || {}).some((value) => {
        if (value == null) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return String(value).trim() !== '';
      });
      const specsUnchangedFromCatalog =
        !isNewProduct && Boolean(existingProduct) && catalogHasFilledSpecs
          ? !hasSupplierSpecificationChangesFromCatalog({
              catalogSpecs: catalogSpecsForVariantReuse,
              supplierSpecs: normalizedSpecs
            })
          : false;

      const computedVariantKey = String(variantIdentityBundle.variantKey || '').trim();
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
      const resolvedVariantKeyInitial =
        stableVariantIdentity.variantKey || variantIdentityBundle.variantKey;
      let resolvedVariantKey = resolvedVariantKeyInitial;
      let variantAsin = stableVariantIdentity.variantAsin;

      const approvedVariantOffer = (existingOffersForProduct || []).find(
        (row) =>
          String(row.variant_key || '').trim() === String(resolvedVariantKey || '').trim() &&
          String(row.status || '').toLowerCase() === 'approved' &&
          row.is_active !== false
      );
      // Prefer deep offer-spec extraction so legacy attribute shapes still match.
      const compatibleApprovedOffer =
        findBestMatchingApprovedOfferForSpecs(
          (existingOffersForProduct || []).map((row) => ({
            ...row,
            attributes: {
              ...(row?.attributes && typeof row.attributes === 'object' ? row.attributes : {}),
              specifications: extractOfferSpecificationsFromRow(row)
            }
          })),
          normalizedSpecs
        ) || null;
      const sameVariantApprovedOffer = approvedVariantOffer || compatibleApprovedOffer || null;
      if (
        sameVariantApprovedOffer &&
        String(resolvedVariantKey || '').trim() !==
          String(sameVariantApprovedOffer.variant_key || '').trim()
      ) {
        // Force stable identity onto the already-live variant before duplicate detection.
        resolvedVariantKey = String(sameVariantApprovedOffer.variant_key || '').trim();
        if (String(sameVariantApprovedOffer.variant_asin || '').trim()) {
          variantAsin = String(sameVariantApprovedOffer.variant_asin || '').trim();
        }
      }

      const currentLocation = canonicalSupplierOfferLocation(otherData.location);
      const ownOfferLookupArgs = {
        supplierId: req.userId,
        location: currentLocation,
        variantKey: resolvedVariantKey,
        outletId: outlet_id || null
      };
      let existingSupplierProduct = findOwnOfferForVariantLocation(
        ownOffersForProduct.length ? ownOffersForProduct : existingOffersForProduct,
        ownOfferLookupArgs
      );
      if (!existingSupplierProduct) {
        const exactLookup = await loadOwnSupplierOffersForProduct(supabase, {
          productId,
          supplierId: req.userId,
          variantKey: resolvedVariantKey || null
        });
        if (exactLookup.error) {
          console.warn(
            '[SupplierProductCreate] exact offer lookup failed:',
            exactLookup.error.message || exactLookup.error
          );
        } else {
          existingSupplierProduct = findOwnOfferForUniqueConflict(
            exactLookup.rows,
            ownOfferLookupArgs
          );
        }
      }
      const updatingExistingOffer = isExistingOfferUpdatableOnCreate(existingSupplierProduct);
      const resubmittingRejectedOffer =
        String(existingSupplierProduct?.status || '').toLowerCase() === 'rejected';
      if (existingSupplierProduct && !updatingExistingOffer) {
        return res.status(400).json({
          status: 'error',
          code: 'duplicate_supplier_variant',
          message: DUPLICATE_SUPPLIER_VARIANT_MESSAGE
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
      const matchedOfferSpecs = sameVariantApprovedOffer
        ? extractOfferSpecificationsFromRow(sameVariantApprovedOffer)
        : {};
      const productOwnSpecs =
        parentProductForVariant?.specifications || existingProduct?.specifications || {};
      const comparisonBaseline =
        Object.keys(matchedOfferSpecs || {}).length > 0
          ? matchedOfferSpecs
          : Object.keys(catalogBaselineSpecs || {}).length > 0
            ? catalogBaselineSpecs
            : productOwnSpecs;

      // Confirmed catalog re-list: only real overlapping value conflicts block auto-approval.
      // Extra category-template keys or legacy offer shapes must not force admin review.
      const confirmedReList =
        !isNewProduct &&
        (String(matchStrength || '').toLowerCase() === 'explicit' ||
          String(matchStrength || '').toLowerCase() === 'strong');

      // Drop unrelated category defaults (mouse fields) that rode in on Computer Accessories.
      if (confirmedReList && Object.keys(comparisonBaseline || {}).length > 0) {
        normalizedSpecs = retainCatalogCompatibleSpecifications(
          comparisonBaseline,
          normalizedSpecs
        );
      }

      const hasValueConflictsWithBaseline = hasSupplierSpecificationChangesFromCatalog({
        catalogSpecs: comparisonBaseline,
        supplierSpecs: normalizedSpecs
      });
      const hasValueConflictsWithProduct = hasSupplierSpecificationChangesFromCatalog({
        catalogSpecs: productOwnSpecs,
        supplierSpecs: normalizedSpecs
      });
      const hasSpecificationChanges =
        !isNewProduct && existingProduct && !sameVariantApprovedOffer
          ? hasValueConflictsWithBaseline || hasValueConflictsWithProduct
          : false;

      // Explicit/strong attach of an already-approved catalog product with no value conflicts
      // goes live immediately — this is the "same DB product, no edits" path.
      const catalogIsLive =
        String(resolvedCatalogStatus || '').toLowerCase() === 'approved' ||
        Boolean(anyApprovedOfferForProduct?.id);
      const shouldBeApproved =
        Boolean(sameVariantApprovedOffer?.id) ||
        (confirmedReList &&
          catalogIsLive &&
          !hasValueConflictsWithBaseline &&
          !hasValueConflictsWithProduct) ||
        shouldAutoApproveSupplierOfferOnCreate({
          hasApprovedSameVariantOffer: Boolean(sameVariantApprovedOffer?.id),
          catalogProductStatus: resolvedCatalogStatus,
          hasAnyApprovedOfferForProduct: Boolean(anyApprovedOfferForProduct?.id),
          matchStrength: isNewProduct ? 'none' : matchStrength,
          hasSpecificationChanges
        });

      console.log('[SUPPLIER CREATE APPROVAL]', {
        productId,
        matchStrength: isNewProduct ? 'none' : matchStrength,
        isNewProduct,
        confirmedReList,
        catalogIsLive,
        reusedVariant: Boolean(stableVariantIdentity?.reused),
        sameVariantApprovedOfferId: sameVariantApprovedOffer?.id || null,
        hasSpecificationChanges,
        shouldBeApproved,
        resolvedVariantKey
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
          ...(clientSentTax ? { igstRate, cgstRate, sgstRate } : {}),
          tags: otherData.tags || [],
          images: normalizedImageUrls
        })
      };

      // Fresh insert for a variant with no live offer: drop leftover Product_COV from a deleted listing.
      // Do not clear when updating a pending/rejected offer or when another location already shares the key.
      if (!updatingExistingOffer && resolvedVariantKey) {
        try {
          await clearOrphanedSupplierBcovLevelsBeforeNewOffer(supabase, {
            supplierId: req.userId,
            variantKey: resolvedVariantKey
          });
        } catch (bcovCleanupError) {
          console.error(
            '[Product_COV] failed to clear orphaned levels before new offer:',
            bcovCleanupError?.message || bcovCleanupError
          );
        }
      }

      const offerUpdatePayload = {
        ...supplierProductData,
        updated_at: new Date().toISOString()
      };
      const clientSentPrice =
        otherData.price !== undefined && otherData.price !== null && String(otherData.price).trim() !== '';
      const clientSentStock =
        otherData.stock !== undefined && otherData.stock !== null && String(otherData.stock).trim() !== '';
      const clientSentLocation = Boolean(String(otherData.location || '').trim());
      const preserveExistingInventoryOnCatalogUpdate = (payload, existingRow) => {
        const next = { ...payload };
        if (!clientSentPrice) delete next.price;
        if (!clientSentStock) delete next.stock;
        if (!clientSentLocation) {
          delete next.location;
          if (!outlet_id) delete next.outlet_id;
        }
        if (!clientSentTax) {
          delete next.igst_rate;
          delete next.cgst_rate;
          delete next.sgst_rate;
          const existingAttrs =
            existingRow?.attributes &&
            typeof existingRow.attributes === 'object' &&
            !Array.isArray(existingRow.attributes)
              ? existingRow.attributes
              : {};
          next.attributes = {
            ...existingAttrs,
            ...next.attributes,
            igstRate: existingAttrs.igstRate ?? existingRow?.igst_rate,
            cgstRate: existingAttrs.cgstRate ?? existingRow?.cgst_rate,
            sgstRate: existingAttrs.sgstRate ?? existingRow?.sgst_rate
          };
        }
        return next;
      };
      const catalogUpdatePayload = updatingExistingOffer
        ? preserveExistingInventoryOnCatalogUpdate(offerUpdatePayload, existingSupplierProduct)
        : offerUpdatePayload;
      if (resubmittingRejectedOffer) {
        catalogUpdatePayload.approved_by = null;
        catalogUpdatePayload.approved_at = null;
        catalogUpdatePayload.rejection_reason = null;
      }

      let newSupplierProduct = null;
      let supplierProductError = null;
      if (updatingExistingOffer) {
        const updated = await supabase
          .from('supplier_products')
          .update(catalogUpdatePayload)
          .eq('id', existingSupplierProduct.id)
          .eq('supplier_id', req.userId)
          .select()
          .single();
        newSupplierProduct = updated.data;
        supplierProductError = updated.error;
      } else {
        const inserted = await supabase
          .from('supplier_products')
          .insert(supplierProductData)
          .select()
          .single();
        newSupplierProduct = inserted.data;
        supplierProductError = inserted.error;
        if (
          supplierProductError &&
          (isSupplierOfferUniqueViolation(supplierProductError) ||
            isPgUniqueViolation(supplierProductError) ||
            looksLikePostgresConstraintError(supplierProductError))
        ) {
          const recovered = await recoverOwnOfferAfterUniqueViolation(supabase, {
            productId,
            supplierId: req.userId,
            location: currentLocation,
            variantKey: resolvedVariantKey,
            outletId: outlet_id || null
          });
          if (recovered.error) {
            console.warn(
              '[SupplierProductCreate] unique-violation lookup failed:',
              recovered.error.message || recovered.error
            );
          }
          const racedOffer = recovered.offer;
          if (racedOffer && isExistingOfferUpdatableOnCreate(racedOffer)) {
            const racedRejected =
              String(racedOffer.status || '').toLowerCase() === 'rejected';
            const racedPayload = preserveExistingInventoryOnCatalogUpdate(
              {
                ...supplierProductData,
                updated_at: new Date().toISOString()
              },
              racedOffer
            );
            if (racedRejected) {
              racedPayload.approved_by = null;
              racedPayload.approved_at = null;
              racedPayload.rejection_reason = null;
            }
            const racedUpdate = await supabase
              .from('supplier_products')
              .update(racedPayload)
              .eq('id', racedOffer.id)
              .eq('supplier_id', req.userId)
              .select()
              .single();
            newSupplierProduct = racedUpdate.data;
            supplierProductError = racedUpdate.error;
            if (!supplierProductError) {
              existingSupplierProduct = racedOffer;
            }
          } else if (
            computedVariantKey &&
            computedVariantKey !== String(resolvedVariantKey || '').trim()
          ) {
            // Reused catalog variant_key collided. Insert this as its own variant instead.
            const retryAsin =
              buildVariantAsinLikeId(
                catalogAsin || identityBundle.asinLikeId || '',
                computedVariantKey
              ) || supplierProductData.variant_asin;
            const retried = await supabase
              .from('supplier_products')
              .insert({
                ...supplierProductData,
                variant_key: computedVariantKey,
                variant_asin: retryAsin
              })
              .select()
              .single();
            newSupplierProduct = retried.data;
            supplierProductError = retried.error;
            if (!supplierProductError) {
              resolvedVariantKey = computedVariantKey;
              variantAsin = retryAsin;
            } else if (
              isSupplierOfferUniqueViolation(supplierProductError) ||
              isPgUniqueViolation(supplierProductError) ||
              looksLikePostgresConstraintError(supplierProductError)
            ) {
              return res.status(400).json({
                status: 'error',
                code: 'duplicate_supplier_variant',
                message: DUPLICATE_SUPPLIER_VARIANT_MESSAGE
              });
            }
          } else {
            console.warn(
              '[SupplierProductCreate] unique constraint on supplier_products:',
              supplierProductError?.message || supplierProductError
            );
            return res.status(400).json({
              status: 'error',
              code: 'duplicate_supplier_variant',
              message: DUPLICATE_SUPPLIER_VARIANT_MESSAGE
            });
          }
        }
      }
      if (supplierProductError) {
        console.warn(
          '[SupplierProductCreate] supplier_products write failed:',
          supplierProductError?.message || supplierProductError
        );
        return res.status(400).json(toSupplierOfferWriteErrorResponse(supplierProductError));
      }

      void syncCatalogProductSnapshotFromOffers(supabase, productId).catch((syncError) => {
        console.error('[CatalogSnapshot] create product sync failed:', syncError?.message || syncError);
      });

      void maybeNotifyInventoryBelowMov({
        supplierId: req.userId,
        supplierProductId: newSupplierProduct.id,
        previousStock: newSupplierProduct.stock,
        newStock: newSupplierProduct.stock,
        quantityChange: 0,
        previousLsaThreshold: null
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
        brand: effectiveBrandInput || baseProduct?.brand || '',
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
        images: resolveSupplierOfferDisplayImages(normalizedImageUrls, [])
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

      return res.status(existingSupplierProduct ? 200 : 201).json({
        status: 'success',
        message: shouldBeApproved
          ? 'Product added successfully and is immediately available.'
          : resubmittingRejectedOffer
            ? 'Product resubmitted successfully and is pending admin approval.'
            : hasSpecificationChanges
              ? 'Product added successfully. Specification changes require admin approval before this listing goes live.'
              : 'Product added successfully and is pending admin approval.',
        product: responseProduct,
        nextStep: {
          brand: effectiveBrandInput || responseProduct.brand || '',
          productName: submittedName || responseProduct.name || '',
          supplierProductId: createdOffer?.id || newSupplierProduct?.id || null,
          variantKey: createdOffer?.variant_key || resolvedVariantKey || null,
          variantAsin: createdOffer?.variant_asin || variantAsin || null
        },
        requiresAdminApproval: !shouldBeApproved,
        specificationChangesDetected: hasSpecificationChanges
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Add product error:', error);
      if (
        isSupplierOfferUniqueViolation(error) ||
        isPgUniqueViolation(error) ||
        looksLikePostgresConstraintError(error)
      ) {
        return res.status(400).json(toSupplierOfferWriteErrorResponse(error));
      }
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  };
}

