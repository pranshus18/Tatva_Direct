import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { FileText, Users, RefreshCw, ShoppingCart, User, LogOut, ChevronDown, BarChart3, Package, Building, CheckCircle, TrendingUp, Wallet, Network, Tag, UserCheck, Table2, Search } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import { normalizeUserType } from '../utils/userType';
import './Layout.css';

const Layout = ({ user, onLogout, children }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const location = useLocation();
  const userType = normalizeUserType(user?.userType);
  

  const steps = [
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
      { path: '/supplier-select', label: 'Supplier Select', icon: Users },
      { path: '/substitution', label: 'Substitution', icon: RefreshCw },
      { path: '/cart', label: 'Cart', icon: ShoppingCart },
      { path: '/create-po', label: 'Create PO', icon: ShoppingCart },
      { path: '/your-orders', label: 'Your Orders', icon: ShoppingCart },
      { path: '/returns', label: 'Returns', icon: RefreshCw }
    ] : [])
  ];

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="logo">
          <img src={tatvaLogo} alt="Tatva Direct" className="logo-image" />
        </div>
        <div className="nav-steps">
          {steps.map(({ path, label, icon: Icon }) => {
            const isActive = location.pathname === path;
            
            return (
              <div
                key={path + label}
                className="nav-step-wrapper"
              >
                <NavLink 
                  to={path} 
                  className={`nav-step ${isActive ? 'active' : ''}`}
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
};

export default Layout;
