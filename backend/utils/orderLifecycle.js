export const PRIMARY_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned'
];

export const LIFECYCLE_STATES = [
  'draft',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'settled',
  'returned',
  'cancelled'
];

const PRIMARY_TO_LIFECYCLE = {
  pending: 'draft',
  confirmed: 'confirmed',
  processing: 'packed',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  returned: 'returned'
};

const LIFECYCLE_TO_PRIMARY = {
  draft: 'pending',
  confirmed: 'confirmed',
  packed: 'processing',
  shipped: 'shipped',
  delivered: 'delivered',
  settled: 'delivered',
  returned: 'returned',
  cancelled: 'cancelled'
};

export function normalizeOrderStatus(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidPrimaryOrderStatus(value) {
  return PRIMARY_ORDER_STATUSES.includes(normalizeOrderStatus(value));
}

export function isValidLifecycleState(value) {
  return LIFECYCLE_STATES.includes(normalizeOrderStatus(value));
}

export function toLifecycleStateFromStatus(status) {
  const normalized = normalizeOrderStatus(status);
  if (!normalized) return 'draft';
  return PRIMARY_TO_LIFECYCLE[normalized] || normalized;
}

export function toPrimaryStatusFromLifecycle(lifecycleState) {
  const normalized = normalizeOrderStatus(lifecycleState);
  if (!normalized) return 'pending';
  return LIFECYCLE_TO_PRIMARY[normalized] || normalized;
}

