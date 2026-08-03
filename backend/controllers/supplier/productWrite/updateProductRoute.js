import {
  brandIsAllowedForSupplier,
  buildSupplierVariantIdentity,
  buildVariantAsinLikeId,
  findAdmins,
  findUserBasicById,
  getContractErrorMessage,
  insertNotifications,
  isCatalogGuardrailsEnabled,
  isValidGtin,
  loadEffectiveSupplierChainProfile,
  maybeNotifyInventoryBelowMov,
  normalizeGtin,
  parseWithSchema,
  shouldMoveToPendingForSpecChange,
  shouldRequireApprovalForVariantSpecChange,
  supplierProductUpdateSchema
} from '../supplierImports.js';
import {
  sanitizeImageUrls,
  validateAndNormalizeTaxRates
} from '../shared/productHelpers.js';
import {
  buildSupplierProductUpdatePayload,
  checkDuplicateSupplierVariant,
  ensureCategoryAndUnit,
  fetchAndValidateSupplierProductForUpdate
} from '../../../services/supplierProductWriteService.js';
import { parseSupplierStockQuantity } from '../../../utils/parseSupplierStockQuantity.js';
import { resolveSupplierOfferDisplayImages, syncCatalogProductImages } from '../../../services/productImageService.js';
import { syncCatalogProductSnapshotFromOffers } from '../../../services/catalogOfferSnapshotService.js';
import {
  bodyHasInventoryUpdateFields,
  validateSupplierProductUpdateRequest,
  validateSupplierMrpUpdateAllowed,
  validateSupplierSpecificationUpdateAllowed,
  SUPPLIER_MRP_LOCKED_MESSAGE,
  SUPPLIER_SPEC_VALUES_LOCKED_MESSAGE
} from '../../../services/supplierProductUpdateValidation.js';
import { validateProductUnitCompatibility } from '../../../utils/productUnitCompatibility.js';

