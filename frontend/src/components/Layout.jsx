import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { FileText, Users, RefreshCw, ShoppingCart, User, LogOut, ChevronDown, BarChart3, Package, Building, CheckCircle, TrendingUp, Wallet, Network, Tag, UserCheck, Table2, Search, Paintbrush, Mic, CreditCard } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import { normalizeUserType } from '../utils/userType';
import {
  getServiceProviderThemePrefs,
  loadServiceProviderThemePrefsFromApi,
  resolveServiceProviderThemeBackground
} from '../utils/serviceProviderTheme';
import './Layout.css';
import { VoiceSessionProvider } from '../voice/VoiceSessionContext.jsx';
import { getVoiceGuidedPath, isVoiceGuidedActive } from '../voice/voiceCartBridge';
import SpAppShell from './sp/SpAppShell';

const routePrefetchers = {
  '/dashboard': () => import('../pages/ServiceProviderDashboard'),
  '/boq-normalize': () => import('../pages/BOQNormalize'),
  '/product-discovery': () => import('../pages/ProductDiscovery'),
  '/voice': () => import('../pages/VoiceCommerce'),
  '/supplier-select': () => import('../pages/VendorSelect'),
  '/substitution': () => import('../pages/Substitution'),
  '/cart': () => import('../pages/Cart'),
  '/create-po': () => import('../pages/CreatePO'),
  '/your-orders': () => import('../pages/YourOrders'),
  '/returns': () => import('../pages/ServiceProviderReturns'),
  '/supplier-dashboard': () => import('../pages/SupplierDashboard'),
  '/product-management': () => import('../pages/ProductManagement'),
  '/manage-inventory': () => import('../pages/ProductManagement'),
  '/supplier-bcov': () => import('../pages/SupplierBCOV'),
  '/supplier-upstream': () => import('../pages/SupplierUpstream'),
  '/supplier-cart': () => import('../pages/Cart'),
  '/supplier-pos': () => import('../pages/SupplierPOS'),
  '/supplier-returns': () => import('../pages/SupplierReturns'),
  '/supplier-select-yourself': () => import('../pages/SupplierSelectYourself'),
  '/supplier-discount-insights': () => import('../pages/SupplierDiscountInsights'),
  '/supplier-buyer-purchases': () => import('../pages/SupplierBuyerPurchases'),
  '/supplier-credit-accounts': () => import('../pages/SupplierCreditAccounts'),
  '/supplier-total-purchase-platform-cov': () => import('../pages/SupplierTotalPurchasePlatformCov'),
  '/supplier-purchase-total': () => import('../pages/SupplierPurchaseTotal'),
  '/portal-theme': () => import('../pages/ServiceProviderThemeSettings'),
  '/admin-dashboard': () => import('../pages/AdminDashboardOverview'),
  '/admin-users': () => import('../pages/AdminUsers'),
  '/admin-transactions': () => import('../pages/AdminTransactions'),
  '/admin-suppliers': () => import('../pages/AdminSuppliers'),
  '/admin-service-providers': () => import('../pages/AdminServiceProviders'),
  '/admin-product-status': () => import('../pages/AdminProductStatus'),
  '/admin-brand-approvals': () => import('../pages/AdminBrandApprovals'),
  '/admin-profile-chain-approvals': () => import('../pages/AdminProfileChainApprovals'),
  '/admin-analytics': () => import('../pages/AdminAnalytics'),
  '/admin-finance': () => import('../pages/AdminFinance'),
  '/admin-supply-chain': () => import('../pages/AdminSupplyChain'),
  '/profile': () => import('../pages/Profile')
};

