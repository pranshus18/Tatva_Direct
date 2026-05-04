import { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
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

const AdminUsers = ({ user }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

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
      } else {
        console.error('Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
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
