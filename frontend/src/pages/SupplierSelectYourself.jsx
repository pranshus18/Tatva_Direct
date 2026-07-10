import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { UserCheck, Save, RotateCcw } from 'lucide-react';
import { getApiUrl } from '../config/api';
import SupplierSupplyChainEntriesEditor from '../components/SupplierSupplyChainEntriesEditor';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import {
  brandKeyForDuplicateCheck,
  validateCompanyInfoEntriesList,
  validateUniqueBrandsAcrossEntries
} from '../utils/supplierChainEntryValidation';
import {
  buildApprovedBaselineSnapshot,
  buildSupplierChainSavePayload,
  buildSupplyChainFormProfile,
  buildSupplyChainSummaryRows,
  deduplicateCompanyInfoEntriesByBrand,
  detectEntryRoleChanges,
  ensureAtLeastOneCompanyInfoEntry,
  formatSupplyChainRoleLabel,
  getApprovedBaselineEntries,
  getCompanyInfoEntriesForSave,
  mergeCompanyInfoEntriesById,
  mergeFormStepProfile,
  normalizeProfileForEditor,
  syncBrandEntriesForSupplyChainStep
} from '../utils/supplierSelectYourselfProfile';
import { formatDateTimeIST } from '../utils/dateTime';
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
  const [focusSupplyChainEntryId, setFocusSupplyChainEntryId] = useState('');
  const [discountInsights, setDiscountInsights] = useState(null);
  const [assignmentChainInfo, setAssignmentChainInfo] = useState({ loading: false, data: null });
  const supplyChainSectionRef = useRef(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!profile || !baseline) return false;
    return chainFormSignature(profile) !== chainFormSignature(baseline);
  }, [profile, baseline]);

  const { brands: catalogBrands } = useSupplierBrands({ source: 'catalog' });

  const approvedBaselineEntries = useMemo(
    () => getApprovedBaselineEntries(baseline || profile || {}),
    [baseline, profile]
  );

  const supplyChainSummaryRows = useMemo(
    () =>
      buildSupplyChainSummaryRows(
        catalogBrands,
        getCompanyInfoEntriesForSave(profile || {}),
        approvedBaselineEntries
      ),
    [catalogBrands, profile, approvedBaselineEntries]
  );

  const supplyChainFormProfile = useMemo(
    () => buildSupplyChainFormProfile(profile, approvedBaselineEntries),
    [profile, approvedBaselineEntries]
  );

  const hasSavedBrandEntries = useMemo(
    () =>
      getCompanyInfoEntriesForSave(profile || {}).some((entry) => String(entry?.brands || '').trim()),
    [profile]
  );

  const chainReadyBrandCount = useMemo(
    () => supplyChainSummaryRows.filter((row) => row.hasAdminSupplyChain).length,
    [supplyChainSummaryRows]
  );

  const selectedAssignment = useMemo(
    () => supplyChainSummaryRows.find((row) => row.id === selectedAssignmentId) || null,
    [supplyChainSummaryRows, selectedAssignmentId]
  );

  useEffect(() => {
    if (supplyChainSummaryRows.length === 0) {
      setSelectedAssignmentId('');
      return;
    }
    if (
      selectedAssignmentId &&
      !supplyChainSummaryRows.some((row) => row.id === selectedAssignmentId)
    ) {
      setSelectedAssignmentId('');
    }
  }, [supplyChainSummaryRows, selectedAssignmentId]);

  const selectedAssignmentChainState = useMemo(() => {
    const brand = String(selectedAssignment?.brand || '').trim();
    const payload = assignmentChainInfo.data;
    if (!brand || !payload || !Array.isArray(payload.brands)) return null;
    const brandKey = brandKeyForDuplicateCheck(brand);
    return (
      payload.brands.find(
        (row) => brandKeyForDuplicateCheck(row?.brand || row?.normalizedBrand) === brandKey
      ) || null
    );
  }, [assignmentChainInfo.data, selectedAssignment?.brand]);

  const selectedAssignmentHasAdminChain = useMemo(() => {
    if (selectedAssignmentChainState?.hasSupplyChainDefinition) return true;
    if (selectedAssignment?.hasAdminSupplyChain) return true;
    const brandKey = brandKeyForDuplicateCheck(selectedAssignment?.brand || '');
    if (!brandKey) return false;
    return catalogBrands.some(
      (item) =>
        brandKeyForDuplicateCheck(typeof item === 'string' ? item : item?.name) === brandKey &&
        item?.hasAdminSupplyChain === true
    );
  }, [catalogBrands, selectedAssignment?.brand, selectedAssignment?.hasAdminSupplyChain, selectedAssignmentChainState]);

  useEffect(() => {
    const brand = String(selectedAssignment?.brand || '').trim();
    if (!brand) {
      setAssignmentChainInfo({ loading: false, data: null });
      return undefined;
    }

    let cancelled = false;
    const loadAssignmentChain = async () => {
      setAssignmentChainInfo({ loading: true, data: null });
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(
          getApiUrl(`/api/profile/supplier/chain-role-options?brands=${encodeURIComponent(brand)}`),
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json().catch(() => ({}));
        if (!cancelled) {
          setAssignmentChainInfo({
            loading: false,
            data: response.ok && data?.status === 'success' ? data : null
          });
        }
      } catch (error) {
        console.error('Failed to load assignment chain info:', error);
        if (!cancelled) {
          setAssignmentChainInfo({ loading: false, data: null });
        }
      }
    };

    loadAssignmentChain();
    return () => {
      cancelled = true;
    };
  }, [selectedAssignment?.brand]);

  const applyBrandStepProfile = (next) => {
    const entries = syncBrandEntriesForSupplyChainStep(ensureAtLeastOneCompanyInfoEntry(next));
    setProfile(buildSupplierChainSavePayload({ ...next, companyInfoEntries: entries }));
  };

  const applyProfileSnapshot = (profileData) => {
    const snapshot = normalizeProfileForEditor(profileData);
    if (!snapshot) return false;
    setProfile(snapshot);
    setBaseline(cloneProfileSnapshot(buildApprovedBaselineSnapshot(profileData)));
    return true;
  };

  const applyProfileFromResponse = (profileData) => {
    if (!profileData) return false;
    return applyProfileSnapshot(profileData);
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

  const findProfileEntryIdForBrand = useCallback(
    (brandName) => {
      const brandKey = brandKeyForDuplicateCheck(brandName);
      if (!brandKey) return '';
      const entry = getCompanyInfoEntriesForSave(profile || {}).find(
        (row) => brandKeyForDuplicateCheck(row?.brands) === brandKey
      );
      return String(entry?.id || '').trim();
    },
    [profile]
  );

  const hasEffectiveRoleForBrand = useCallback(
    (brandName) => {
      const brandKey = brandKeyForDuplicateCheck(brandName);
      if (!brandKey) return false;
      const currentEntry = getCompanyInfoEntriesForSave(profile || {}).find(
        (row) => brandKeyForDuplicateCheck(row?.brands) === brandKey
      );
      if (String(currentEntry?.role || '').trim()) return true;
      const baselineEntry = approvedBaselineEntries.find(
        (row) => brandKeyForDuplicateCheck(row?.brands) === brandKey
      );
      return !!String(baselineEntry?.role || '').trim();
    },
    [approvedBaselineEntries, profile]
  );

  const promptAddRoleForBrand = useCallback(
    (brandLabel) => {
      const label = String(brandLabel || '').trim();
      if (!label) return false;
      if (hasEffectiveRoleForBrand(label)) return false;
      return window.confirm(
        `${label} does not have a supply-chain role yet.\n\nDo you want to add a role?`
      );
    },
    [hasEffectiveRoleForBrand]
  );

  const ensureBrandEntryForSupplyChain = useCallback(
    (brandLabel) => {
      const label = String(brandLabel || '').trim();
      if (!label || !profile) return '';

      const existingId = findProfileEntryIdForBrand(label);
      if (existingId) return existingId;

      const entries = getCompanyInfoEntriesForSave(profile);
      const newEntry = {
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `entry-${Date.now()}`,
        role: '',
        brands: label,
        gstin: '',
        companyName: '',
        ownershipDetails: '',
        brandApprovalDocumentUrls: [],
        brandApprovalDocumentUrl: '',
        authorizationCertificateUrls: [],
        authorizationCertificateUrl: '',
        minimumOrderValue: '',
        supplyChainRegistrationStarted: true
      };
      setProfile(
        buildSupplierChainSavePayload(
          profile,
          syncBrandEntriesForSupplyChainStep([...entries, newEntry])
        )
      );
      return newEntry.id;
    },
    [findProfileEntryIdForBrand, profile]
  );

  const navigateToAddRole = useCallback(
    (rowOrBrand) => {
      const row =
        rowOrBrand && typeof rowOrBrand === 'object'
          ? rowOrBrand
          : supplyChainSummaryRows.find(
              (item) =>
                brandKeyForDuplicateCheck(item.brand) === brandKeyForDuplicateCheck(String(rowOrBrand || ''))
            ) || null;
      const brandLabel = String(row?.brand || rowOrBrand || '').trim();
      if (!brandLabel) return;

      const entryId = ensureBrandEntryForSupplyChain(brandLabel);
      if (!entryId) {
        setBrandSectionExpanded(true);
        window.requestAnimationFrame(() => {
          document
            .querySelector('.supplier-select-section--brand')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }

      setFocusSupplyChainEntryId(entryId);
      window.requestAnimationFrame(() => {
        supplyChainSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [ensureBrandEntryForSupplyChain, supplyChainSummaryRows]
  );

  const handleAssignmentBrandChange = (event) => {
    const nextId = event.target.value;
    setSelectedAssignmentId(nextId);
    const nextRow = supplyChainSummaryRows.find((row) => row.id === nextId);
    if (!nextRow?.brand) return;

    const entryId = ensureBrandEntryForSupplyChain(nextRow.brand);
    if (entryId) {
      setFocusSupplyChainEntryId(entryId);
      window.requestAnimationFrame(() => {
        supplyChainSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const handleBrandPickedWithoutRole = useCallback(
    (brandName) => {
      const label = String(brandName || '').trim();
      if (!label) return;
      if (!promptAddRoleForBrand(label)) return;
      navigateToAddRole(label);
    },
    [navigateToAddRole, promptAddRoleForBrand]
  );

  const handleFocusEntryHandled = useCallback(() => {
    setFocusSupplyChainEntryId('');
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
    const roleChanges = detectEntryRoleChanges(baseline, profile);
    if (roleChanges.length > 0 && !validation.ok) {
      alert(
        `You changed the supply-chain role for ${roleChanges[0].brand || 'a brand'}. Complete all required fields for that brand, then save to submit the role change for admin approval.`
      );
      return;
    }
    const saveAsDraft = !validation.ok;

    if (roleChanges.length > 0 && !saveAsDraft) {
      const summary = roleChanges
        .map((change) => `${change.brand}: ${change.fromRoleLabel} -> ${change.toRoleLabel}`)
        .join('\n');
      if (
        !window.confirm(
          `Changing your supply-chain role requires admin approval.\n\n${summary}\n\nSubmit for admin approval now?`
        )
      ) {
        return;
      }
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const payload = buildSupplierChainSavePayload(
        profile,
        getCompanyInfoEntriesForSave(profile),
        { forApi: true, saveAsDraft: saveAsDraft || undefined }
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
    const formEntries = getCompanyInfoEntriesForSave(supplyChainFormProfile || profile);
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
    const formEntry =
      formEntries.find((entry) => String(entry?.id || '') === String(entryId || '')) || null;
    const selectedEntry = formEntry || entries[entryIndex] || null;
    if (!selectedEntry) return;

    const roleChanges = detectEntryRoleChanges(baseline, profile).filter(
      (change) => String(change.entryId || '') === String(selectedEntry.id || '')
    );

    const entryValidation = validateCompanyInfoEntriesList([selectedEntry]);
    if (!entryValidation.ok) {
      if (roleChanges.length > 0) {
        alert(
          `You changed the supply-chain role for ${selectedEntry.brands || 'this brand'}. Upload role documents and complete required fields, then save to submit for admin approval.`
        );
        return;
      }
      const message = String(entryValidation.message || 'Entry is incomplete.').replace(
        /^Entry 1:/,
        `Entry ${entryIndex + 1}:`
      );
      alert(message);
      return;
    }

    if (roleChanges.length > 0) {
      const change = roleChanges[0];
      if (
        !window.confirm(
          `Change supply-chain role for ${change.brand} from ${change.fromRoleLabel} to ${change.toRoleLabel}?\n\nThis requires admin approval. Your current approved role stays active until admin approves.`
        )
      ) {
        return;
      }
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

    const profileForEntrySave = buildSupplierChainSavePayload(profile, entriesForEntrySave, {
      forApi: true,
      saveSupplyChainEntryId: selectedEntry?.id || entryId
    });

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
        body: JSON.stringify(
          buildSupplierChainSavePayload(profile, syncBrandEntriesForSupplyChainStep(allEntries), {
            forApi: true,
            saveBrandApprovalOnly: true
          })
        )
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
          Admin defines each brand&apos;s supply chain once. Any supplier can select a brand below and pick their
          role from that admin-defined chain — no prior setup required.
        </p>

        {!hasSavedBrandEntries && chainReadyBrandCount > 0 ? (
          <div className="supplier-select-alert supplier-select-alert--draft">
            <strong>Welcome — pick your brand</strong>
            <p>
              Admin has already set up supply chains for {chainReadyBrandCount} brand
              {chainReadyBrandCount === 1 ? '' : 's'}. Select a brand in the dropdown below to see the chain and choose
              your role in Step 2.
            </p>
          </div>
        ) : null}

        <div className="supplier-select-flow-card" aria-label="Select yourself steps">
          <div className="supplier-select-flow-card__step">
            <span className="supplier-select-flow-card__badge">Step 1</span>
            <span>Add a New Brand for Approval</span>
          </div>
          <div className="supplier-select-flow-card__arrow" aria-hidden>
            →
          </div>
          <div className="supplier-select-flow-card__step">
            <span className="supplier-select-flow-card__badge">Step 2</span>
            <span>Select a Supply-Chain Role for an Existing Brand</span>
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
                onChange={handleAssignmentBrandChange}
              >
                <option value="">Select brand</option>
                {supplyChainSummaryRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.brand}
                    {row.hasAdminSupplyChain ? ' — supply chain ready' : ''}
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
                  <span className="supplier-select-assignments__detail-label">Admin supply chain</span>
                  {assignmentChainInfo.loading ? (
                    <span className="supplier-select-assignments__chain-hint">Loading…</span>
                  ) : selectedAssignmentHasAdminChain ? (
                    <span className="supplier-select-assignments__chain-value">
                      {(selectedAssignmentChainState?.roles || [])
                        .map((role) => formatSupplyChainRoleLabel(role))
                        .join(' → ') || 'Defined by admin'}
                    </span>
                  ) : (
                    <span className="supplier-select-assignments__chain-hint supplier-select-assignments__chain-hint--missing">
                      Not defined by admin yet
                    </span>
                  )}
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
                {!selectedAssignment.hasRole ? (
                  <div className="supplier-select-assignments__role-prompt">
                    <p>
                      {selectedAssignmentHasAdminChain
                        ? 'Admin has defined the supply chain for this brand. Pick your role in Step 2 below.'
                        : 'This brand does not have a supply-chain role yet.'}
                    </p>
                    <button
                      type="button"
                      className="btn-primary supplier-select-assignments__role-prompt-btn"
                      onClick={() => navigateToAddRole(selectedAssignment)}
                    >
                      {selectedAssignmentHasAdminChain ? 'Select role' : 'Add role'}
                    </button>
                  </div>
                ) : null}
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
                ? ` Submitted: ${formatDateTimeIST(profile.chainProfilePendingSubmittedAt, '—')}.`
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
                ? ` Last draft save: ${formatDateTimeIST(profile.chainProfileDraftSavedAt, '—')}.`
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
              Add a New Brand for Approval
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
              showAddEntry={false}
              approvedBaselineEntries={approvedBaselineEntries}
              onBrandPickedWithoutRole={handleBrandPickedWithoutRole}
            />
          ) : null}
        </div>

        <div
          ref={supplyChainSectionRef}
          className="profile-section supplier-select-section supplier-select-section--form"
        >
          <h2>
            <span className="supplier-select-section__label">Step 2</span>
            Select a Supply-Chain Role for an Existing Brand
          </h2>
          <p className="supplier-select-section__intro">
            Select a brand above, then choose your role from the admin-defined supply chain and upload documents.
            The brand name is filled automatically — do not change it here.
          </p>

          {!selectedAssignmentId ? (
            <div className="supplier-select-alert supplier-select-alert--draft">
              <strong>Select a brand to continue</strong>
              <p>
                Pick any brand from the <strong>Your supply chain by brand</strong> dropdown above. If admin has defined
                its supply chain, your role options will appear here automatically.
              </p>
            </div>
          ) : null}

          {!supplyChainFormProfile?.companyInfoEntries?.length && selectedAssignmentId ? (
            <div className="supplier-select-alert supplier-select-alert--draft">
              <strong>No supply-chain forms yet</strong>
              <p>
                Select a brand in <strong>Step 1</strong> above. A matching supply-chain role form will appear here
                automatically with that brand filled in.
              </p>
            </div>
          ) : null}

          {supplyChainFormProfile && selectedAssignmentId ? (
            <SupplierSupplyChainEntriesEditor
              key={`form-${editorResetKey}`}
              profile={supplyChainFormProfile}
              approvedBaselineEntries={approvedBaselineEntries}
              setProfile={(next) => setProfile(mergeFormStepProfile(profile, next))}
              editing
              sectionView="form"
              selectionMode="all"
              allowEntryManagement={false}
              showAddEntry={false}
              onSaveEntry={handleSaveEntry}
              savingEntryId={savingEntryId}
              focusEntryId={focusSupplyChainEntryId}
              onFocusEntryHandled={handleFocusEntryHandled}
              filterBrandName={selectedAssignment?.brand || ''}
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
