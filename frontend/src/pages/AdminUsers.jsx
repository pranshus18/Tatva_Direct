import { useState, useEffect } from 'react';
import { authFetch } from '../config/api';
import { 
  Users, 
  Search, 
  Eye,
  CheckCircle,
  Clock,
  RefreshCw
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';

const ADMIN_DASHBOARD_CACHE_KEY = 'admin_dashboard_cache_v1';
const ADMIN_DASHBOARD_CACHE_TTL_MS = 60 * 1000;

const AdminUsers = ({ user }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const removeTestUsers = (allUsers = []) =>
    (allUsers || []).filter((user) => {
      const email = user.email?.toLowerCase() || '';
      const name = user.name?.toLowerCase() || '';

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

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ADMIN_DASHBOARD_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        const isFresh = cached?.savedAt && Date.now() - Number(cached.savedAt) <= ADMIN_DASHBOARD_CACHE_TTL_MS;
        if (isFresh && Array.isArray(cached?.data?.users)) {
          setUsers(removeTestUsers(cached.data.users));
          setLoading(false);
          fetchAdminData({ silent: true });
          return;
        }
      }
    } catch (_e) {
      // Ignore cache parse errors and fallback to network fetch.
    }
    fetchAdminData();
  }, []);

  const fetchAdminData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await authFetch('/api/admin/dashboard', {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });
      const result = await response.json();
      
      if (result.status === 'success') {
        const data = result.data;
        setUsers(removeTestUsers(data.users || []));
        try {
          sessionStorage.setItem(
            ADMIN_DASHBOARD_CACHE_KEY,
            JSON.stringify({ savedAt: Date.now(), data })
          );
        } catch (_e) {
          // Ignore cache write failures.
        }
      } else {
        console.error('Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleRefresh = () => {
    setSearchTerm('');
    setFilterType('all');
    fetchAdminData();
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = (user.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (user.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (user.company || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || user.userType === filterType;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading users...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Users Management</h1>
          <p>View and manage all platform users</p>
        </div>
        <div className="admin-actions">
          <AdminNotifications />
          <button 
            className="btn-refresh" 
            onClick={handleRefresh}
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

      <div className="admin-content">
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
                {filteredUsers.map((user) => (
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
      </div>
    </div>
  );
};

export default AdminUsers;
