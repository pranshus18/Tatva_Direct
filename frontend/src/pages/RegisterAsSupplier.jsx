import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import { getApiUrl } from '../config/api';
import { registerAsSupplier, persistPortalAuthResult } from '../services/portalService';
import { verifyPmGst } from '../services/pmGstService';
import { isSupplierRegistered, isPmPlaceholderEmail } from '../utils/portalRoles';
import { getPmAuthSession, getVerifiedServiceProviderPhone } from '../utils/pmAuthSession';
import './RegisterAsSupplier.css';
import './Auth.css';

const emptyForm = () => ({
  phoneNumber: '',
  email: '',
  gstNo: '',
  companyName: '',
  legalName: '',
  companyType: '',
  designation: '',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  businessAddress: '',
  panNo: '',
  accountHolderName: '',
  accountType: '',
  branch: ''
});

const RegisterAsSupplier = ({ user, onPortalChange }) => {
  const [formData, setFormData] = useState(emptyForm());
  const [additionalGstNumbers, setAdditionalGstNumbers] = useState([]);
  const [files, setFiles] = useState({
    gstCertificate: null,
    panCardFile: null,
    cancelledChequeFile: null
  });
  const [loading, setLoading] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(true);
  const [gstVerifying, setGstVerifying] = useState(false);
  const [gstVerified, setGstVerified] = useState(false);
  const [gstVerifyMessage, setGstVerifyMessage] = useState('');
  const [error, setError] = useState('');
  const gstVerifyTimerRef = useRef(null);
  const lastVerifiedGstRef = useRef('');

  const applyGstVerification = (result) => {
    setFormData((prev) => ({
      ...prev,
      gstNo: result.gstNo || prev.gstNo,
      companyName: result.companyName || prev.companyName,
      legalName: result.legalName || prev.legalName,
      companyType: result.companyType || prev.companyType,
      panNo: result.panNo || prev.panNo,
      businessAddress: result.businessAddress || prev.businessAddress
    }));
    setGstVerified(true);
    setGstVerifyMessage('GST verified. Company details auto-filled.');
  };

  const runGstVerification = async (rawGstNo) => {
    const normalizedGst = String(rawGstNo || '')
      .trim()
      .toUpperCase()
      .replace(/\s/g, '');

    if (normalizedGst.length !== 15) {
      setGstVerified(false);
      setGstVerifyMessage('');
      lastVerifiedGstRef.current = '';
      return;
    }

    if (lastVerifiedGstRef.current === normalizedGst) {
      return;
    }

    setGstVerifying(true);
    setGstVerifyMessage('');
    setError('');

    try {
      const result = await verifyPmGst(normalizedGst);
      lastVerifiedGstRef.current = normalizedGst;
      applyGstVerification(result);
    } catch (verifyError) {
      lastVerifiedGstRef.current = '';
      setGstVerified(false);
      setGstVerifyMessage(verifyError.message || 'Could not verify GST number');
    } finally {
      setGstVerifying(false);
    }
  };

  const queueGstVerification = (rawGstNo) => {
    if (gstVerifyTimerRef.current) {
      clearTimeout(gstVerifyTimerRef.current);
    }

    const normalizedGst = String(rawGstNo || '')
      .trim()
      .toUpperCase()
      .replace(/\s/g, '');

    if (normalizedGst.length !== 15) {
      setGstVerified(false);
      setGstVerifyMessage('');
      lastVerifiedGstRef.current = '';
      return;
    }

    gstVerifyTimerRef.current = setTimeout(() => {
      runGstVerification(normalizedGst);
    }, 450);
  };

  useEffect(
    () => () => {
      if (gstVerifyTimerRef.current) {
        clearTimeout(gstVerifyTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (isSupplierRegistered(user)) {
      window.location.replace('/supplier-dashboard');
      return;
    }

    const pmSession = getPmAuthSession();
    const loadPrefill = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(getApiUrl('/api/profile'), {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const data = await response.json().catch(() => ({}));
        const profile = data.profile || {};
        const email = profile.email || user?.email || '';

        setFormData((prev) => ({
          ...prev,
          phoneNumber: profile.phone || user?.phone || pmSession?.phoneNumber || '',
          email: isPmPlaceholderEmail(email) ? '' : email,
          designation: profile.designation || '',
          gstNo: profile.gstin || profile.mainGstin || '',
          businessAddress:
            profile.address?.line1 ||
            [profile.address?.line1, profile.address?.city, profile.address?.state, profile.address?.pincode]
              .filter(Boolean)
              .join(', ') ||
            ''
        }));

        const initialGst = String(profile.gstin || profile.mainGstin || '').trim();
        if (initialGst.length === 15) {
          await runGstVerification(initialGst);
        }
      } catch {
        setFormData((prev) => ({
          ...prev,
          phoneNumber: user?.phone || pmSession?.phoneNumber || '',
          email: isPmPlaceholderEmail(user?.email) ? '' : (user?.email || '')
        }));
      } finally {
        setPrefillLoading(false);
      }
    };

    loadPrefill();
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'gstNo') {
      const normalizedGst = value.toUpperCase().replace(/\s/g, '').slice(0, 15);
      setFormData((prev) => ({ ...prev, gstNo: normalizedGst }));
      setError('');
      queueGstVerification(normalizedGst);
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleGstBlur = () => {
    if (formData.gstNo.length === 15) {
      runGstVerification(formData.gstNo);
    }
  };

  const handleFileChange = (name, file) => {
    setFiles((prev) => ({ ...prev, [name]: file }));
    setError('');
  };

  const addAdditionalGst = () => {
    setAdditionalGstNumbers((prev) => [...prev, '']);
  };

  const updateAdditionalGst = (index, value) => {
    setAdditionalGstNumbers((prev) =>
      prev.map((item, i) => (i === index ? value.toUpperCase() : item))
    );
  };

  const removeAdditionalGst = (index) => {
    setAdditionalGstNumbers((prev) => prev.filter((_, i) => i !== index));
  };

  const verifiedPhone = getVerifiedServiceProviderPhone(user, formData.phoneNumber);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const activePhone = getVerifiedServiceProviderPhone(user, formData.phoneNumber);
      if (!activePhone || activePhone.length !== 10) {
        throw new Error('Sign in with your Service Provider phone number before registering as a supplier.');
      }

      if (!files.gstCertificate || !files.panCardFile || !files.cancelledChequeFile) {
        throw new Error('Please upload GST Certificate, PAN Card, and Cancelled Cheque.');
      }

      const normalizedGst = formData.gstNo.trim().toUpperCase().replace(/\s/g, '');
      if (normalizedGst.length === 15) {
        if (lastVerifiedGstRef.current !== normalizedGst) {
          await runGstVerification(normalizedGst);
        }
        if (lastVerifiedGstRef.current !== normalizedGst) {
          throw new Error('Please enter a valid GST number before submitting.');
        }
      }

      const payload = new FormData();
      payload.append('phoneNumber', activePhone);
      payload.append('email', formData.email.trim());
      payload.append('gstNo', formData.gstNo.trim().toUpperCase());
      payload.append('companyName', formData.companyName.trim());
      if (formData.legalName.trim()) {
        payload.append('legalName', formData.legalName.trim());
      }
      payload.append('companyType', formData.companyType.trim());
      payload.append('designation', formData.designation.trim());
      payload.append('bankName', formData.bankName.trim());
      payload.append('accountNumber', formData.accountNumber.trim());
      payload.append('ifscCode', formData.ifscCode.trim().toUpperCase());
      payload.append('businessAddress', formData.businessAddress.trim());
      payload.append(
        'additionalGstNumbers',
        JSON.stringify(additionalGstNumbers.map((g) => g.trim().toUpperCase()).filter(Boolean))
      );

      if (formData.panNo.trim()) payload.append('panNo', formData.panNo.trim().toUpperCase());
      if (formData.accountHolderName.trim()) {
        payload.append('accountHolderName', formData.accountHolderName.trim());
      }
      if (formData.accountType.trim()) {
        payload.append('accountType', formData.accountType.trim().toLowerCase());
      }
      if (formData.branch.trim()) payload.append('branch', formData.branch.trim());

      payload.append('gstCertificate', files.gstCertificate);
      payload.append('panCardFile', files.panCardFile);
      payload.append('cancelledChequeFile', files.cancelledChequeFile);

      const data = await registerAsSupplier(payload, { user });
      const nextUser = persistPortalAuthResult(data);
      await onPortalChange?.(nextUser);
    } catch (err) {
      setError(err.message || 'Supplier registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (prefillLoading) {
    return (
      <div className="vendor-register-container">
        <div className="vendor-register-card">
          <div className="vendor-register-header">
            <div className="spinner" />
            <p>Loading registration form...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vendor-register-container">
      <div className="vendor-register-card">
        <div className="vendor-register-header">
          <img src={tatvaLogo} alt="Tatva Direct" className="auth-logo" />
          <h1>Register as a Supplier</h1>
          <p>Welcome to Tatva</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error ? <div className="vendor-error">{error}</div> : null}

          <div className="vendor-field">
            <label htmlFor="phoneNumber">Phone Number</label>
            <input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              value={verifiedPhone || formData.phoneNumber}
              readOnly
              placeholder="Same number used for Service Provider login"
              required
            />
            <p className="vendor-field-hint">
              Supplier registration uses the same verified phone as your Service Provider account.
            </p>
          </div>

          <div className="vendor-field">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Enter your Email"
              required
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="gstNo">GST Number</label>
            <div className="vendor-gst-verify-row">
              <input
                id="gstNo"
                name="gstNo"
                type="text"
                value={formData.gstNo}
                onChange={handleChange}
                onBlur={handleGstBlur}
                placeholder="GST NUMBER"
                maxLength={15}
                required
              />
              {gstVerifying ? (
                <span className="vendor-gst-verify-status" aria-live="polite">
                  <Loader2 className="vendor-gst-spinner" size={16} />
                  Verifying...
                </span>
              ) : null}
            </div>
            {gstVerifyMessage ? (
              <p className={`vendor-gst-hint ${gstVerified ? 'is-success' : 'is-error'}`}>
                {gstVerifyMessage}
              </p>
            ) : (
              <p className="vendor-gst-hint">Company name and legal name auto-fill after GST verification.</p>
            )}
          </div>

          <div className="vendor-field">
            <label>Additional GST Numbers (Optional)</label>
            {additionalGstNumbers.map((gst, index) => (
              <div key={`gst-${index}`} className="vendor-gst-row">
                <input
                  type="text"
                  value={gst}
                  onChange={(e) => updateAdditionalGst(index, e.target.value)}
                  placeholder="Additional GST No"
                  maxLength={15}
                />
                <button
                  type="button"
                  className="vendor-remove-btn"
                  onClick={() => removeAdditionalGst(index)}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="vendor-add-gst-btn" onClick={addAdditionalGst}>
              <Plus size={16} style={{ display: 'inline', verticalAlign: 'middle' }} /> Add additional GST No
            </button>
          </div>

          <div className="vendor-field">
            <label htmlFor="companyName">Company Name</label>
            <input
              id="companyName"
              name="companyName"
              type="text"
              value={formData.companyName}
              onChange={handleChange}
              placeholder="Company Name"
              required
              readOnly={gstVerified}
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="legalName">Legal Name</label>
            <input
              id="legalName"
              name="legalName"
              type="text"
              value={formData.legalName}
              onChange={handleChange}
              placeholder="Legal Name"
              required
              readOnly={gstVerified}
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="companyType">Company Type</label>
            <input
              id="companyType"
              name="companyType"
              type="text"
              value={formData.companyType}
              onChange={handleChange}
              placeholder="Company Type (e.g. Private Limited)"
              required
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="designation">Designation</label>
            <input
              id="designation"
              name="designation"
              type="text"
              value={formData.designation}
              onChange={handleChange}
              placeholder="Designation (e.g. Director, Manager)"
              required
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="bankName">Bank Name</label>
            <input
              id="bankName"
              name="bankName"
              type="text"
              value={formData.bankName}
              onChange={handleChange}
              placeholder="Bank Name (e.g., HDFC Bank)"
              required
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="accountNumber">Account Number</label>
            <input
              id="accountNumber"
              name="accountNumber"
              type="text"
              value={formData.accountNumber}
              onChange={handleChange}
              placeholder="Account Number (e.g., 12345678901234)"
              required
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="ifscCode">IFSC Code</label>
            <input
              id="ifscCode"
              name="ifscCode"
              type="text"
              value={formData.ifscCode}
              onChange={handleChange}
              placeholder="IFSC Code (e.g., HDFC0001234)"
              required
            />
          </div>

          <div className="vendor-field">
            <label htmlFor="businessAddress">
              Business Address <span className="required">*</span>
            </label>
            <textarea
              id="businessAddress"
              name="businessAddress"
              value={formData.businessAddress}
              onChange={handleChange}
              placeholder="Enter your business address"
              required
            />
          </div>

          <div className="vendor-section-title">Documents</div>

          <div className="vendor-file-row">
            <label htmlFor="gstCertificate">
              GST Certificate <span className="required">*</span>
            </label>
            <input
              id="gstCertificate"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => handleFileChange('gstCertificate', e.target.files?.[0] || null)}
              required
            />
          </div>

          <div className="vendor-file-row">
            <label htmlFor="panCardFile">
              PAN Card <span className="required">*</span>
            </label>
            <input
              id="panCardFile"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => handleFileChange('panCardFile', e.target.files?.[0] || null)}
              required
            />
          </div>

          <div className="vendor-file-row">
            <label htmlFor="cancelledChequeFile">
              Cancelled Cheque <span className="required">*</span>
            </label>
            <input
              id="cancelledChequeFile"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => handleFileChange('cancelledChequeFile', e.target.files?.[0] || null)}
              required
            />
          </div>

          <button type="submit" className="vendor-submit-btn" disabled={loading}>
            {loading ? 'Submitting...' : 'Register'}
          </button>

          <p className="vendor-footer-note">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </form>

        <Link to="/dashboard" className="vendor-back-link">
          <ArrowLeft size={16} />
          Back to Service Provider Dashboard
        </Link>
      </div>
    </div>
  );
};

export default RegisterAsSupplier;
