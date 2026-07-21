import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { clearPmAuthSession } from './utils/pmAuthSession';
import { clearCachedProfilePhotoUrl } from './utils/profilePhoto';
import ServiceProviderRoute from './components/ServiceProviderRoute';
import SupplierRoute from './components/SupplierRoute';
import AdminRoute from './components/AdminRoute';
import { getApiUrl } from './config/api';
import { getPostAuthRedirectPath } from './utils/authRedirect';
import { fetchPortalStatus, syncPortalUser } from './services/portalService';
import { isSupplierRegistered, isServiceProviderRegistered } from './utils/portalRoles';
import { normalizeUser, normalizeUserType } from './utils/userType';
import {
  clearSpWorkflowStorage,
  ensureSpWorkflowOwner,
  WORKFLOW_STORAGE_KEY
} from './utils/spWorkflow';

const buildLazyErrorFallback = (label) => () => (
  <div style={{ padding: '1rem', color: '#b91c1c' }}>
    Failed to load {label}. Please refresh the page.
  </div>
);

const safeLazy = (importer, label) =>
  lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      console.error(`Lazy load failed for ${label}:`, error);
      return { default: buildLazyErrorFallback(label) };
    }
  });

const safeLazyNamed = (importer, exportName, label) =>
  lazy(async () => {
    try {
      const module = await importer();
      if (!module?.[exportName]) {
        throw new Error(`Missing export "${exportName}"`);
      }
      return { default: module[exportName] };
    } catch (error) {
      console.error(`Lazy load failed for ${label}:`, error);
      return { default: buildLazyErrorFallback(label) };
    }
  });

const Layout = safeLazy(() => import('./components/Layout'), 'Layout shell');
const Toaster = safeLazyNamed(() => import('sonner'), 'Toaster', 'Toast notifications');

