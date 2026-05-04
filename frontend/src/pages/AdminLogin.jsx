import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, LogIn, Shield } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import { getApiUrl } from '../config/api';
import './Auth.css';

const AdminLogin = ({ onLogin }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(getApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        // Verify that the user is actually an admin
        if (data.user.userType !== 'admin') {
          setError('Access denied. This is an admin-only login page.');
          setLoading(false);
          return;
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        onLogin(data.user);
        navigate('/admin-dashboard');
      } else {
        setError(data.message || 'Login failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container admin-login-container">
      <div className="auth-card admin-login-card">
        <div className="auth-header">
          <img src={tatvaLogo} alt="Tatva Direct" className="auth-logo" />
          <div className="admin-badge-header">
            <Shield size={24} />
            <span>Admin Portal</span>
          </div>
          <h1>Admin Access</h1>
          <p>Sign in to access the admin dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Admin Email</label>
            <div className="input-wrapper">
              <Mail size={20} className="input-icon" />
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Enter admin email"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <Lock size={20} className="input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter admin password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button type="submit" className="auth-button admin-login-button" disabled={loading}>
            {loading ? (
              <div className="spinner" />
            ) : (
              <>
                <Shield size={20} />
                Sign In as Admin
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Not an admin?{' '}
            <Link to="/login" className="auth-link">
              Regular login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
