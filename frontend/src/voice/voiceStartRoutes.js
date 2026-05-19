/** Map current app path → voice-guided navigation when a call starts. */
export const VOICE_START_ROUTES = {
  '/product-discovery': {
    path: '/product-discovery?voice=1',
    label: 'Product discovery',
    screen: 'product_discovery'
  },
  '/cart': {
    path: '/cart?voice=1',
    label: 'Cart',
    screen: 'cart'
  },
  '/supplier-select': {
    path: '/supplier-select?from=cart&voice=1',
    label: 'Supplier selection',
    screen: 'supplier_select'
  },
  '/substitution': {
    path: '/substitution?voice=1',
    label: 'Substitution',
    screen: 'substitution'
  },
  '/create-po': {
    path: '/create-po?voice=1',
    label: 'Create purchase order',
    screen: 'create_po'
  },
  '/transport-suggestion': {
    path: '/transport-suggestion?voice=1',
    label: 'Transport',
    screen: 'transport'
  },
  '/your-orders': {
    path: '/your-orders',
    label: 'Your orders',
    screen: 'orders'
  }
};

export function voiceStartRouteForPathname(pathname) {
  const base = String(pathname || '').split('?')[0];
  return VOICE_START_ROUTES[base] || null;
}
