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

export const SP_NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', shortLabel: 'Dashboard', icon: BarChart3 },
  { path: '/boq-normalize', label: 'BOQ Normalize', shortLabel: 'BOQ', icon: FileText },
  { path: '/product-discovery', label: 'Product Discovery', shortLabel: 'Discover', icon: Search },
  { path: '/voice', label: 'Voice Shop', shortLabel: 'Voice', icon: Mic },
  { path: '/supplier-select', label: 'Supplier Select', shortLabel: 'Suppliers', icon: Users },
  { path: '/substitution', label: 'Substitution', shortLabel: 'Substitute', icon: RefreshCw },
  { path: '/cart', label: 'Cart', shortLabel: 'Cart', icon: ShoppingCart, badgeKey: 'cart' },
  { path: '/create-po', label: 'Create PO', shortLabel: 'Create PO', icon: Package },
  { path: '/transport-suggestion', label: 'Transport', shortLabel: 'Transport', icon: Truck },
  { path: '/your-orders', label: 'Your Orders', shortLabel: 'Orders', icon: ShoppingCart },
  { path: '/wallet', label: 'Wallet', shortLabel: 'Wallet', icon: Wallet },
  { path: '/returns', label: 'Returns', shortLabel: 'Returns', icon: RefreshCw },
  { path: '/portal-theme', label: 'Portal Theme', shortLabel: 'Theme', icon: Paintbrush }
];

const navByPath = Object.fromEntries(SP_NAV_ITEMS.map((item) => [item.path, item]));

export const SP_NAV_GROUPS = [
  {
    id: 'home',
    label: 'Home',
    items: [navByPath['/dashboard']]
  },
  {
    id: 'procure',
    label: 'Procure',
    items: [
      navByPath['/boq-normalize'],
      navByPath['/product-discovery'],
      navByPath['/voice'],
      navByPath['/supplier-select'],
      navByPath['/substitution'],
      navByPath['/cart'],
      navByPath['/create-po'],
      navByPath['/transport-suggestion']
    ]
  },
  {
    id: 'orders',
    label: 'Orders',
    items: [
      navByPath['/your-orders'],
      navByPath['/wallet'],
      navByPath['/returns']
    ]
  },
  {
    id: 'account',
    label: 'Account',
    items: [navByPath['/portal-theme']]
  }
];

const ROUTE_META = {
  '/dashboard': { group: 'Home', title: 'Dashboard' },
  '/boq-normalize': { group: 'Procure', title: 'BOQ Normalize' },
  '/boqs': { group: 'Procure', title: 'All BOQs' },
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