const Login = safeLazy(() => import('./pages/Login'), 'Login page');
const PmOtpAuth = safeLazy(() => import('./pages/PmOtpAuth'), 'PM OTP auth page');
const RegisterAsSupplier = safeLazy(() => import('./pages/RegisterAsSupplier'), 'Register as Supplier page');
const AdminLogin = safeLazy(() => import('./pages/AdminLogin'), 'Admin Login page');
const Profile = safeLazy(() => import('./pages/Profile'), 'Profile page');
const ServiceProviderDashboard = safeLazy(
  () => import('./pages/ServiceProviderDashboard'),
  'Service Provider Dashboard page'
);
const SupplierDashboard = safeLazy(() => import('./pages/SupplierDashboard'), 'Supplier Dashboard page');
const SupplierPOS = safeLazy(() => import('./pages/SupplierPOS'), 'Supplier POS page');
const SupplierProductSetup = safeLazy(() => import('./pages/SupplierProductSetup'), 'Supplier Product Setup page');
const SupplierBCOV = safeLazy(() => import('./pages/SupplierBCOV'), 'Supplier BCOV page');
const ProductManagement = safeLazy(() => import('./pages/ProductManagement'), 'Product Management page');
const SupplierReturns = safeLazy(() => import('./pages/SupplierReturns'), 'Supplier Returns page');
const SupplierUpstream = safeLazy(() => import('./pages/SupplierUpstream'), 'Supplier Upstream page');
const SupplierPlaceOrder = safeLazy(() => import('./pages/SupplierPlaceOrder'), 'Supplier Place Order page');
const SupplierUpstreamCart = safeLazy(
  () => import('./pages/SupplierUpstreamCart'),
  'Supplier Upstream Cart page'
);
const SupplierUpstreamOrders = safeLazy(
  () => import('./pages/SupplierUpstreamOrders'),
  'Supplier Upstream Orders page'
);
const SupplierSelectYourself = safeLazy(
  () => import('./pages/SupplierSelectYourself'),
  'Supplier Select Yourself page'
);
const SupplierDiscountInsights = safeLazy(
  () => import('./pages/SupplierDiscountInsights'),
  'Supplier Discount Insights page'
);
const SupplierBuyerPurchases = safeLazy(
  () => import('./pages/SupplierBuyerPurchases'),
  'Supplier Buyer Purchases page'
);
const SupplierCreditAccounts = safeLazy(
  () => import('./pages/SupplierCreditAccounts'),
  'Supplier Credit Accounts page'
);
const SupplierWallet = safeLazy(() => import('./pages/SupplierWallet'), 'Supplier Wallet page');
const SupplierTotalPurchasePlatformCov = safeLazy(
  () => import('./pages/SupplierTotalPurchasePlatformCov'),
  'Supplier Total Purchase Platform COV page'
);
const SupplierPurchaseTotal = safeLazy(() => import('./pages/SupplierPurchaseTotal'), 'Supplier Purchase Total page');
const ServiceProviderReturns = safeLazy(
  () => import('./pages/ServiceProviderReturns'),
  'Service Provider Returns page'
);
const ProductDiscovery = safeLazy(() => import('./pages/ProductDiscovery'), 'Product Discovery page');
const ProductDiscoveryDetail = safeLazy(
  () => import('./pages/ProductDiscoveryDetail'),
  'Product Discovery detail page'
);
const VoiceCommerce = safeLazy(() => import('./pages/VoiceCommerce'), 'Voice Commerce page');
const SupplierPortalThemeSettings = safeLazy(
  () => import('./pages/SupplierPortalThemeSettings'),
  'Supplier Portal Theme page'
);
const ServiceProviderThemeSettings = safeLazy(
  () => import('./pages/ServiceProviderThemeSettings'),
  'Service Provider Theme Settings page'
);
const AdminDashboardOverview = safeLazy(
  () => import('./pages/AdminDashboardOverview'),
  'Admin Dashboard Overview page'
);
const AdminAnalytics = safeLazy(() => import('./pages/AdminAnalytics'), 'Admin Analytics page');
const AdminUsers = safeLazy(() => import('./pages/AdminUsers'), 'Admin Users page');
const AdminTransactions = safeLazy(() => import('./pages/AdminTransactions'), 'Admin Transactions page');
const AdminSuppliers = safeLazy(() => import('./pages/AdminSuppliers'), 'Admin Suppliers page');
const AdminServiceProviders = safeLazy(
  () => import('./pages/AdminServiceProviders'),
  'Admin Service Providers page'
);
const AdminProductStatus = safeLazy(() => import('./pages/AdminProductStatus'), 'Admin Product Status page');
const AdminBrandApprovals = safeLazy(() => import('./pages/AdminBrandApprovals'), 'Admin Brand Approvals page');
const AdminProfileChainApprovals = safeLazy(
  () => import('./pages/AdminProfileChainApprovals'),
  'Admin Profile Chain Approvals page'
);
const AdminFinance = safeLazy(() => import('./pages/AdminFinance'), 'Admin Finance page');
const AdminWallet = safeLazy(() => import('./pages/AdminWallet'), 'Admin Wallet page');
const AdminSupplyChain = safeLazy(() => import('./pages/AdminSupplyChain'), 'Admin Supply Chain page');
const BOQNormalize = safeLazy(() => import('./pages/BOQNormalize'), 'BOQ Normalize page');
const BoqListing = safeLazy(() => import('./pages/BoqListing'), 'BOQ Listing page');
const VendorSelect = safeLazy(() => import('./pages/VendorSelect'), 'Vendor Select page');
const Substitution = safeLazy(() => import('./pages/Substitution'), 'Substitution page');
const CreatePO = safeLazy(() => import('./pages/CreatePO'), 'Create PO page');
const TransportSuggestion = safeLazy(() => import('./pages/TransportSuggestion'), 'Transport Suggestion page');
const YourOrders = safeLazy(() => import('./pages/YourOrders'), 'Your Orders page');
const Wallet = safeLazy(() => import('./pages/Wallet'), 'Vault balance page');
const Cart = safeLazy(() => import('./pages/Cart'), 'Cart page');
const SharedCart = safeLazy(() => import('./pages/SharedCart'), 'Shared Cart page');

const idlePrefetch = (importers = []) => {
  if (typeof window === 'undefined') return () => {};
  const run = () => importers.forEach((load) => Promise.resolve().then(load).catch(() => {}));

  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(id);
  }

  const timeoutId = window.setTimeout(run, 450);
  return () => window.clearTimeout(timeoutId);
};

