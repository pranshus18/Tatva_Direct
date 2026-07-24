/** PO routes: cart */
import {
  MAX_CART_ITEM_QUANTITY,
  buildPoCartDraftFromSavePayload,
  getContractErrorMessage,
  mergeTransportSelection,
  mergeOrAppendCartGroupItem,
  appendDiscoveryItemAsNewProject,
  loadAdminBrandTerminalRoleMap,
  normalizePoCartDraft,
  poCartDraftNeedsPersistAfterPrune,
  parseWithSchema,
  poCartSaveSchema,
  poCartTransportPatchSchema,
  poCheckoutReleaseSchema,
  poCheckoutReserveSchema,
  supplierMatchesBrandTerminalRole
} from './poImports.js';
import { deriveShippingAddressesFromProfile } from '../profile/profileHelpers.js';
import { isAddressComplete, normalizeAddress } from './shared/poHelpers.js';
import { formatShippingAddressText } from '../../services/vendorRequestContextService.js';
import { geocodeIndianAddress } from '../../utils/geoUtils.js';
import { validateRequiredDateNotPast } from '../../utils/dateTime.js';
import {
  CHECKOUT_RESERVATION_MINUTES,
  CHECKOUT_SOURCES,
  getCheckoutReservationStatus,
  releaseCheckoutReservations,
  reserveCheckoutLines
} from '../../services/checkoutInventoryReservationService.js';

export function registerPoCartRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase
  } = ctx;

const normalizeProjectNameKey = (value) => String(value || '').trim().toLowerCase();
const normalizeProjectDateKey = (value) => String(value || '').trim().slice(0, 10);

async function resolveDiscoveryProjectShipping(supabaseClient, userId, body = {}) {
  const shippingAddressId = String(body?.shippingAddressId || '').trim();
  const inlineAddress =
    body?.shippingAddress && typeof body.shippingAddress === 'object'
      ? normalizeAddress(body.shippingAddress)
      : null;

  if (inlineAddress && isAddressComplete(inlineAddress)) {
    return {
      shippingAddressId: shippingAddressId || null,
      shippingAddress: inlineAddress
    };
  }

  if (!shippingAddressId) {
    return null;
  }

  const { data: user, error } = await supabaseClient
    .from('users')
    .select('profile, user_type')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;

  const saved = deriveShippingAddressesFromProfile(user || {});
  const match = saved.find((entry) => String(entry.id) === shippingAddressId);
  if (!match) {
    return { error: 'Selected shipping address was not found in your profile.' };
  }

  return {
    shippingAddressId,
    shippingAddress: normalizeAddress(match)
  };
}

async function enrichDiscoveryShippingMeta(shippingMeta) {
  if (!shippingMeta?.shippingAddress) return shippingMeta;
  const location = formatShippingAddressText(shippingMeta.shippingAddress);
  let siteGeo = null;
  try {
    const geo = await geocodeIndianAddress(shippingMeta.shippingAddress);
    if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
      siteGeo = { lat: geo.lat, lng: geo.lng };
    }
  } catch {
    // Geocoding is best-effort; ranking still uses city/state fallback.
  }
  return {
    ...shippingMeta,
    location,
    siteGeo
  };
}

const hasDuplicateProjectKey = (groups, nextName, nextDate, excludeGroupId = '') => {
  const nameKey = normalizeProjectNameKey(nextName);
  const dateKey = normalizeProjectDateKey(nextDate);
  return (Array.isArray(groups) ? groups : []).some((group) => {
    const gid = String(group?.groupId || '').trim();
    if (excludeGroupId && gid === excludeGroupId) return false;
    const existingNameKey = normalizeProjectNameKey(group?.boqName || '');
    const existingDateKey = normalizeProjectDateKey(
      group?.boqProject?.requiredDate || group?.requiredDate || ''
    );
    return existingNameKey === nameKey && existingDateKey === dateKey;
  });
};

router.get('/cart', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const { data: cart, error } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at, created_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (error) throw error;
    if (!cart) {
      return res.json({ status: 'success', cart: null });
    }

    const rawDraft = cart.draft_payload && typeof cart.draft_payload === 'object' ? cart.draft_payload : {};
    const draft = normalizePoCartDraft(rawDraft);
    if (poCartDraftNeedsPersistAfterPrune(rawDraft, draft)) {
      await supabase
        .from('po_carts')
        .update({ draft_payload: draft })
        .eq('id', cart.id)
        .eq('service_provider_id', req.userId);
    }

    return res.json({
      status: 'success',
      cart: {
        id: cart.id,
        draft,
        updatedAt: cart.updated_at,
        createdAt: cart.created_at
      }
    });
  } catch (error) {
    console.error('Get PO cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load cart' });
  }
});

