import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Building, UserPlus, Briefcase, Truck } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import { getApiUrl } from '../config/api';
import './Auth.css';

const Signup = ({ onLogin }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    userType: '', // No default selection
    password: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(getApiUrl('/api/auth/signup'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          company: formData.company,
          userType: formData.userType,
          password: formData.password
        })
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        onLogin(data.user);
        
        // Redirect based on user type
        if (data.user.userType === 'supplier') {
          // Go directly to supplier dashboard; skip any setup form
          navigate('/supplier-dashboard');
        } else {
          navigate('/boq-normalize');
        }
      } else {
        setError(data.message || 'Signup failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img src={tatvaLogo} alt="Tatva Direct" className="auth-logo" />
          <h1>Create Account</h1>
          <p>Join Tatva Direct for smart procurement</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <div className="input-wrapper">
              <User size={20} className="input-icon" />
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter your full name"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <div className="input-wrapper">
              <Mail size={20} className="input-icon" />
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Enter your email"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="company">Company Name</label>
            <div className="input-wrapper">
              <Building size={20} className="input-icon" />
              <input
                type="text"
                id="company"
                name="company"
                value={formData.company}
                onChange={handleChange}
                placeholder="Enter your company name"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Account Type (Optional)</label>
            <div className="user-type-selection">
              <div 
                className={`user-type-option ${formData.userType === 'service_provider' ? 'selected' : ''}`}
                onClick={() => setFormData({...formData, userType: 'service_provider'})}
              >
                <div className="user-type-icon">
                  <Briefcase size={24} />
                </div>
                <div className="user-type-content">
                  <h3>Service Provider</h3>
                  <p>I need procurement services and want to create BOQs</p>
                </div>
                <input
                  type="radio"
                  name="userType"
                  value="service_provider"
                  checked={formData.userType === 'service_provider'}
                  onChange={handleChange}
                  hidden
                />
              </div>

              <div 
                className={`user-type-option ${formData.userType === 'supplier' ? 'selected' : ''}`}
                onClick={() => setFormData({...formData, userType: 'supplier'})}
              >
                <div className="user-type-icon">
                  <Truck size={24} />
                </div>
                <div className="user-type-content">
                  <h3>Supplier</h3>
                  <p>I supply materials and want to receive purchase orders</p>
                </div>
                <input
                  type="radio"
                  name="userType"
                  value="supplier"
                  checked={formData.userType === 'supplier'}
                  onChange={handleChange}
                  hidden
                />
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
              You can skip this and select your role later from your profile
            </p>
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
                placeholder="Create a password"
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

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <div className="input-wrapper">
              <Lock size={20} className="input-icon" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Confirm your password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? (
              <div className="spinner" />
            ) : (
              <>
                <UserPlus size={20} />
                Create Account
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-link">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signup;