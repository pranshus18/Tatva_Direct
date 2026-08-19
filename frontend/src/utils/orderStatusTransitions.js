import { formatOrderStatusLabel } from './orderStatusUi';

export const SEQUENTIAL_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered'
];

const PRIMARY_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  returned: []
};

const LIFECYCLE_TO_PRIMARY = {
  draft: 'pending',
  packed: 'processing',
  settled: 'delivered'
};

export function normalizePrimaryOrderStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'pending';
  if (normalized === 'canceled') return 'cancelled';
  return LIFECYCLE_TO_PRIMARY[normalized] || normalized;
}

export function isCancelledOrderStatus(value) {
  return normalizePrimaryOrderStatus(value) === 'cancelled';
}

export function isCancelledOrder(order) {
  return (
    isCancelledOrderStatus(order?.status) ||
    isCancelledOrderStatus(order?.lifecycle_state) ||
    isCancelledOrderStatus(order?.lifecycleState)
  );
}

export function getAllowedOrderStatusTransitions(currentStatus) {
  const current = normalizePrimaryOrderStatus(currentStatus);
  if (isCancelledOrderStatus(current) || current === 'returned') return [];
  return [...(PRIMARY_STATUS_TRANSITIONS[current] || [])];
}

export function isValidOrderStatusTransition(fromStatus, toStatus) {
  const from = normalizePrimaryOrderStatus(fromStatus);
  const to = normalizePrimaryOrderStatus(toStatus);
  if (isCancelledOrderStatus(from) || from === 'returned') return false;
  if (from === to) return true;
  return getAllowedOrderStatusTransitions(from).includes(to);
}

export function getSelectableOrderStatusOptions(currentStatus) {
  const current = normalizePrimaryOrderStatus(currentStatus);
  if (isCancelledOrderStatus(current) || current === 'returned') {
    return [{ value: current, label: formatOrderStatusLabel(current) }];
  }
  const values = [current, ...getAllowedOrderStatusTransitions(current).filter((status) => status !== current)];
  return values.map((value) => ({
    value,
    label: formatOrderStatusLabel(value)
  }));
}

export function canAdvanceOrderStatus(currentStatus) {
  if (isCancelledOrderStatus(currentStatus)) return false;
  return getAllowedOrderStatusTransitions(currentStatus).length > 0;
}
