import React, { useState, useEffect } from 'react';
import { UserCheck, Save, RotateCcw } from 'lucide-react';
import { getApiUrl } from '../config/api';
import SupplierSupplyChainEntriesEditor from '../components/SupplierSupplyChainEntriesEditor';
import './Profile.css';
import './Dashboard.css';

/**
 * Supply-chain role & brands setup for suppliers. Linked from the sidebar below Returns.
 */
export default function SupplierSelectYourself() {
  const [profile, setProfile] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [discountInsights, setDiscountInsights] = useState(null);

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      const p = data.profile;
      setProfile(p);
      setBaseline(p ? JSON.parse(JSON.stringify(p)) : null);
    } catch (e) {
      console.error('Failed to fetch profile:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  useEffect(() => {
    const fetchDiscountInsights = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(getApiUrl('/api/supplier/analytics/discount-insights'), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.status === 'success') {
          setDiscountInsights(data);
        }
      } catch (e) {
        console.error('Failed to fetch discount insights:', e);
      }
    };

    fetchDiscountInsights();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(profile)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save. Please try again.');
        return;
      }
      if (data.chainApprovalPending) {
        alert(data.message || 'Submitted for admin approval.');
      }
      await fetchProfile();
    } catch (e) {
      console.error('Failed to save profile:', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!baseline) return;
    setProfile(JSON.parse(JSON.stringify(baseline)));
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="dashboard-container">
        <p>Could not load profile.</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="profile-title">
          <UserCheck size={24} />
          <h1>Select yourself</h1>
        </div>
        <div className="profile-actions">
          <button type="button" className="btn-secondary" onClick={handleDiscard} disabled={saving}>
            <RotateCcw size={18} strokeWidth={2} aria-hidden />
            Discard changes
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={18} strokeWidth={2} aria-hidden />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

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

        <div className="profile-section">
          <h2>Supply-chain registration</h2>
          <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: '-0.25rem', marginBottom: '1rem' }}>
            Define how you participate in the chain and which brands you handle. This is used for upstream matching and
            orders.
          </p>
          <SupplierSupplyChainEntriesEditor profile={profile} setProfile={setProfile} editing />
        </div>

        <div className="profile-section">
          <h2>Discount Planning Insights</h2>
          <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: '-0.25rem', marginBottom: '1rem' }}>
            Track buyer count, order value, and brand-wise performance to decide discount slabs.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginBottom: '0.9rem'
            }}
          >
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.75rem' }}>
              <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Total buyers</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{discountInsights?.summary?.totalBuyers ?? 0}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.75rem' }}>
              <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Total orders</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{discountInsights?.summary?.totalOrders ?? 0}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.75rem' }}>
              <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Total order value</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                ₹{Number(discountInsights?.summary?.totalOrderValue || 0).toLocaleString()}
              </div>
            </div>
          </div>

          {Array.isArray(discountInsights?.brands) && discountInsights.brands.length > 0 ? (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {discountInsights.brands.slice(0, 8).map((brand) => (
                <div
                  key={brand.brand}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    padding: '0.65rem 0.8rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{brand.brand}</div>
                    <div style={{ color: '#64748b', fontSize: '0.84rem' }}>
                      Qty: {Number(brand.itemQty || 0).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700 }}>
                    ₹{Number(brand.orderValue || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#64748b', margin: 0 }}>No brand-wise values available yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
