/** PO routes: cart */
import {
  MAX_CART_ITEM_QUANTITY,
  buildPoCartDraftFromSavePayload,
  getContractErrorMessage,
  appendDiscoveryItemAsNewProject,
  normalizePoCartDraft,
  parseWithSchema,
  poCartSaveSchema
} from './poImports.js';

export function registerPoCartRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase
  } = ctx;

router.get('/cart', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const { data: cart, error } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at, created_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (error) throw error;
    return res.json({
      status: 'success',
      cart: cart
        ? {
            id: cart.id,
            draft: normalizePoCartDraft(cart.draft_payload || {}),
            updatedAt: cart.updated_at,
            createdAt: cart.created_at
          }
        : null
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
    const rawQty = Number(req.body?.quantity);
    const quantity = Number.isFinite(rawQty) ? Math.max(1, Math.floor(rawQty)) : 1;

    if (!productId) {
      return res.status(400).json({ status: 'error', message: 'productId is required' });
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, unit, brand, specifications, status')
      .eq('id', productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || String(product.status || '').toLowerCase() !== 'approved') {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    // Keep cart add behavior aligned with Product Discovery:
    // allow only products that are actively listed by at least one approved supplier listing.
    const { data: activeListing, error: listingError } = await supabase
      .from('supplier_products')
      .select('id')
      .eq('product_id', productId)
      .eq('status', 'approved')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!activeListing) {
      return res.status(400).json({
        status: 'error',
        message: 'This product is not currently listed on the platform.'
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

    const { boqGroups: nextGroups, groupId: resultGroupId } = appendDiscoveryItemAsNewProject(
      currentDraft.boqGroups,
      discoveryItem,
      product.name
    );

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

// Service provider rating + feedback for a supplier on an order
}
