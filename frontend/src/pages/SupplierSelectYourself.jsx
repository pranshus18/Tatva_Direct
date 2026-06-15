import React, { useState, useEffect, useMemo } from 'react';
import { UserCheck, Save, RotateCcw } from 'lucide-react';
import { getApiUrl } from '../config/api';
import SupplierSupplyChainEntriesEditor from '../components/SupplierSupplyChainEntriesEditor';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import { validateCompanyInfoEntriesList, validateUniqueBrandsAcrossEntries } from '../utils/supplierChainEntryValidation';
import {
  buildSupplierChainSavePayload,
  buildSupplyChainFormProfile,
  buildSupplyChainSummaryRows,
  deduplicateCompanyInfoEntriesByBrand,
  ensureAtLeastOneCompanyInfoEntry,
  getCompanyInfoEntriesForSave,
  mergeCompanyInfoEntriesById,
  mergeFormStepProfile,
  syncBrandEntriesForSupplyChainStep
} from '../utils/supplierSelectYourselfProfile';
import './Profile.css';
import './Dashboard.css';
import './SupplierSelectYourself.css';

function cloneProfileSnapshot(profile) {
  return profile ? JSON.parse(JSON.stringify(profile)) : null;
}

/** Compare supply-chain form fields only (what this page edits). */
function chainFormSignature(profile) {
  if (!profile) return '';
  const entries = Array.isArray(profile.companyInfoEntries) ? profile.companyInfoEntries : [];
  return JSON.stringify({
    companyInfoEntries: entries.map((e) => ({
      id: e.id || '',
      role: e.role || '',
      brands: e.brands || '',
      gstin: e.gstin || '',
      companyName: e.companyName || '',
      brandApprovalDocumentUrl: e.brandApprovalDocumentUrl || '',
      brandApprovalDocumentUrls: e.brandApprovalDocumentUrls || [],
      authorizationCertificateUrl: e.authorizationCertificateUrl || '',
      authorizationCertificateUrls: e.authorizationCertificateUrls || [],
      minimumOrderValue: e.minimumOrderValue ?? ''
    }))
  });
}

