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

/** Happy-path workflow. Status may only move one step forward. */
export const SEQUENTIAL_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered'
];

export const TERMINAL_ORDER_STATUSES = ['delivered', 'cancelled', 'returned'];

const SEQUENTIAL_RANK = Object.fromEntries(
  SEQUENTIAL_ORDER_STATUSES.map((status, index) => [status, index])
);

/**
 * Direct supplier status updates: one step forward, or cancel before delivery.
 * Returns are handled by the return-request APIs, not this map.
 */
export const PRIMARY_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  returned: []
};

export function toCanonicalPrimaryStatus(value) {
  const normalized = normalizeOrderStatus(value);
  if (!normalized) return 'pending';
  if (normalized === 'canceled') return 'cancelled';
  if (PRIMARY_ORDER_STATUSES.includes(normalized)) return normalized;
  if (LIFECYCLE_TO_PRIMARY[normalized]) return LIFECYCLE_TO_PRIMARY[normalized];
  return normalized;
}

export function isCancelledOrderStatus(value) {
  return toCanonicalPrimaryStatus(value) === 'cancelled';
}

export function isLockedOrderStatus(value) {
  const current = toCanonicalPrimaryStatus(value);
  return current === 'cancelled' || current === 'returned';
}

export function getAllowedPrimaryStatusTransitions(currentStatus) {
  const current = toCanonicalPrimaryStatus(currentStatus);
  if (isLockedOrderStatus(current)) return [];
  return [...(PRIMARY_STATUS_TRANSITIONS[current] || [])];
}

export function isValidPrimaryStatusTransition(fromStatus, toStatus) {
  const from = toCanonicalPrimaryStatus(fromStatus);
  const to = toCanonicalPrimaryStatus(toStatus);
  if (isLockedOrderStatus(from)) return false;
  if (!isValidPrimaryOrderStatus(to)) return false;
  if (from === to) return true;
  return getAllowedPrimaryStatusTransitions(from).includes(to);
}

export function getInvalidPrimaryStatusTransitionMessage(fromStatus, toStatus) {
  const from = toCanonicalPrimaryStatus(fromStatus);
  const to = toCanonicalPrimaryStatus(toStatus);
  if (isCancelledOrderStatus(from)) {
    return 'This order is cancelled and the status cannot be changed.';
  }
  if (from === 'returned') {
    return 'This order was returned and the status cannot be changed.';
  }
  if (from === to) return '';
  if (TERMINAL_ORDER_STATUSES.includes(from)) {
    return `Order status "${from}" is final and cannot be changed.`;
  }
  const fromRank = SEQUENTIAL_RANK[from];
  const toRank = SEQUENTIAL_RANK[to];
  if (Number.isInteger(fromRank) && Number.isInteger(toRank) && toRank < fromRank) {
    return `Cannot move order status backward from ${from} to ${to}.`;
  }
  if (Number.isInteger(fromRank) && Number.isInteger(toRank) && toRank > fromRank + 1) {
    return `Cannot skip required status steps from ${from} to ${to}.`;
  }
  return `Invalid status transition from ${from} to ${to}. Allowed next: ${
    getAllowedPrimaryStatusTransitions(from).join(', ') || 'none'
  }.`;
}

const PRIMARY_STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned'
};

/** Human label for receipts, invoices, and APIs — always the live fulfillment status. */
export function formatOrderStatusLabel(status) {
  const canonical = toCanonicalPrimaryStatus(status);
  if (PRIMARY_STATUS_LABELS[canonical]) return PRIMARY_STATUS_LABELS[canonical];
  if (!canonical) return 'Pending';
  return canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

