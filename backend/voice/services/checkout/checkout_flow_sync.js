/**
 * Persist in-memory voice checkout (suppliers, substitutions, PO fields) to the server PO cart
 * so React pages (Substitution, Create PO) see the same data as a manual checkout.
 */
import { getCheckout, setCheckout } from './checkout_flow_state.js';
import { loadCartItems } from './checkout_flow_cart.js';

export async function syncVoiceCheckoutToCart(toolCtx, memory) {
  if (!toolCtx?.client || !memory) return { ok: false };

  const checkoutBefore = getCheckout(memory);
  const cart = await loadCartItems(toolCtx.client);
  if (!cart.ok) return { ok: false, error: cart.error };

  const draft = cart.draft || {};
  const boqGroups = Array.isArray(draft.boqGroups) ? draft.boqGroups : [];
  const checkout = checkoutBefore;
  const flatItems =
    checkout.items?.length > 0
      ? checkout.items
      : cart.items?.length > 0
        ? cart.items
        : boqGroups.flatMap((g) => (Array.isArray(g.items) ? g.items : []));

  if (!flatItems.length && !boqGroups.length) {
    return { ok: false, error: 'empty_cart' };
  }
  const selectedVendors = {
    ...(draft.selectedVendors || {}),
    ...(checkout.selectedVendors || {})
  };
  const substitutions = Array.isArray(checkout.substitutions)
    ? checkout.substitutions
    : Array.isArray(draft.substitutions)
      ? draft.substitutions
      : [];

  setCheckout(memory, { selectedVendors, substitutions });

  const body = {
    boqGroups: boqGroups.length ? boqGroups : undefined,
    items: flatItems,
    selectedVendors,
    substitutions,
    requiredDate: checkout.requiredDate ?? draft.requiredDate ?? null,
    paymentMethod: checkout.paymentMethod ?? draft.paymentMethod ?? null,
    deliveryDestination: checkout.deliveryDestination ?? draft.deliveryDestination ?? null,
    shippingAddress: checkout.shippingAddress ?? draft.shippingAddress ?? null,
    billingAddress: checkout.billingAddress ?? draft.billingAddress ?? null,
    gstin: checkout.gstin ?? draft.gstin ?? null,
    boqId: draft.boqId ?? null,
    boqProject: draft.boqProject ?? null,
    poGroups: Array.isArray(checkout.poGroups) ? checkout.poGroups : draft.poGroups || [],
    grandTotalAllPos: checkout.grandTotal ?? draft.grandTotalAllPos ?? null
  };

  const res = await toolCtx.client.put('/api/po/cart', body);
  return { ok: Boolean(res.ok), error: res.error };
}
