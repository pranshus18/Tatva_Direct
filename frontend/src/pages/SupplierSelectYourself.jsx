import React, { useState, useEffect, useMemo } from 'react';
import { UserCheck, Save, RotateCcw } from 'lucide-react';
import { getApiUrl } from '../config/api';
import SupplierSupplyChainEntriesEditor from '../components/SupplierSupplyChainEntriesEditor';
import {
  resolveCompanyInfoEntriesForValidation,
  validateCompanyInfoEntriesList,
  validateSupplierChainProfile
} from '../utils/supplierChainEntryValidation';
import './Profile.css';
import './Dashboard.css';

function cloneProfileSnapshot(profile) {
  return profile ? JSON.parse(JSON.stringify(profile)) : null;
}

function chainEntryIdentity(entry = {}) {
  const role = String(entry?.role || '').trim().toLowerCase();
  const brand = String(entry?.brands || '').trim().toLowerCase();
  const gstin = String(entry?.gstin || '').trim().toLowerCase();
  const company = String(entry?.companyName || '').trim().toLowerCase();
  return `${role}|${brand}|${gstin}|${company}`;
}

function mergeDisplayAndApprovedEntries(profile) {
  const displayEntries = Array.isArray(profile?.companyInfoEntries) ? profile.companyInfoEntries : [];
  const approvedEntries = Array.isArray(profile?.approvedChainProfile?.companyInfoEntries)
    ? profile.approvedChainProfile.companyInfoEntries
    : [];
  if (approvedEntries.length === 0) return displayEntries;

  const merged = [];
  const seen = new Set();
  for (const entry of [...displayEntries, ...approvedEntries]) {
    if (!entry || typeof entry !== 'object') continue;
    const key = chainEntryIdentity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...entry });
  }
  return merged;
}

/** Compare supply-chain form fields only (what this page edits). */
function chainFormSignature(profile) {
  if (!profile) return '';
  const entries = Array.isArray(profile.companyInfoEntries) ? profile.companyInfoEntries : [];
  return JSON.stringify({
    supplierRole: profile.supplierRole || '',
    brands: profile.brands || '',
    companyName: profile.companyName || '',
    gstin: profile.gstin || '',
    authorizationCertificateUrl: profile.authorizationCertificateUrl || '',
    authorizationCertificateUrls: profile.authorizationCertificateUrls || [],
    minimumOrderValue: profile.minimumOrderValue ?? '',
    companyInfoEntries: entries.map((e) => ({
      id: e.id || '',
      role: e.role || '',
      brands: e.brands || '',
      gstin: e.gstin || '',
      companyName: e.companyName || '',
      authorizationCertificateUrl: e.authorizationCertificateUrl || '',
      authorizationCertificateUrls: e.authorizationCertificateUrls || [],
      minimumOrderValue: e.minimumOrderValue ?? ''
    }))
  });
}

/**
 * Supply-chain role & brands setup for suppliers. Linked from the sidebar below Returns.
 */
