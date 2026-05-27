const WORKFLOW_STORAGE_KEY = 'spBoqWorkflow';

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

export function readSpWorkflow() {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
    cart: items.length > 0,
    po: false
  };
}

export function getCartItemCount() {
  const wf = readSpWorkflow();
  const items = Array.isArray(wf?.normalizedItems) ? wf.normalizedItems : [];
  return items.reduce((sum, it) => sum + (Number(it?.quantity) || 1), 0);
}

export function isProcurementPath(pathname) {
  return PROCUREMENT_PATHS.has(pathname);
}
