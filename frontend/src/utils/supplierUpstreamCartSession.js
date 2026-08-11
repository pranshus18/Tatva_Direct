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

/**
 * Drop every client-side pointer at a cart project once the cart (or its last
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
