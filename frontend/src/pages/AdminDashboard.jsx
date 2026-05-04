import { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import { useLocation } from 'react-router-dom';
import { 
  Users, 
  Building, 
  ShoppingCart, 
  TrendingUp, 
  Eye, 
  Search, 
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Package,
  RefreshCw,
  X,
  DollarSign,
  Box,
  Tag,
  Edit2,
  Check,
  Ban,
  Save,
  Sparkles,
  Plus,
  Trash2
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';

const AdminDashboard = ({ user }) => {
  const location = useLocation();
  const [stats, setStats] = useState({
    totalUsers: 0,
    serviceProviders: 0,
    suppliers: 0,
    totalTransactions: 0,
    totalRevenue: 0,
    activeBOQs: 0,
    totalProducts: 0,
    totalInventoryValue: 0
  });
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [supplierData, setSupplierData] = useState([]);
  const [serviceProviderData, setServiceProviderData] = useState([]);
  const [products, setProducts] = useState([]);
  const [pendingProducts, setPendingProducts] = useState([]);
  const [boqs, setBOQs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(() => {
    // Get tab from URL params
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || 'users';
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  // Product modal states
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  useEffect(() => {
    fetchAdminData();
    fetchPendingProducts();
    
    // Also fetch pending products periodically to catch new ones
    const pendingInterval = setInterval(() => {
      fetchPendingProducts();
    }, 60000); // Check every minute
    
    // Listen for URL changes
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab) {
        setActiveTab(tab);
      }
    };
    
    // Listen for custom tab change events
    const handleTabChange = (event) => {
      if (event.detail?.tab) {
        setActiveTab(event.detail.tab);
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('adminTabChange', handleTabChange);
    
    return () => {
      clearInterval(pendingInterval);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('adminTabChange', handleTabChange);
    };
  }, []);
  
  // Also check URL on mount and when location changes
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab && tab !== activeTab) {
      console.log('URL changed, switching to tab:', tab);
      setActiveTab(tab);
    }
  }, [location.search, activeTab]);

  const fetchPendingProducts = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No token found');
        return;
      }
      
      const response = await fetch(getApiUrl('/api/admin/products/pending'), {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        cache: 'no-cache'
      });
      
      if (!response.ok) {
        console.error('Failed to fetch pending products:', response.status, response.statusText);
        setPendingProducts([]);
        return;
      }
      
      const result = await response.json();
      
      console.log('Pending products API response:', result);
      
      if (result.status === 'success') {
        const products = result.products || [];
        setPendingProducts(products);
        console.log(`✅ Found ${products.length} pending products`);
        // Debug: Log specifications for first product
        if (products.length > 0) {
          console.log('📦 ========== PENDING PRODUCTS FETCHED ==========');
          console.log('📦 Total products:', products.length);
          products.forEach((p, idx) => {
            console.log(`📦 Product ${idx + 1}:`, p.name);
            console.log(`📦   - Has specifications:`, !!p.specifications);
            console.log(`📦   - Specifications:`, p.specifications);
            console.log(`📦   - Specifications keys:`, p.specifications ? Object.keys(p.specifications) : 'none');
            console.log(`📦   - Specifications count:`, p.specifications ? Object.keys(p.specifications).length : 0);
          });
          console.log('📦 ============================================');
        }
        
        // Log product details for debugging
        if (products.length > 0) {
          console.log('Pending products:', products.map(p => ({ 
            name: p.name, 
            status: p.status, 
            id: p._id || p.id 
          })));
        }
      } else {
        console.error('❌ Failed to fetch pending products:', result.message);
        setPendingProducts([]);
      }
    } catch (error) {
      console.error('❌ Error fetching pending products:', error);
      setPendingProducts([]);
    }
  };

  // Listen for tab changes from sidebar
  useEffect(() => {
    const handleTabChange = (event) => {
      setActiveTab(event.detail.tab);
    };
    
    window.addEventListener('adminTabChange', handleTabChange);
    
    // Set initial tab on mount - default to 'users'
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab') || 'users';
    setActiveTab(initialTab);
    
    // Dispatch event to update sidebar state
    window.dispatchEvent(new CustomEvent('adminTabChange', { detail: { tab: initialTab } }));
    
    return () => window.removeEventListener('adminTabChange', handleTabChange);
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/dashboard'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const result = await response.json();
      
      console.log('Admin Dashboard Response:', result);
      
      if (result.status === 'success') {
        const data = result.data;
        console.log('Admin Dashboard Data:', data);
        console.log('Supplier Data:', data.supplierData);
        
        setStats(data.stats);
        // Filter out test/dummy users based on email patterns and names
        const filteredUsers = (data.users || []).filter(user => {
          const email = user.email?.toLowerCase() || '';
          const name = user.name?.toLowerCase() || '';
          
          // Filter out test users - exclude users with test email patterns and test names
          const isTestUser = 
            email.includes('harshranjan') ||
            email.includes('ranjhan.harsh') ||
            email.includes('@mitaoe.ac.in') ||
            email.includes('mindblogg') ||
            email.includes('harsh') ||
            name.includes('harsh') ||
            name.includes('kasak') ||
            name.includes('beep316') ||
            name.includes('c417');
          
          return !isTestUser;
        });
        
        setUsers(filteredUsers);
        setTransactions(data.transactions);
        setSupplierData(data.supplierData || []);
        setServiceProviderData(data.serviceProviderData || []);
        setProducts(data.products || []);
        setBOQs(data.boqs || []);
      } else {
        console.error('Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProductUpdate = () => {
    fetchAdminData();
    fetchPendingProducts();
    setSelectedProduct(null);
    setSelectedSupplier(null);
    // Refresh the page to show updated product status
    setTimeout(() => {
      fetchPendingProducts();
    }, 500);
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.company.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || user.userType === filterType;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading admin dashboard...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Admin Dashboard</h1>
          <p>Monitor and manage platform activities • Real-time data</p>
          {pendingProducts.length > 0 && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem 1rem',
              background: '#fef3c7',
              border: '1px solid #fbbf24',
              borderRadius: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={() => {
              setActiveTab('products');
              window.dispatchEvent(new CustomEvent('adminTabChange', { detail: { tab: 'products' } }));
              const url = new URL(window.location);
              url.searchParams.set('tab', 'products');
              window.history.pushState({}, '', url);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#fde68a';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fef3c7';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            >
              <Clock size={18} color="#d97706" />
              <span style={{ fontWeight: '600', color: '#92400e' }}>
                {pendingProducts.length} product{pendingProducts.length !== 1 ? 's' : ''} pending approval - Click to review
              </span>
            </div>
          )}
        </div>
        <div className="admin-actions">
          <AdminNotifications 
            onProductClick={(product, supplier) => {
              console.log('Product clicked from notification:', product);
              setSelectedProduct(product);
              setSelectedSupplier(supplier);
              // Ensure we're on the products tab
              setActiveTab('products');
              window.dispatchEvent(new CustomEvent('adminTabChange', { detail: { tab: 'products' } }));
              const url = new URL(window.location);
              url.searchParams.set('tab', 'products');
              window.history.pushState({}, '', url);
            }}
          />
          <button 
            className="btn-refresh" 
            onClick={() => {
              fetchAdminData();
              fetchPendingProducts();
            }}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh Data
          </button>
          <button 
            onClick={() => {
              console.log('Opening products tab...');
              setActiveTab('products');
              window.dispatchEvent(new CustomEvent('adminTabChange', { detail: { tab: 'products' } }));
              const url = new URL(window.location);
              url.searchParams.set('tab', 'products');
              window.history.pushState({}, '', url);
              fetchPendingProducts();
              // Scroll to content area
              setTimeout(() => {
                const contentArea = document.querySelector('.admin-content');
                if (contentArea) {
                  contentArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }, 100);
            }}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              background: pendingProducts.length > 0 ? '#f59e0b' : 'rgba(79, 70, 229, 0.1)',
              border: pendingProducts.length > 0 ? '2px solid #f59e0b' : '1px solid rgba(79, 70, 229, 0.2)',
              color: pendingProducts.length > 0 ? 'white' : '#4f46e5',
              borderRadius: '8px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontSize: '0.875rem'
            }}
            onMouseEnter={(e) => {
              if (pendingProducts.length > 0) {
                e.currentTarget.style.background = '#d97706';
              } else {
                e.currentTarget.style.background = 'rgba(79, 70, 229, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              if (pendingProducts.length > 0) {
                e.currentTarget.style.background = '#f59e0b';
              } else {
                e.currentTarget.style.background = 'rgba(79, 70, 229, 0.1)';
              }
            }}
          >
            <Clock size={16} />
            {pendingProducts.length > 0 ? `Approve Products (${pendingProducts.length})` : 'View All Products'}
          </button>
          <div className="admin-user-info">
            <span>Welcome, {user?.name}</span>
            <div className="admin-badge">Admin</div>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="stat-icon users">
            <Users size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.totalUsers}</h3>
            <p>Total Users</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="stat-icon providers">
            <Building size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.serviceProviders}</h3>
            <p>Service Providers</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="stat-icon suppliers">
            <Package size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.suppliers}</h3>
            <p>Suppliers</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="stat-icon transactions">
            <ShoppingCart size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.totalTransactions}</h3>
            <p>Total Transactions</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="stat-icon revenue">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <h3>₹{stats.totalRevenue.toLocaleString('en-IN')}</h3>
            <p>Net Platform Revenue</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="stat-icon boqs">
            <FileText size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.activeBOQs}</h3>
            <p>Active BOQs</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="stat-icon products">
            <Package size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.totalProducts}</h3>
            <p>Total Products</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="stat-icon inventory">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <h3>₹{stats.totalInventoryValue?.toLocaleString('en-IN')}</h3>
            <p>Inventory Value</p>
          </div>
        </div>

        {/* Pending Products Card - Always Visible */}
        <div 
          className="admin-stat-card pending-products-stat"
          onClick={() => {
            console.log('Pending products card clicked, opening products tab...');
            setActiveTab('products');
            window.dispatchEvent(new CustomEvent('adminTabChange', { detail: { tab: 'products' } }));
            // Update URL to persist tab state
            const url = new URL(window.location);
            url.searchParams.set('tab', 'products');
            window.history.pushState({}, '', url);
            fetchPendingProducts(); // Refresh when clicked
            // Scroll to top of content area
            setTimeout(() => {
              const contentArea = document.querySelector('.admin-content');
              if (contentArea) {
                contentArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }}
          style={{ 
            cursor: 'pointer',
            border: pendingProducts.length > 0 ? '2px solid #f59e0b' : '1px solid #e5e7eb',
            background: pendingProducts.length > 0 ? '#fffbeb' : 'rgba(255, 255, 255, 0.9)',
            animation: pendingProducts.length > 0 ? 'pulse 2s infinite' : 'none',
            display: 'flex', // Ensure it's visible
            visibility: 'visible',
            opacity: 1
          }}
          title={pendingProducts.length > 0 ? `Click to approve ${pendingProducts.length} pending product(s)` : 'Click to view all products'}
        >
          <div className="stat-icon pending" style={{ 
            background: pendingProducts.length > 0 ? '#f59e0b' : '#fef3c7', 
            color: pendingProducts.length > 0 ? 'white' : '#d97706' 
          }}>
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <h3 style={{ color: pendingProducts.length > 0 ? '#d97706' : '#1e293b' }}>
              {pendingProducts.length}
            </h3>
            <p style={{ color: pendingProducts.length > 0 ? '#92400e' : '#64748b', fontWeight: pendingProducts.length > 0 ? '600' : '400' }}>
              {pendingProducts.length > 0 ? '⚠️ Pending Approval' : 'Pending Products'}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="admin-content">
        {activeTab === 'users' && (
          <UsersTab 
            users={filteredUsers}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filterType={filterType}
            setFilterType={setFilterType}
          />
        )}
        
        {activeTab === 'transactions' && (
          <TransactionsTab 
            transactions={transactions}
            onTransactionClick={(transaction) => {
              console.log('Transaction clicked:', transaction);
              // Could open a modal with full transaction details
            }}
          />
        )}
        
        {activeTab === 'suppliers' && (
          <SuppliersTab 
            supplierData={supplierData}
            onProductClick={(product, supplier) => {
              setSelectedProduct(product);
              setSelectedSupplier(supplier);
            }}
          />
        )}
        
        {activeTab === 'providers' && (
          <ServiceProvidersTab serviceProviderData={serviceProviderData} />
        )}
        
        {activeTab === 'products' && (
          <PendingProductsTab 
            pendingProducts={pendingProducts}
            onProductClick={(product) => {
              // Find supplier for this product
              const supplier = supplierData.find(s => 
                s.products?.some(p => (p._id || p.id) === (product._id || product.id))
              );
              setSelectedProduct(product);
              setSelectedSupplier(supplier || product.supplier);
            }}
            onRefresh={fetchPendingProducts}
          />
        )}
      </div>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal 
          product={selectedProduct}
          supplier={selectedSupplier}
          onClose={() => {
            setSelectedProduct(null);
            setSelectedSupplier(null);
          }}
          onUpdate={handleProductUpdate}
        />
      )}
    </div>
  );
};

