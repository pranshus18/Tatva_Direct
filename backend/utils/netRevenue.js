const toNumber = (value) => {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : 0;
};

const getOrderItemId = (item) => item?.id || item?.order_item_id || item?.orderItemId || null;

export async function fetchClosedReturnQuantityByOrderItem(supabaseClient, orderIds = []) {
  const normalizedOrderIds = Array.from(new Set((orderIds || []).filter(Boolean)));
  if (normalizedOrderIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseClient
    .from('order_returns')
    .select('order_id, order_item_id, quantity, status')
    .in('order_id', normalizedOrderIds)
    .eq('status', 'closed');

  if (error) {
    throw error;
  }

  const closedReturnedQtyByOrderItem = new Map();
  for (const row of data || []) {
    if (!row?.order_item_id) continue;
    const prev = closedReturnedQtyByOrderItem.get(row.order_item_id) || 0;
    const qty = Math.max(0, toNumber(row.quantity));
    closedReturnedQtyByOrderItem.set(row.order_item_id, prev + qty);
  }

  return closedReturnedQtyByOrderItem;
}

export function getNetItemMetrics(item, closedReturnedQtyByOrderItem = new Map()) {
  const qty = Math.max(0, toNumber(item?.quantity));
  const parsedTotal = toNumber(item?.total_price ?? item?.totalPrice);
  const parsedUnit = toNumber(item?.unit_price ?? item?.unitPrice);
  const grossRevenue = parsedTotal > 0 ? parsedTotal : parsedUnit * qty;
  const effectiveUnitPrice = qty > 0 ? grossRevenue / qty : parsedUnit;

  const itemId = getOrderItemId(item);
  const rawReturnedQty = itemId ? toNumber(closedReturnedQtyByOrderItem.get(itemId)) : 0;
  const returnedQty = Math.max(0, Math.min(qty, rawReturnedQty));
  const netQty = Math.max(0, qty - returnedQty);
  const netRevenue = Math.max(0, effectiveUnitPrice * netQty);

  return {
    qty,
    returnedQty,
    netQty,
    grossRevenue,
    netRevenue
  };
}

export function buildOrderNetRevenueMap(orderItems = [], closedReturnedQtyByOrderItem = new Map()) {
  const byOrderId = new Map();
  for (const item of orderItems || []) {
    const orderId = item?.order_id || item?.orderId;
    if (!orderId) continue;
    const metrics = getNetItemMetrics(item, closedReturnedQtyByOrderItem);
    byOrderId.set(orderId, (byOrderId.get(orderId) || 0) + metrics.netRevenue);
  }
  return byOrderId;
}
