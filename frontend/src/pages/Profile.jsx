import React, { useState, useEffect, useMemo } from 'react';
import { getApiUrl } from '../config/api';
import { User, Building, MapPin, Phone, Mail, FileText, Plus, Edit, Save, X, Users } from 'lucide-react';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import ProfilePhotoSection from '../components/ProfilePhotoSection';
import { cacheProfilePhotoUrl } from '../utils/profilePhoto';
import './Profile.css';

const Profile = ({ user }) => {
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setProfile(data.profile);
      cacheProfilePhotoUrl(data.profile?.profilePhotoUrl || '');
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (profile?.userType === 'service_provider') {
        const addr = profile?.address || {};
        const requiredAddressFields = [
          { key: 'line1', label: 'Address' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'pincode', label: 'PIN code' },
          { key: 'country', label: 'Country' }
        ];
        const missing = requiredAddressFields.find((f) => !String(addr?.[f.key] || '').trim());
        if (missing) {
          alert(`Please enter ${missing.label} in the profile address section.`);
          return;
        }

        const billingAddresses = Array.isArray(profile?.billingAddresses) ? profile.billingAddresses : [];
        for (let i = 0; i < billingAddresses.length; i += 1) {
          const entry = billingAddresses[i] || {};
          const missingBillingField = requiredAddressFields.find(
            (f) => !String(entry?.[f.key] || '').trim()
          );
          if (missingBillingField) {
            const label = String(entry?.label || '').trim() || `Billing Address ${i + 1}`;
            alert(`Please enter ${missingBillingField.label} in ${label}.`);
            return;
          }
        }
      }

      if (profile?.userType === 'supplier') {
        const branches = Array.isArray(profile?.branches) ? profile.branches : [];
        const isBranchComplete = (branch) =>
          ['address', 'city', 'state', 'country'].every((key) => String(branch?.[key] || '').trim()) &&
          String(branch?.zipCode || branch?.pincode || '').trim();

        if (!branches.some(isBranchComplete)) {
          alert(
            'Please add at least one complete branch location (shipping address) with address, city, state, PIN, and country.'
          );
          return;
        }

        const billingAddresses = Array.isArray(profile?.billingAddresses) ? profile.billingAddresses : [];
        const requiredBillingFields = [
          { key: 'line1', label: 'Address' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'pincode', label: 'PIN code' },
          { key: 'country', label: 'Country' }
        ];
        for (let i = 0; i < billingAddresses.length; i += 1) {
          const entry = billingAddresses[i] || {};
          const missingBillingField = requiredBillingFields.find(
            (f) => !String(entry?.[f.key] || '').trim()
          );
          if (missingBillingField) {
            const label = String(entry?.label || '').trim() || `Billing Address ${i + 1}`;
            alert(`Please enter ${missingBillingField.label} in ${label}.`);
            return;
          }
        }
      }

      let payload = profile;
      if (profile?.userType === 'supplier') {
        const branches = Array.isArray(profile?.branches) ? profile.branches : [];
        const primaryBranch = branches.find(
          (branch) =>
            ['address', 'city', 'state', 'country'].every((key) => String(branch?.[key] || '').trim()) &&
            String(branch?.zipCode || branch?.pincode || '').trim()
        );
        if (primaryBranch) {
          payload = {
            ...profile,
            address: {
              line1: String(primaryBranch.address || primaryBranch.line1 || '').trim(),
              city: String(primaryBranch.city || '').trim(),
              state: String(primaryBranch.state || '').trim(),
              pincode: String(primaryBranch.zipCode || primaryBranch.pincode || '').trim(),
              country: String(primaryBranch.country || 'India').trim() || 'India'
            }
          };
        }
      }

      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save profile. Please try again.');
        return;
      }
      if (data.chainApprovalPending) {
        alert(data.message || 'Submitted for admin approval.');
      }
      if (data.profile) {
        setProfile(data.profile);
        cacheProfilePhotoUrl(data.profile?.profilePhotoUrl || '');
      } else {
        await fetchProfile();
      }
      setEditing(false);
    } catch (error) {
      console.error('Failed to save profile:', error);
      alert('Failed to save profile. Please try again.');
    }
  };

  const handleCancel = async () => {
    // Re-load persisted profile so local unsaved edits are discarded.
    await fetchProfile();
    setEditing(false);
  };

  if (loading) {
    return (
      <div className="profile-loading">
        <div className="spinner" />
        <p>Loading profile...</p>
      </div>
    );
  }

  const isServiceProvider = user?.userType === 'service_provider';

  const profileBody = (
    <div className="profile-container">
      {profile ? <ProfilePhotoSection profile={profile} /> : null}
      {!isServiceProvider ? (
      <div className="profile-header">
        <div className="profile-title">
          <User size={24} />
          <h1>Company Profile</h1>
        </div>
        <div className="profile-actions profile-page-header-actions">
          {editing ? (
            <>
              <button type="button" className="btn-secondary" onClick={handleCancel}>
                <X size={18} strokeWidth={2} aria-hidden />
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSave}>
                <Save size={18} strokeWidth={2} aria-hidden />
                Save Changes
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
              <Edit size={18} strokeWidth={2} aria-hidden />
              Edit Profile
            </button>
          )}
        </div>
      </div>
      ) : null}

      {user?.userType === 'supplier' ? (
        <SupplierProfile
          profile={profile}
          setProfile={setProfile}
          editing={editing}
        />
      ) : (
        <ServiceProviderProfile
          profile={profile}
          setProfile={setProfile}
          editing={editing}
          isAdmin={user?.userType === 'admin'}
        />
      )}
    </div>
  );

  if (isServiceProvider) {
    return (
      <SpPageLayout showStepper={false}>
        <SpPageHeader
          title="Company Profile"
          description="Manage your company details, projects, and billing addresses."
          icon={User}
          actions={
            <div className="profile-page-header-actions">
              {editing ? (
                <>
                  <button type="button" className="btn-secondary" onClick={handleCancel}>
                    <X size={18} strokeWidth={2} aria-hidden />
                    Cancel
                  </button>
                  <button type="button" className="btn-primary" onClick={handleSave}>
                    <Save size={18} strokeWidth={2} aria-hidden />
                    Save Changes
                  </button>
                </>
              ) : (
                <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
                  <Edit size={18} strokeWidth={2} aria-hidden />
                  Edit Profile
                </button>
              )}
            </div>
          }
        />
        {profileBody}
      </SpPageLayout>
    );
  }

  return profileBody;
};