// Product Detail Modal Component
const ProductDetailModal = ({ product, supplier, onClose, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedProduct, setEditedProduct] = useState({ 
    ...product,
    specifications: product.specifications || {}
  });
  const [loading, setLoading] = useState(false);
  // AI Fetch state
  const [enhancing, setEnhancing] = useState(false);
  const [aiProvider, setAiProvider] = useState('auto'); // 'auto', 'openai', 'gemini', 'claude'
  // Add new specification key state
  const [isAddingNewKey, setIsAddingNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  
  // Update editedProduct when product changes
  useEffect(() => {
    console.log('🔍 ========== PRODUCT LOADED IN ADMIN MODAL ==========');
    console.log('🔍 Full product object:', JSON.stringify(product, null, 2));
    console.log('🔍 Product specifications:', product.specifications);
    console.log('🔍 Product specifications type:', typeof product.specifications);
    console.log('🔍 Product specifications is array?', Array.isArray(product.specifications));
    console.log('🔍 Product specifications keys:', product.specifications ? Object.keys(product.specifications) : 'none');
    console.log('🔍 Product specifications count:', product.specifications ? Object.keys(product.specifications).length : 0);
    console.log('✅ AI Fetch buttons should be visible in Description section');
    
    // Ensure specifications is always an object
    const specs = product.specifications || {};
    if (typeof specs !== 'object' || Array.isArray(specs)) {
      console.warn('⚠️ Specifications is not an object, converting...');
      console.warn('⚠️ Original specs:', specs);
    }
    
    const finalSpecs = typeof specs === 'object' && !Array.isArray(specs) ? specs : {};
    console.log('🔍 Final specifications to use:', finalSpecs);
    console.log('🔍 Final specifications keys:', Object.keys(finalSpecs));
    console.log('🔍 ================================================');
    
    setEditedProduct({
      ...product,
      specifications: finalSpecs
    });
  }, [product]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product.id || product._id;
      // Prepare product data with specifications
      const productData = {
        ...editedProduct,
        specifications: editedProduct.specifications || {}
      };
      
      // IMPORTANT: Preserve null values - they represent specification keys that need values
      // Only remove undefined values, but keep null and empty strings
      if (productData.specifications) {
        Object.keys(productData.specifications).forEach(key => {
          const value = productData.specifications[key];
          // Only remove undefined - keep null (for new keys), empty strings, and arrays
          if (value === undefined) {
            delete productData.specifications[key];
          }
        });
      }
      
      console.log('💾 [ADMIN SAVE] Saving product with specifications:', productData.specifications);
      console.log('💾 [ADMIN SAVE] Specification keys:', Object.keys(productData.specifications || {}));
      
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(productData)
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ [ADMIN SAVE] Product saved successfully:', result);
        
        // Update the product with the response data to ensure new keys are visible
        // Response structure: { status: 'success', product: productResponse }
        const updatedProduct = result.product || result.data?.product || result;
        if (updatedProduct && updatedProduct.specifications !== undefined) {
          console.log('✅ [ADMIN SAVE] Updated product from response:', updatedProduct);
          console.log('✅ [ADMIN SAVE] Updated specifications:', updatedProduct.specifications);
          console.log('✅ [ADMIN SAVE] Updated specifications keys:', Object.keys(updatedProduct.specifications || {}));
          
          // Update editedProduct to reflect the saved state with all specifications (including null values)
          setEditedProduct({
            ...updatedProduct,
            specifications: updatedProduct.specifications || {}
          });
          
          // Also update the product prop if onUpdate is available
          if (onUpdate) {
            onUpdate(updatedProduct);
          }
        }
        
        alert('Product updated successfully!');
        setIsEditing(false);
        if (onUpdate) onUpdate();
      } else {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        console.error('❌ [ADMIN SAVE] Failed to update product:', errorData);
        alert(`Failed to update product: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('❌ [ADMIN SAVE] Error updating product:', error);
      alert(`Error updating product: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm('Are you sure you want to approve this product?')) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product.id || product._id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/approve`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        alert('Product approved successfully!');
        if (onUpdate) onUpdate();
      } else {
        alert('Failed to approve product');
      }
    } catch (error) {
      console.error('Error approving product:', error);
      alert('Error approving product');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product.id || product._id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/reject`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      });

      if (response.ok) {
        alert('Product rejected');
        if (onUpdate) onUpdate();
      } else {
        alert('Failed to reject product');
      }
    } catch (error) {
      console.error('Error rejecting product:', error);
      alert('Error rejecting product');
    } finally {
      setLoading(false);
    }
  };

  const performAIFetch = async (productData) => {
    if (!productData.name) {
      alert('Please enter a product name first');
      return;
    }

    setEnhancing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/products/ai-enhance'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          productName: productData.name,
          category: productData.category,
          description: productData.description || '',
          provider: aiProvider
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        console.error('API Error:', errorData);
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('AI Fetch Response:', data);
      
      if (data.status === 'success') {
        // Show category mismatch warning if present
        if (data.categoryMismatchWarning) {
          alert(`⚠️ ${data.categoryMismatchWarning}`);
        }
        
        // Update description with AI-generated content
        const generatedDesc = data.enhancedDescription || data.description;
        
        // Update specifications with extracted attributes and key-value pairs
        // IMPORTANT: Replace existing specs completely, don't merge - user requested exact count
        let newSpecs = {};
        if (data.specifications && Object.keys(data.specifications).length > 0) {
          // Use the specifications directly from AI (already trimmed to exact count by backend)
          newSpecs = { ...data.specifications };
          
          // Also merge extractedAttributes for backward compatibility (only if they don't conflict)
          if (data.extractedAttributes) {
            // Only add extractedAttributes if they don't already exist in specifications
            const extractedMap = {
              grade: data.extractedAttributes.grade,
              brand: data.extractedAttributes.brand,
              dimensions: data.extractedAttributes.dimensions,
              weight: data.extractedAttributes.weight,
              color: data.extractedAttributes.color,
              material: data.extractedAttributes.material,
              certification: data.extractedAttributes.certification
            };
            
            // Only add if not already present in specifications
            Object.keys(extractedMap).forEach(key => {
              const value = extractedMap[key];
              if (value && value !== '' && value !== null && !newSpecs[key]) {
                // Check if there's a similar key with different casing
                const hasSimilarKey = Object.keys(newSpecs).some(specKey => 
                  specKey.toLowerCase() === key.toLowerCase()
                );
                if (!hasSimilarKey) {
                  newSpecs[key] = value;
                }
              }
            });
          }
        } else if (data.extractedAttributes) {
          // Fallback to extracted attributes if no specifications object
          const fallbackSpecs = {
            grade: data.extractedAttributes.grade || '',
            brand: data.extractedAttributes.brand || '',
            dimensions: data.extractedAttributes.dimensions || '',
            weight: data.extractedAttributes.weight || '',
            color: data.extractedAttributes.color || '',
            material: data.extractedAttributes.material || '',
            certification: data.extractedAttributes.certification || []
          };
          
          const hasAttributes = Object.values(fallbackSpecs).some(val => 
            val !== '' && val !== null && (Array.isArray(val) ? val.length > 0 : true)
          );
          
          if (hasAttributes) {
            newSpecs = fallbackSpecs;
          }
        }
        
        // REPLACE specifications completely (don't merge with existing)
        // This ensures we get exactly the count requested by the user
        setEditedProduct(prev => ({
          ...prev,
          ...(generatedDesc && { description: generatedDesc }),
          specifications: newSpecs  // Replace, don't merge
        }));
        
        if (Object.keys(newSpecs).length > 0) {
          console.log('✅ Specifications received from AI:', newSpecs);
          console.log('✅ Total specification keys:', Object.keys(newSpecs).length);
        }

        const providerName = data.provider === 'openai' ? 'ChatGPT' : data.provider === 'gemini' ? 'Gemini' : data.provider === 'claude' ? 'Claude' : 'AI';
        const successMessage = data.categoryMismatchWarning 
          ? `Product description fetched successfully from ${providerName}! However, please verify that the category matches the description.`
          : `Product description fetched successfully from ${providerName}! Attributes extracted and ready to use.`;
        alert(successMessage);
      } else {
        alert(data.message || 'Failed to fetch data from AI service. Please try again.');
      }
    } catch (error) {
      console.error('AI fetch error:', error);
      alert(`Failed to fetch data from AI: ${error.message}. Please check your API keys configuration and try again.`);
    } finally {
      setEnhancing(false);
    }
  };

  const handleAIEnhance = async () => {
    // Use current product data (either editedProduct if editing, or product if not)
    const productToUse = isEditing ? editedProduct : product;
    await performAIFetch(productToUse);
  };

  const currentProduct = isEditing ? editedProduct : product;
  
  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": currentProduct.name,
    "description": currentProduct.description || "Construction material for building projects",
    "sku": `PROD-${String(currentProduct.id || currentProduct._id || '000000').padStart(6, '0')}`,
    "category": currentProduct.category,
    "brand": {
      "@type": "Brand",
      "name": supplier?.company || supplier?.name || "TatvaDirect Supplier"
    },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "INR",
      "price": currentProduct.price.toString(),
      "priceSpecification": {
        "@type": "UnitPriceSpecification",
        "price": currentProduct.price,
        "priceCurrency": "INR",
        "unitText": currentProduct.unit
      },
      "itemCondition": "https://schema.org/NewCondition",
      "availability": currentProduct.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": {
        "@type": "Organization",
        "name": supplier?.company || supplier?.name || "TatvaDirect Supplier"
      }
    }
  };

  const statusInfo = {
    approved: { color: '#059669', text: 'Approved' },
    pending: { color: '#d97706', text: 'Pending Approval' },
    rejected: { color: '#dc2626', text: 'Rejected' }
  };

  const status = statusInfo[product.status] || statusInfo.pending;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-content">
            <div className="modal-title-section">
              <Package size={28} color="#4f46e5" />
              {isEditing ? (
                <input
                  type="text"
                  value={editedProduct.name}
                  onChange={(e) => setEditedProduct({ ...editedProduct, name: e.target.value })}
                  className="modal-title-input"
                />
              ) : (
                <h2 className="modal-title">{product.name}</h2>
              )}
            </div>
            <div className="modal-badges">
              <span className="category-badge-modal">{currentProduct.category}</span>
              <span className={`status-badge-modal status-${product.status}`}>
                {status.text}
              </span>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="modal-actions">
            {!isEditing ? (
              <>
                <button onClick={() => {
                  console.log('🖱️ Edit button clicked');
                  console.log('🖱️ Current product specifications:', product.specifications);
                  console.log('🖱️ Current editedProduct specifications:', editedProduct.specifications);
                  // Ensure specifications are properly initialized
                  const updatedProduct = {
                    ...product,
                    specifications: product.specifications || {}
                  };
                  setEditedProduct(updatedProduct);
                  setIsEditing(true);
                  console.log('🖱️ After setting, editedProduct.specifications:', updatedProduct.specifications);
                  console.log('🖱️ isEditing set to true, AI Fetch should be visible');
                }} className="btn-modal btn-edit-modal">
                  <Edit2 size={16} />
                  Edit
                </button>
                
                {product.status !== 'approved' && (
                  <button onClick={handleApprove} disabled={loading} className="btn-modal btn-approve-modal">
                    <Check size={16} />
                    Approve
                  </button>
                )}
                
                {product.status !== 'rejected' && (
                  <button onClick={handleReject} disabled={loading} className="btn-modal btn-reject-modal">
                    <Ban size={16} />
                    Reject
                  </button>
                )}
              </>
            ) : (
              <>
                <button onClick={handleSave} disabled={loading} className="btn-modal btn-save-modal">
                  <Save size={16} />
                  {loading ? 'Saving...' : 'Save'}
                </button>
                
                <button 
                  onClick={() => {
                    setIsEditing(false);
                    setEditedProduct({ 
                      ...product,
                      specifications: product.specifications || {}
                    });
                  }} 
                  disabled={loading}
                  className="btn-modal btn-cancel-modal"
                >
                  <X size={16} />
                  Cancel
                </button>
              </>
            )}
            
            <button onClick={onClose} disabled={loading} className="btn-close-modal">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="modal-body">
          {/* Product Details Grid */}
          <div className="detail-cards-grid">
            {isEditing ? (
              <>
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#05966915' }}>
                    <DollarSign size={20} color="#059669" />
                  </div>
                  <div className="detail-content-editable">
                    <label>Price</label>
                    <input
                      type="number"
                      value={editedProduct.price}
                      onChange={(e) => setEditedProduct({ ...editedProduct, price: parseFloat(e.target.value) || 0 })}
                      className="detail-input"
                    />
                    <span className="detail-subtitle">per {editedProduct.unit}</span>
                  </div>
                </div>
                
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#4f46e515' }}>
                    <Box size={20} color="#4f46e5" />
                  </div>
                  <div className="detail-content-editable">
                    <label>Stock</label>
                    <input
                      type="number"
                      value={editedProduct.stock}
                      onChange={(e) => setEditedProduct({ ...editedProduct, stock: parseInt(e.target.value) || 0 })}
                      className="detail-input"
                    />
                    <span className="detail-subtitle">{editedProduct.unit}</span>
                  </div>
                </div>
                
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#d9770615' }}>
                    <Tag size={20} color="#d97706" />
                  </div>
                  <div className="detail-content-editable">
                    <label>Category</label>
                    <select
                      value={editedProduct.category}
                      onChange={(e) => setEditedProduct({ ...editedProduct, category: e.target.value })}
                      className="detail-select"
                    >
                      <option value="steel">Steel</option>
                      <option value="cement">Cement</option>
                      <option value="aggregates">Aggregates</option>
                      <option value="masonry">Masonry</option>
                      <option value="other">Other</option>
                    </select>
                    <label style={{ marginTop: '0.75rem' }}>Unit</label>
                    <input
                      type="text"
                      value={editedProduct.unit}
                      onChange={(e) => setEditedProduct({ ...editedProduct, unit: e.target.value })}
                      className="detail-input"
                      style={{ marginTop: '0.25rem' }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#05966915' }}>
                    <DollarSign size={20} color="#059669" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">Price</span>
                    <span className="detail-value">₹{currentProduct.price.toLocaleString('en-IN')}</span>
                    <span className="detail-subtitle">per {currentProduct.unit}</span>
                  </div>
                </div>
                
                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#4f46e515' }}>
                    <Box size={20} color="#4f46e5" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">Stock Available</span>
                    <span className="detail-value">{currentProduct.stock.toLocaleString()}</span>
                    <span className="detail-subtitle">{currentProduct.unit}</span>
                  </div>
                </div>
                
                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#d9770615' }}>
                    <Tag size={20} color="#d97706" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">SKU</span>
                    <span className="detail-value">PROD-{String(currentProduct.id || currentProduct._id || '000000').padStart(6, '0')}</span>
                    <span className="detail-subtitle">Product Code</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Description */}
          <div className="description-section">
            <h3 style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              flexWrap: 'wrap', 
              gap: '0.5rem', 
              marginBottom: '1rem',
              width: '100%'
            }}>
              <span>Description</span>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem', 
                flexWrap: 'wrap',
                marginLeft: 'auto',
                visibility: 'visible',
                opacity: 1
              }}>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  disabled={enhancing}
                  style={{
                    padding: '0.375rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '0.75rem',
                    background: 'white',
                    cursor: enhancing ? 'not-allowed' : 'pointer',
                    minWidth: '150px'
                  }}
                  title="Select AI provider"
                >
                  <option value="auto">Auto (Best Available)</option>
                  <option value="openai">ChatGPT</option>
                  <option value="gemini">Gemini</option>
                  <option value="claude">Claude</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    // If not editing, enter edit mode first
                    if (!isEditing) {
                      const updatedProduct = {
                        ...product,
                        specifications: product.specifications || {}
                      };
                      setEditedProduct(updatedProduct);
                      setIsEditing(true);
                      // Wait a moment for state to update, then fetch
                      setTimeout(() => {
                        performAIFetch(updatedProduct);
                      }, 50);
                    } else {
                      handleAIEnhance();
                    }
                  }}
                  disabled={enhancing || !currentProduct.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.875rem',
                    background: enhancing ? '#9ca3af' : '#4f46e5',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: enhancing || !currentProduct.name ? 'not-allowed' : 'pointer',
                    opacity: enhancing || !currentProduct.name ? 0.6 : 1,
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                    boxShadow: enhancing ? 'none' : '0 2px 4px rgba(79, 70, 229, 0.2)'
                  }}
                  title="Fetch product description and attributes from AI (ChatGPT, Gemini, or Claude)"
                  onMouseEnter={(e) => {
                    if (!enhancing && currentProduct.name) {
                      e.currentTarget.style.background = '#4338ca';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(79, 70, 229, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!enhancing && currentProduct.name) {
                      e.currentTarget.style.background = '#4f46e5';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(79, 70, 229, 0.2)';
                    }
                  }}
                >
                  <Sparkles size={16} />
                  <span>{enhancing ? 'Fetching...' : 'AI Fetch'}</span>
                </button>
              </div>
            </h3>
            {isEditing ? (
              <textarea
                value={editedProduct.description || ''}
                onChange={(e) => setEditedProduct({ ...editedProduct, description: e.target.value })}
                className="description-textarea"
                placeholder="Enter product name and category, then click 'AI Fetch' to generate description from AI platforms (ChatGPT, Gemini, or Claude). You can also enter a description manually."
              />
            ) : (
              <p>{currentProduct.description || 'No description available'}</p>
            )}
          </div>

          {/* Specifications */}
          <div className="description-section">
            <h3>Specifications {isEditing && <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'normal' }}>(from AI) - Enter values manually</span>}</h3>
            {isEditing ? (
              <div 
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  padding: '0.5rem',
                  background: 'white',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  position: 'relative',
                  zIndex: 1
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {(() => {
                  const specs = editedProduct.specifications || {};
                  const specKeys = Object.keys(specs).filter(key => key && key.trim() !== '');
                  
                  if (specKeys.length === 0) {
                    return (
                      <p style={{ color: '#64748b', fontSize: '0.875rem', fontStyle: 'italic', margin: 0, padding: '1rem', textAlign: 'center' }}>
                        No specifications available. Click 'AI Fetch' in the Description section to generate specification keys, or they will appear here after supplier uses AI Fetch feature.
                      </p>
                    );
                  }
                  
                  return (
                    <>
                      {specKeys.map((key, index) => {
                    const specs = editedProduct.specifications || {};
                    const currentValue = specs[key] !== undefined && specs[key] !== null ? String(specs[key]) : '';
                    
                    return (
                      <div 
                        key={`spec-${key}-${index}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem',
                          padding: '0.75rem',
                          background: index % 2 === 0 ? '#ffffff' : '#f9fafb',
                          borderRadius: '6px',
                          borderLeft: '3px solid #4f46e5'
                        }}
                      >
                        <label 
                          htmlFor={`spec-input-${key}-${index}`}
                          style={{
                            fontSize: '0.875rem',
                            color: '#1e293b',
                            fontWeight: '600',
                            minWidth: '180px',
                            flexShrink: 0,
                            textTransform: 'uppercase'
                          }}
                        >
                          {key}:
                        </label>
                        <input
                          id={`spec-input-${key}-${index}`}
                          type="text"
                          value={currentValue}
                          onChange={(e) => {
                            e.stopPropagation();
                            const newValue = e.target.value;
                            // Convert empty string to null to preserve keys that need values
                            const valueToSave = newValue.trim() === '' ? null : newValue;
                            console.log(`📝 [SPEC INPUT] Changing ${key} from "${currentValue}" to "${newValue}" (saving as: ${valueToSave})`);
                            
                            const updatedSpecs = {
                              ...(editedProduct.specifications || {}),
                              [key]: valueToSave
                            };
                            
                            console.log(`📝 [SPEC INPUT] Updated specifications:`, updatedSpecs);
                            
                            setEditedProduct({
                              ...editedProduct,
                              specifications: updatedSpecs
                            });
                            
                            console.log(`📝 [SPEC INPUT] State updated`);
                          }}
                          placeholder={`Enter ${key.toLowerCase()} value`}
                          style={{
                            flex: '1',
                            padding: '0.5rem 0.75rem',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            color: '#1e293b',
                            background: 'white',
                            transition: 'all 0.2s ease',
                            pointerEvents: 'auto',
                            cursor: 'text',
                            WebkitUserSelect: 'text',
                            MozUserSelect: 'text',
                            msUserSelect: 'text',
                            position: 'relative',
                            zIndex: 9999
                          }}
                          onFocus={(e) => {
                            e.stopPropagation();
                            console.log(`🎯 [SPEC INPUT] Focused on ${key} input`);
                            e.target.style.borderColor = '#4f46e5';
                            e.target.style.boxShadow = '0 0 0 3px rgba(79, 70, 229, 0.1)';
                          }}
                          onBlur={(e) => {
                            e.stopPropagation();
                            e.target.style.borderColor = '#d1d5db';
                            e.target.style.boxShadow = 'none';
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            console.log(`🖱️ [SPEC INPUT] MouseDown on ${key} input`);
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            console.log(`⌨️ [SPEC INPUT] KeyDown on ${key} input:`, e.key);
                          }}
                          onKeyUp={(e) => {
                            e.stopPropagation();
                          }}
                          onKeyPress={(e) => {
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log(`🖱️ [SPEC INPUT] Clicked on ${key} input`);
                            e.target.focus();
                          }}
                        />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const updatedSpecs = { ...(editedProduct.specifications || {}) };
                                delete updatedSpecs[key];
                                setEditedProduct({
                                  ...editedProduct,
                                  specifications: updatedSpecs
                                });
                              }}
                              style={{
                                padding: '0.375rem',
                                background: '#ef4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                transition: 'all 0.2s ease'
                              }}
                              title="Remove this specification"
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#dc2626';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = '#ef4444';
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                      </div>
                    );
                      })}
                      
                      {/* Add new key form */}
                      {isAddingNewKey ? (
                        <div 
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            padding: '0.75rem',
                            background: '#f0f9ff',
                            borderRadius: '6px',
                            borderLeft: '3px solid #10b981',
                            border: '2px solid #10b981'
                          }}
                        >
                          <input
                            type="text"
                            value={newKeyName}
                            onChange={(e) => {
                              e.stopPropagation();
                              setNewKeyName(e.target.value);
                            }}
                            placeholder="Specification key name"
                            style={{
                              minWidth: '180px',
                              padding: '0.5rem 0.75rem',
                              border: '1px solid #10b981',
                              borderRadius: '6px',
                              fontSize: '0.875rem',
                              fontWeight: '600',
                              textTransform: 'uppercase',
                              background: 'white'
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (newKeyName.trim()) {
                                  // Use null for empty values to represent keys that need values
                                  const value = newKeyValue.trim() || null;
                                  const updatedSpecs = {
                                    ...(editedProduct.specifications || {}),
                                    [newKeyName.trim()]: value
                                  };
                                  setEditedProduct({
                                    ...editedProduct,
                                    specifications: updatedSpecs
                                  });
                                  setNewKeyName('');
                                  setNewKeyValue('');
                                  setIsAddingNewKey(false);
                                }
                              } else if (e.key === 'Escape') {
                                setIsAddingNewKey(false);
                                setNewKeyName('');
                                setNewKeyValue('');
                              }
                            }}
                            autoFocus
                          />
                          <input
                            type="text"
                            value={newKeyValue}
                            onChange={(e) => {
                              e.stopPropagation();
                              setNewKeyValue(e.target.value);
                            }}
                            placeholder="Value (optional)"
                            style={{
                              flex: '1',
                              padding: '0.5rem 0.75rem',
                              border: '1px solid #10b981',
                              borderRadius: '6px',
                              fontSize: '0.875rem',
                              background: 'white'
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (newKeyName.trim()) {
                                  // Use null for empty values to represent keys that need values
                                  const value = newKeyValue.trim() || null;
                                  const updatedSpecs = {
                                    ...(editedProduct.specifications || {}),
                                    [newKeyName.trim()]: value
                                  };
                                  setEditedProduct({
                                    ...editedProduct,
                                    specifications: updatedSpecs
                                  });
                                  setNewKeyName('');
                                  setNewKeyValue('');
                                  setIsAddingNewKey(false);
                                }
                              } else if (e.key === 'Escape') {
                                setIsAddingNewKey(false);
                                setNewKeyName('');
                                setNewKeyValue('');
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (newKeyName.trim()) {
                                const updatedSpecs = {
                                  ...(editedProduct.specifications || {}),
                                  [newKeyName.trim()]: newKeyValue.trim()
                                };
                                setEditedProduct({
                                  ...editedProduct,
                                  specifications: updatedSpecs
                                });
                                setNewKeyName('');
                                setNewKeyValue('');
                                setIsAddingNewKey(false);
                              }
                            }}
                            style={{
                              padding: '0.5rem',
                              background: '#10b981',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}
                            title="Add specification"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsAddingNewKey(false);
                              setNewKeyName('');
                              setNewKeyValue('');
                            }}
                            style={{
                              padding: '0.5rem',
                              background: '#6b7280',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsAddingNewKey(true);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            padding: '0.75rem',
                            background: '#f0f9ff',
                            border: '2px dashed #4f46e5',
                            borderRadius: '6px',
                            color: '#4f46e5',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '600',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#e0e7ff';
                            e.currentTarget.style.borderColor = '#6366f1';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#f0f9ff';
                            e.currentTarget.style.borderColor = '#4f46e5';
                          }}
                        >
                          <Plus size={16} />
                          <span>Add New Specification Key</span>
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  padding: '1rem',
                  background: '#f9fafb',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb'
                }}>
                  {currentProduct.specifications && Object.keys(currentProduct.specifications).length > 0 ? (
                    Object.entries(currentProduct.specifications)
                      .filter(([key]) => key && key.trim() !== '') // Only filter out empty keys
                      .map(([key, value], index) => {
                        // Show all keys, even if value is null/empty
                        const displayValue = value !== null && value !== undefined && value !== '' 
                          ? (Array.isArray(value) ? value.join(', ') : String(value))
                          : '(Not set)';
                        const hasValue = value !== null && value !== '' && value !== undefined &&
                                       !(Array.isArray(value) && value.length === 0);
                        
                        return (
                          <div key={key} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.625rem 0.75rem',
                            background: index % 2 === 0 ? '#ffffff' : '#f9fafb',
                            borderRadius: '4px',
                            borderLeft: '3px solid #4f46e5'
                          }}>
                            <span style={{
                              fontSize: '0.875rem',
                              color: '#64748b',
                              fontWeight: '600'
                            }}>
                              {key}:
                            </span>
                            <span style={{
                              fontSize: '0.875rem',
                              color: hasValue ? '#1e293b' : '#9ca3af',
                              fontWeight: hasValue ? '500' : '400',
                              fontStyle: hasValue ? 'normal' : 'italic'
                            }}>
                              {displayValue}
                            </span>
                          </div>
                        );
                      })
                  ) : (
                    <p style={{ color: '#64748b', fontSize: '0.875rem', fontStyle: 'italic', margin: 0, padding: '1rem', textAlign: 'center' }}>
                      No specifications available. Click 'AI Fetch' in the Description section to generate specification keys, or they will appear here after supplier uses AI Fetch feature.
                    </p>
                  )}
                </div>
              )}
            </div>

          {/* Supplier Information */}
          {supplier && (
            <div className="supplier-section">
              <h3>Supplier Information</h3>
              <div className="supplier-info-card">
                <div className="supplier-avatar-modal">
                  {(supplier.name || 'S').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="supplier-name-modal">{supplier.name}</div>
                  <div className="supplier-company-modal">{supplier.company || supplier.email}</div>
                </div>
              </div>
            </div>
          )}

          {/* Schema.org JSON-LD */}
          <div className="schema-section">
            <div className="schema-header">
              <h3>Schema.org Structured Data</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(productSchema, null, 2));
                  alert('Schema copied to clipboard!');
                }}
                className="btn-copy-schema"
              >
                Copy JSON
              </button>
            </div>
            <pre className="schema-code">
              <code>{JSON.stringify(productSchema, null, 2)}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

const UsersTab = ({ users, searchTerm, setSearchTerm, filterType, setFilterType }) => (
  <div className="users-content">
    <div className="users-controls">
      <div className="search-box">
        <Search size={16} />
        <input
          type="text"
          placeholder="Search users..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
        <option value="all">All Users</option>
        <option value="service_provider">Service Providers</option>
        <option value="supplier">Suppliers</option>
        <option value="">No Role Selected</option>
      </select>
    </div>

    <div className="users-table">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Type</th>
            <th>Company</th>
            <th>Joined</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <div className="user-info">
                  <div className="user-avatar">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="user-name">{user.name}</div>
                    <div className="user-email">{user.email}</div>
                  </div>
                </div>
              </td>
              <td>
                <span className={`user-type-badge ${user.userType || 'none'}`}>
                  {user.userType === 'service_provider' ? '🏢 Service Provider' :
                   user.userType === 'supplier' ? '🚛 Supplier' : 
                   user.userType === 'admin' ? '🔐 Admin' : '👤 No Role'}
                </span>
              </td>
              <td>{user.company}</td>
              <td>{user.joinedDate}</td>
              <td>
                <span className={`status-badge ${user.status}`}>
                  {user.status === 'active' ? <CheckCircle size={14} /> : <Clock size={14} />}
                  {user.status}
                </span>
              </td>
              <td>
                <button className="btn-icon" title="View Details">
                  <Eye size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const TransactionsTab = ({ transactions, onTransactionClick }) => {
  const [selectedTransaction, setSelectedTransaction] = useState(null);

  return (
    <div className="transactions-content">
      <div className="transactions-table">
        <table>
          <thead>
            <tr>
              <th>Order Number</th>
              <th>Service Provider</th>
              <th>Supplier</th>
              <th>Products</th>
              <th>Amount</th>
              <th>Date</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr 
                key={transaction.id}
                onClick={() => {
                  setSelectedTransaction(transaction);
                  if (onTransactionClick) onTransactionClick(transaction);
                }}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <span className="transaction-id">#{transaction.id}</span>
                </td>
                <td>
                  {transaction.serviceProvider ? (
                    <div className="transaction-party">
                      <div className="party-name">{transaction.serviceProvider.name}</div>
                      {transaction.serviceProvider.company && (
                        <div className="party-company">{transaction.serviceProvider.company}</div>
                      )}
                    </div>
                  ) : (
                    <span>N/A</span>
                  )}
                </td>
                <td>
                  {transaction.supplier ? (
                    <div className="transaction-party">
                      <div className="party-name">{transaction.supplier.name}</div>
                      {transaction.supplier.company && (
                        <div className="party-company">{transaction.supplier.company}</div>
                      )}
                    </div>
                  ) : (
                    <span>N/A</span>
                  )}
                </td>
                <td>
                  <div className="transaction-products">
                    <span className="product-names">{transaction.products}</span>
                    {transaction.productCount > 0 && (
                      <span className="product-count-badge">
                        {transaction.productCount} items
                      </span>
                    )}
                  </div>
                </td>
                <td className="amount">₹{transaction.amount.toLocaleString('en-IN')}</td>
                <td>{transaction.date}</td>
                <td>
                  <span className={`status-badge ${transaction.status}`}>
                    {transaction.status === 'delivered' ? <CheckCircle size={14} /> : 
                     transaction.status === 'pending' ? <Clock size={14} /> : 
                     transaction.status === 'cancelled' ? <X size={14} /> : <AlertTriangle size={14} />}
                    {transaction.status}
                  </span>
                </td>
                <td>
                  <span className={`status-badge ${transaction.paymentStatus || 'pending'}`}>
                    {transaction.paymentStatus || 'pending'}
                  </span>
                </td>
                <td>
                  <button 
                    className="btn-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTransaction(transaction);
                      if (onTransactionClick) onTransactionClick(transaction);
                    }}
                  >
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {selectedTransaction && (
        <div className="modal-overlay" onClick={() => setSelectedTransaction(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Transaction Details - #{selectedTransaction.id}</h2>
              <button onClick={() => setSelectedTransaction(null)} className="btn-close-modal">
                <X size={24} />
              </button>
            </div>
            <div className="modal-body">
              <div className="transaction-details-grid">
                <div className="detail-section">
                  <h3>Service Provider</h3>
                  {selectedTransaction.serviceProvider ? (
                    <div>
                      <p><strong>Name:</strong> {selectedTransaction.serviceProvider.name}</p>
                      {selectedTransaction.serviceProvider.company && (
                        <p><strong>Company:</strong> {selectedTransaction.serviceProvider.company}</p>
                      )}
                      {selectedTransaction.serviceProvider.email && (
                        <p><strong>Email:</strong> {selectedTransaction.serviceProvider.email}</p>
                      )}
                    </div>
                  ) : (
                    <p>N/A</p>
                  )}
                </div>
                
                <div className="detail-section">
                  <h3>Supplier</h3>
                  {selectedTransaction.supplier ? (
                    <div>
                      <p><strong>Name:</strong> {selectedTransaction.supplier.name}</p>
                      {selectedTransaction.supplier.company && (
                        <p><strong>Company:</strong> {selectedTransaction.supplier.company}</p>
                      )}
                      {selectedTransaction.supplier.email && (
                        <p><strong>Email:</strong> {selectedTransaction.supplier.email}</p>
                      )}
                    </div>
                  ) : (
                    <p>N/A</p>
                  )}
                </div>
                
                <div className="detail-section">
                  <h3>Order Information</h3>
                  <p><strong>Amount:</strong> ₹{selectedTransaction.amount.toLocaleString('en-IN')}</p>
                  <p><strong>Status:</strong> {selectedTransaction.status}</p>
                  <p><strong>Payment Status:</strong> {selectedTransaction.paymentStatus || 'pending'}</p>
                  <p><strong>Date:</strong> {selectedTransaction.date}</p>
                </div>
                
                {selectedTransaction.boq && (
                  <div className="detail-section">
                    <h3>BOQ Information</h3>
                    <p><strong>Name:</strong> {selectedTransaction.boq.name}</p>
                    {selectedTransaction.boq.description && (
                      <p><strong>Description:</strong> {selectedTransaction.boq.description}</p>
                    )}
                  </div>
                )}
                
                {selectedTransaction.items && selectedTransaction.items.length > 0 && (
                  <div className="detail-section full-width">
                    <h3>Order Items</h3>
                    <table className="items-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Quantity</th>
                          <th>Unit Price</th>
                          <th>Total Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTransaction.items.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              {(item.productImage || item.product?.image || item.images?.[0] || item.product?.images?.[0]) && (
                                <div style={{ marginBottom: '0.35rem' }}>
                                  <img
                                    src={item.productImage || item.product?.image || item.images?.[0] || item.product?.images?.[0]}
                                    alt={item.product || item.productName || 'Product'}
                                    style={{
                                      width: '56px',
                                      height: '56px',
                                      objectFit: 'cover',
                                      borderRadius: '6px',
                                      border: '1px solid #e5e7eb'
                                    }}
                                  />
                                </div>
                              )}
                              {item.product}
                            </td>
                            <td>{item.quantity}</td>
                            <td>₹{item.unitPrice.toLocaleString('en-IN')}</td>
                            <td>₹{item.totalPrice.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SuppliersTab = ({ supplierData, onProductClick }) => {
  const [expandedSuppliers, setExpandedSuppliers] = useState({});
  const [viewMode, setViewMode] = useState('products'); // 'products' or 'orders'

  const toggleSupplier = (supplierId) => {
    setExpandedSuppliers(prev => ({
      ...prev,
      [supplierId]: !prev[supplierId]
    }));
  };

  return (
    <div className="suppliers-content">
      <div className="suppliers-header-controls">
        <div className="view-mode-toggle">
          <button 
            className={viewMode === 'products' ? 'active' : ''}
            onClick={() => setViewMode('products')}
          >
            Products View
          </button>
          <button 
            className={viewMode === 'orders' ? 'active' : ''}
            onClick={() => setViewMode('orders')}
          >
            Orders View
          </button>
        </div>
      </div>
      
      {!supplierData || supplierData.length === 0 ? (
        <div className="empty-state">
          <Package size={48} />
          <p>No suppliers found</p>
        </div>
      ) : (
        <div className="suppliers-list">
          {supplierData.map((supplier, index) => {
            const supplierId = supplier._id || supplier.id || index;
            const isExpanded = expandedSuppliers[supplierId];
            // Use totalProducts if available, otherwise use products array length
            const productCount = supplier.totalProducts !== undefined 
              ? supplier.totalProducts 
              : (supplier.products?.length || 0);
            const orderCount = supplier.orders?.length || 0;
            const totalRevenue = supplier.totalRevenue || 0;
            const activeOrders = supplier.activeOrders || 0;
            
            return (
              <div key={supplierId} className="supplier-card">
                <div 
                  className="supplier-header"
                  onClick={() => toggleSupplier(supplierId)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="supplier-info">
                    <div className="supplier-avatar">
                      {(supplier.name || 'S').charAt(0).toUpperCase()}
                    </div>
                    <div className="supplier-details">
                      <div className="supplier-name">{supplier.name}</div>
                      <div className="supplier-company">{supplier.company || supplier.email}</div>
                      <div className="supplier-meta">
                        <span>{productCount} product{productCount !== 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>{orderCount} order{orderCount !== 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>₹{totalRevenue.toLocaleString('en-IN')} revenue</span>
                        {supplier.serviceProvidersWorkedWith > 0 && (
                          <>
                            <span>•</span>
                            <span>{supplier.serviceProvidersWorkedWith} SP{supplier.serviceProvidersWorkedWith !== 1 ? 's' : ''}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="supplier-stats">
                    <div className="stat-item">
                      <span className="stat-label">Active Orders</span>
                      <span className="stat-value">{activeOrders}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Inventory Value</span>
                      <span className="stat-value">₹{(supplier.totalInventoryValue || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                  <div className="expand-icon">
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="supplier-expanded-content">
                    {viewMode === 'products' ? (
                      <>
                        <h4>Products ({productCount})</h4>
                        {supplier.products && supplier.products.length > 0 ? (
                          <div className="supplier-products">
                            {supplier.products.map((product) => (
                              <div 
                                key={product.id || product._id} 
                                className="product-item"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onProductClick(product, supplier);
                                }}
                              >
                                <div className="product-item-main">
                                  <span className="product-name">{product.name}</span>
                                  <span className="product-category">{product.category}</span>
                                </div>
                                <div className="product-item-details">
                                  <span className="product-price">₹{product.price.toLocaleString('en-IN')}/{product.unit}</span>
                                  <span className="product-stock">Stock: {product.stock}</span>
                                  <span className={`product-status-badge status-${product.status || 'pending'}`}>
                                    {product.status || 'pending'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="supplier-products-empty">
                            <p>No products available</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <h4>Orders ({orderCount})</h4>
                        {supplier.orders && supplier.orders.length > 0 ? (
                          <div className="supplier-orders">
                            {supplier.orders.map((order, idx) => (
                              <div key={order.orderNumber || idx} className="order-item">
                                <div className="order-item-header">
                                  <span className="order-number">#{order.orderNumber}</span>
                                  <span className={`status-badge ${order.status}`}>
                                    {order.status}
                                  </span>
                                </div>
                                <div className="order-item-details">
                                  {order.serviceProvider && (
                                    <div className="order-service-provider">
                                      <strong>Service Provider:</strong> {order.serviceProvider.name} 
                                      {order.serviceProvider.company && ` (${order.serviceProvider.company})`}
                                    </div>
                                  )}
                                  <div className="order-amount">
                                    <strong>Amount:</strong> ₹{order.totalAmount?.toLocaleString('en-IN') || '0'}
                                  </div>
                                  <div className="order-items">
                                    <strong>Items:</strong> {order.items || 0}
                                  </div>
                                  {order.createdAt && (
                                    <div className="order-date">
                                      <strong>Date:</strong> {new Date(order.createdAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="supplier-orders-empty">
                            <p>No orders found</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Pending Products Tab Component
const PendingProductsTab = ({ pendingProducts, onProductClick, onRefresh }) => {
  const [loading, setLoading] = useState(false);

  const handleApprove = async (product) => {
    if (!confirm(`Are you sure you want to approve "${product.name}"?`)) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product._id || product.id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/approve`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        alert('Product approved successfully!');
        if (onRefresh) onRefresh();
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to approve product');
      }
    } catch (error) {
      console.error('Error approving product:', error);
      alert('Error approving product');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (product) => {
    const reason = prompt(`Enter rejection reason for "${product.name}":`);
    if (!reason || !reason.trim()) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product._id || product.id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/reject`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: reason.trim() })
      });

      if (response.ok) {
        alert('Product rejected');
        if (onRefresh) onRefresh();
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to reject product');
      }
    } catch (error) {
      console.error('Error rejecting product:', error);
      alert('Error rejecting product');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAll = async () => {
    if (!confirm(`Are you sure you want to approve all pending products? This will approve all existing products that are not already approved or rejected.`)) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/products/approve-all'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (data.status === 'success') {
        alert(`Successfully approved ${data.approvedCount} product(s)! Please refresh the page to see the updated status.`);
        // Refresh immediately
        if (onRefresh) {
          onRefresh();
          // Also refresh the page after a short delay to ensure data is updated
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      } else {
        alert(data.message || 'Failed to approve products');
      }
    } catch (error) {
      console.error('Error approving all products:', error);
      alert('Error approving products: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/products/status-check'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (data.status === 'success') {
        const message = `Product Status Check:\n\n` +
          `Total Products: ${data.totalProducts}\n` +
          `Approved: ${data.statusCounts.approved}\n` +
          `Pending: ${data.statusCounts.pending}\n` +
          `Rejected: ${data.statusCounts.rejected}\n` +
          `Null/Undefined: ${data.statusCounts.null + data.statusCounts.undefined}\n` +
          `Empty: ${data.statusCounts.empty}\n` +
          `Other: ${data.statusCounts.other}`;
        alert(message);
        console.log('All products:', data.products);
      }
    } catch (error) {
      console.error('Error checking status:', error);
      alert('Error checking product status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pending-products-content">
      <div className="pending-products-header">
        <div>
          <h2>Pending Product Approvals</h2>
          <p>{pendingProducts.length} product{pendingProducts.length !== 1 ? 's' : ''} waiting for approval</p>
          {pendingProducts.length === 0 && (
            <p style={{ 
              marginTop: '0.5rem', 
              color: '#64748b', 
              fontSize: '0.875rem',
              fontStyle: 'italic'
            }}>
              No pending products found. All products are approved or you may need to refresh.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn-approve" 
            onClick={handleApproveAll}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              background: '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            <Check size={16} />
            Approve All Pending
          </button>
          <button 
            onClick={handleCheckStatus}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            <Package size={16} />
            Check Status
          </button>
          <button 
            className="btn-refresh" 
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {pendingProducts.length === 0 ? (
        <div className="empty-state">
          <CheckCircle size={48} color="#059669" />
          <p>No pending products</p>
          <p className="empty-state-subtitle">All products have been reviewed</p>
        </div>
      ) : (
        <div className="pending-products-list">
          {pendingProducts.map((product) => {
            const supplier = product.supplier || {};
            return (
              <div key={product._id || product.id} className="pending-product-card">
                <div className="pending-product-main">
                  <div className="pending-product-info">
                    <div className="pending-product-header-row">
                      <h3 className="pending-product-name">{product.name}</h3>
                      <span className="product-status-badge status-pending">Pending</span>
                    </div>
                    <div className="pending-product-details">
                      <div className="pending-product-meta">
                        <span className="meta-item">
                          <Tag size={14} />
                          {product.category}
                        </span>
                        <span className="meta-item">
                          ₹{product.price?.toLocaleString('en-IN') || '0'} / {product.unit}
                        </span>
                        <span className="meta-item">
                          <Box size={14} />
                          Stock: {product.stock || 0}
                        </span>
                        {product.location && (
                          <span className="meta-item">
                            📍 {product.location}
                          </span>
                        )}
                      </div>
                      {product.description && (
                        <p className="pending-product-description">{product.description}</p>
                      )}
                      <div className="pending-product-supplier">
                        <strong>Supplier:</strong> {supplier.name || supplier.company || 'Unknown'}
                        {supplier.email && ` (${supplier.email})`}
                      </div>
                      {product.createdAt && (
                        <div className="pending-product-date">
                          <Clock size={14} />
                          Submitted: {new Date(product.createdAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="pending-product-actions">
                  <button
                    className="btn-view-details"
                    onClick={() => onProductClick && onProductClick(product)}
                  >
                    <Eye size={16} />
                    View Details
                  </button>
                  <button
                    className="btn-approve"
                    onClick={() => handleApprove(product)}
                    disabled={loading}
                  >
                    <Check size={16} />
                    Approve
                  </button>
                  <button
                    className="btn-reject"
                    onClick={() => handleReject(product)}
                    disabled={loading}
                  >
                    <Ban size={16} />
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ServiceProvidersTab = ({ serviceProviderData }) => {
  const [expandedProviders, setExpandedProviders] = useState({});
  const [viewMode, setViewMode] = useState('boqs'); // 'boqs' or 'orders'

  const toggleProvider = (providerId) => {
    setExpandedProviders(prev => ({
      ...prev,
      [providerId]: !prev[providerId]
    }));
  };

  return (
    <div className="service-providers-content">
      <div className="providers-header-controls">
        <div className="view-mode-toggle">
          <button 
            className={viewMode === 'boqs' ? 'active' : ''}
            onClick={() => {
              console.log('🔄 [ADMIN DASHBOARD] Switching to BOQs view');
              setViewMode('boqs');
            }}
          >
            BOQs View
          </button>
          <button 
            className={viewMode === 'orders' ? 'active' : ''}
            onClick={() => {
              console.log('🔄 [ADMIN DASHBOARD] Switching to Orders view');
              setViewMode('orders');
            }}
          >
            Orders View
          </button>
        </div>
      </div>
      
      {!serviceProviderData || serviceProviderData.length === 0 ? (
        <div className="empty-state">
          <Building size={48} />
          <p>No service providers found</p>
        </div>
      ) : (
        <div className="providers-list">
          {serviceProviderData.map((provider, index) => {
            const providerId = provider._id || provider.id || index;
            const isExpanded = expandedProviders[providerId];
            const boqCount = provider.boqs?.length || 0;
            const orderCount = provider.orders?.length || 0;
            const totalSpent = provider.totalSpent || 0;
            const activeOrders = provider.activeOrders || 0;
            const activeBOQs = provider.activeBOQs || 0;
            
            return (
              <div key={providerId} className="provider-card">
                <div 
                  className="provider-header"
                  onClick={() => toggleProvider(providerId)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="provider-info">
                    <div className="provider-avatar">
                      {(provider.name || 'SP').charAt(0).toUpperCase()}
                    </div>
                    <div className="provider-details">
                      <div className="provider-name">{provider.name}</div>
                      <div className="provider-company">{provider.company || provider.email}</div>
                      <div className="provider-meta">
                        <span>{boqCount} BOQ{boqCount !== 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>{orderCount} order{orderCount !== 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>₹{totalSpent.toLocaleString('en-IN')} spent</span>
                        {provider.suppliersWorkedWith > 0 && (
                          <>
                            <span>•</span>
                            <span>{provider.suppliersWorkedWith} supplier{provider.suppliersWorkedWith !== 1 ? 's' : ''}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="provider-stats">
                    <div className="stat-item">
                      <span className="stat-label">Active Orders</span>
                      <span className="stat-value">{activeOrders}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Active BOQs</span>
                      <span className="stat-value">{activeBOQs}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Total BOQ Value</span>
                      <span className="stat-value">₹{(provider.totalBOQValue || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                  <div className="expand-icon">
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="provider-expanded-content">
                    {viewMode === 'boqs' ? (
                      <div key="boqs-view">
                        <h4 style={{ color: '#4f46e5', marginBottom: '1rem' }}>BOQs ({boqCount})</h4>
                        {provider.boqs && provider.boqs.length > 0 ? (
                          <div className="provider-boqs">
                            {provider.boqs.map((boq, idx) => (
                              <div key={boq._id || boq.id || idx} className="boq-item">
                                <div className="boq-item-header">
                                  <span className="boq-name">{boq.name}</span>
                                  <span className={`status-badge ${boq.status}`}>
                                    {boq.status}
                                  </span>
                                </div>
                                <div className="boq-item-details">
                                  {boq.description && (
                                    <div className="boq-description">{boq.description}</div>
                                  )}
                                  <div className="boq-stats">
                                    <span>Items: {boq.itemCount || 0}</span>
                                    <span>•</span>
                                    <span>Value: ₹{(boq.totalValue || 0).toLocaleString('en-IN')}</span>
                                    {boq.createdAt && (
                                      <>
                                        <span>•</span>
                                        <span>Created: {new Date(boq.createdAt).toLocaleDateString()}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="provider-boqs-empty">
                            <p>No BOQs found for this service provider</p>
                          </div>
                        )}
                      </div>
                    ) : viewMode === 'orders' ? (
                      <div key="orders-view">
                        <h4 style={{ color: '#4f46e5', marginBottom: '1rem' }}>Orders ({orderCount})</h4>
                        {provider.orders && provider.orders.length > 0 ? (
                          <div className="provider-orders">
                            {provider.orders.map((order, idx) => (
                              <div key={order.orderNumber || order._id || idx} className="order-item">
                                <div className="order-item-header">
                                  <span className="order-number">#{order.orderNumber}</span>
                                  <span className={`status-badge ${order.status}`}>
                                    {order.status}
                                  </span>
                                </div>
                                <div className="order-item-details">
                                  {order.supplier && (
                                    <div className="order-supplier">
                                      <strong>Supplier:</strong> {order.supplier.name} 
                                      {order.supplier.company && ` (${order.supplier.company})`}
                                    </div>
                                  )}
                                  <div className="order-amount">
                                    <strong>Amount:</strong> ₹{order.totalAmount?.toLocaleString('en-IN') || '0'}
                                  </div>
                                  <div className="order-items">
                                    <strong>Items:</strong> {order.items || 0}
                                  </div>
                                  {order.createdAt && (
                                    <div className="order-date">
                                      <strong>Date:</strong> {new Date(order.createdAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="provider-orders-empty">
                            <p>No orders found for this service provider</p>
                          </div>
                    )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;