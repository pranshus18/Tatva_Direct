/** Last project chosen in this browser session — reused when adding more qty. */
export const SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY = 'supplierUpstreamSessionProjectId';

/** Resume draft written when continuing from cart back to sourcing. */
export const SUPPLIER_UPSTREAM_CART_RESUME_KEY = 'supplierUpstreamCartResumeDraft';

export const readUpstreamSessionProjectId = () => {
  try {
    return String(sessionStorage.getItem(SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY) || '').trim();
  } catch {
    return '';
  }
};

export const writeUpstreamSessionProjectId = (projectId) => {
  const id = String(projectId || '').trim();
  if (!id || id === '__new__') return;
  try {
    sessionStorage.setItem(SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY, id);
  } catch {
    // Ignore quota / private-mode failures.
  }
};

export const clearUpstreamSessionProjectId = () => {
  try {
    sessionStorage.removeItem(SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY);
  } catch {
    // Ignore private-mode failures.
  }
};

/** Drop every client-side pointer at a cart project once the cart (or its last
 * project) is cleared — otherwise Add to Cart keeps targeting a deleted project.
 */
export const clearUpstreamCartClientProjectState = () => {
  clearUpstreamSessionProjectId();
  try {
    localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
  } catch {
    // Ignore private-mode failures.
  }
};

/** Legacy auto-name that stuffed today's date into the project label. */
const AUTO_DATED_UPSTREAM_PROJECT_NAME = /^Project \d{1,2}\/[A-Za-z]+\/\d{2}$/i;
export const DEFAULT_UPSTREAM_PROJECT_NAME = 'Supplier Project';

/**
 * Project name must stay separate from expected dispatch date.
 * Never surface `Project DD/Month/YY` (auto-generated from "today") as the label.
 */
export const resolveUpstreamProjectCartName = (value) => {
  const cartNameRaw = String(value || '').trim();
  if (!cartNameRaw || AUTO_DATED_UPSTREAM_PROJECT_NAME.test(cartNameRaw)) {
    return DEFAULT_UPSTREAM_PROJECT_NAME;
  }
  return cartNameRaw;
};
