import { countServiceProviderCartDraft } from './cartBadge';

const WORKFLOW_STORAGE_KEY = 'spBoqWorkflow';
const WORKFLOW_OWNER_KEY = 'spBoqWorkflowOwnerId';

export const PROCUREMENT_STEPS = [
  { id: 'boq', path: '/boq-normalize', label: 'BOQ' },
  { id: 'discover', path: '/product-discovery', label: 'Discover' },
  { id: 'supplier', path: '/supplier-select', label: 'Supplier' },
  { id: 'substitution', path: '/substitution', label: 'Substitute' },
  { id: 'cart', path: '/cart', label: 'Cart' },
  { id: 'po', path: '/create-po', label: 'Create PO' }
];

export const PROCUREMENT_PATHS = new Set([
  ...PROCUREMENT_STEPS.map((s) => s.path),
  '/voice',
  '/transport-suggestion'
]);

export function clearSpWorkflowStorage() {
  try {
    localStorage.removeItem(WORKFLOW_STORAGE_KEY);
    localStorage.removeItem(WORKFLOW_OWNER_KEY);
    localStorage.removeItem('lastBoqId');
  } catch {
    // Ignore storage errors.
  }
}

export function ensureSpWorkflowOwner(userId) {
  const nextOwner = userId != null ? String(userId).trim() : '';
  if (!nextOwner) return false;

  try {
    const currentOwner = localStorage.getItem(WORKFLOW_OWNER_KEY);
    if (currentOwner && currentOwner !== nextOwner) {
      clearSpWorkflowStorage();
    }
    localStorage.setItem(WORKFLOW_OWNER_KEY, nextOwner);
    return currentOwner && currentOwner !== nextOwner;
  } catch {
    return false;
  }
}

export function readSpWorkflow() {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Replace the active procurement workflow with a newly selected BOQ.
 * Clears prior vendor/substitution selections so Supplier Selection cannot
 * keep showing a previously opened BOQ.
 */
export function replaceSpWorkflowForSelectedBoq({ boqId, items, project } = {}) {
  const nextBoqId = boqId != null && String(boqId).trim() !== '' ? String(boqId).trim() : null;
  const nextItems = Array.isArray(items)
    ? items.map((item) => ({
        ...item,
        boqId: item?.boqId || nextBoqId
      }))
    : [];
  const payload = {
    normalizedItems: nextItems,
    selectedVendors: {},
    substitutions: [],
    boqId: nextBoqId,
    boqProject: project && typeof project === 'object' ? project : null
  };

  try {
    localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(payload));
    if (nextBoqId) localStorage.setItem('lastBoqId', nextBoqId);
    else localStorage.removeItem('lastBoqId');
  } catch {
    // Ignore storage errors; in-memory handoff still works via navigation state.
  }

  try {
    window.dispatchEvent(new CustomEvent('sp-boq-workflow-replaced', { detail: payload }));
    window.dispatchEvent(new Event('sp-workflow-updated'));
  } catch {
    // Ignore event errors in non-browser environments.
  }

  return payload;
}

export function getWorkflowStepStatus() {
  const wf = readSpWorkflow();
  const items = Array.isArray(wf?.normalizedItems) ? wf.normalizedItems : [];
  const vendors = wf?.selectedVendors && typeof wf.selectedVendors === 'object' ? wf.selectedVendors : {};
  const subs = Array.isArray(wf?.substitutions) ? wf.substitutions : [];
  const boqId = localStorage.getItem('lastBoqId') || wf?.boqId;

  return {
    boq: Boolean(boqId),
    discover: items.length > 0,
    supplier: Object.keys(vendors).length > 0,
    substitution: subs.length > 0 || Object.keys(vendors).length > 0,
    cart: items.some((item) => Number(item?.quantity) > 0),
    po: false
  };
}

export function getCartItemCount() {
  const wf = readSpWorkflow();
  const items = Array.isArray(wf?.normalizedItems) ? wf.normalizedItems : [];
  const fromItems = items.reduce((sum, it) => {
    const qty = Number(it?.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return sum;
    return sum + qty;
  }, 0);
  if (fromItems > 0) return fromItems;

  const draft = wf?.cartDraft;
  if (draft && typeof draft === 'object') {
    return countServiceProviderCartDraft(draft);
  }

  return 0;
}

export function isProcurementPath(pathname) {
  return PROCUREMENT_PATHS.has(pathname);
}

export { WORKFLOW_STORAGE_KEY, WORKFLOW_OWNER_KEY };
