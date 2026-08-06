const normalizeReturnStatus = (status) => String(status || '').trim().toLowerCase();

export function getRemainingReturnableQuantity(orderedQty, existingReturns = []) {
  const ordered = Number(orderedQty) || 0;
  const reserved = (existingReturns || [])
    .filter((row) => normalizeReturnStatus(row?.status) !== 'rejected')
    .reduce((sum, row) => sum + (Number(row?.quantity) || 0), 0);
  return Math.max(0, ordered - reserved);
}

function getReturnsForItem(returns, itemId) {
  return (returns || []).filter((row) => {
    const rowItemId = row?.order_item_id ?? row?.orderItemId;
    return rowItemId === itemId;
  });
}

export function getTotalRemainingReturnableQuantity(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const returns = Array.isArray(order?.returns) ? order.returns : [];
  return items.reduce((sum, item) => {
    const itemId = item?.id ?? item?.order_item_id ?? item?.orderItemId;
    if (!itemId) return sum;
    const itemReturns = getReturnsForItem(returns, itemId);
    return sum + getRemainingReturnableQuantity(item.quantity, itemReturns);
  }, 0);
}

export function canRequestReturnForOrder(order) {
  const status = String(order?.status || '').toLowerCase();
  if (status !== 'delivered') return false;
  if (Array.isArray(order?.items) && order.items.length > 0) {
    return getTotalRemainingReturnableQuantity(order) > 0;
  }
  return true;
}

export function getReturnRequestBlockReason(order) {
  const status = String(order?.status || '').toLowerCase();
  if (status === 'cancelled') {
    return 'Cancelled orders cannot be returned.';
  }
  if (status !== 'delivered') {
    return 'Returns can only be requested after delivery.';
  }
  if (Array.isArray(order?.items) && order.items.length > 0) {
    const remaining = getTotalRemainingReturnableQuantity(order);
    if (remaining <= 0) {
      const returns = Array.isArray(order?.returns) ? order.returns : [];
      const activeReturns = returns.filter(
        (row) => normalizeReturnStatus(row?.status) !== 'rejected'
      );
      const allClosed =
        activeReturns.length > 0 &&
        activeReturns.every((row) => normalizeReturnStatus(row?.status) === 'closed');
      if (allClosed) {
        return 'All return requests for this order have been closed. No further returns can be requested.';
      }
      return 'All units for this order have already been requested for return.';
    }
  }
  return '';
}

export const SUPPLIER_RETURN_ACTIONS = {
  requested: ['approved', 'rejected'],
  approved: ['picked_up', 'received'],
  picked_up: ['received'],
  received: ['refunded', 'replaced'],
  refunded: ['closed'],
  replaced: ['closed']
};

export const RETURN_STATUS_LABEL = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  picked_up: 'Picked up',
  received: 'Received',
  refunded: 'Refunded',
  replaced: 'Replaced',
  closed: 'Closed'
};

export function labelReturnStatus(status) {
  return RETURN_STATUS_LABEL[status] || String(status || '').replaceAll('_', ' ');
}

export const SUPPLIER_INCOMING_RETURN_PAGE = {
  customer: {
    title: 'Customer returns',
    description: 'Process return requests from service providers who bought from you.',
    emptyTitle: 'No customer return requests',
    emptySubtitle: 'When service providers request returns on retail orders, they will show up here.'
  },
  chain: {
    title: 'Downstream chain returns',
    description:
      'Process returns from downstream suppliers in your supply chain (B2B purchase orders they placed with you).',
    emptyTitle: 'No downstream chain returns',
    emptySubtitle: 'When a tier-below partner returns goods from a B2B order, it will show up here.'
  }
};

export const BUYER_OUTGOING_RETURN_PAGE = {
  retail: {
    title: 'My returns',
    description: 'Track return requests you raised on orders placed with suppliers.'
  },
  upstream: {
    title: 'Returns to upstream partners',
    description:
      'Track return requests you raised on orders placed with tier-above suppliers. Inventory is restored to your upstream partner automatically when they close the return.'
  }
};
