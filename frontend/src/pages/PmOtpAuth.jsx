import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Phone, ShieldCheck, ArrowRight } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import { PM_SAMPLE_PHONE } from '../config/pmAuth';
import { completePmAuth, sendPmOtp, verifyPmOtp, restorePmVaultSession } from '../services/pmAuthService';
import { syncPortalUser } from '../services/portalService';
import { isPmAuthenticated, getPmAuthSession, setPmAuthSession, clearPmOtpSession, setPmCustomerCredentials } from '../utils/pmAuthSession';
import { normalizeUser } from '../utils/userType';
import './Auth.css';

const RESEND_COOLDOWN_SEC = 30;

function extractPmAuthContext(pmData, verifiedPhone) {
  if (!pmData || typeof pmData !== 'object') {
    return {
      pmProfile: { phoneNumber: verifiedPhone },
      pmAccessToken: null,
      pmRefreshToken: null
    };
  }

  const payload = pmData.data && typeof pmData.data === 'object' ? pmData.data : pmData;
  const pmUser = payload.user || null;
  const tokens = payload.tokens || payload.tokenPair || {};
  const pmAccessToken =
    tokens.accessToken ||
    tokens.access_token ||
    payload.accessToken ||
    payload.access_token ||
    null;
  const pmRefreshToken =
    tokens.refreshToken ||
    tokens.refresh_token ||
    payload.refreshToken ||
    payload.refresh_token ||
    null;

  const pmProfile = pmUser
    ? {
        pmUserId: pmUser._id || pmUser.id || undefined,
        fullName: pmUser.fullName || pmUser.name || undefined,
        userName: pmUser.userName || pmUser.username || undefined,
        email: pmUser.email || undefined,
        phoneNumber: pmUser.phoneNumber || pmUser.phone || verifiedPhone,
        status: pmUser.status || undefined,
        isEmailVerified: pmUser.isEmailVerified === true,
        flag: pmUser.flag || undefined,
        role: pmUser.role || undefined,
        isVendor: payload.isVendor === true
      }
    : { phoneNumber: verifiedPhone };

  return {
    pmProfile,
    pmAccessToken,
    pmRefreshToken
  };
}

const PmOtpAuth = ({ onLogin }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState('phone');
  const [phoneNumber, setPhoneNumber] = useState(PM_SAMPLE_PHONE);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const finishPmAuth = async (verifiedPhone, pmData = null) => {
    setPmAuthSession({
      phoneNumber: verifiedPhone,
      data: pmData
    });

    const { pmProfile, pmAccessToken, pmRefreshToken } = extractPmAuthContext(pmData, verifiedPhone);

    if (pmAccessToken || pmRefreshToken || pmProfile?.pmUserId) {
      setPmCustomerCredentials({
        accessToken: pmAccessToken,
        refreshToken: pmRefreshToken,
        pmUserId: pmProfile?.pmUserId
      });
    }

    const authResult = await completePmAuth(verifiedPhone, pmProfile, pmAccessToken, pmRefreshToken);

    if (authResult.token && authResult.user) {
      localStorage.setItem('token', authResult.token);
      if (authResult.pmVault?.accessToken) {
        setPmCustomerCredentials(authResult.pmVault);
      }
      let normalizedUser = normalizeUser(authResult.user);

      try {
        normalizedUser = await syncPortalUser(normalizedUser);
      } catch {
        // Keep auth result if portal status sync fails.
      }

      localStorage.setItem('user', JSON.stringify(normalizedUser));
      clearPmOtpSession();
      await onLogin(normalizedUser);
      navigate('/dashboard', { replace: true });
      return;
    }

    throw new Error('Could not sign in after OTP verification');
  };

  useEffect(() => {
    const existingToken = localStorage.getItem('token');
    if (existingToken || !isPmAuthenticated()) return undefined;

    let cancelled = false;

    const resumePmAuth = async () => {
      setLoading(true);
      try {
        const session = getPmAuthSession();
        if (!session?.phoneNumber || cancelled) return;
        await finishPmAuth(session.phoneNumber, session.data);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not resume sign-in');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    resumePmAuth();

    return () => {
      cancelled = true;
    };
    // Resume only once on mount when PM session already exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendIn((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await sendPmOtp(phoneNumber);
      setStep('otp');
      setOtp('');
      setResendIn(RESEND_COOLDOWN_SEC);
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await verifyPmOtp(phoneNumber, otp);
      await finishPmAuth(phoneNumber, result.data ?? result);
    } catch (err) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    setError('');

    try {
      await sendPmOtp(phoneNumber);
      setResendIn(RESEND_COOLDOWN_SEC);
    } catch (err) {
      setError(err.message || 'Failed to resend OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img src={tatvaLogo} alt="Tatva Direct" className="auth-logo" />
          <h1>Sign In with Phone</h1>
          <p>Verify your mobile number to access Tatva Direct</p>
        </div>

        {step === 'phone' ? (
          <form onSubmit={handleSendOtp} className="auth-form">
            {error && <div className="error-message">{error}</div>}

            <div className="form-group">
              <label htmlFor="phoneNumber">Phone Number</label>
              <div className="input-wrapper">
                <Phone size={20} className="input-icon" />
                <input
                  type="tel"
                  id="phoneNumber"
                  name="phoneNumber"
                  value={phoneNumber}
                  onChange={(e) => {
                    setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10));
                    setError('');
                  }}
                  placeholder="10-digit mobile number"
                  inputMode="numeric"
                  autoComplete="tel"
                  required
                />
              </div>
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? (
                <div className="spinner" />
              ) : (
                <>
                  <ArrowRight size={20} />
                  Send OTP
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="auth-form">
            {error && <div className="error-message">{error}</div>}

            <p className="otp-hint">
              OTP sent to <strong>+91 {phoneNumber}</strong>
            </p>

            <div className="form-group">
              <label htmlFor="otp">One-Time Password</label>
              <div className="input-wrapper">
                <ShieldCheck size={20} className="input-icon" />
                <input
                  type="text"
                  id="otp"
                  name="otp"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setError('');
                  }}
                  placeholder="Enter 6-digit OTP"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </div>
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? (
                <div className="spinner" />
              ) : (
                <>
                  <ShieldCheck size={20} />
                  Verify &amp; Continue
                </>
              )}
            </button>

            <div className="otp-actions">
              <button
                type="button"
                className="otp-link-button"
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setError('');
                }}
                disabled={loading}
              >
                Change number
              </button>
              <button
                type="button"
                className="otp-link-button"
                onClick={handleResendOtp}
                disabled={loading || resendIn > 0}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend OTP'}
              </button>
            </div>
          </form>
        )}

        <div className="auth-footer">
          <p>
            <Link to="/admin-login" className="auth-link admin-link">
              Admin Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default PmOtpAuth;
