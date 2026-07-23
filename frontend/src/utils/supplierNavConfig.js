import {
  BarChart3,
  Package,
  Boxes,
  Table2,
  Network,
  ClipboardList,
  ShoppingCart,
  RefreshCw,
  UserCheck,
  TrendingUp,
  Users,
  CreditCard,
  Paintbrush,
  Wallet
} from 'lucide-react';

export const SUPPLIER_NAV_ITEMS = [
  { path: '/supplier-dashboard', label: 'Dashboard', shortLabel: 'Dashboard', icon: BarChart3 },
  { path: '/product-management', label: 'Manage Products', shortLabel: 'Products', icon: Package },
  { path: '/manage-inventory', label: 'Manage Inventory', shortLabel: 'Inventory', icon: Boxes },
  { path: '/supplier-bcov', label: 'Product COV', shortLabel: 'COV', icon: Table2 },
  { path: '/supplier-upstream', label: 'Upstream Sourcing', shortLabel: 'Upstream', icon: Network },
  { path: '/supplier-upstream-orders', label: 'My Upstream Orders', shortLabel: 'Orders', icon: ClipboardList },
  { path: '/supplier-cart', label: 'Cart', shortLabel: 'Cart', icon: ShoppingCart, badgeKey: 'cart' },
  { path: '/supplier-pos', label: 'POS Sales', shortLabel: 'POS', icon: ShoppingCart },
  { path: '/supplier-returns', label: 'Returns', shortLabel: 'Returns', icon: RefreshCw },
  { path: '/supplier-select-yourself', label: 'Select Yourself', shortLabel: 'Select', icon: UserCheck },
  { path: '/supplier-wallet', label: 'Vault balance', shortLabel: 'Vault', icon: Wallet },
  { path: '/supplier-discount-insights', label: 'Brand Level COV', shortLabel: 'Brand COV', icon: TrendingUp },
  { path: '/supplier-buyer-purchases', label: 'Sales', shortLabel: 'Sales', icon: Users },
  { path: '/supplier-credit-accounts', label: 'Credit on Account', shortLabel: 'Credit', icon: CreditCard },
  {
    path: '/supplier-total-purchase-platform-cov',
    label: 'Total Purchase Platform COV',
    shortLabel: 'Platform',
    icon: ShoppingCart
  },
  { path: '/supplier-purchase-total', label: 'Supplier Purchase Total', shortLabel: 'Purchases', icon: ShoppingCart },
  { path: '/supplier-portal-theme', label: 'Portal Theme', shortLabel: 'Theme', icon: Paintbrush }
];

const navByPath = Object.fromEntries(SUPPLIER_NAV_ITEMS.map((item) => [item.path, item]));

export const SUPPLIER_NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [navByPath['/supplier-dashboard']]
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      navByPath['/product-management'],
      navByPath['/manage-inventory'],
      navByPath['/supplier-bcov']
    ]
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      navByPath['/supplier-upstream'],
      navByPath['/supplier-upstream-orders'],
      navByPath['/supplier-cart'],
      navByPath['/supplier-pos'],
      navByPath['/supplier-returns'],
      navByPath['/supplier-select-yourself']
    ]
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      navByPath['/supplier-wallet'],
      navByPath['/supplier-discount-insights'],
      navByPath['/supplier-buyer-purchases'],
      navByPath['/supplier-credit-accounts'],
      navByPath['/supplier-total-purchase-platform-cov'],
      navByPath['/supplier-purchase-total']
    ]
  },
  {
    id: 'account',
    label: 'Account',
    items: [navByPath['/supplier-portal-theme']]
  }
];

const ROUTE_META = {
  '/supplier-dashboard': { group: 'Overview', title: 'Dashboard' },
  '/product-management': { group: 'Catalog', title: 'Manage Products' },
  '/manage-inventory': { group: 'Catalog', title: 'Manage Inventory' },
  '/supplier-bcov': { group: 'Catalog', title: 'Product COV' },
  '/supplier-upstream': { group: 'Operations', title: 'Upstream Sourcing' },
  '/supplier-upstream-orders': { group: 'Operations', title: 'My Upstream Orders' },
  '/supplier-cart': { group: 'Operations', title: 'Cart' },
  '/supplier-pos': { group: 'Operations', title: 'POS Sales' },
  '/supplier-returns': { group: 'Operations', title: 'Returns' },
  '/supplier-select-yourself': { group: 'Operations', title: 'Select Yourself' },
  '/supplier-discount-insights': { group: 'Insights', title: 'Brand Level COV' },
  '/supplier-wallet': { group: 'Insights', title: 'Vault balance' },
  '/supplier-buyer-purchases': { group: 'Insights', title: 'Sales' },
  '/supplier-credit-accounts': { group: 'Insights', title: 'Credit on Account' },
  '/supplier-total-purchase-platform-cov': { group: 'Insights', title: 'Total Purchase Platform COV' },
  '/supplier-purchase-total': { group: 'Insights', title: 'Supplier Purchase Total' },
  '/profile': { group: 'Account', title: 'Profile' },
  '/supplier-portal-theme': { group: 'Account', title: 'Portal Theme' }
};

export function getSupplierBreadcrumb(pathname) {
  const meta = ROUTE_META[pathname] || { group: 'Supplier', title: 'Portal' };
  return [
    { label: 'Home', href: '/supplier-dashboard' },
    ...(meta.group !== 'Overview' ? [{ label: meta.group }] : []),
    { label: meta.title, current: true }
  ];
}
