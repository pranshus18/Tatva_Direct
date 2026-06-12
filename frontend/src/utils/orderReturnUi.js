export function canRequestReturnForOrder(order) {
  const status = String(order?.status || '').toLowerCase();
  return status === 'delivered';
}

export function getReturnRequestBlockReason(order) {
  const status = String(order?.status || '').toLowerCase();
  if (status === 'cancelled') {
    return 'Cancelled orders cannot be returned.';
  }
  if (status !== 'delivered') {
    return 'Returns can only be requested after delivery.';
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