function normalizeProfileForEditor(profileData) {
  if (!profileData) return null;
  const snapshot = cloneProfileSnapshot(profileData);
  const mergedEntries = deduplicateCompanyInfoEntriesByBrand(
    mergeCompanyInfoEntriesById(
      snapshot.companyInfoEntries || [],
      snapshot.approvedChainProfile?.companyInfoEntries || []
    )
  );
  snapshot.companyInfoEntries = ensureAtLeastOneCompanyInfoEntry({
    ...snapshot,
    companyInfoEntries: mergedEntries
  });
  return snapshot;
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
  const [savingBrandApproval, setSavingBrandApproval] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [brandSectionExpanded, setBrandSectionExpanded] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [discountInsights, setDiscountInsights] = useState(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!profile || !baseline) return false;
    return chainFormSignature(profile) !== chainFormSignature(baseline);
  }, [profile, baseline]);

  const { brands: catalogBrands } = useSupplierBrands({ source: 'catalog' });

  const supplyChainSummaryRows = useMemo(
    () => buildSupplyChainSummaryRows(catalogBrands, getCompanyInfoEntriesForSave(profile || {})),
    [catalogBrands, profile]
  );

  const supplyChainFormProfile = useMemo(() => buildSupplyChainFormProfile(profile), [profile]);

  const selectedAssignment = useMemo(
    () => supplyChainSummaryRows.find((row) => row.id === selectedAssignmentId) || null,
    [supplyChainSummaryRows, selectedAssignmentId]
  );

  useEffect(() => {
    if (supplyChainSummaryRows.length === 0) {
      setSelectedAssignmentId('');
      return;
    }
    if (!supplyChainSummaryRows.some((row) => row.id === selectedAssignmentId)) {
      setSelectedAssignmentId(supplyChainSummaryRows[0].id);
    }
  }, [supplyChainSummaryRows, selectedAssignmentId]);

  const applyBrandStepProfile = (next) => {
    const entries = syncBrandEntriesForSupplyChainStep(ensureAtLeastOneCompanyInfoEntry(next));
    setProfile(buildSupplierChainSavePayload({ ...next, companyInfoEntries: entries }));
  };

  const applyProfileFromResponse = (profileData) => {
    const snapshot = normalizeProfileForEditor(profileData);
    if (!snapshot) return false;
    setProfile(snapshot);
    setBaseline(cloneProfileSnapshot(snapshot));
    return true;
  };

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
      return applyProfileFromResponse(data.profile);
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
    const allEntries = getCompanyInfoEntriesForSave(profile);
    const uniqueBrandsCheck = validateUniqueBrandsAcrossEntries(allEntries);
    if (!uniqueBrandsCheck.ok) {
      alert(uniqueBrandsCheck.message);
      return;
    }

    const entries = allEntries.filter((entry) => String(entry?.brands || '').trim());
    const validation =
      entries.length > 0
        ? validateCompanyInfoEntriesList(entries)
        : { ok: false, message: 'Add at least one brand registration below.' };
    const saveAsDraft = !validation.ok;

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const payload = buildSupplierChainSavePayload(
        saveAsDraft ? { ...profile, saveAsDraft: true } : profile,
        getCompanyInfoEntriesForSave(profile)
      );
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
      if (!applyProfileFromResponse(data.profile)) {
        await fetchProfile();
      }
    } catch (e) {
      console.error('Failed to save profile:', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEntry = async (entryId, entryIndexHint = -1) => {
    if (!profile || saving || discarding) return;
    const entries = getCompanyInfoEntriesForSave(profile);
    const uniqueBrandsCheck = validateUniqueBrandsAcrossEntries(entries);
    if (!uniqueBrandsCheck.ok) {
      alert(uniqueBrandsCheck.message);
      return;
    }

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

    const entriesForEntrySave = entries.map((entry) => ({ ...(entry || {}) }));
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

    const profileForEntrySave = buildSupplierChainSavePayload(profile, entriesForEntrySave);

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
        alert(`Brand registration ${entryIndex + 1} saved.`);
      }
      if (!applyProfileFromResponse(data.profile)) {
        await fetchProfile();
      }
    } catch (e) {
      console.error('Failed to save entry:', e);
      alert('Failed to save this entry. Please try again.');
    } finally {
      setSavingEntryId(null);
    }
  };

  const handleSaveBrandApproval = async () => {
    if (!profile || saving || discarding || savingBrandApproval) return;

    const allEntries = getCompanyInfoEntriesForSave(profile);
    const uniqueBrandsCheck = validateUniqueBrandsAcrossEntries(allEntries);
    if (!uniqueBrandsCheck.ok) {
      alert(uniqueBrandsCheck.message);
      return;
    }

    const hasBrand = allEntries.some((entry) => String(entry?.brands || '').trim());
    if (!hasBrand) {
      alert('Select at least one brand before saving.');
      return;
    }

    try {
      setSavingBrandApproval(true);
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...buildSupplierChainSavePayload(profile, syncBrandEntriesForSupplyChainStep(allEntries)),
          userType: profile?.userType || 'supplier',
          saveBrandApprovalOnly: true
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save brand request. Please try again.');
        return;
      }
      alert(data.message || 'Brand saved. Supply-chain role form is ready in Step 2 below.');
      if (!applyProfileFromResponse(data.profile)) {
        await fetchProfile();
      }
    } catch (e) {
      console.error('Failed to save brand approval:', e);
      alert('Failed to save brand request. Please try again.');
    } finally {
      setSavingBrandApproval(false);
    }
  };

  const handleRemoveEntry = (entryId) => {
    if (!profile) return;
    const entries = getCompanyInfoEntriesForSave(profile).filter((entry) => entry.id !== entryId);
    setProfile(
      buildSupplierChainSavePayload(
        profile,
        entries.length > 0 ? entries : ensureAtLeastOneCompanyInfoEntry({ companyInfoEntries: [] })
      )
    );
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
    <div className="profile-container supplier-select-yourself-page">
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
            {saving ? 'Saving…' : 'Save all'}
          </button>
        </div>
      </div>

      <div className="profile-content">
        <p className="supplier-select-page-intro">
          Two separate steps: first pick your <strong>brand</strong>, then in the next section select your{' '}
          <strong>supply-chain role</strong> for that brand. The brand you choose in Step 1 is filled automatically in
          Step 2.
        </p>

        <div className="supplier-select-flow-card" aria-label="Select yourself steps">
          <div className="supplier-select-flow-card__step">
            <span className="supplier-select-flow-card__badge">Step 1</span>
            <span>Brand</span>
          </div>
          <div className="supplier-select-flow-card__arrow" aria-hidden>
            →
          </div>
          <div className="supplier-select-flow-card__step">
            <span className="supplier-select-flow-card__badge">Step 2</span>
            <span>Supply-chain role</span>
          </div>
        </div>

        {supplyChainSummaryRows.length > 0 ? (
          <div className="supplier-select-assignments" aria-label="Your supply chain by brand">
            <strong>Your supply chain by brand ({supplyChainSummaryRows.length})</strong>
            <div className="supplier-select-assignments__picker">
              <label className="supplier-select-assignments__picker-label" htmlFor="assignment-brand-select">
                Select brand
              </label>
              <select
                id="assignment-brand-select"
                className="supplier-select-assignments__picker-select"
                value={selectedAssignmentId}
                onChange={(e) => setSelectedAssignmentId(e.target.value)}
              >
                {supplyChainSummaryRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.brand}
                  </option>
                ))}
              </select>
            </div>
            {selectedAssignment ? (
              <div className="supplier-select-assignments__detail">
                <div className="supplier-select-assignments__detail-row">
                  <span className="supplier-select-assignments__detail-label">Brand</span>
                  <span className="supplier-select-assignments__detail-value">{selectedAssignment.brand}</span>
                </div>
                <div className="supplier-select-assignments__detail-row">
                  <span className="supplier-select-assignments__detail-label">Your role in supply chain</span>
                  <span
                    className={`supplier-select-assignments__role${
                      selectedAssignment.hasRole ? '' : ' supplier-select-assignments__role--pending'
                    }`}
                  >
                    {selectedAssignment.roleLabel}
                  </span>
                </div>
                <div className="supplier-select-assignments__detail-row">
                  <span className="supplier-select-assignments__detail-label">Status</span>
                  {selectedAssignment.hasRole && selectedAssignment.hasRoleDocuments ? (
                    <span className="supplier-select-assignments__status supplier-select-assignments__status--ready">
                      Complete
                    </span>
                  ) : selectedAssignment.hasRole ? (
                    <span className="supplier-select-assignments__status supplier-select-assignments__status--draft">
                      Add documents
                    </span>
                  ) : (
                    <span className="supplier-select-assignments__status supplier-select-assignments__status--pending">
                      Select role
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {profile?.chainProfileApprovalStatus === 'pending' ? (
          <div className="supplier-select-alert supplier-select-alert--pending">
            <strong>Supply-chain profile pending admin approval</strong>
            <p>
              You submitted supply-chain role details for admin review. Until an admin approves them, the platform
              continues to use your previously approved assignment.
              {profile.chainProfilePendingSubmittedAt
                ? ` Submitted: ${new Date(profile.chainProfilePendingSubmittedAt).toLocaleString()}.`
                : ''}
            </p>
          </div>
        ) : null}
        {profile?.chainProfileApprovalStatus === 'draft' ? (
          <div className="supplier-select-alert supplier-select-alert--draft">
            <strong>Draft saved</strong>
            <p>
              Complete the remaining fields and click Save all to submit for admin approval.
              {profile.chainProfileDraftSavedAt
                ? ` Last draft save: ${new Date(profile.chainProfileDraftSavedAt).toLocaleString()}.`
                : ''}
            </p>
          </div>
        ) : null}
        {profile?.chainProfileLastRejection?.reason && profile?.chainProfileApprovalStatus !== 'pending' ? (
          <div className="supplier-select-alert supplier-select-alert--rejected">
            <strong>Previous submission was not approved</strong>
            <p>{profile.chainProfileLastRejection.reason}</p>
          </div>
        ) : null}

        <div className="profile-section supplier-select-section supplier-select-section--brand">
          <div className="supplier-select-section__head">
            <h2>
              <span className="supplier-select-section__label">Step 1</span>
              Brand you are dealing with
            </h2>
            <div className="supplier-select-section__head-actions">
              <button
                type="button"
                className="btn-secondary supplier-select-section__toggle-btn"
                onClick={() => setBrandSectionExpanded((prev) => !prev)}
              >
                {brandSectionExpanded ? 'Collapse' : 'Expand'}
              </button>
              <button
                type="button"
                className="btn-primary supplier-select-section__save-btn"
                onClick={handleSaveBrandApproval}
                disabled={saving || !!savingEntryId || discarding || savingBrandApproval}
              >
                {savingBrandApproval ? 'Saving…' : 'Save brand'}
              </button>
            </div>
          </div>
          {brandSectionExpanded ? (
            <SupplierSupplyChainEntriesEditor
              key={`brand-${editorResetKey}`}
              profile={profile}
              setProfile={applyBrandStepProfile}
              editing
              sectionView="brand"
              selectionMode="dropdown"
              allowEntryManagement
              showAddEntry
              onRemoveEntry={handleRemoveEntry}
            />
          ) : null}
        </div>

        <div className="profile-section supplier-select-section supplier-select-section--form">
          <h2>
            <span className="supplier-select-section__label">Step 2</span>
            Supply-chain role for your brand
          </h2>
          <p className="supplier-select-section__intro">
            For each brand you picked in Step 1, select your role in the supply chain and upload documents. The brand
            name is already filled — do not change it here.
          </p>

          {!supplyChainFormProfile?.companyInfoEntries?.length ? (
            <div className="supplier-select-alert supplier-select-alert--draft">
              <strong>No supply-chain forms yet</strong>
              <p>
                Select a brand in <strong>Step 1</strong> above. A matching supply-chain role form will appear here
                automatically with that brand filled in.
              </p>
            </div>
          ) : null}

          {supplyChainFormProfile ? (
            <SupplierSupplyChainEntriesEditor
              key={`form-${editorResetKey}`}
              profile={supplyChainFormProfile}
              setProfile={(next) =>
                setProfile(
                  mergeFormStepProfile(
                    profile,
                    buildSupplierChainSavePayload(next, next.companyInfoEntries || [])
                  )
                )
              }
              editing
              sectionView="form"
              selectionMode="all"
              allowEntryManagement={false}
              showAddEntry={false}
              onSaveEntry={handleSaveEntry}
              savingEntryId={savingEntryId}
            />
          ) : null}
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
