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
  Paintbrush
} from 'lucide-react';

export const SUPPLIER_NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [{ path: '/supplier-dashboard', label: 'Dashboard', icon: BarChart3 }]
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      { path: '/product-management', label: 'Manage Products', icon: Package },
      { path: '/manage-inventory', label: 'Manage Inventory', icon: Boxes },
      { path: '/supplier-bcov', label: 'Product COV', icon: Table2 }
    ]
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { path: '/supplier-upstream', label: 'Upstream Sourcing', icon: Network },
      { path: '/supplier-upstream-orders', label: 'My Upstream Orders', icon: ClipboardList },
      { path: '/supplier-cart', label: 'Cart', icon: ShoppingCart, badgeKey: 'cart' },
      { path: '/supplier-pos', label: 'POS Sales', icon: ShoppingCart },
      { path: '/supplier-returns', label: 'Returns', icon: RefreshCw },
      { path: '/supplier-select-yourself', label: 'Select Yourself', icon: UserCheck }
    ]
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { path: '/supplier-discount-insights', label: 'Brand Level COV', icon: TrendingUp },
      { path: '/supplier-buyer-purchases', label: 'Sales', icon: Users },
      { path: '/supplier-credit-accounts', label: 'Credit on Account', icon: CreditCard },
      {
        path: '/supplier-total-purchase-platform-cov',
        label: 'Total Purchase Platform COV',
        icon: ShoppingCart
      },
      { path: '/supplier-purchase-total', label: 'Supplier Purchase Total', icon: ShoppingCart }
    ]
  },
  {
    id: 'account',
    label: 'Account',
    items: [{ path: '/supplier-portal-theme', label: 'Portal Theme', icon: Paintbrush }]
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
