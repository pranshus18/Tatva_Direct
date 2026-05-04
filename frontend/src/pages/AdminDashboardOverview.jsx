import { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import { 
  Users, 
  Building, 
  ShoppingCart, 
  TrendingUp, 
  FileText,
  Package,
  RefreshCw
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';

const AdminDashboardOverview = ({ user }) => {
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminData();
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
      
      if (result.status === 'success') {
        const data = result.data;
        setStats(data.stats);
      } else {
        console.error('Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  };

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
        </div>
        <div className="admin-actions">
          <AdminNotifications />
          <button 
            className="btn-refresh" 
            onClick={fetchAdminData}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh Data
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
            <h3>{stats.totalRevenue.toLocaleString()}</h3>
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
            <h3>{stats.totalInventoryValue?.toLocaleString()}</h3>
            <p>Inventory Value</p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default AdminDashboardOverview;
