import {
  BarChart3,
  FileText,
  Search,
  Mic,
  Users,
  RefreshCw,
  ShoppingCart,
  Truck,
  Paintbrush,
  Package,
  Wallet
} from 'lucide-react';

export const SP_NAV_GROUPS = [
  {
    id: 'home',
    label: 'Home',
    items: [{ path: '/dashboard', label: 'Dashboard', icon: BarChart3 }]
  },
  {
    id: 'procure',
    label: 'Procure',
    items: [
      { path: '/boq-normalize', label: 'BOQ Normalize', icon: FileText },
      { path: '/product-discovery', label: 'Product Discovery', icon: Search },
      { path: '/voice', label: 'Voice Shop', icon: Mic },
      { path: '/supplier-select', label: 'Supplier Select', icon: Users },
      { path: '/substitution', label: 'Substitution', icon: RefreshCw },
      { path: '/cart', label: 'Cart', icon: ShoppingCart, badgeKey: 'cart' },
      { path: '/create-po', label: 'Create PO', icon: Package },
      { path: '/transport-suggestion', label: 'Transport', icon: Truck }
    ]
  },
  {
    id: 'orders',
    label: 'Orders',
    items: [
      { path: '/your-orders', label: 'Your Orders', icon: ShoppingCart },
      { path: '/wallet', label: 'Wallet', icon: Wallet },
      { path: '/returns', label: 'Returns', icon: RefreshCw }
    ]
  },
  {
    id: 'account',
    label: 'Account',
    items: [{ path: '/portal-theme', label: 'Portal Theme', icon: Paintbrush }]
  }
];

const ROUTE_META = {
  '/dashboard': { group: 'Home', title: 'Dashboard' },
  '/boq-normalize': { group: 'Procure', title: 'BOQ Normalize' },
  '/product-discovery': { group: 'Procure', title: 'Product Discovery' },
  '/voice': { group: 'Procure', title: 'Voice Shop' },
  '/supplier-select': { group: 'Procure', title: 'Supplier Select' },
  '/substitution': { group: 'Procure', title: 'Substitution' },
  '/cart': { group: 'Procure', title: 'Cart' },
  '/create-po': { group: 'Procure', title: 'Create PO' },
  '/transport-suggestion': { group: 'Procure', title: 'Transport' },
  '/your-orders': { group: 'Orders', title: 'Your Orders' },
  '/wallet': { group: 'Orders', title: 'Wallet' },
  '/returns': { group: 'Orders', title: 'Returns' },
  '/portal-theme': { group: 'Account', title: 'Portal Theme' },
  '/profile': { group: 'Account', title: 'Profile' }
};

export function getSpBreadcrumb(pathname) {
  const meta = ROUTE_META[pathname] || { group: 'Portal', title: 'Page' };
  return [
    { label: 'Home', href: '/dashboard' },
    ...(meta.group !== 'Home' ? [{ label: meta.group }] : []),
    { label: meta.title, current: true }
  ];
}

export function getSpPageTitle(pathname) {
  return ROUTE_META[pathname]?.title || 'Portal';
}
