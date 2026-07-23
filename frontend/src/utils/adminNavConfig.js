import {
  BarChart3,
  Users,
  ShoppingCart,
  Package,
  Building,
  CheckCircle,
  Tag,
  UserCheck,
  TrendingUp,
  Wallet,
  Network
} from 'lucide-react';

export const ADMIN_NAV_ITEMS = [
  { path: '/admin-dashboard', label: 'Admin Dashboard', shortLabel: 'Dashboard', icon: BarChart3 },
  { path: '/admin-users', label: 'Users', shortLabel: 'Users', icon: Users },
  { path: '/admin-transactions', label: 'Transactions', shortLabel: 'Transactions', icon: ShoppingCart },
  { path: '/admin-suppliers', label: 'Suppliers', shortLabel: 'Suppliers', icon: Package },
  { path: '/admin-service-providers', label: 'Service Providers', shortLabel: 'Providers', icon: Building },
  { path: '/admin-product-status', label: 'Product Status', shortLabel: 'Products', icon: CheckCircle },
  { path: '/admin-brand-approvals', label: 'Brand Approvals', shortLabel: 'Brands', icon: Tag },
  {
    path: '/admin-profile-chain-approvals',
    label: 'Profile brand assignment',
    shortLabel: 'Profiles',
    icon: UserCheck
  },
  { path: '/admin-analytics', label: 'Analytics', shortLabel: 'Analytics', icon: TrendingUp },
  { path: '/admin-wallet', label: 'Wallet', shortLabel: 'Wallet', icon: Wallet },
  { path: '/admin-supply-chain', label: 'Supply chain', shortLabel: 'Chain', icon: Network }
];

const navByPath = Object.fromEntries(ADMIN_NAV_ITEMS.map((item) => [item.path, item]));

export const ADMIN_NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [navByPath['/admin-dashboard']]
  },
  {
    id: 'directory',
    label: 'Directory',
    items: [
      navByPath['/admin-users'],
      navByPath['/admin-suppliers'],
      navByPath['/admin-service-providers']
    ]
  },
  {
    id: 'commerce',
    label: 'Commerce',
    items: [
      navByPath['/admin-transactions'],
      navByPath['/admin-product-status']
    ]
  },
  {
    id: 'approvals',
    label: 'Approvals',
    items: [
      navByPath['/admin-brand-approvals'],
      navByPath['/admin-profile-chain-approvals']
    ]
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      navByPath['/admin-analytics'],
      navByPath['/admin-wallet'],
      navByPath['/admin-supply-chain']
    ]
  }
];

const ROUTE_META = {
  '/admin-dashboard': { group: 'Overview', title: 'Admin Dashboard' },
  '/admin-users': { group: 'Directory', title: 'Users' },
  '/admin-transactions': { group: 'Commerce', title: 'Transactions' },
  '/admin-suppliers': { group: 'Directory', title: 'Suppliers' },
  '/admin-service-providers': { group: 'Directory', title: 'Service Providers' },
  '/admin-product-status': { group: 'Commerce', title: 'Product Status' },
  '/admin-brand-approvals': { group: 'Approvals', title: 'Brand Approvals' },
  '/admin-profile-chain-approvals': { group: 'Approvals', title: 'Profile brand assignment' },
  '/admin-analytics': { group: 'Finance', title: 'Analytics' },
  '/admin-wallet': { group: 'Finance', title: 'Wallet' },
  '/admin-supply-chain': { group: 'Finance', title: 'Supply chain' },
  '/profile': { group: 'Account', title: 'Profile' }
};

export function getAdminBreadcrumb(pathname) {
  const meta = ROUTE_META[pathname] || { group: 'Admin', title: 'Portal' };
  return [
    { label: 'Home', href: '/admin-dashboard' },
    ...(meta.group !== 'Overview' ? [{ label: meta.group }] : []),
    { label: meta.title, current: true }
  ];
}

export function getAdminPageTitle(pathname) {
  return ROUTE_META[pathname]?.title || 'Admin Portal';
}
