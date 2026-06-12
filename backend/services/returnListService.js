import { isSupplierBuyerUser } from '../utils/orderReturnRules.js';

export const SUPPLIER_INCOMING_SCOPES = ['customer', 'chain'];
export const BUYER_OUTGOING_SCOPES = ['retail', 'upstream'];

function normalizeChannel(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Seller-side classification (returns addressed to this supplier).
 * - customer: service provider / retail buyers
 * - chain: downstream supplier returned on a b2b_po upstream order
 */
export function classifySupplierIncomingReturnScope({ orderChannel, buyerUserType }) {
  const channel = normalizeChannel(orderChannel);
  if (channel === 'b2b_po' && isSupplierBuyerUser(buyerUserType)) {
    return 'chain';
  }
  return 'customer';
}

/**
 * Buyer-side classification (returns this user initiated).
 * - upstream: supplier returning goods to a tier-above partner (b2b_po)
 * - retail: service provider returning to a vendor
 */
export function classifyBuyerOutgoingReturnScope({ orderChannel, buyerUserType }) {
  const channel = normalizeChannel(orderChannel);
  if (channel === 'b2b_po' && isSupplierBuyerUser(buyerUserType)) {
    return 'upstream';
  }
  return 'retail';
}

function parseScope(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

async function loadBuyersById(supabase, buyerIds) {
  if (!buyerIds.length) return new Map();
  const { data: buyers, error } = await supabase
    .from('users')
    .select('id, user_type, name, company')
    .in('id', buyerIds);
  if (error) throw error;
  return new Map((buyers || []).map((b) => [b.id, b]));
}

async function loadOrdersById(supabase, orderIds) {
  if (!orderIds.length) return new Map();
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, channel')
    .in('id', orderIds);
  if (error) throw error;
  return new Map((orders || []).map((o) => [o.id, o]));
}

function enrichReturnRow(row, order, buyer, incomingScope) {
  const buyerUserType = buyer?.user_type || null;
  const orderChannel = order?.channel || null;
  return {
    ...row,
    order_number: order?.order_number || row.order_number || null,
    order_channel: orderChannel,
    buyer_name: buyer?.name || buyer?.company || null,
    buyer_user_type: buyerUserType,
    return_scope: incomingScope
      ? classifySupplierIncomingReturnScope({ orderChannel, buyerUserType })
      : classifyBuyerOutgoingReturnScope({ orderChannel, buyerUserType })
  };
}

export async function listSupplierIncomingReturns(supabase, supplierId, scopeInput) {
  const scope = parseScope(scopeInput, SUPPLIER_INCOMING_SCOPES, 'customer');

  const { data, error } = await supabase
    .from('order_returns')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = data || [];
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const buyerIds = [...new Set(rows.map((r) => r.service_provider_id).filter(Boolean))];

  const [ordersById, buyersById] = await Promise.all([
    loadOrdersById(supabase, orderIds),
    loadBuyersById(supabase, buyerIds)
  ]);

  const enriched = rows.map((row) =>
    enrichReturnRow(row, ordersById.get(row.order_id), buyersById.get(row.service_provider_id), true)
  );

  return {
    scope,
    returns: enriched.filter((row) => row.return_scope === scope)
  };
}

export async function listBuyerOutgoingReturns(supabase, buyerId, scopeInput) {
  const scope = parseScope(scopeInput, BUYER_OUTGOING_SCOPES, 'retail');

  const { data, error } = await supabase
    .from('order_returns')
    .select('*')
    .eq('service_provider_id', buyerId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = data || [];
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const ordersById = await loadOrdersById(supabase, orderIds);

  const { data: buyerUser } = await supabase
    .from('users')
    .select('id, user_type, name, company')
    .eq('id', buyerId)
    .maybeSingle();

  const enriched = rows.map((row) =>
    enrichReturnRow(row, ordersById.get(row.order_id), buyerUser, false)
  );

  return {
    scope,
    returns: enriched.filter((row) => row.return_scope === scope)
  };
}
