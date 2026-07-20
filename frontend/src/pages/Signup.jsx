import React, { useEffect, useState } from 'react';
import { User, Building, UserPlus, Briefcase, Truck, Mail, Phone } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import { getApiUrl } from '../config/api';
import { normalizeUser } from '../utils/userType';
import { getPostAuthRedirectPath } from '../utils/authRedirect';
import { getPmAuthSession, isPmAuthenticated, getPmCustomerCredentials } from '../utils/pmAuthSession';
import './Auth.css';

const Signup = ({ onLogin }) => {
  const pmSession = getPmAuthSession();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    userType: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isPmAuthenticated()) {
      window.location.replace('/pm-auth');
    }
  }, []);

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

    if (!formData.userType) {
      setError('Please select whether you are a Service Provider or Supplier');
      setLoading(false);
      return;
    }

    try {
      const pmCredentials = getPmCustomerCredentials();
      const response = await fetch(getApiUrl('/api/auth/pm-signup'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          company: formData.company,
          userType: formData.userType,
          phoneNumber: pmSession?.phoneNumber,
          pmAccessToken: pmCredentials.accessToken || undefined,
          pmRefreshToken: pmCredentials.refreshToken || undefined,
          pmProfile: pmCredentials.pmUserId
            ? {
                pmUserId: pmCredentials.pmUserId,
                phoneNumber: pmSession?.phoneNumber
              }
            : undefined
        })
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        const normalizedUser = normalizeUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(normalizedUser));
        await onLogin(normalizedUser);
        window.location.replace(getPostAuthRedirectPath(normalizedUser.userType));
      } else {
        setError(data.message || 'Signup failed');
      }
    } catch (err) {
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
          <h1>Complete Your Profile</h1>
          <p>Tell us who you are to finish setting up your account</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {pmSession?.phoneNumber && (
            <div className="form-group">
              <label htmlFor="verifiedPhone">Verified Phone</label>
              <div className="input-wrapper">
                <Phone size={20} className="input-icon" />
                <input
                  type="tel"
                  id="verifiedPhone"
                  name="verifiedPhone"
                  value={`+91 ${pmSession.phoneNumber}`}
                  readOnly
                />
              </div>
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
            <label>I am a *</label>
            <div className="user-type-selection">
              <div
                className={`user-type-option ${formData.userType === 'service_provider' ? 'selected' : ''}`}
                onClick={() => setFormData({ ...formData, userType: 'service_provider' })}
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
                onClick={() => setFormData({ ...formData, userType: 'supplier' })}
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
      </div>
    </div>
  );
};

export default Signup;