export default function SupplierSelectYourself() {
  const [profile, setProfile] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingEntryId, setSavingEntryId] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [discountInsights, setDiscountInsights] = useState(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!profile || !baseline) return false;
    return chainFormSignature(profile) !== chainFormSignature(baseline);
  }, [profile, baseline]);

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success' || !data.profile) {
        console.error('Failed to fetch profile:', data.message || response.status);
        return false;
      }
      const snapshot = cloneProfileSnapshot(data.profile);
      if (snapshot) {
        snapshot.companyInfoEntries = mergeDisplayAndApprovedEntries(snapshot);
      }
      setProfile(snapshot);
      setBaseline(cloneProfileSnapshot(snapshot));
      return true;
    } catch (e) {
      console.error('Failed to fetch profile:', e);
      return false;
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
    const validation = validateSupplierChainProfile(profile);
    const saveAsDraft = !validation.ok;

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const payload = saveAsDraft ? { ...profile, saveAsDraft: true } : profile;
      const response = await fetch(getApiUrl('/api/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save. Please try again.');
        return;
      }
      if (data.chainApprovalPending) {
        alert(data.message || 'Submitted for admin approval.');
      } else if (data.chainDraftSaved || saveAsDraft) {
        alert('Draft saved. You can come back later and complete remaining fields.');
      } else {
        alert('Saved successfully.');
      }
      await fetchProfile();
    } catch (e) {
      console.error('Failed to save profile:', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEntry = async (entryId, entryIndexHint = -1) => {
    if (!profile || saving || discarding) return;
    const entries = resolveCompanyInfoEntriesForValidation(profile);
    const baselineEntries = resolveCompanyInfoEntriesForValidation(baseline || {});
    const entryIndexById = entryId ? entries.findIndex((e) => e?.id === entryId) : -1;
    const entryIndex =
      entryIndexById >= 0
        ? entryIndexById
        : Number.isInteger(entryIndexHint) && entryIndexHint >= 0 && entryIndexHint < entries.length
          ? entryIndexHint
          : -1;
    if (entryIndex < 0) return;
    const selectedEntry = entries[entryIndex] || null;
    if (!selectedEntry) return;

    const entryValidation = validateCompanyInfoEntriesList([entries[entryIndex]]);
    if (!entryValidation.ok) {
      const message = String(entryValidation.message || 'Entry is incomplete.').replace(
        /^Entry 1:/,
        `Entry ${entryIndex + 1}:`
      );
      alert(message);
      return;
    }

    const entriesForEntrySave = baselineEntries.map((entry) => ({ ...(entry || {}) }));
    const selectedId = String(selectedEntry?.id || '').trim();
    let replaced = false;
    if (selectedId) {
      for (let i = 0; i < entriesForEntrySave.length; i += 1) {
        const currentId = String(entriesForEntrySave[i]?.id || '').trim();
        if (currentId && currentId === selectedId) {
          entriesForEntrySave[i] = { ...selectedEntry };
          replaced = true;
          break;
        }
      }
    }
    if (!replaced && entryIndexHint >= 0 && entryIndexHint < entriesForEntrySave.length) {
      entriesForEntrySave[entryIndexHint] = { ...selectedEntry };
      replaced = true;
    }
    if (!replaced) {
      entriesForEntrySave.push({ ...selectedEntry });
    }

    const entriesForSave = entriesForEntrySave.filter((entry) => {
      if (!entry) return false;
      return validateCompanyInfoEntriesList([entry]).ok;
    });
    const entriesToPersist = entriesForSave.length > 0 ? entriesForSave : [{ ...selectedEntry }];
    const firstSavedEntry = entriesToPersist[0] || {};
    const profileForEntrySave = {
      ...profile,
      companyInfoEntries: entriesToPersist,
      supplierRole: firstSavedEntry.role || '',
      brands: firstSavedEntry.brands || '',
      gstin: firstSavedEntry.gstin || '',
      companyName: firstSavedEntry.companyName || '',
      minimumOrderValue: firstSavedEntry.minimumOrderValue ?? ''
    };

    try {
      setSavingEntryId(entryId);
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(profileForEntrySave)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save this entry. Please try again.');
        return;
      }
      if (data.chainApprovalPending) {
        alert(data.message || 'Submitted for admin approval.');
      } else {
        alert(`Entry ${entryIndex + 1} saved.`);
      }
      await fetchProfile();
    } catch (e) {
      console.error('Failed to save entry:', e);
      alert('Failed to save this entry. Please try again.');
    } finally {
      setSavingEntryId(null);
    }
  };

  const handleDiscard = async () => {
    if (discarding || saving || !hasUnsavedChanges) return;

    setDiscarding(true);
    try {
      const ok = await fetchProfile();
      if (ok) setEditorResetKey((k) => k + 1);
    } finally {
      setDiscarding(false);
    }
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
        <div className="profile-actions profile-page-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleDiscard}
            disabled={saving || !!savingEntryId || discarding || !hasUnsavedChanges}
            title={hasUnsavedChanges ? 'Revert unsaved edits' : 'No changes to discard'}
          >
            <RotateCcw size={18} strokeWidth={2} aria-hidden />
            {discarding ? 'Discarding…' : 'Discard changes'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || !!savingEntryId || discarding}
          >
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
        {profile?.chainProfileApprovalStatus === 'draft' ? (
          <div
            className="profile-section"
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 10,
              padding: '1rem 1.1rem'
            }}
          >
            <strong style={{ color: '#1d4ed8' }}>Draft saved</strong>
            <p style={{ margin: '0.45rem 0 0', color: '#1e3a8a', fontSize: '0.95rem', lineHeight: 1.45 }}>
              Your latest form values are saved as draft and shown here. Complete the remaining required fields and
              click Save again to submit for admin approval.
              {profile.chainProfileDraftSavedAt
                ? ` Last draft save: ${new Date(profile.chainProfileDraftSavedAt).toLocaleString()}.`
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
          <p className="profile-section-lead">
            Tell us your supply-chain role and brand for upstream matching and orders. Fields marked with{' '}
            <span className="field-required">*</span> are required before you save.
          </p>
          <SupplierSupplyChainEntriesEditor
            key={editorResetKey}
            profile={profile}
            setProfile={setProfile}
            editing
            onSaveEntry={handleSaveEntry}
            savingEntryId={savingEntryId}
          />
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
              <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Total purchase value</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                ₹{Number(discountInsights?.summary?.totalPurchaseValue || 0).toLocaleString()}
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