router.put('/cart', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poCartSaveSchema, req.body || {});
    const draftPayload = buildPoCartDraftFromSavePayload(payload);
    const groups = Array.isArray(draftPayload?.boqGroups) ? draftPayload.boqGroups : [];
    const seen = new Set();
    for (const group of groups) {
      const key = `${normalizeProjectNameKey(group?.boqName || '')}::${normalizeProjectDateKey(
        group?.boqProject?.requiredDate || group?.requiredDate || ''
      )}`;
      if (seen.has(key)) {
        return res.status(400).json({
          status: 'error',
          message: 'Duplicate projects are not allowed with the same name and expected delivery date'
        });
      }
      seen.add(key);
    }

    const { data: saved, error } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: draftPayload
        },
        { onConflict: 'service_provider_id' }
      )
      .select('id, updated_at')
      .single();
    if (error) throw error;
    return res.json({
      status: 'success',
      message: 'Cart saved successfully',
      cart: {
        id: saved.id,
        updatedAt: saved.updated_at
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Save PO cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to save cart' });
  }
});

router.post('/cart/discovery-item', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const productId = String(req.body?.productId || '').trim();
    const variantKey = String(req.body?.variantKey || '').trim();
    const rawQty = Number(req.body?.quantity);
    const quantity = Number.isFinite(rawQty) ? Math.max(1, Math.floor(rawQty)) : 1;
    const targetGroupId = String(req.body?.groupId || '').trim();
    const providedProjectName = String(req.body?.projectName || '').trim();
    const hasExpectedDeliveryDateField = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'expectedDeliveryDate'
    );
    const providedExpectedDate = String(req.body?.expectedDeliveryDate || '').trim();
    const expectedDeliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(providedExpectedDate)
      ? providedExpectedDate
      : null;

    if (!productId) {
      return res.status(400).json({ status: 'error', message: 'productId is required' });
    }
    if (hasExpectedDeliveryDateField && providedExpectedDate && !expectedDeliveryDate) {
      return res.status(400).json({
        status: 'error',
        message: 'expectedDeliveryDate must be in YYYY-MM-DD format'
      });
    }
    if (expectedDeliveryDate) {
      const dateValidation = validateRequiredDateNotPast(expectedDeliveryDate);
      if (dateValidation.error) {
        return res.status(400).json({ status: 'error', message: dateValidation.error });
      }
    }
    if (!targetGroupId && providedProjectName && !expectedDeliveryDate) {
      return res.status(400).json({
        status: 'error',
        message: 'expectedDeliveryDate is required when creating a named new project'
      });
    }

    const shippingMeta = await resolveDiscoveryProjectShipping(supabase, req.userId, req.body || {});
    if (shippingMeta?.error) {
      return res.status(400).json({ status: 'error', message: shippingMeta.error });
    }
    const enrichedShipping = shippingMeta ? await enrichDiscoveryShippingMeta(shippingMeta) : null;

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, unit, brand, specifications, status')
      .eq('id', productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || String(product.status || '').toLowerCase() !== 'approved') {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    // Keep cart add behavior aligned with Product Discovery and PO grouping rules:
    // product must have at least one active approved offer from a supplier eligible
    // for the terminal role configured for this brand's supply chain.
    const { data: activeListings, error: listingError } = await supabase
      .from('supplier_products')
      .select('id, supplier:users!supplier_products_supplier_id_fkey(profile)')
      .eq('product_id', productId)
      .eq('status', 'approved')
      .eq('is_active', true)
      .limit(200);
    if (listingError) throw listingError;
    const brandLabel =
      String(product?.brand || '').trim() ||
      String(product?.specifications?.brand || '').trim() ||
      String(product?.specifications?.brandModel || '').trim();
    const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(
      supabase,
      brandLabel ? [brandLabel] : []
    );
    const hasTerminalEligibleListing = (activeListings || []).some((row) =>
      supplierMatchesBrandTerminalRole(
        row?.supplier?.profile || {},
        brandLabel,
        terminalRoleByBrandMap
      )
    );
    if (!hasTerminalEligibleListing) {
      return res.status(400).json({
        status: 'error',
        message: "This product is not currently listed by the terminal role supplier for this brand's supply chain."
      });
    }

    const { data: cartRow, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (cartError) throw cartError;

    const currentDraft = normalizePoCartDraft(
      cartRow?.draft_payload && typeof cartRow.draft_payload === 'object' ? cartRow.draft_payload : {}
    );

    const discoveryItem = {
      id: `pd-item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      normalizedName: product.name || 'Unnamed Product',
      rawName: product.name || 'Unnamed Product',
      name: product.name || 'Unnamed Product',
      quantity,
      unit: product.unit || 'nos',
      productId: product.id,
      brand: product.brand || undefined,
      specifications: product.specifications || undefined
    };
    if (variantKey) {
      discoveryItem.variantKey = variantKey;
    }

    let nextGroups = Array.isArray(currentDraft.boqGroups) ? [...currentDraft.boqGroups] : [];
    let resultGroupId = '';

    if (targetGroupId) {
      let matched = false;
      nextGroups = nextGroups.map((group) => {
        if (String(group?.groupId || '') !== targetGroupId) return group;
        matched = true;
        const existingItems = Array.isArray(group.items) ? group.items : [];
        const nextProject = { ...(group.boqProject || {}) };
        if (enrichedShipping?.shippingAddress) {
          nextProject.shippingAddress = enrichedShipping.shippingAddress;
          if (enrichedShipping.shippingAddressId) {
            nextProject.shippingAddressId = enrichedShipping.shippingAddressId;
          }
          if (enrichedShipping.location) nextProject.location = enrichedShipping.location;
          if (enrichedShipping.siteGeo) nextProject.siteGeo = enrichedShipping.siteGeo;
        }
        // Same product added again to the SAME project: increase the existing line's quantity
        // instead of appending a second row for it. A different project always gets its own line
        // (handled below in the "new project" branch), so this only dedupes within one project.
        return {
          ...group,
          boqProject: nextProject,
          items: mergeOrAppendCartGroupItem(existingItems, discoveryItem)
        };
      });
      if (!matched) {
        return res.status(404).json({ status: 'error', message: 'Selected project not found in cart' });
      }
      resultGroupId = targetGroupId;
    } else {
      const proposedProjectName = providedProjectName || product.name;
      const proposedProjectDate = expectedDeliveryDate || '';
      if (hasDuplicateProjectKey(currentDraft.boqGroups, proposedProjectName, proposedProjectDate)) {
        return res.status(400).json({
          status: 'error',
          message: 'A project with the same name and expected delivery date already exists'
        });
      }
      const appended = appendDiscoveryItemAsNewProject(currentDraft.boqGroups, discoveryItem, product.name, {
        projectName: proposedProjectName,
        expectedDeliveryDate,
        shippingAddressId: enrichedShipping?.shippingAddressId || null,
        shippingAddress: enrichedShipping?.shippingAddress || null,
        location: enrichedShipping?.location || null,
        siteGeo: enrichedShipping?.siteGeo || null
      });
      nextGroups = appended.boqGroups;
      resultGroupId = appended.groupId;
    }

    const nextDraftPayload = normalizePoCartDraft({
      ...currentDraft,
      boqGroups: nextGroups
    });

    const { error: saveError } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: nextDraftPayload
        },
        { onConflict: 'service_provider_id' }
      );
    if (saveError) throw saveError;

    return res.json({
      status: 'success',
      message: 'Product added to cart',
      groupId: resultGroupId
    });
  } catch (error) {
    console.error('Add discovery product to cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to add product to cart' });
  }
});

router.patch('/cart/transport-selection', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poCartTransportPatchSchema, req.body || {});

    const { data: cart, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload')
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (cartError) throw cartError;

    const currentDraft = normalizePoCartDraft(
      cart?.draft_payload && typeof cart.draft_payload === 'object' ? cart.draft_payload : {}
    );

    let nextTransportSelection = currentDraft.transportSelection || null;
    if (payload.clear === true) {
      nextTransportSelection = null;
    } else if (payload.transportSelection && typeof payload.transportSelection === 'object') {
      nextTransportSelection = mergeTransportSelection(
        currentDraft.transportSelection,
        payload.transportSelection,
        payload.transportVendorIds
      );
    }

    const nextDraftPayload = {
      ...currentDraft,
      transportSelection: nextTransportSelection
    };

    const { error: saveError } = await supabase.from('po_carts').upsert(
      {
        service_provider_id: req.userId,
        draft_payload: nextDraftPayload
      },
      { onConflict: 'service_provider_id' }
    );
    if (saveError) throw saveError;

    return res.json({
      status: 'success',
      transportSelection: nextTransportSelection
    });
  } catch (error) {
    console.error('Patch PO cart transport selection error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to save transport selection' });
  }
});

router.patch('/cart/items/:itemId/quantity', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const rawQuantity = Number(req.body?.quantity);
    const quantity = Number.isFinite(rawQuantity) ? Math.floor(rawQuantity) : NaN;
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY) {
      return res.status(400).json({
        status: 'error',
        message: `Quantity must be an integer between 1 and ${MAX_CART_ITEM_QUANTITY}`
      });
    }

    const itemId = String(req.params?.itemId || '').trim();
    if (!itemId) {
      return res.status(400).json({
        status: 'error',
        message: 'Cart item id is required'
      });
    }

    const { data: cart, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (cartError) throw cartError;
    if (!cart) {
      return res.status(404).json({ status: 'error', message: 'Saved cart not found' });
    }

    const currentDraft = normalizePoCartDraft(
      cart.draft_payload && typeof cart.draft_payload === 'object' ? cart.draft_payload : {}
    );
    const groups = Array.isArray(currentDraft.boqGroups) ? [...currentDraft.boqGroups] : [];
    let found = false;
    const nextGroups = groups.map((group) => {
      const arr = Array.isArray(group.items) ? [...group.items] : [];
      const idx = arr.findIndex((item) => item?.id !== undefined && item?.id !== null && String(item.id) === itemId);
      if (idx < 0) return group;
      found = true;
      const nextArr = [...arr];
      nextArr[idx] = { ...nextArr[idx], quantity };
      return { ...group, items: nextArr };
    });

    if (!found) {
      return res.status(404).json({ status: 'error', message: 'Cart item not found' });
    }

    const nextDraftPayload = normalizePoCartDraft({
      ...currentDraft,
      boqGroups: nextGroups
    });

    const { error: updateError } = await supabase
      .from('po_carts')
      .update({ draft_payload: nextDraftPayload })
      .eq('id', cart.id)
      .eq('service_provider_id', req.userId);
    if (updateError) throw updateError;

    const updatedItem = nextDraftPayload.items.find((it) => String(it?.id) === itemId);

    return res.json({
      status: 'success',
      message: 'Cart item quantity updated',
      item: updatedItem
    });
  } catch (error) {
    console.error('Update PO cart item quantity error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update cart quantity' });
  }
});

router.delete('/cart/items/:itemId', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const itemId = String(req.params?.itemId || '').trim();
    if (!itemId) {
      return res.status(400).json({
        status: 'error',
        message: 'Cart item id is required'
      });
    }

    const { data: cart, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload')
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (cartError) throw cartError;
    if (!cart) {
      return res.status(404).json({ status: 'error', message: 'Saved cart not found' });
    }

    const currentDraft = normalizePoCartDraft(
      cart.draft_payload && typeof cart.draft_payload === 'object' ? cart.draft_payload : {}
    );
    const groups = Array.isArray(currentDraft.boqGroups) ? [...currentDraft.boqGroups] : [];
    let found = false;
    const nextGroups = groups
      .map((group) => {
        const arr = Array.isArray(group.items) ? [...group.items] : [];
        const nextItems = arr.filter((item) => {
          const isTarget = item?.id !== undefined && item?.id !== null && String(item.id) === itemId;
          if (isTarget) found = true;
          return !isTarget;
        });
        return {
          ...group,
          items: nextItems
        };
      })
      .filter((group) => Array.isArray(group.items) && group.items.length > 0);

    if (!found) {
      return res.status(404).json({ status: 'error', message: 'Cart item not found' });
    }

    const nextDraftPayload = normalizePoCartDraft({
      ...currentDraft,
      boqGroups: nextGroups
    });

    const { error: updateError } = await supabase
      .from('po_carts')
      .update({ draft_payload: nextDraftPayload })
      .eq('id', cart.id)
      .eq('service_provider_id', req.userId);
    if (updateError) throw updateError;

    return res.json({
      status: 'success',
      message: 'Cart item removed',
      itemId,
      draft: nextDraftPayload
    });
  } catch (error) {
    console.error('Delete PO cart item error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to remove cart item' });
  }
});

router.patch('/cart/groups/:groupId/name', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const groupId = String(req.params?.groupId || '').trim();
    const nextName = String(req.body?.boqName || '').trim();
    const hasExpectedDeliveryDateField = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'expectedDeliveryDate'
    );
    const hasShippingAddressIdField = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'shippingAddressId'
    );
    const hasShippingAddressField = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'shippingAddress'
    );
    const wantsShippingUpdate = hasShippingAddressIdField || hasShippingAddressField;
    const providedExpectedDate = String(req.body?.expectedDeliveryDate || '').trim();
    const expectedDeliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(providedExpectedDate)
      ? providedExpectedDate
      : null;
    if (!groupId) {
      return res.status(400).json({ status: 'error', message: 'Cart group id is required' });
    }
    if (!nextName) {
      return res.status(400).json({ status: 'error', message: 'Project name is required' });
    }
    if (nextName.length > 120) {
      return res.status(400).json({ status: 'error', message: 'Project name must be 120 characters or fewer' });
    }
    if (hasExpectedDeliveryDateField && providedExpectedDate && !expectedDeliveryDate) {
      return res.status(400).json({
        status: 'error',
        message: 'expectedDeliveryDate must be in YYYY-MM-DD format'
      });
    }
    if (expectedDeliveryDate) {
      const dateValidation = validateRequiredDateNotPast(expectedDeliveryDate);
      if (dateValidation.error) {
        return res.status(400).json({ status: 'error', message: dateValidation.error });
      }
    }

    const { data: cart, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (cartError) throw cartError;
    if (!cart) {
      return res.status(404).json({ status: 'error', message: 'Saved cart not found' });
    }

    const currentDraft = normalizePoCartDraft(
      cart.draft_payload && typeof cart.draft_payload === 'object' ? cart.draft_payload : {}
    );
    const groups = Array.isArray(currentDraft.boqGroups) ? [...currentDraft.boqGroups] : [];
    const targetGroup = groups.find((group) => String(group?.groupId || '') === groupId);
    if (!targetGroup) {
      return res.status(404).json({ status: 'error', message: 'Cart group not found' });
    }
    const effectiveDate = hasExpectedDeliveryDateField
      ? expectedDeliveryDate || ''
      : String(targetGroup?.boqProject?.requiredDate || targetGroup?.requiredDate || '').trim();
    if (hasDuplicateProjectKey(groups, nextName, effectiveDate, groupId)) {
      return res.status(400).json({
        status: 'error',
        message: 'A project with the same name and expected delivery date already exists'
      });
    }
    let found = false;
    let enrichedShipping = null;
    if (wantsShippingUpdate) {
      const shippingIdRaw = hasShippingAddressIdField ? String(req.body?.shippingAddressId || '').trim() : '';
      const hasInlineShipping =
        hasShippingAddressField &&
        req.body?.shippingAddress &&
        typeof req.body.shippingAddress === 'object';
      if (!shippingIdRaw && !hasInlineShipping) {
        enrichedShipping = { clear: true };
      } else {
        const shippingMeta = await resolveDiscoveryProjectShipping(supabase, req.userId, req.body || {});
        if (shippingMeta?.error) {
          return res.status(400).json({ status: 'error', message: shippingMeta.error });
        }
        if (shippingMeta) {
          enrichedShipping = await enrichDiscoveryShippingMeta(shippingMeta);
        }
      }
    }

    const nextGroups = groups.map((group) => {
      if (String(group?.groupId || '') !== groupId) return group;
      found = true;
      const nextProjectMeta =
        group?.boqProject && typeof group.boqProject === 'object' ? { ...group.boqProject } : {};
      if (hasExpectedDeliveryDateField) {
        if (expectedDeliveryDate) nextProjectMeta.requiredDate = expectedDeliveryDate;
        else delete nextProjectMeta.requiredDate;
      }
      if (enrichedShipping?.clear) {
        delete nextProjectMeta.shippingAddress;
        delete nextProjectMeta.shippingAddressId;
        delete nextProjectMeta.location;
        delete nextProjectMeta.siteGeo;
      } else if (enrichedShipping?.shippingAddress) {
        nextProjectMeta.shippingAddress = enrichedShipping.shippingAddress;
        if (enrichedShipping.shippingAddressId) {
          nextProjectMeta.shippingAddressId = enrichedShipping.shippingAddressId;
        }
        if (enrichedShipping.location) nextProjectMeta.location = enrichedShipping.location;
        if (enrichedShipping.siteGeo) nextProjectMeta.siteGeo = enrichedShipping.siteGeo;
      }
      return { ...group, boqName: nextName, boqProject: nextProjectMeta };
    });
    if (!found) return res.status(404).json({ status: 'error', message: 'Cart group not found' });

    const nextDraftPayload = normalizePoCartDraft({
      ...currentDraft,
      boqGroups: nextGroups
    });

    const { error: updateError } = await supabase
      .from('po_carts')
      .update({ draft_payload: nextDraftPayload })
      .eq('id', cart.id)
      .eq('service_provider_id', req.userId);
    if (updateError) throw updateError;

    return res.json({
      status: 'success',
      message: 'Project details updated',
      group: {
        groupId,
        boqName: nextName,
        expectedDeliveryDate: hasExpectedDeliveryDateField ? expectedDeliveryDate : null,
        shippingAddressId: enrichedShipping?.clear
          ? null
          : enrichedShipping?.shippingAddressId || null,
        shippingAddress: enrichedShipping?.clear ? null : enrichedShipping?.shippingAddress || null,
        location: enrichedShipping?.clear ? null : enrichedShipping?.location || null,
        siteGeo: enrichedShipping?.clear ? null : enrichedShipping?.siteGeo || null
      }
    });
  } catch (error) {
    console.error('Update PO cart project name error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update project name' });
  }
});

router.delete('/cart', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const { error } = await supabase
      .from('po_carts')
      .delete()
      .eq('service_provider_id', req.userId);
    if (error) throw error;
    return res.json({ status: 'success', message: 'Cart cleared successfully' });
  } catch (error) {
    console.error('Clear PO cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to clear cart' });
  }
});

router.get('/checkout-reservation-config', authenticateToken, isServiceProvider, async (_req, res) => {
  return res.json({
    status: 'success',
    expiresInMinutes: CHECKOUT_RESERVATION_MINUTES
  });
});

router.post('/checkout-reservations', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poCheckoutReserveSchema, req.body || {});
    const result = await reserveCheckoutLines({
      buyerUserId: req.userId,
      source: CHECKOUT_SOURCES.SP_PO,
      checkoutSessionId: payload.checkoutSessionId,
      lines: payload.lines
    });

    return res.json({
      status: 'success',
      message: `Inventory held for ${CHECKOUT_RESERVATION_MINUTES} minutes while you complete checkout`,
      checkoutSessionId: result.checkoutSessionId,
      expiresAt: result.expiresAt,
      expiresInMinutes: result.expiresInMinutes,
      reservations: (result.reservations || []).map((row) => ({
        id: row.id,
        supplierProductId: row.supplier_product_id,
        supplierId: row.supplier_id,
        reservedQuantity: row.reserved_quantity,
        expiresAt: row.expires_at
      }))
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('PO checkout reserve error:', error);
    const rawMessage = String(error?.message || '');
    const isDuplicateReservation =
      String(error?.code || '') === '23505' ||
      /inventory_reservations_idempotency_key/i.test(rawMessage) ||
      /duplicate key value violates unique constraint/i.test(rawMessage);
    return res.status(400).json({
      status: 'error',
      message: isDuplicateReservation
        ? 'Could not reserve inventory because a checkout hold is already in progress. Please retry checkout.'
        : rawMessage || 'Failed to reserve inventory for checkout'
    });
  }
});

router.get('/checkout-reservations/:checkoutSessionId', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const checkoutSessionId = String(req.params?.checkoutSessionId || '').trim();
    if (!checkoutSessionId) {
      return res.status(400).json({ status: 'error', message: 'checkoutSessionId is required' });
    }

    const status = await getCheckoutReservationStatus({
      buyerUserId: req.userId,
      source: CHECKOUT_SOURCES.SP_PO,
      checkoutSessionId
    });

    return res.json({ status: 'success', ...status });
  } catch (error) {
    console.error('PO checkout reservation status error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load checkout reservation status' });
  }
});

router.delete('/checkout-reservations', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poCheckoutReleaseSchema, req.body || {});
    const result = await releaseCheckoutReservations({
      buyerUserId: req.userId,
      source: CHECKOUT_SOURCES.SP_PO,
      checkoutSessionId: payload.checkoutSessionId || null,
      actorUserId: req.userId
    });

    return res.json({
      status: 'success',
      message:
        result.released > 0
          ? 'Inventory hold released — stock is available again for other buyers'
          : 'No active inventory hold to release',
      released: result.released
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('PO checkout release error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to release checkout reservations' });
  }
});

// Service provider rating + feedback for a supplier on an order
}