const prefetchedRoutes = new Set();
const idleHandleFallback = { id: null };
const Layout = ({ user, onLogout, children }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [voiceNavTick, setVoiceNavTick] = useState(0);
  const [serviceProviderThemePrefs, setServiceProviderThemePrefs] = useState(() => ({
    themeId: 'default',
    customImageDataUrl: ''
  }));
  const location = useLocation();
  const userType = normalizeUserType(user?.userType);

  const prefetchRoute = (path) => {
    const loader = routePrefetchers[path];
    if (!loader || prefetchedRoutes.has(path)) return;
    prefetchedRoutes.add(path);
    loader().catch(() => {
      prefetchedRoutes.delete(path);
    });
  };
  

  const steps = useMemo(() => [
    ...(userType === 'admin' ? [
      {
        path: '/admin-dashboard', 
        label: 'Admin Dashboard', 
        icon: BarChart3 
      },
      {
        path: '/admin-users',
        label: 'Users',
        icon: Users
      },
      {
        path: '/admin-transactions',
        label: 'Transactions',
        icon: ShoppingCart
      },
      {
        path: '/admin-suppliers',
        label: 'Suppliers',
        icon: Package
      },
      {
        path: '/admin-service-providers',
        label: 'Service Providers',
        icon: Building
      },
      {
        path: '/admin-product-status',
        label: 'Product Status',
        icon: CheckCircle
      },
      {
        path: '/admin-brand-approvals',
        label: 'Brand Approvals',
        icon: Tag
      },
      {
        path: '/admin-profile-chain-approvals',
        label: 'Profile brand assignment',
        icon: UserCheck
      },
      {
        path: '/admin-analytics',
        label: 'Analytics',
        icon: TrendingUp
      },
      {
        path: '/admin-finance',
        label: 'Finance Ops',
        icon: Wallet
      },
      {
        path: '/admin-supply-chain',
        label: 'Supply chain',
        icon: Network
      }
    ] : userType === 'service_provider' ? [
      {
        path: '/dashboard',
        label: 'Dashboard',
        icon: BarChart3
      }
    ] : userType === 'supplier' ? [
      {
        path: '/supplier-dashboard', 
        label: 'Dashboard', 
        icon: BarChart3 
      },
      {
        path: '/product-management', 
        label: 'Manage Products', 
        icon: Package
      },
      {
        path: '/manage-inventory', 
        label: 'Manage Inventory', 
        icon: Package
      },
      {
        path: '/supplier-bcov',
        label: 'Product_COV',
        icon: Table2
      },
      {
        path: '/supplier-upstream',
        label: 'Upstream Orders',
        icon: Network
      },
      {
        path: '/supplier-cart',
        label: 'Cart',
        icon: ShoppingCart
      },
      {
        path: '/supplier-pos',
        label: 'POS (Offline Sales)',
        icon: ShoppingCart
      },
      {
        path: '/supplier-returns',
        label: 'Returns',
        icon: RefreshCw
      },
      {
        path: '/supplier-select-yourself',
        label: 'Select yourself',
        icon: UserCheck
      },
      {
        path: '/supplier-discount-insights',
        label: 'Brand_level_cov',
        icon: TrendingUp
      },
      {
        path: '/supplier-buyer-purchases',
        label: 'Sales',
        icon: Users
      },
      {
        path: '/supplier-credit-accounts',
        label: 'Credit on account',
        icon: CreditCard
      },
      {
        path: '/supplier-total-purchase-platform-cov',
        label: 'total_purchase_PlatformCOV',
        icon: ShoppingCart
      },
      {
        path: '/supplier-purchase-total',
        label: 'Supplier_purchase_total',
        icon: ShoppingCart
      }
    ] : []),
    // Only show workflow steps for service providers
    ...(userType === 'service_provider' ? [
      { path: '/boq-normalize', label: 'BOQ Normalize', icon: FileText },
      { path: '/product-discovery', label: 'Product Discovery', icon: Search },
      { path: '/voice', label: 'Voice Shop', icon: Mic },
      { path: '/supplier-select', label: 'Supplier Select', icon: Users },
      { path: '/substitution', label: 'Substitution', icon: RefreshCw },
      { path: '/cart', label: 'Cart', icon: ShoppingCart },
      { path: '/create-po', label: 'Create PO', icon: ShoppingCart },
      { path: '/your-orders', label: 'Your Orders', icon: ShoppingCart },
      { path: '/returns', label: 'Returns', icon: RefreshCw },
      { path: '/portal-theme', label: 'Portal Theme', icon: Paintbrush }
    ] : [])
  ], [userType]);
  const stepPaths = useMemo(() => steps.map((step) => step.path).filter(Boolean), [steps]);

  useEffect(() => {
    const visiblePaths = stepPaths.filter((path) => path !== location.pathname);

    if (!visiblePaths.length) return undefined;

    const warmVisibleTabs = () => {
      // Stagger requests a bit to avoid network burst while still warming quickly.
      visiblePaths.forEach((path, idx) => {
        window.setTimeout(() => prefetchRoute(path), idx * 120);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(warmVisibleTabs, { timeout: 1200 });
      return () => window.cancelIdleCallback(idleId);
    }

    idleHandleFallback.id = window.setTimeout(warmVisibleTabs, 250);
    return () => {
      if (idleHandleFallback.id) {
        clearTimeout(idleHandleFallback.id);
      }
    };
  }, [location.pathname, stepPaths]);

  useEffect(() => {
    if (userType !== 'service_provider') return undefined;
    setServiceProviderThemePrefs(getServiceProviderThemePrefs());
    let cancelled = false;
    loadServiceProviderThemePrefsFromApi()
      .then((remotePrefs) => {
        if (!cancelled && remotePrefs) {
          setServiceProviderThemePrefs(remotePrefs);
        }
      })
      .catch(() => {
        // Ignore remote sync errors and keep local theme.
      });
    return () => {
      cancelled = true;
    };
  }, [userType]);

  useEffect(() => {
    const refreshTheme = () => {
      setServiceProviderThemePrefs(getServiceProviderThemePrefs());
    };
    window.addEventListener('storage', refreshTheme);
    window.addEventListener('service-provider-theme-updated', refreshTheme);
    return () => {
      window.removeEventListener('storage', refreshTheme);
      window.removeEventListener('service-provider-theme-updated', refreshTheme);
    };
  }, []);

  useEffect(() => {
    const onVoiceNav = () => setVoiceNavTick((n) => n + 1);
    window.addEventListener('voice-guided-updated', onVoiceNav);
    return () => window.removeEventListener('voice-guided-updated', onVoiceNav);
  }, []);

  const layoutThemeClass =
    userType === 'service_provider'
      ? 'layout--service-provider-theme'
      : '';
  const layoutStyle =
    userType === 'service_provider'
      ? { backgroundImage: resolveServiceProviderThemeBackground(serviceProviderThemePrefs) }
      : undefined;

  const layoutToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  if (userType === 'service_provider') {
    const spBody = <SpAppShell user={user} onLogout={onLogout} children={children} />;
    if (layoutToken) {
      return <VoiceSessionProvider token={layoutToken}>{spBody}</VoiceSessionProvider>;
    }
    return spBody;
  }

  const layoutBody = (
    <div
      className={`layout ${layoutThemeClass}${isVoiceGuidedActive() ? ' layout--voice-guided' : ''}`.trim()}
      style={layoutStyle}
    >
      <nav className="sidebar">
        <div className="logo">
          <img src={tatvaLogo} alt="Tatva Direct" className="logo-image" />
        </div>
        <div className="nav-steps">
          {steps.map(({ path, label, icon: Icon }) => {
            void voiceNavTick;
            const guidedPath = isVoiceGuidedActive() ? getVoiceGuidedPath() : '';
            const guidedBase = guidedPath ? guidedPath.split('?')[0] : '';
            const isActive =
              guidedBase && location.pathname === guidedBase
                ? path === guidedBase
                : location.pathname === path;
            
            return (
              <div
                key={path + label}
                className="nav-step-wrapper"
              >
                <NavLink 
                  to={path} 
                  className={`nav-step ${isActive ? 'active' : ''}`}
                  onMouseEnter={() => prefetchRoute(path)}
                  onFocus={() => prefetchRoute(path)}
                  onMouseDown={() => prefetchRoute(path)}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </NavLink>
              </div>
            );
          })}
        </div>
        
        {/* User Profile Section */}
        <div className="user-section">
          <div 
            className="user-profile"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="user-avatar">
              <User size={20} />
            </div>
            <div className="user-info">
              <div className="user-name">{user?.name}</div>
              <div className="user-company">
                {userType === 'admin' ? '🔐 Admin' :
                 userType === 'service_provider' ? '🏢 Service Provider' : 
                 userType === 'supplier' ? '🚛 Supplier' : 
                 '👤 User'}
              </div>
            </div>
            <ChevronDown size={16} className={`chevron ${showUserMenu ? 'rotated' : ''}`} />
          </div>
          
          {showUserMenu && (
            <div className="user-menu">
              <NavLink 
                to="/profile" 
                className="user-menu-item"
                onClick={() => setShowUserMenu(false)}
                onMouseEnter={() => prefetchRoute('/profile')}
                onFocus={() => prefetchRoute('/profile')}
              >
                <User size={16} />
                <span>Profile</span>
              </NavLink>
              <button className="user-menu-item" onClick={onLogout}>
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </nav>
      <main className="content">
        {/* 
          Prefer nested routing via <Outlet />, but if Layout is used
          as a wrapper with children (as in /supplier-dashboard route),
          render children as a fallback. This prevents blank pages when
          there are no nested routes configured.
        */}
        {children || <Outlet />}
      </main>
    </div>
  );

  return layoutBody;
};

export default Layout;