function App() {
  const [normalizedItems, setNormalizedItems] = useState([]);
  const [selectedVendors, setSelectedVendors] = useState({});
  const [substitutions, setSubstitutions] = useState([]);
  const [boqId, setBoqId] = useState(null);
  const [boqProject, setBoqProject] = useState(null);
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [supplierSetupStatus, setSupplierSetupStatus] = useState(null);

  useEffect(() => {
    // Check if user is already logged in
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    const lastBoqId = localStorage.getItem('lastBoqId');
    const savedWorkflow = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    
    if (token && savedUser) {
      try {
        const parsedUser = normalizeUser(JSON.parse(savedUser));
        const ownerChanged = ensureSpWorkflowOwner(parsedUser?.id);
        setUser(parsedUser);
        setIsAuthenticated(true);

        if (!ownerChanged && lastBoqId) {
          setBoqId(lastBoqId);
        }
        if (!ownerChanged && savedWorkflow) {
          try {
            const wf = JSON.parse(savedWorkflow);
            if (Array.isArray(wf.normalizedItems)) setNormalizedItems(wf.normalizedItems);
            if (wf.selectedVendors && typeof wf.selectedVendors === 'object') setSelectedVendors(wf.selectedVendors);
            if (Array.isArray(wf.substitutions)) setSubstitutions(wf.substitutions);
            if (wf.boqProject && typeof wf.boqProject === 'object') setBoqProject(wf.boqProject);
            if (!lastBoqId && wf.boqId) setBoqId(wf.boqId);
          } catch (wfErr) {
            console.warn('Failed to parse saved workflow:', wfErr);
          }
        }
        
        // Check supplier setup status if user is a supplier
        if (normalizeUserType(parsedUser.userType) === 'supplier') {
          checkSupplierSetupStatus(token);
        }

        fetchPortalStatus()
          .then((status) => {
            const syncedUser = normalizeUser({
              ...parsedUser,
              registeredRoles: status.registeredRoles,
              supplierRegistered: status.supplierRegistered,
              serviceProviderRegistered: status.serviceProviderRegistered,
              activePortal: status.activePortal
            });
            localStorage.setItem('user', JSON.stringify(syncedUser));
            setUser(syncedUser);
          })
          .catch(() => {});
      } catch (error) {
        console.error('Error parsing saved user:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        clearCachedProfilePhotoUrl();
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    ensureSpWorkflowOwner(user.id);
    const payload = {
      normalizedItems,
      selectedVendors,
      substitutions,
      boqId,
      boqProject
    };
    localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(payload));
    if (boqId) {
      localStorage.setItem('lastBoqId', boqId);
    } else {
      localStorage.removeItem('lastBoqId');
    }
    window.dispatchEvent(new Event('sp-workflow-updated'));
  }, [isAuthenticated, user?.id, normalizedItems, selectedVendors, substitutions, boqId, boqProject]);

  // Update document title based on logged-in user
  useEffect(() => {
    if (user && user.name) {
      // Get user type label
      let userTypeLabel = '';
      if (user.userType === 'admin') {
        userTypeLabel = 'Admin';
      } else if (user.userType === 'supplier') {
        userTypeLabel = 'Supplier';
      } else if (user.userType === 'service_provider') {
        userTypeLabel = 'Service Provider';
      }
      
      // Set title with user name and type
      if (userTypeLabel) {
        document.title = `${user.name} (${userTypeLabel}) - Tatva Direct`;
      } else {
        document.title = `${user.name} - Tatva Direct`;
      }
    } else {
      document.title = 'Tatva Direct';
    }
  }, [user]);

  const checkSupplierSetupStatus = async (token) => {
    try {
      const response = await fetch(getApiUrl('/api/supplier/setup-status'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSupplierSetupStatus(data.hasProducts);
      }
    } catch (error) {
      console.error('Error checking setup status:', error);
    }
  };

  const handleLogin = async (userData) => {
    let normalizedUser = normalizeUser(userData);
    const token = localStorage.getItem('token');

    // Drop any previous account's cached avatar before hydrating the new session.
    clearCachedProfilePhotoUrl();

    if (token) {
      try {
        normalizedUser = await syncPortalUser(normalizedUser);
        localStorage.setItem('user', JSON.stringify(normalizedUser));
      } catch {
        // Keep login response if portal status sync fails.
      }
    }

    const ownerChanged = ensureSpWorkflowOwner(normalizedUser?.id);
    if (ownerChanged) {
      resetWorkflow();
    }
    setUser(normalizedUser);
    setIsAuthenticated(true);
    
    // Check supplier setup status if user is a supplier
    if (normalizeUserType(normalizedUser.userType) === 'supplier') {
      if (token) {
        await checkSupplierSetupStatus(token);
      }
    }
  };

  const handlePortalChange = async (userData) => {
    const normalizedUser = normalizeUser(userData);
    setUser(normalizedUser);
    localStorage.setItem('user', JSON.stringify(normalizedUser));

    if (normalizeUserType(normalizedUser.userType) === 'supplier') {
      const token = localStorage.getItem('token');
      if (token) {
        await checkSupplierSetupStatus(token);
      }
    }

    window.location.assign(getPostAuthRedirectPath(normalizedUser.userType));
  };

  const handleLogout = () => {
    const wasAdmin = normalizeUserType(user?.userType) === 'admin';
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearCachedProfilePhotoUrl();
    clearPmAuthSession();
    setUser(null);
    setIsAuthenticated(false);
    resetWorkflow();
    window.location.replace(wasAdmin ? '/admin-login' : '/pm-auth');
  };

  // Reset state when starting over
  const resetWorkflow = () => {
    setNormalizedItems([]);
    setSelectedVendors({});
    setSubstitutions([]);
    setBoqId(null);
    setBoqProject(null);
    clearSpWorkflowStorage();
  };

  const loadCartDraftIntoWorkflow = (draft = {}) => {
    const groups = Array.isArray(draft?.boqGroups) ? draft.boqGroups : [];
    const itemsFromGroups = groups.flatMap((group) =>
      Array.isArray(group?.items) ? group.items : []
    );
    const nextItems = Array.isArray(draft.items) && draft.items.length > 0 ? draft.items : itemsFromGroups;

    setNormalizedItems(nextItems);
    setSelectedVendors(
      draft.selectedVendors && typeof draft.selectedVendors === 'object' ? draft.selectedVendors : {}
    );
    setSubstitutions(Array.isArray(draft.substitutions) ? draft.substitutions : []);
    setBoqId(draft.boqId || null);
    setBoqProject(draft.boqProject && typeof draft.boqProject === 'object' ? draft.boqProject : null);
  };

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const onVoiceCart = (event) => {
      const detail = event?.detail;
      if (!detail || typeof detail !== 'object') return;
      loadCartDraftIntoWorkflow({
        items: detail.items,
        selectedVendors: detail.selectedVendors,
        substitutions: detail.substitutions,
        boqId: detail.draft?.boqId,
        boqProject: detail.draft?.boqProject
      });
    };
    window.addEventListener('voice-cart-updated', onVoiceCart);
    return () => window.removeEventListener('voice-cart-updated', onVoiceCart);
  }, [isAuthenticated]);

  useEffect(() => {
    const userType = normalizeUserType(user?.userType);

    if (!isAuthenticated) {
      return idlePrefetch([
        () => import('./pages/PmOtpAuth'),
        () => import('./pages/Login')
      ]);
    }

    if (userType === 'service_provider') {
      return idlePrefetch([
        () => import('./pages/ProductDiscovery'),
        () => import('./pages/Cart'),
        () => import('./pages/CreatePO'),
        () => import('./pages/YourOrders'),
        () => import('./pages/Wallet')
      ]);
    }

    if (userType === 'supplier') {
      return idlePrefetch([
        () => import('./pages/SupplierUpstream'),
        () => import('./pages/SupplierUpstreamOrders'),
        () => import('./pages/SupplierWallet'),
        () => import('./pages/SupplierPOS')
      ]);
    }

    if (userType === 'admin') {
      return idlePrefetch([
        () => import('./pages/AdminTransactions'),
        () => import('./pages/AdminWallet'),
        () => import('./pages/AdminSupplyChain')
      ]);
    }

    return () => {};
  }, [isAuthenticated, user?.userType]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{ color: 'white', fontSize: '1.2rem' }}>Loading...</div>
      </div>
    );
  }

  const routeLoader = (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div style={{ color: '#334155', fontSize: '1rem' }}>Loading page...</div>
    </div>
  );

  const supplierPortal = (page) => {
    if (!isAuthenticated) {
      return <Navigate to="/pm-auth" replace />;
    }
    return (
      <SupplierRoute user={user}>
        <Layout user={user} onLogout={handleLogout} onPortalChange={handlePortalChange}>
          {page}
        </Layout>
      </SupplierRoute>
    );
  };

  const authRedirectElement = () => <Navigate to={getPostAuthRedirectPath(user?.userType)} replace />;

  return (
    <BrowserRouter>
      <Suspense fallback={routeLoader}>
      <Routes>
        {/* Public Routes */}
        <Route path="/shared-cart/:token" element={<SharedCart />} />
        <Route path="/c/:token" element={<SharedCart />} />
        {/* Supplier Portal - always go directly to supplier dashboard */}
        <Route 
          path="/supplier-portal" 
          element={<Navigate to="/supplier-dashboard" replace />} 
        />
        {/* Supplier Dashboard - Accessible without login form */}
        <Route path="/supplier-dashboard" element={supplierPortal(<SupplierDashboard user={user} />)} />
        <Route path="/supplier-pos" element={supplierPortal(<SupplierPOS />)} />
        <Route path="/supplier-returns" element={supplierPortal(<SupplierReturns />)} />
        <Route
          path="/supplier-chain-returns"
          element={<Navigate to="/supplier-returns?source=chain" replace />}
        />
        <Route path="/supplier-select-yourself" element={supplierPortal(<SupplierSelectYourself />)} />
        <Route path="/supplier-upstream" element={supplierPortal(<SupplierUpstream user={user} />)} />
        <Route path="/supplier-upstream-orders" element={supplierPortal(<SupplierUpstreamOrders />)} />
        <Route
          path="/supplier-upstream-returns"
          element={<Navigate to="/supplier-returns?tab=outgoing" replace />}
        />
        <Route path="/supplier-place-order" element={supplierPortal(<SupplierPlaceOrder user={user} />)} />
        <Route path="/supplier-transport-suggestion" element={supplierPortal(<TransportSuggestion />)} />
        <Route path="/supplier-cart" element={supplierPortal(<SupplierUpstreamCart />)} />
        <Route path="/supplier-discount-insights" element={supplierPortal(<SupplierDiscountInsights />)} />
        <Route path="/supplier-buyer-purchases" element={supplierPortal(<SupplierBuyerPurchases />)} />
        <Route path="/supplier-credit-accounts" element={supplierPortal(<SupplierCreditAccounts />)} />
        <Route path="/supplier-wallet" element={supplierPortal(<SupplierWallet />)} />
        <Route
          path="/supplier-total-purchase-platform-cov"
          element={supplierPortal(<SupplierTotalPurchasePlatformCov />)}
        />
        <Route path="/supplier-purchase-total" element={supplierPortal(<SupplierPurchaseTotal />)} />
        <Route path="/supplier-bcov" element={supplierPortal(<SupplierBCOV user={user} />)} />
        <Route path="/pm-auth" element={<PmOtpAuth onLogin={handleLogin} />} />
        <Route
          path="/login"
          element={
            isAuthenticated ?
            authRedirectElement() :
            <Navigate to="/pm-auth" replace />
          }
        />
        <Route 
          path="/admin-login" 
          element={
            isAuthenticated && user?.userType === 'admin' ? 
            <Navigate to="/admin-dashboard" replace /> : 
            isAuthenticated ? 
            <Navigate to="/" replace /> :
            <AdminLogin onLogin={handleLogin} />
          } 
        />
        <Route
          path="/signup"
          element={
            isAuthenticated ?
            authRedirectElement() :
            <Navigate to="/pm-auth" replace />
          }
        />

        <Route
          path="/register-supplier"
          element={
            !isAuthenticated ? (
              <Navigate to="/pm-auth" replace />
            ) : isSupplierRegistered(user) ? (
              <Navigate to="/supplier-dashboard" replace />
            ) : !isServiceProviderRegistered(user) ? (
              <Navigate to={getPostAuthRedirectPath(user?.userType)} replace />
            ) : (
              <RegisterAsSupplier user={user} onPortalChange={handlePortalChange} />
            )
          }
        />
        
        {/* Protected Routes */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              <Layout user={user} onLogout={handleLogout} onPortalChange={handlePortalChange} />
            </ProtectedRoute>
          }
        >
          <Route 
            index 
            element={
              <Navigate to={getPostAuthRedirectPath(user?.userType)} replace />
            } 
          />
          <Route 
            path="admin-dashboard" 
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminDashboardOverview user={user} />
              </AdminRoute>
            } 
          />
          <Route
            path="admin-analytics"
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminAnalytics user={user} />
              </AdminRoute>
            }
          />
          <Route
            path="admin-wallet"
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminWallet user={user} />
              </AdminRoute>
            }
          />
          <Route
            path="admin-finance"
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminFinance user={user} />
              </AdminRoute>
            }
          />
          <Route
            path="admin-supply-chain"
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminSupplyChain user={user} />
              </AdminRoute>
            }
          />
          <Route 
            path="admin-users" 
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminUsers user={user} />
              </AdminRoute>
            } 
          />
          <Route 
            path="admin-transactions" 
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminTransactions user={user} />
              </AdminRoute>
            } 
          />
          <Route 
            path="admin-suppliers" 
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminSuppliers user={user} />
              </AdminRoute>
            } 
          />
          <Route 
            path="admin-service-providers" 
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminServiceProviders user={user} />
              </AdminRoute>
            } 
          />
          <Route 
            path="admin-product-status" 
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminProductStatus user={user} />
              </AdminRoute>
            } 
          />
          <Route 
            path="admin-brand-approvals" 
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminBrandApprovals user={user} />
              </AdminRoute>
            } 
          />
          <Route
            path="admin-profile-chain-approvals"
            element={
              <AdminRoute user={user} isAuthenticated={isAuthenticated}>
                <AdminProfileChainApprovals user={user} />
              </AdminRoute>
            }
          />
          <Route 
            path="dashboard" 
            element={<ServiceProviderDashboard user={user} />} 
          />
          <Route 
            path="supplier-setup" 
            element={<SupplierProductSetup user={user} />} 
          />
          <Route 
            path="product-management" 
            element={<ProductManagement user={user} />} 
          />
          <Route 
            path="manage-inventory" 
            element={<ProductManagement user={user} />} 
          />
          <Route
            path="supplier-returns"
            element={<SupplierReturns />}
          />
          <Route 
            path="profile" 
            element={<Profile user={user} />} 
          />
          <Route
            path="supplier-portal-theme"
            element={
              <SupplierRoute user={user}>
                <SupplierPortalThemeSettings />
              </SupplierRoute>
            }
          />
          <Route 
            path="boq-normalize" 
            element={
              <ServiceProviderRoute user={user}>
                <BOQNormalize
                  onComplete={(items, id, project) => {
                    setNormalizedItems(items);
                    setBoqId(id);
                    setBoqProject(project || null);
                  }}
                />
              </ServiceProviderRoute>
            } 
          />
          <Route
            path="boqs"
            element={
              <ServiceProviderRoute user={user}>
                <BoqListing />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="portal-theme"
            element={
              <ServiceProviderRoute user={user}>
                <ServiceProviderThemeSettings />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="product-discovery/:productId"
            element={
              <ServiceProviderRoute user={user}>
                <ProductDiscoveryDetail />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="product-discovery"
            element={
              <ServiceProviderRoute user={user}>
                <ProductDiscovery />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="voice"
            element={
              <ServiceProviderRoute user={user}>
                <VoiceCommerce user={user} />
              </ServiceProviderRoute>
            }
          />
          <Route 
            path="supplier-select" 
            element={
              <ServiceProviderRoute user={user}>
                <VendorSelect
                  items={normalizedItems}
                  boqId={boqId}
                  boqProject={boqProject}
                  onComplete={(vendors, selectedItems) => {
                    setSelectedVendors(vendors || {});
                    if (Array.isArray(selectedItems) && selectedItems.length > 0) {
                      setNormalizedItems(selectedItems);
                    }
                  }}
                />
              </ServiceProviderRoute>
            } 
          />
          <Route 
            path="substitution" 
            element={
              <ServiceProviderRoute user={user}>
                <Substitution selectedVendors={selectedVendors} onComplete={setSubstitutions} items={normalizedItems} />
              </ServiceProviderRoute>
            } 
          />
          <Route 
            path="create-po" 
            element={
              <ServiceProviderRoute user={user}>
                <CreatePO
                  selectedVendors={selectedVendors}
                  substitutions={substitutions}
                  boqId={boqId}
                  boqProject={boqProject}
                  items={normalizedItems}
                />
              </ServiceProviderRoute>
            } 
          />
          <Route
            path="transport-suggestion"
            element={
              <ServiceProviderRoute user={user}>
                <TransportSuggestion />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="cart"
            element={
              <ServiceProviderRoute user={user}>
                <Cart onLoadCart={loadCartDraftIntoWorkflow} />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="your-orders"
            element={
              <ServiceProviderRoute user={user}>
                <YourOrders />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="wallet"
            element={
              <ServiceProviderRoute user={user}>
                <Wallet />
              </ServiceProviderRoute>
            }
          />
          <Route
            path="returns"
            element={
              <ServiceProviderRoute user={user}>
                <ServiceProviderReturns />
              </ServiceProviderRoute>
            }
          />
        </Route>
        
        {/* Redirect to PM SSO or login if not authenticated */}
        <Route
          path="*"
          element={<Navigate to="/pm-auth" replace />}
        />
      </Routes>
      </Suspense>
      <Suspense fallback={null}>
        <Toaster position="top-right" richColors closeButton />
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
