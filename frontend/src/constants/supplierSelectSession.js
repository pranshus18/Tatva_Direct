/** Cart → Supplier Select handoff (survives lost router state in prod). */
export const SUPPLIER_SELECT_SESSION = {
  SCOPE_KEY: 'tatvaSupplierSelectScope',
  SCOPE_TS_KEY: 'tatvaSupplierSelectScopeTs',
  SCOPE_SOURCE_KEY: 'tatvaSupplierSelectScopeSource',
  SOURCE_CART: 'cart',
  TTL_MS: 120000
};

export function clearSupplierSelectSessionScope() {
  try {
    sessionStorage.removeItem(SUPPLIER_SELECT_SESSION.SCOPE_KEY);
    sessionStorage.removeItem(SUPPLIER_SELECT_SESSION.SCOPE_TS_KEY);
    sessionStorage.removeItem(SUPPLIER_SELECT_SESSION.SCOPE_SOURCE_KEY);
  } catch {
    /* ignore */
  }
}