const ServiceProviderProfile = ({ profile, setProfile, editing, isAdmin = false }) => {
  const [locatingAddress, setLocatingAddress] = useState(false);

  const addProject = () => {
    const newProject = {
      id: Date.now(),
      name: '',
      address: '',
      googleLocation: '',
      siteInCharge: '',
      contactDetails: { phone: '', email: '' }
    };
    setProfile({
      ...profile,
      projects: [...(profile?.projects || []), newProject]
    });
  };

  const updateProject = (projectId, field, value) => {
    setProfile({
      ...profile,
      projects: profile.projects.map(project =>
        project.id === projectId ? { ...project, [field]: value } : project
      )
    });
  };

  const removeProject = (projectId) => {
    setProfile({
      ...profile,
      projects: profile.projects.filter(project => project.id !== projectId)
    });
  };

  const addBillingAddress = () => {
    const newAddress = {
      id: Date.now(),
      label: '',
      line1: '',
      city: '',
      state: '',
      pincode: '',
      country: ''
    };
    setProfile((prev) => ({
      ...prev,
      billingAddresses: [...(prev?.billingAddresses || []), newAddress]
    }));
  };

  const updateBillingAddress = (addressId, field, value) => {
    setProfile((prev) => ({
      ...prev,
      billingAddresses: (prev?.billingAddresses || []).map((addr) =>
        addr.id === addressId ? { ...addr, [field]: value } : addr
      )
    }));
  };

  const removeBillingAddress = (addressId) => {
    setProfile((prev) => ({
      ...prev,
      billingAddresses: (prev?.billingAddresses || []).filter((addr) => addr.id !== addressId)
    }));
  };

  const updateCompanyAddress = (field, value) => {
    setProfile({
      ...profile,
      address: {
        ...(profile?.address || {}),
        [field]: value
      }
    });
  };

  const getCurrentPositionAsync = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Location is not supported in this browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    });

  const reverseGeocodeLocation = async (lat, lon) => {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'en'
      }
    });
    if (!res.ok) {
      throw new Error('Could not fetch address from your current location.');
    }
    return res.json();
  };

  const fillAddressFromCurrentLocation = async () => {
    if (!editing) return;
    setLocatingAddress(true);
    try {
      const position = await getCurrentPositionAsync();
      const latitude = position?.coords?.latitude;
      const longitude = position?.coords?.longitude;

      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new Error('Could not read your current coordinates.');
      }

      const geoData = await reverseGeocodeLocation(latitude, longitude);
      const addr = geoData?.address || {};
      const line1 =
        [
          addr.house_number,
          addr.road || addr.pedestrian || addr.footway,
          addr.neighbourhood || addr.suburb || addr.quarter
        ]
          .filter(Boolean)
          .join(', ')
          .trim() || geoData?.display_name || '';
      const city =
        addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.county ||
        '';
      const state = addr.state || addr.state_district || '';
      const pincode = addr.postcode || '';
      const country = addr.country || '';

      setProfile((prev) => ({
        ...prev,
        address: {
          ...(prev?.address || {}),
          line1: line1 || prev?.address?.line1 || '',
          city: city || prev?.address?.city || '',
          state: state || prev?.address?.state || '',
          pincode: pincode || prev?.address?.pincode || '',
          country: country || prev?.address?.country || '',
          latitude,
          longitude,
          geoLocation: { lat: latitude, lng: longitude }
        }
      }));
    } catch (error) {
      let message = 'Unable to fetch your current location.';
      if (error?.code === 1) {
        message = 'Location permission is blocked. Please allow location access and try again.';
      } else if (error?.code === 2) {
        message = 'Your location is unavailable right now. Please try again.';
      } else if (error?.code === 3) {
        message = 'Location request timed out. Please try again.';
      } else if (error?.message) {
        message = error.message;
      }
      alert(message);
    } finally {
      setLocatingAddress(false);
    }
  };

  return (
    <div className="profile-content">
      <div className="profile-section">
        <h2>
          <FileText size={20} />
          Order Summary
        </h2>
        <div className="supplier-summary-grid">
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Orders Placed</p>
            <p className="supplier-summary-value">
              {Number(profile?.totalOrdersPlaced || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Amount Placed</p>
            <p className="supplier-summary-value">
              ₹{Number(profile?.totalAmountPlaced || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Amount Paid</p>
            <p className="supplier-summary-value">
              ₹{Number(profile?.totalAmountPaid || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Most Purchased Brand</p>
            <p className="supplier-summary-value supplier-summary-brand">
              {profile?.topPurchasedBrand?.brand || 'N/A'}
            </p>
            {profile?.topPurchasedBrand ? (
              <p className="supplier-summary-meta">
                Qty {Number(profile.topPurchasedBrand.totalQuantity || 0).toLocaleString('en-IN')} | ₹
                {Number(profile.topPurchasedBrand.totalAmount || 0).toLocaleString('en-IN')}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {!isAdmin ? (
        <div className="profile-section">
          <div className="section-header">
            <h2>
              <MapPin size={20} />
              Address and Location
            </h2>
            {editing ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={fillAddressFromCurrentLocation}
                disabled={locatingAddress}
                style={{ padding: '0.45rem 0.7rem', fontSize: '0.82rem' }}
              >
                {locatingAddress ? 'Detecting...' : 'Use my current location'}
              </button>
            ) : null}
          </div>
          <div className="form-grid">
            <div className="form-group span-2">
              <label>Address (Street / Area)</label>
              <textarea
                rows="2"
                value={profile?.address?.line1 || ''}
                onChange={(e) => updateCompanyAddress('line1', e.target.value)}
                disabled={!editing}
                placeholder="Office address"
              />
            </div>
            <div className="form-group">
              <label>City</label>
              <input
                type="text"
                value={profile?.address?.city || ''}
                onChange={(e) => updateCompanyAddress('city', e.target.value)}
                disabled={!editing}
              />
            </div>
            <div className="form-group">
              <label>State / Region</label>
              <input
                type="text"
                value={profile?.address?.state || ''}
                onChange={(e) => updateCompanyAddress('state', e.target.value)}
                disabled={!editing}
              />
            </div>
            <div className="form-group">
              <label>PIN / ZIP Code</label>
              <input
                type="text"
                value={profile?.address?.pincode || ''}
                onChange={(e) => updateCompanyAddress('pincode', e.target.value)}
                disabled={!editing}
              />
            </div>
            <div className="form-group">
              <label>Country</label>
              <input
                type="text"
                value={profile?.address?.country || ''}
                onChange={(e) => updateCompanyAddress('country', e.target.value)}
                disabled={!editing}
              />
            </div>
          </div>
        </div>
      ) : null}

      {!isAdmin ? (
        <div className="profile-section">
          <div className="section-header">
            <h2>
              <FileText size={20} />
              Billing Addresses (for PO)
            </h2>
            {editing ? (
              <button type="button" className="btn-add" onClick={addBillingAddress}>
                <Plus size={16} />
                Add Billing Address
              </button>
            ) : null}
          </div>
          {(profile?.billingAddresses || []).length === 0 ? (
            <p style={{ color: '#64748b', margin: 0 }}>
              No billing addresses added yet. Add one or more addresses to use in Create PO dropdown.
            </p>
          ) : (
            <div className="branches-list">
              {(profile?.billingAddresses || []).map((addr) => (
                <div key={addr.id} className="branch-card">
                  <div className="branch-header">
                    <input
                      type="text"
                      value={addr.label || ''}
                      onChange={(e) => updateBillingAddress(addr.id, 'label', e.target.value)}
                      disabled={!editing}
                      placeholder="Address label (e.g. Head Office GST)"
                      className="branch-name-input"
                    />
                    {editing ? (
                      <button className="btn-remove" onClick={() => removeBillingAddress(addr.id)}>
                        <X size={16} />
                      </button>
                    ) : null}
                  </div>
                  <div className="form-grid">
                    <div className="form-group span-2">
                      <label>Address (Street / Area)</label>
                      <textarea
                        rows="2"
                        value={addr.line1 || ''}
                        onChange={(e) => updateBillingAddress(addr.id, 'line1', e.target.value)}
                        disabled={!editing}
                      />
                    </div>
                    <div className="form-group">
                      <label>City</label>
                      <input
                        type="text"
                        value={addr.city || ''}
                        onChange={(e) => updateBillingAddress(addr.id, 'city', e.target.value)}
                        disabled={!editing}
                      />
                    </div>
                    <div className="form-group">
                      <label>State / Region</label>
                      <input
                        type="text"
                        value={addr.state || ''}
                        onChange={(e) => updateBillingAddress(addr.id, 'state', e.target.value)}
                        disabled={!editing}
                      />
                    </div>
                    <div className="form-group">
                      <label>PIN / ZIP Code</label>
                      <input
                        type="text"
                        value={addr.pincode || ''}
                        onChange={(e) => updateBillingAddress(addr.id, 'pincode', e.target.value)}
                        disabled={!editing}
                      />
                    </div>
                    <div className="form-group">
                      <label>Country</label>
                      <input
                        type="text"
                        value={addr.country || ''}
                        onChange={(e) => updateBillingAddress(addr.id, 'country', e.target.value)}
                        disabled={!editing}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

    </div>
  );
};

/** One upstream partner (e.g. dealer) with full profile-style details */
const SupplyChainPartnerCard = ({ partner }) => {
  const addrLine = [partner.line1, partner.city, partner.state, partner.pincode].filter(Boolean).join(', ');
  return (
    <article className="supply-chain-partner-card">
      <div className="supply-chain-partner-card-head">
        <h4 className="supply-chain-partner-title">{partner.company || partner.name || 'Company'}</h4>
        {partner.supplierRoleLabel ? (
          <span className="supply-chain-partner-badge">{partner.supplierRoleLabel}</span>
        ) : null}
      </div>
      <dl className="supply-chain-partner-dl">
        <dt>Contact person</dt>
        <dd>{partner.name || '—'}</dd>
        <dt>Phone</dt>
        <dd>{partner.phone ? <a href={`tel:${partner.phone}`}>{partner.phone}</a> : '—'}</dd>
        <dt>Email</dt>
        <dd>
          {partner.email ? (
            <a href={`mailto:${partner.email}`}>{partner.email}</a>
          ) : (
            '—'
          )}
        </dd>
        <dt>GSTIN</dt>
        <dd>{partner.gstin || '—'}</dd>
        <dt>Brands</dt>
        <dd>{partner.brands?.trim() ? partner.brands : '—'}</dd>
        <dt>Ownership</dt>
        <dd>{partner.ownershipDetails?.trim() ? partner.ownershipDetails : '—'}</dd>
        {addrLine ? (
          <>
            <dt>Location</dt>
            <dd>{addrLine}</dd>
          </>
        ) : null}
      </dl>
      {partner.authorizationCertificateUrl ? (
        <p className="supply-chain-partner-cert">
          <a href={partner.authorizationCertificateUrl} target="_blank" rel="noopener noreferrer">
            Brand authorisation
          </a>
        </p>
      ) : null}
      {partner.companyInfoEntries && partner.companyInfoEntries.length > 0 ? (
        <div className="supply-chain-partner-entries">
          <strong className="supply-chain-partner-entries-title">
            {partner.companyInfoEntries.length > 1 ? 'Matching registrations' : 'Registration details'}
          </strong>
          <ul className="supply-chain-partner-entries-list">
            {partner.companyInfoEntries.map((e) => (
              <li key={e.id || `${e.role}-${e.gstin}`} className="supply-chain-partner-entry-item">
                <div className="supply-chain-partner-entry-line">
                  <span className="supply-chain-partner-entry-role">{e.roleLabel || e.role || 'Role'}</span>
                  {e.companyName ? <span className="supply-chain-partner-entry-co"> · {e.companyName}</span> : null}
                  {e.gstin ? <span className="supply-chain-partner-entry-gst"> · GSTIN {e.gstin}</span> : null}
                </div>
                {e.brands?.trim() ? <div className="supply-chain-partner-entry-meta">Brands: {e.brands}</div> : null}
                {e.ownershipDetails?.trim() ? (
                  <div className="supply-chain-partner-entry-meta">Ownership: {e.ownershipDetails}</div>
                ) : null}
                {e.authorizationCertificateUrl ? (
                  <a
                    href={e.authorizationCertificateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="supply-chain-partner-entry-cert"
                  >
                    Certificate for this entry
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
};

const SupplierProfile = ({ profile, setProfile, editing }) => {
  const [supplyChainState, setSupplyChainState] = useState({
    loading: true,
    partnerGroups: [],
    topMessage: null
  });
  const [locatingBranchId, setLocatingBranchId] = useState(null);

  /** Partner hints should reflect latest selection in real time (including pending chain edits). */
  const profileForChainPartners = useMemo(() => profile, [profile]);

  /** Roles + brands — refetch upstream partners when supply-chain selection changes */
  const supplyChainRoleKey = useMemo(() => {
    const p = profileForChainPartners;
    const parts = [];
    if (p?.supplierRole) parts.push(`sr:${p.supplierRole}`);
    if (p?.brands?.trim()) parts.push(`sb:${p.brands.trim()}`);
    (p?.companyInfoEntries || []).forEach((e) => {
      parts.push(`${e?.role || ''}|${(e?.brands || '').trim()}`);
    });
    return parts.sort().join(';;');
  }, [profileForChainPartners?.supplierRole, profileForChainPartners?.brands, profileForChainPartners?.companyInfoEntries]);

  useEffect(() => {
    let cancelled = false;
    const loadPartners = async () => {
      setSupplyChainState((s) => ({ ...s, loading: true }));
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(getApiUrl('/api/supplier/supply-chain-partners'), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSupplyChainState({
            loading: false,
            partnerGroups: [],
            topMessage: data.message || 'Could not load upstream partners.'
          });
          return;
        }
        if (data.status === 'success') {
          const groups = Array.isArray(data.partnerGroups) ? data.partnerGroups : [];
          setSupplyChainState({
            loading: false,
            partnerGroups: groups,
            topMessage: groups.length === 0 ? data.message || null : null
          });
        } else {
          setSupplyChainState({
            loading: false,
            partnerGroups: [],
            topMessage: data.message || 'Could not load upstream partners.'
          });
        }
      } catch {
        if (!cancelled) {
          setSupplyChainState({
            loading: false,
            partnerGroups: [],
            topMessage: 'Failed to load upstream partners.'
          });
        }
      }
    };
    loadPartners();
    return () => {
      cancelled = true;
    };
  }, [supplyChainRoleKey]);

  const handleComplianceFieldChange = (field, value) => {
    setProfile({
      ...profile,
      [field]: value
    });
  };

  const addBranch = () => {
    const newBranch = {
      id: Date.now(),
      name: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
      phone: '',
      latitude: null,
      longitude: null,
      geoLocation: null
    };
    setProfile({
      ...profile,
      branches: [...(profile?.branches || []), newBranch]
    });
  };

  const updateBranch = (branchId, field, value) => {
    setProfile({
      ...profile,
      branches: profile.branches.map(branch =>
        branch.id === branchId ? { ...branch, [field]: value } : branch
      )
    });
  };

  const removeBranch = (branchId) => {
    setProfile({
      ...profile,
      branches: profile.branches.filter(branch => branch.id !== branchId)
    });
  };

  const addBillingAddress = () => {
    const newAddress = {
      id: Date.now(),
      label: '',
      line1: '',
      city: '',
      state: '',
      pincode: '',
      country: 'India'
    };
    setProfile((prev) => ({
      ...prev,
      billingAddresses: [...(prev?.billingAddresses || []), newAddress]
    }));
  };

  const updateBillingAddress = (addressId, field, value) => {
    setProfile((prev) => ({
      ...prev,
      billingAddresses: (prev?.billingAddresses || []).map((addr) =>
        addr.id === addressId ? { ...addr, [field]: value } : addr
      )
    }));
  };

  const removeBillingAddress = (addressId) => {
    setProfile((prev) => ({
      ...prev,
      billingAddresses: (prev?.billingAddresses || []).filter((addr) => addr.id !== addressId)
    }));
  };

  const getCurrentPositionAsync = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Location is not supported in this browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    });

  const reverseGeocodeLocation = async (lat, lon) => {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'en'
      }
    });
    if (!res.ok) {
      throw new Error('Could not fetch address from your current location.');
    }
    return res.json();
  };

  const fillBranchFromCurrentLocation = async (branchId) => {
    if (!editing) return;
    setLocatingBranchId(branchId);
    try {
      const position = await getCurrentPositionAsync();
      const latitude = position?.coords?.latitude;
      const longitude = position?.coords?.longitude;

      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new Error('Could not read your current coordinates.');
      }

      const geoData = await reverseGeocodeLocation(latitude, longitude);
      const address = geoData?.address || {};
      const streetAddress =
        [
          address.house_number,
          address.road || address.pedestrian || address.footway,
          address.neighbourhood || address.suburb || address.quarter
        ]
          .filter(Boolean)
          .join(', ')
          .trim() || geoData?.display_name || '';

      const city =
        address.city ||
        address.town ||
        address.village ||
        address.municipality ||
        address.county ||
        '';
      const state = address.state || address.state_district || '';
      const zipCode = address.postcode || '';
      const country = address.country || '';

      setProfile((prev) => ({
        ...prev,
        branches: (prev?.branches || []).map((branch) =>
          branch.id === branchId
            ? {
                ...branch,
                name: (branch.name || '').trim() || city || 'Current Location Branch',
                address: streetAddress || branch.address || '',
                city: city || branch.city || '',
                state: state || branch.state || '',
                zipCode: zipCode || branch.zipCode || '',
                country: country || branch.country || '',
                latitude,
                longitude,
                geoLocation: { lat: latitude, lng: longitude }
              }
            : branch
        )
      }));
    } catch (error) {
      let message = 'Unable to fetch your current location.';
      if (error?.code === 1) {
        message = 'Location permission is blocked. Please allow location access and try again.';
      } else if (error?.code === 2) {
        message = 'Your location is unavailable right now. Please try again.';
      } else if (error?.code === 3) {
        message = 'Location request timed out. Please try again.';
      } else if (error?.message) {
        message = error.message;
      }
      alert(message);
    } finally {
      setLocatingBranchId(null);
    }
  };

  return (
    <div className="profile-content">
      {profile?.chainProfileApprovalStatus === 'pending' ? (
        <div
          className="profile-section"
          style={{
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 10,
            padding: '1rem 1.1rem'
          }}
        >
          <strong style={{ color: '#92400e' }}>Supply-chain profile pending admin approval</strong>
          <p style={{ margin: '0.45rem 0 0', color: '#78350f', fontSize: '0.95rem', lineHeight: 1.45 }}>
            You submitted changes to your role and/or brands. Until an admin approves them on the{' '}
            <strong>Profile brand assignment</strong> page, the platform continues to use your previously approved
            assignment for upstream matching and orders.
            {profile.chainProfilePendingSubmittedAt
              ? ` Submitted: ${new Date(profile.chainProfilePendingSubmittedAt).toLocaleString()}.`
              : ''}
          </p>
        </div>
      ) : null}
      {profile?.chainProfileLastRejection?.reason && profile?.chainProfileApprovalStatus !== 'pending' ? (
        <div
          className="profile-section"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 10,
            padding: '1rem 1.1rem'
          }}
        >
          <strong style={{ color: '#991b1b' }}>Previous submission was not approved</strong>
          <p style={{ margin: '0.45rem 0 0', color: '#7f1d1d', fontSize: '0.95rem' }}>
            {profile.chainProfileLastRejection.reason}
          </p>
        </div>
      ) : null}
      {/* Basic Information */}
      <div className="profile-section">
        <h2>
          <Building size={20} />
          Company Information
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '-0.35rem', marginBottom: '1rem' }}>
          Supply-chain role, brands per layer, and authorisation certificates are configured under{' '}
          <strong>Select yourself</strong> in the sidebar (below Returns).
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label>Company Name</label>
            <input
              type="text"
              value={profile?.companyName || ''}
              onChange={(e) => setProfile({...profile, companyName: e.target.value})}
              disabled={!editing}
            />
          </div>
          <div className="form-group">
            <label>Main GSTIN</label>
            <input
              type="text"
              value={profile?.gstin || profile?.mainGstin || ''}
              onChange={(e) => setProfile({...profile, gstin: e.target.value, mainGstin: e.target.value})}
              disabled={!editing}
              placeholder="22AAAAA0000A1Z5"
            />
          </div>
          <div className="form-group">
            <label>Contact Person</label>
            <input
              type="text"
              value={profile?.contactPerson || ''}
              onChange={(e) => setProfile({...profile, contactPerson: e.target.value})}
              disabled={!editing}
            />
          </div>
          <div className="form-group">
            <label>Phone Number</label>
            <input
              type="tel"
              value={profile?.phone || ''}
              onChange={(e) => setProfile({...profile, phone: e.target.value})}
              disabled={!editing}
            />
          </div>
          <div className="form-group span-2">
            <label>Email Address</label>
            <input
              type="email"
              value={profile?.email || ''}
              onChange={(e) => setProfile({...profile, email: e.target.value})}
              disabled={!editing}
            />
          </div>
          <div className="form-group span-2">
            <label>Ownership Details</label>
            <textarea
              rows="3"
              value={profile?.ownershipDetails || ''}
              onChange={(e) => handleComplianceFieldChange('ownershipDetails', e.target.value)}
              disabled={!editing}
              placeholder="Proprietorship / Partnership / Pvt. Ltd. / LLP etc. Include key owners/directors."
            />
          </div>
        </div>
      </div>

      <div className="profile-section">
        <div className="section-header">
          <h2>
            <MapPin size={20} />
            Shipping addresses (branch locations)
          </h2>
          {editing ? (
            <button className="btn-add" onClick={addBranch}>
              <Plus size={16} />
              Add shipping branch
            </button>
          ) : null}
        </div>
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '-0.35rem', marginBottom: '1rem' }}>
          Branch locations are your shipping addresses — used for upstream place order, transport quotes, and delivery.
          Add at least one complete branch.
        </p>

        {(profile?.branches || []).length === 0 ? (
          <p style={{ color: '#64748b', margin: 0 }}>No shipping branches added yet.</p>
        ) : (
          <div className="branches-list">
            {(profile?.branches || []).map((branch) => (
              <div key={branch.id} className="branch-card">
                <div className="branch-header">
                  <input
                    type="text"
                    value={branch.name}
                    onChange={(e) => updateBranch(branch.id, 'name', e.target.value)}
                    disabled={!editing}
                    placeholder="Branch / warehouse name"
                    className="branch-name-input"
                  />
                  {editing ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => fillBranchFromCurrentLocation(branch.id)}
                        disabled={locatingBranchId === branch.id}
                        style={{ padding: '0.45rem 0.7rem', fontSize: '0.82rem' }}
                      >
                        {locatingBranchId === branch.id ? 'Detecting...' : 'Use my current location'}
                      </button>
                      <button className="btn-remove" onClick={() => removeBranch(branch.id)}>
                        <X size={16} />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="form-grid">
                  <div className="form-group span-2">
                    <label>Address (Street / Area)</label>
                    <textarea
                      value={branch.address || ''}
                      onChange={(e) => updateBranch(branch.id, 'address', e.target.value)}
                      disabled={!editing}
                      rows="2"
                    />
                  </div>
                  <div className="form-group">
                    <label>City</label>
                    <input
                      type="text"
                      value={branch.city || ''}
                      onChange={(e) => updateBranch(branch.id, 'city', e.target.value)}
                      disabled={!editing}
                      placeholder="e.g. Pune"
                    />
                  </div>
                  <div className="form-group">
                    <label>State / Region</label>
                    <input
                      type="text"
                      value={branch.state || ''}
                      onChange={(e) => updateBranch(branch.id, 'state', e.target.value)}
                      disabled={!editing}
                      placeholder="e.g. Maharashtra"
                    />
                  </div>
                  <div className="form-group">
                    <label>PIN / ZIP Code</label>
                    <input
                      type="text"
                      value={branch.zipCode || ''}
                      onChange={(e) => updateBranch(branch.id, 'zipCode', e.target.value)}
                      disabled={!editing}
                      placeholder="e.g. 411026"
                    />
                  </div>
                  <div className="form-group">
                    <label>Country</label>
                    <input
                      type="text"
                      value={branch.country || ''}
                      onChange={(e) => updateBranch(branch.id, 'country', e.target.value)}
                      disabled={!editing}
                      placeholder="e.g. India"
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone Number</label>
                    <input
                      type="tel"
                      value={branch.phone || ''}
                      onChange={(e) => updateBranch(branch.id, 'phone', e.target.value)}
                      disabled={!editing}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="profile-section">
        <div className="section-header">
          <h2>
            <FileText size={20} />
            Billing Addresses
          </h2>
          {editing ? (
            <button type="button" className="btn-add" onClick={addBillingAddress}>
              <Plus size={16} />
              Add Billing Address
            </button>
          ) : null}
        </div>
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '-0.35rem', marginBottom: '1rem' }}>
          Add one or more GST billing addresses. The first entry is used by default on upstream place order when GSTIN is set.
        </p>
        {(profile?.billingAddresses || []).length === 0 ? (
          <p style={{ color: '#64748b', margin: 0 }}>
            No billing addresses added yet. For GST billing on upstream orders, add at least one billing address here.
          </p>
        ) : (
          <div className="branches-list">
            {(profile?.billingAddresses || []).map((addr) => (
              <div key={addr.id} className="branch-card">
                <div className="branch-header">
                  <input
                    type="text"
                    value={addr.label || ''}
                    onChange={(e) => updateBillingAddress(addr.id, 'label', e.target.value)}
                    disabled={!editing}
                    placeholder="Address label (e.g. Head Office GST)"
                    className="branch-name-input"
                  />
                  {editing ? (
                    <button className="btn-remove" onClick={() => removeBillingAddress(addr.id)}>
                      <X size={16} />
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <div className="form-group span-2">
                    <label>Address (Street / Area)</label>
                    <textarea
                      rows="2"
                      value={addr.line1 || ''}
                      onChange={(e) => updateBillingAddress(addr.id, 'line1', e.target.value)}
                      disabled={!editing}
                    />
                  </div>
                  <div className="form-group">
                    <label>City</label>
                    <input
                      type="text"
                      value={addr.city || ''}
                      onChange={(e) => updateBillingAddress(addr.id, 'city', e.target.value)}
                      disabled={!editing}
                    />
                  </div>
                  <div className="form-group">
                    <label>State / Region</label>
                    <input
                      type="text"
                      value={addr.state || ''}
                      onChange={(e) => updateBillingAddress(addr.id, 'state', e.target.value)}
                      disabled={!editing}
                    />
                  </div>
                  <div className="form-group">
                    <label>PIN / ZIP Code</label>
                    <input
                      type="text"
                      value={addr.pincode || ''}
                      onChange={(e) => updateBillingAddress(addr.id, 'pincode', e.target.value)}
                      disabled={!editing}
                    />
                  </div>
                  <div className="form-group">
                    <label>Country</label>
                    <input
                      type="text"
                      value={addr.country || ''}
                      onChange={(e) => updateBillingAddress(addr.id, 'country', e.target.value)}
                      disabled={!editing}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="profile-section">
        <h2>
          <FileText size={20} />
          Order Summary
        </h2>
        <div className="supplier-summary-grid">
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Orders Placed</p>
            <p className="supplier-summary-value">
              {Number(profile?.totalOrdersPlaced || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Amount Placed</p>
            <p className="supplier-summary-value">
              ₹{Number(profile?.totalAmountPlaced || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Amount Paid</p>
            <p className="supplier-summary-value">
              ₹{Number(profile?.totalAmountPaid || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Most Purchased Brand</p>
            <p className="supplier-summary-value supplier-summary-brand">
              {profile?.topPurchasedBrand?.brand || 'N/A'}
            </p>
            {profile?.topPurchasedBrand ? (
              <p className="supplier-summary-meta">
                Qty {Number(profile.topPurchasedBrand.totalQuantity || 0).toLocaleString('en-IN')} | ₹
                {Number(profile.topPurchasedBrand.totalAmount || 0).toLocaleString('en-IN')}
              </p>
            ) : null}
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Orders Received</p>
            <p className="supplier-summary-value">
              {Number(profile?.totalOrdersReceived || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="supplier-summary-card">
            <p className="supplier-summary-label">Total Revenue Received</p>
            <p className="supplier-summary-value">
              ₹{Number(profile?.totalRevenueReceived || 0).toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      </div>

      {/* Upstream partners (e.g. retailers see dealers) */}
      <div className="profile-section supply-chain-section">
        <h2>
          <Users size={20} />
          Upstream partners
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: '-0.25rem', marginBottom: '0.75rem', maxWidth: '48rem', lineHeight: 1.45 }}>
          Suppliers <strong>one step above you</strong> in the admin supply chain for each of your brands.
        </p>
        {supplyChainState.loading ? (
          <p className="supply-chain-status">Loading partners…</p>
        ) : supplyChainState.topMessage ? (
          <p className="supply-chain-status">{supplyChainState.topMessage}</p>
        ) : (
          supplyChainState.partnerGroups.map((group) => (
            <div
              key={`${group.brandKey || group.brand || ''}-${group.parentRole}-${group.yourRole}`}
              className="supply-chain-group"
            >
              <h3 className="supply-chain-group-title">
                {group.brand ? (
                  <>
                    <span className="supply-chain-group-brand">{group.brand}</span>
                    <span className="supply-chain-group-sep"> · </span>
                    {group.parentRoleLabel}
                  </>
                ) : (
                  group.parentRoleLabel
                )}
              </h3>
              <div className="supply-chain-partner-grid">
                {group.partners.map((p) => (
                  <SupplyChainPartnerCard key={`${group.brandKey}-${group.parentRole}-${p.id}`} partner={p} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
};

export default Profile;