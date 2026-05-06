import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import ServiceProviderRoute from './components/ServiceProviderRoute';
import AdminRoute from './components/AdminRoute';
import { getApiUrl } from './config/api';
import { normalizeUser, normalizeUserType } from './utils/userType';

const Login = lazy(() => import('./pages/Login'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const Signup = lazy(() => import('./pages/Signup'));
const Profile = lazy(() => import('./pages/Profile'));
const ServiceProviderDashboard = lazy(() => import('./pages/ServiceProviderDashboard'));
const SupplierDashboard = lazy(() => import('./pages/SupplierDashboard'));
const SupplierPOS = lazy(() => import('./pages/SupplierPOS'));
const SupplierProductSetup = lazy(() => import('./pages/SupplierProductSetup'));
const SupplierBCOV = lazy(() => import('./pages/SupplierBCOV'));
const ProductManagement = lazy(() => import('./pages/ProductManagement'));
const SupplierReturns = lazy(() => import('./pages/SupplierReturns'));
const SupplierUpstream = lazy(() => import('./pages/SupplierUpstream'));
const SupplierSelectYourself = lazy(() => import('./pages/SupplierSelectYourself'));
const SupplierDiscountInsights = lazy(() => import('./pages/SupplierDiscountInsights'));
const SupplierBuyerPurchases = lazy(() => import('./pages/SupplierBuyerPurchases'));
const SupplierTotalPurchasePlatformCov = lazy(() => import('./pages/SupplierTotalPurchasePlatformCov'));
const SupplierPurchaseTotal = lazy(() => import('./pages/SupplierPurchaseTotal'));
const ServiceProviderReturns = lazy(() => import('./pages/ServiceProviderReturns'));
const ProductDiscovery = lazy(() => import('./pages/ProductDiscovery'));
const AdminDashboardOverview = lazy(() => import('./pages/AdminDashboardOverview'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminTransactions = lazy(() => import('./pages/AdminTransactions'));
const AdminSuppliers = lazy(() => import('./pages/AdminSuppliers'));
const AdminServiceProviders = lazy(() => import('./pages/AdminServiceProviders'));
const AdminProductStatus = lazy(() => import('./pages/AdminProductStatus'));
const AdminBrandApprovals = lazy(() => import('./pages/AdminBrandApprovals'));
const AdminProfileChainApprovals = lazy(() => import('./pages/AdminProfileChainApprovals'));
const AdminFinance = lazy(() => import('./pages/AdminFinance'));
const AdminSupplyChain = lazy(() => import('./pages/AdminSupplyChain'));
const BOQNormalize = lazy(() => import('./pages/BOQNormalize'));
const VendorSelect = lazy(() => import('./pages/VendorSelect'));
const Substitution = lazy(() => import('./pages/Substitution'));
const CreatePO = lazy(() => import('./pages/CreatePO'));
const YourOrders = lazy(() => import('./pages/YourOrders'));
const Cart = lazy(() => import('./pages/Cart'));
const SharedCart = lazy(() => import('./pages/SharedCart'));

function App() {
  const WORKFLOW_STORAGE_KEY = 'spBoqWorkflow';
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
        setUser(parsedUser);
        setIsAuthenticated(true);

        // Restore last BOQ id (allows revisiting supplier select without re-upload)
        if (lastBoqId) {
          setBoqId(lastBoqId);
        }
        if (savedWorkflow) {
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
      } catch (error) {
        console.error('Error parsing saved user:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const payload = {
      normalizedItems,
      selectedVendors,
      substitutions,
      boqId,
      boqProject
    };
    localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(payload));
    if (boqId) localStorage.setItem('lastBoqId', boqId);
  }, [isAuthenticated, normalizedItems, selectedVendors, substitutions, boqId, boqProject]);

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
    const normalizedUser = normalizeUser(userData);
    setUser(normalizedUser);
    setIsAuthenticated(true);
    
    // Check supplier setup status if user is a supplier
    if (normalizeUserType(normalizedUser.userType) === 'supplier') {
      const token = localStorage.getItem('token');
      if (token) {
        await checkSupplierSetupStatus(token);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
    resetWorkflow();
    // Full navigation so supplier (and other) pages never render with user=null
    window.location.replace('/login');
  };

  // Reset state when starting over
  const resetWorkflow = () => {
    setNormalizedItems([]);
    setSelectedVendors({});
    setSubstitutions([]);
    setBoqId(null);
    setBoqProject(null);
    localStorage.removeItem(WORKFLOW_STORAGE_KEY);
  };

  const loadCartDraftIntoWorkflow = (draft = {}) => {
    if (Array.isArray(draft.items)) setNormalizedItems(draft.items);
    if (draft.selectedVendors && typeof draft.selectedVendors === 'object') {
      setSelectedVendors(draft.selectedVendors);
    }
    if (Array.isArray(draft.substitutions)) setSubstitutions(draft.substitutions);
    if (draft.boqId) setBoqId(draft.boqId);
    if (draft.boqProject && typeof draft.boqProject === 'object') setBoqProject(draft.boqProject);
  };

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
        <Route 
          path="/supplier-dashboard" 
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierDashboard user={user} />
              </Layout>
            )
          } 
        />
        <Route 
          path="/supplier-pos" 
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierPOS />
              </Layout>
            )
          } 
        />
        <Route
          path="/supplier-returns"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierReturns />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-select-yourself"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : user?.userType !== 'supplier' ? (
              <Navigate to="/" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierSelectYourself />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-upstream"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierUpstream user={user} />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-cart"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : user?.userType !== 'supplier' ? (
              <Navigate to="/" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <Cart />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-discount-insights"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : user?.userType !== 'supplier' ? (
              <Navigate to="/" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierDiscountInsights />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-buyer-purchases"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : user?.userType !== 'supplier' ? (
              <Navigate to="/" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierBuyerPurchases />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-total-purchase-platform-cov"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : user?.userType !== 'supplier' ? (
              <Navigate to="/" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierTotalPurchasePlatformCov />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-purchase-total"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : user?.userType !== 'supplier' ? (
              <Navigate to="/" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierPurchaseTotal />
              </Layout>
            )
          }
        />
        <Route
          path="/supplier-bcov"
          element={
            !isAuthenticated ? (
              <Navigate to="/login" replace />
            ) : (
              <Layout user={user} onLogout={handleLogout}>
                <SupplierBCOV user={user} />
              </Layout>
            )
          }
        />
        <Route 
          path="/login" 
          element={
            isAuthenticated ? 
            (normalizeUserType(user?.userType) === 'admin' ? <Navigate to="/admin-dashboard" replace /> :
             normalizeUserType(user?.userType) === 'service_provider' ? <Navigate to="/dashboard" replace /> :
             normalizeUserType(user?.userType) === 'supplier' ? <Navigate to="/supplier-dashboard" replace /> :
             <Navigate to="/dashboard" replace />) : 
            <Login onLogin={handleLogin} />
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
            (normalizeUserType(user?.userType) === 'admin' ? <Navigate to="/admin-dashboard" replace /> :
             normalizeUserType(user?.userType) === 'service_provider' ? <Navigate to="/dashboard" replace /> :
             normalizeUserType(user?.userType) === 'supplier' ? <Navigate to="/supplier-dashboard" replace /> :
             <Navigate to="/dashboard" replace />) : 
            <Signup onLogin={handleLogin} />
          } 
        />
        
        {/* Protected Routes */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              <Layout user={user} onLogout={handleLogout} />
            </ProtectedRoute>
          }
        >
          <Route 
            index 
            element={
              normalizeUserType(user?.userType) === 'admin' ?
              <Navigate to="/admin-dashboard" replace /> :
              normalizeUserType(user?.userType) === 'service_provider' ? 
              <Navigate to="/dashboard" replace /> : 
              normalizeUserType(user?.userType) === 'supplier' ?
                <Navigate to="/supplier-dashboard" replace /> :
              <Navigate to="/boq-normalize" replace />
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
            path="product-discovery"
            element={
              <ServiceProviderRoute user={user}>
                <ProductDiscovery />
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
                  onComplete={setSelectedVendors}
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
                  items={normalizedItems}
                />
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
            path="returns"
            element={
              <ServiceProviderRoute user={user}>
                <ServiceProviderReturns />
              </ServiceProviderRoute>
            }
          />
        </Route>
        
        {/* Redirect to login if not authenticated */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