export function registerSupplierProductUpdateRoute(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    upsertModelSpecProfile
  } = ctx;

  // Update product (supports both shared product data and supplier-specific inventory)
  router.put('/products/:id', authenticateToken, async (req, res) => {
    try {
      req.body = parseWithSchema(supplierProductUpdateSchema, req.body || {});
      const hasInventoryFields = bodyHasInventoryUpdateFields(req.body);
      if (hasInventoryFields && req.body.specifications !== undefined) {
        delete req.body.specifications;
      }

      const validation = validateSupplierProductUpdateRequest(req.body || {});
      if (!validation.ok) {
        return res.status(400).json({
          status: 'error',
          code: validation.code || 'validation_error',
          message: validation.message || 'Please complete all required fields.',
          errors: validation.errors || [],
          missingFields: validation.missingFields || []
        });
      }

      const id = req.params.id;
      console.log(`[Supplier Inventory] PUT /api/supplier/products/${id} by supplier ${req.userId}`, {
        bodyKeys: Object.keys(req.body || {}),
        price: req.body?.price,
        stock: req.body?.stock,
        location: req.body?.location
      });

      // 1) Try to treat ID as supplier_products.id (inventory update)
      const { supplierProduct, error: supplierProductError } =
        await fetchAndValidateSupplierProductForUpdate(supabase, { id, reqUserId: req.userId });

      if (supplierProduct) {
        const mrpValidation = validateSupplierMrpUpdateAllowed(supplierProduct, req.body || {});
        if (!mrpValidation.ok) {
          return res.status(403).json({
            status: 'error',
            code: mrpValidation.code || 'mrp_locked',
            message: mrpValidation.message || SUPPLIER_MRP_LOCKED_MESSAGE,
            missingFields: mrpValidation.missingFields || ['price']
          });
        }

        const specValidation = validateSupplierSpecificationUpdateAllowed(supplierProduct, req.body || {});
        if (!specValidation.ok) {
          return res.status(403).json({
            status: 'error',
            code: specValidation.code || 'spec_values_locked',
            message: specValidation.message || SUPPLIER_SPEC_VALUES_LOCKED_MESSAGE,
            missingFields: specValidation.missingFields || ['specifications']
          });
        }

        if (req.body.unit !== undefined && String(req.body.unit || '').trim()) {
          const { data: unitContextProduct } = await supabase
            .from('products')
            .select('id, name, category, unit, status')
            .eq('id', supplierProduct.product_id)
            .maybeSingle();
          const unitCheck = validateProductUnitCompatibility({
            unit: req.body.unit,
            productName: req.body.name || unitContextProduct?.name || '',
            category: req.body.category || unitContextProduct?.category || ''
          });
          if (!unitCheck.ok && unitCheck.severity === 'error') {
            return res.status(400).json({
              status: 'error',
              code: unitCheck.code || 'unit_incompatible',
              message: unitCheck.message,
              missingFields: ['unit'],
              suggestedUnits: unitCheck.suggestedUnits
            });
          }
        }

        const payload = buildSupplierProductUpdatePayload({
          reqBody: req.body,
          supplierProduct,
          validateAndNormalizeTaxRates,
          sanitizeImageUrls,
          normalizeGtin,
          isValidGtin,
          shouldMoveToPendingForSpecChange
        });
        if (payload.error) {
          return res.status(400).json({ status: 'error', message: payload.error });
        }
        const {
          updateSupplierProductData,
          updatedAttributes,
          nextSpecifications,
          specificationsChanged
        } = payload;

        if (req.body.brandModel !== undefined) {
          const brandToValidate = String(
            updatedAttributes.brandModel ||
              updatedAttributes.brand ||
              req.body.brand ||
              supplierProduct?.attributes?.brandModel ||
              supplierProduct?.attributes?.brand ||
              ''
          ).trim();
          // Image/inventory-only saves often omit brand. Do not fail those with brand_required.
          if (brandToValidate) {
            const effectiveProfile = await loadEffectiveSupplierChainProfile(req.userId, req.user?.profile || {});
            const brandGuard = brandIsAllowedForSupplier(effectiveProfile, brandToValidate);
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
        }

        const candidateLocation = req.body.location !== undefined
          ? ((req.body.location || '').trim() || supplierProduct.location)
          : supplierProduct.location;
        const { data: parentProduct } = await supabase
          .from('products')
          .select('asin, specifications, status')
          .eq('id', supplierProduct.product_id)
          .maybeSingle();
        const variantIdentity = buildSupplierVariantIdentity(
          {
            unit: req.body.unit !== undefined ? req.body.unit : updatedAttributes.unit,
            brandModel: updatedAttributes.brandModel,
            gtin: updatedAttributes.gtin,
            mpn: updatedAttributes.mpn,
            sku: updatedAttributes.sku,
            packSize: updatedAttributes.packSize,
            specifications: nextSpecifications
          },
          parentProduct
        );
        const variantKeyChanged =
          specificationsChanged ||
          String(variantIdentity.variantKey || '') !== String(supplierProduct.variant_key || '');

        if (variantKeyChanged) {
          updateSupplierProductData.variant_key = variantIdentity.variantKey;
          updatedAttributes.variantAttributes = variantIdentity.variant.variantAttributes;
          if (updateSupplierProductData.attributes) {
            updateSupplierProductData.attributes = {
              ...updateSupplierProductData.attributes,
              variantAttributes: variantIdentity.variant.variantAttributes
            };
          }
          updateSupplierProductData.variant_asin = buildVariantAsinLikeId(
            parentProduct?.asin || '',
            variantIdentity.variantKey
          );

          const duplicateVariant = await checkDuplicateSupplierVariant(supabase, {
            supplierProduct,
            reqUserId: req.userId,
            candidateLocation,
            variantKey: variantIdentity.variantKey,
            currentId: id
          });
          if (duplicateVariant) {
            return res.status(400).json({
              status: 'error',
              message: 'An identical product variation already exists for this location. Update that offer instead.'
            });
          }
        }

        let movedToPendingForSpecReview = false;
        if (specificationsChanged) {
          const { data: anyApprovedOfferForProduct } = await supabase
            .from('supplier_products')
            .select('id')
            .eq('product_id', supplierProduct.product_id)
            .eq('status', 'approved')
            .limit(1)
            .maybeSingle();
          const requiresApproval = shouldRequireApprovalForVariantSpecChange({
            catalogProductStatus: parentProduct?.status,
            hasAnyApprovedOfferForProduct: Boolean(anyApprovedOfferForProduct?.id),
            currentOfferStatus: supplierProduct.status
          });
          if (requiresApproval) {
            movedToPendingForSpecReview = true;
            updateSupplierProductData.status = 'pending';
            updateSupplierProductData.is_active = false;
            updateSupplierProductData.approved_by = null;
            updateSupplierProductData.approved_at = null;
            updateSupplierProductData.rejection_reason = null;
          }
        }

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
          return res.status(400).json({
            status: 'error',
            message: spUpdateError?.code === '23505'
              ? 'This exact product variation already exists for the selected location.'
              : (spUpdateError?.message || 'Failed to update product')
          });
        }

        if (req.body.unit !== undefined && String(req.body.unit || '').trim()) {
          try {
            const { unitName } = await ensureCategoryAndUnit(supabase, {
              category: req.body.category,
              unit: req.body.unit,
              reqUserId: req.userId
            });
            if (unitName) {
              const { error: unitUpdateError } = await supabase
                .from('products')
                .update({ unit: unitName })
                .eq('id', updatedSupplierProduct.product_id);
              if (unitUpdateError) {
                console.error(
                  '[Supplier Product] Failed to sync catalog unit:',
                  unitUpdateError.message || unitUpdateError
                );
              } else {
                // Keep offer attributes aligned with catalog unit for list/detail reads.
                const nextAttributes = {
                  ...(updatedSupplierProduct.attributes || {}),
                  unit: unitName
                };
                updatedSupplierProduct.attributes = nextAttributes;
                await supabase
                  .from('supplier_products')
                  .update({ attributes: nextAttributes })
                  .eq('id', updatedSupplierProduct.id)
                  .eq('supplier_id', req.userId);
              }
            }
          } catch (unitSyncError) {
            console.error(
              '[Supplier Product] Failed to sync catalog unit:',
              unitSyncError?.message || unitSyncError
            );
          }
        }

        void syncCatalogProductSnapshotFromOffers(supabase, updatedSupplierProduct.product_id).catch((syncError) => {
          console.error('[CatalogSnapshot] update product sync failed:', syncError?.message || syncError);
        });

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

        const offerImages = sanitizeImageUrls(updatedSupplierProduct.attributes?.images);
        if (offerImages.length > 0) {
          await syncCatalogProductImages(supabase, updatedSupplierProduct.product_id, offerImages);
        }

        const { data: baseProduct } = await supabase
          .from('products')
          .select('id, name, description, category, unit, brand, gtin, mpn, specifications, images, asin, status')
          .eq('id', updatedSupplierProduct.product_id)
          .single();

        void upsertModelSpecProfile({
          category: req.body.category || baseProduct?.category,
          modelRaw: req.body.mpn || updatedAttributes.brandModel || baseProduct?.mpn,
          specifications: nextSpecifications,
          actorUserId: req.userId
        }).catch((err) => console.log('upsertModelSpecProfile failed:', err?.message || err));

        const ra = updatedSupplierProduct.attributes || {};
        const resolvedUnit =
          String(ra.unit || '').trim() ||
          String(baseProduct?.unit || '').trim() ||
          String(req.body.unit || '').trim() ||
          '';
        const responseProduct = {
          ...(baseProduct || {}),
          name: (ra.listingName != null && String(ra.listingName).trim() !== '') ? String(ra.listingName).trim() : baseProduct?.name,
          supplierDescription: ra.supplierDescription || ra.description || '',
          publishedDescription: baseProduct?.description || '',
          description: ra.supplierDescription || ra.description || '',
          brand: ra.brand || baseProduct?.brand,
          unit: resolvedUnit,
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
          stock:
            parseSupplierStockQuantity(updatedSupplierProduct.stock) ??
            parseSupplierStockQuantity(supplierProduct.stock) ??
            0,
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
          attributes: updatedSupplierProduct.attributes || {},
          images: resolveSupplierOfferDisplayImages(
            updatedSupplierProduct.attributes?.images,
            baseProduct?.images
          )
        };

        void (async () => {
          try {
            const changes = [];
            if (supplierProduct.price !== updatedSupplierProduct.price) {
              changes.push(`Price: ₹${supplierProduct.price} -> ₹${updatedSupplierProduct.price}`);
            }
            if (supplierProduct.stock !== updatedSupplierProduct.stock) changes.push(`Stock: ${supplierProduct.stock} -> ${updatedSupplierProduct.stock}`);
            if (supplierProduct.location !== updatedSupplierProduct.location) changes.push(`Location changed`);
            if (supplierProduct.min_order_quantity !== updatedSupplierProduct.min_order_quantity) changes.push(`Min Order Qty changed`);
            if (specificationsChanged) {
              changes.push(
                movedToPendingForSpecReview
                  ? 'Specifications changed (requires admin approval)'
                  : 'Variant specifications updated'
              );
            }
            if (changes.length === 0) return;

            const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
            const { data: admins } = await findAdmins(adminEmail, supabase);
            const { data: supplier } = await findUserBasicById(req.userId, supabase);
            if (!admins?.length) return;

            const notifications = admins.map((admin) => ({
              user_id: admin.id,
              type: 'supplier_edit',
              title: `Supplier Updated Inventory: ${responseProduct.name}`,
              message: `${supplier?.name || 'Supplier'} updated "${responseProduct.name}". Changes: ${changes.join(', ')}`,
              related_product_id: updatedSupplierProduct.product_id,
              related_supplier_id: req.userId,
              metadata: { productId: updatedSupplierProduct.product_id, supplierId: req.userId, changes },
              is_read: false
            }));
            await insertNotifications(notifications, supabase);
          } catch (notifErr) {
            console.log('Failed to notify admins about supplier inventory update:', notifErr?.message || notifErr);
          }
        })();

        return res.json({
          status: 'success',
          message: movedToPendingForSpecReview
            ? 'Specifications updated. Product is now pending admin approval.'
            : 'Product updated successfully',
          product: responseProduct
        });
      }

      if (supplierProductError && supplierProductError.code && supplierProductError.code !== 'PGRST116') {
        console.error('Error checking supplier_products for update:', supplierProductError);
      }

      const inventoryFieldsTouched =
        req.body.stock !== undefined ||
        req.body.price !== undefined ||
        req.body.location !== undefined ||
        req.body.min_order_quantity !== undefined;

      if (inventoryFieldsTouched) {
        const { data: offerRows, error: offerRowsError } = await supabase
          .from('supplier_products')
          .select('id')
          .eq('product_id', id)
          .eq('supplier_id', req.userId)
          .neq('status', 'rejected');

        if (!offerRowsError && offerRows && offerRows.length > 0) {
          return res.status(400).json({
            status: 'error',
            message:
              offerRows.length > 1
                ? 'This product has multiple variants. Edit each variant separately in Manage Inventory (each row has its own offer id).'
                : 'Use the variant offer id from Manage Inventory, not the shared catalog product id.'
          });
        }
      }

      // 2) Fallback: treat ID as products.id (backward compatibility)
      const { data: oldProduct, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
      if (fetchError || !oldProduct) {
        return res.status(404).json({ status: 'error', message: 'Product not found' });
      }
      if (oldProduct.supplier_id && oldProduct.supplier_id !== req.userId) {
        return res.status(403).json({ status: 'error', message: 'You do not have permission to update this product' });
      }

      const updateData = { ...req.body, specifications: req.body.specifications || oldProduct.specifications || {} };
      const legacySpecificationsChanged = shouldMoveToPendingForSpecChange({
        specificationsProvided: req.body.specifications !== undefined,
        currentSpecs: oldProduct.specifications || {},
        nextSpecs: updateData.specifications || {}
      });
      delete updateData.id;
      delete updateData.supplier_id;
      delete updateData.status;
      delete updateData.approved_by;
      delete updateData.approved_at;
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
        return res.status(400).json({ status: 'error', message: updateError?.message || 'Failed to update product' });
      }
      if (legacySpecificationsChanged) {
        await supabase
          .from('supplier_products')
          .update({ status: 'pending', is_active: false, approved_by: null, approved_at: null, rejection_reason: null })
          .eq('product_id', product.id)
          .eq('supplier_id', req.userId);
      }

      return res.json({
        status: 'success',
        message: legacySpecificationsChanged ? 'Specifications updated. Product is now pending admin approval.' : 'Product updated successfully',
        product
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Update product error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });
}
