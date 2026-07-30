import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { UserCheck, RotateCcw } from 'lucide-react';
import { resolveApiPath } from '../config/api';
import SupplierSupplyChainEntriesEditor from '../components/SupplierSupplyChainEntriesEditor';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import {
  brandKeyForDuplicateCheck,
  findApprovedCatalogBrandMatch,
  formatApprovedCatalogBrandMatchMessage,
  validateUniqueBrandsAcrossEntries
} from '../utils/supplierChainEntryValidation';
import { validateSelectYourselfChainEntries } from '../utils/supplierSelectYourselfValidation';
import {
  buildSupplierChainSavePayload,
  buildSupplyChainFormProfile,
  buildSupplyChainSummaryRows,
  BRAND_REQUIRED_BEFORE_SAVE_MESSAGE,
  deduplicateCompanyInfoEntriesByBrand,
  detectEntryRoleChanges,
  ensureAtLeastOneCompanyInfoEntry,
  findSupplierBrandRequest,
  formatSupplyChainRoleLabel,
  getApprovedBaselineEntries,
  getCompanyInfoEntriesForSave,
  mergeCompanyInfoEntriesById,
  mergeFormStepProfile,
  normalizeProfileForEditor,
  syncBrandEntriesForSupplyChainStep,
  isBrandApprovedForSupplyChainStep,
  profileHasConfiguredBrand,
  mergeSupplierBrandRequestsIntoProfile,
  buildBrandApprovalDetailsSignature,
  isBrandApprovalSaveBlockedForPendingRequests,
  BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE,
  SUPPLY_CHAIN_NOT_DEFINED_MESSAGE
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
  const [savingEntryId, setSavingEntryId] = useState(null);
  const [savingBrandApproval, setSavingBrandApproval] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [brandSectionExpanded, setBrandSectionExpanded] = useState(true);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [focusSupplyChainEntryId, setFocusSupplyChainEntryId] = useState('');
  const [discountInsights, setDiscountInsights] = useState(null);
  const [assignmentChainInfo, setAssignmentChainInfo] = useState({ loading: false, data: null });
  const [brandSubmissionNotice, setBrandSubmissionNotice] = useState(null);
  const [brandApprovalSubmittedSignature, setBrandApprovalSubmittedSignature] = useState('');
  const [chainConfigNotice, setChainConfigNotice] = useState(null);
  const [requestingChainConfigBrand, setRequestingChainConfigBrand] = useState('');
  const supplyChainSectionRef = useRef(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!profile || !baseline) return false;
    return chainFormSignature(profile) !== chainFormSignature(baseline);
  }, [profile, baseline]);

  const {
    brands: catalogBrands,
    brandNames: catalogBrandNames,
    loading: catalogBrandsLoading,
    error: catalogBrandsError,
    reload: reloadCatalogBrands
  } = useSupplierBrands({
    source: 'catalog'
  });

  const approvedBaselineEntries = useMemo(
    () => getApprovedBaselineEntries(baseline || profile || {}),
    [baseline, profile]
  );

  /** Brands the supplier may use for Step 2 role setup after admin approval / catalog selection. */
  const effectiveApprovedBrands = useMemo(() => {
    const merged = [];
    const seen = new Set();
    const rejectedKeys = new Set(
      (Array.isArray(profile?.supplierBrandRequests) ? profile.supplierBrandRequests : [])
        .filter((row) => String(row?.status || '').toLowerCase() === 'rejected')
        .filter((row) => !/duplicate of approved brand/i.test(String(row?.rejectionReason || '')))
        .map((row) => brandKeyForDuplicateCheck(row?.normalizedName || row?.name))
        .filter(Boolean)
    );

    const push = (name, status = 'approved') => {
      const label = String(name || '').trim();
      const key = brandKeyForDuplicateCheck(label);
      if (!label || !key || seen.has(key) || rejectedKeys.has(key)) return;
      if (String(status || 'approved').toLowerCase() !== 'approved') return;
      seen.add(key);
      merged.push({ name: label, status: 'approved' });
    };

    for (const item of Array.isArray(profile?.adminApprovedBrands) ? profile.adminApprovedBrands : []) {
      push(typeof item === 'string' ? item : item?.name, typeof item === 'object' ? item?.status : 'approved');
    }

    for (const item of Array.isArray(profile?.supplierBrandRequests) ? profile.supplierBrandRequests : []) {
      if (String(item?.status || '').toLowerCase() === 'approved') {
        push(item?.name || item?.normalizedName, 'approved');
      }
    }

    const catalogApprovedKeys = new Set();
    for (const item of Array.isArray(catalogBrands) ? catalogBrands : []) {
      const brand = String(typeof item === 'string' ? item : item?.name || '').trim();
      const status =
        typeof item === 'object' ? String(item?.status || 'approved').toLowerCase() : 'approved';
      if (!brand || status !== 'approved') continue;
      const key = brandKeyForDuplicateCheck(brand);
      if (key) catalogApprovedKeys.add(key);
      // Path A: every admin-approved catalog brand is eligible to select (Layer 1 → access).
      push(brand, 'approved');
    }

    for (const entry of getCompanyInfoEntriesForSave(profile || {})) {
      const brand = String(entry?.brands || '').trim();
      if (!brand) continue;
      const key = brandKeyForDuplicateCheck(brand);
      if (key && catalogApprovedKeys.has(key)) {
        push(brand, 'approved');
      }
    }

    return merged;
  }, [catalogBrands, profile]);

  const supplyChainSummaryRows = useMemo(
    () =>
      buildSupplyChainSummaryRows(
        catalogBrands,
        getCompanyInfoEntriesForSave(profile || {}),
        approvedBaselineEntries,
        effectiveApprovedBrands,
        profile?.supplierBrandRequests || []
      ),
    [catalogBrands, profile, approvedBaselineEntries, effectiveApprovedBrands]
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

  const pendingBrandRequests = useMemo(() => {
    const requests = Array.isArray(profile?.supplierBrandRequests) ? profile.supplierBrandRequests : [];
    return requests
      .filter((row) => String(row?.status || '').toLowerCase() === 'pending')
      .map((row) => ({
        name: String(row?.name || '').trim(),
        submittedAt: row?.submittedAt || row?.requestedAt || row?.createdAt || null
      }))
      .filter((row) => row.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [profile?.supplierBrandRequests]);

  const brandSaveBlockedForPending = useMemo(() => {
    const noticePendingNames =
      brandSubmissionNotice?.tone === 'pending' && Array.isArray(brandSubmissionNotice.brands)
        ? brandSubmissionNotice.brands.map((row) => row?.name).filter(Boolean)
        : [];
    return isBrandApprovalSaveBlockedForPendingRequests({
      profile,
      catalogBrands,
      submittedSignature: brandApprovalSubmittedSignature,
      extraPendingBrandNames: noticePendingNames
    });
  }, [profile, catalogBrands, brandApprovalSubmittedSignature, brandSubmissionNotice]);
  const chainReadyBrandCount = useMemo(
    () => supplyChainSummaryRows.filter((row) => row.hasAdminSupplyChain).length,
    [supplyChainSummaryRows]
  );
  const approvedBrandCount = supplyChainSummaryRows.length;

  const selectedAssignment = useMemo(
    () => supplyChainSummaryRows.find((row) => row.id === selectedAssignmentId) || null,
    [supplyChainSummaryRows, selectedAssignmentId]
  );

  useEffect(() => {
    if (supplyChainSummaryRows.length === 0) {
      if (selectedAssignmentId) setSelectedAssignmentId('');
      return;
    }

    // Keep an existing manual selection if it is still in the list.
    // Do not auto-pick a brand — the dropdown should stay on the placeholder
    // until the supplier selects one.
    const selectionStillValid =
      selectedAssignmentId &&
      supplyChainSummaryRows.some((row) => row.id === selectedAssignmentId);
    if (selectionStillValid) return;

    if (selectedAssignmentId) setSelectedAssignmentId('');
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
          resolveApiPath(`/api/profile/supplier/chain-role-options?brands=${encodeURIComponent(brand)}`),
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
    // Discard must compare against the last saved editor state, not an approved-only
    // subset — otherwise the button stays active with no local edits.
    setBaseline(cloneProfileSnapshot(snapshot));
    const hasPendingRequest = (Array.isArray(snapshot.supplierBrandRequests) ? snapshot.supplierBrandRequests : [])
      .some((row) => String(row?.status || '').toLowerCase() === 'pending');
    setBrandApprovalSubmittedSignature(
      hasPendingRequest ? buildBrandApprovalDetailsSignature(snapshot, catalogBrands) : ''
    );
    return true;
  };

  const applyProfileFromResponse = (profileData) => {
    if (!profileData) return false;
    return applyProfileSnapshot(profileData);
  };

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(resolveApiPath('/api/profile'), {
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

  // Keep approved brands / role options fresh after admin approval in another session.
  useEffect(() => {
    const refreshApprovedState = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      fetchProfile();
      reloadCatalogBrands?.();
    };
    window.addEventListener('focus', refreshApprovedState);
    document.addEventListener('visibilitychange', refreshApprovedState);
    return () => {
      window.removeEventListener('focus', refreshApprovedState);
      document.removeEventListener('visibilitychange', refreshApprovedState);
    };
  }, [reloadCatalogBrands]);

  useEffect(() => {
    const fetchDiscountInsights = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(resolveApiPath('/api/supplier/analytics/discount-insights'), {
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

  const brandHasAdminConfiguredRoles = useCallback(
    (brandName) => {
      const brandKey = brandKeyForDuplicateCheck(brandName);
      if (!brandKey) return false;
      if (
        supplyChainSummaryRows.some(
          (row) =>
            brandKeyForDuplicateCheck(row?.brand) === brandKey && row.hasAdminSupplyChain === true
        )
      ) {
        return true;
      }
      return catalogBrands.some((item) => {
        const name = typeof item === 'string' ? item : item?.name;
        return (
          brandKeyForDuplicateCheck(name) === brandKey &&
          typeof item === 'object' &&
          item?.hasAdminSupplyChain === true
        );
      });
    },
    [catalogBrands, supplyChainSummaryRows]
  );

  const requestChainConfigurationForBrand = useCallback(async (brandName) => {
    const brand = String(brandName || '').trim();
    if (!brand) return { ok: false, message: 'Brand name is required' };
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(resolveApiPath('/api/profile/supplier/request-chain-configuration'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ brand })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        return {
          ok: false,
          message: data.message || 'Failed to notify admin. Please try again.'
        };
      }
      return {
        ok: true,
        message:
          data.message ||
          'Admin has been notified to configure supply-chain roles for this brand.'
      };
    } catch (_err) {
      return { ok: false, message: 'Failed to notify admin. Please try again.' };
    }
  }, []);

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

      const assignmentRow =
        row?.id && supplyChainSummaryRows.some((item) => item.id === row.id)
          ? row
          : supplyChainSummaryRows.find(
              (item) =>
                brandKeyForDuplicateCheck(item.brand) === brandKeyForDuplicateCheck(brandLabel)
            ) || null;
      if (assignmentRow?.id) {
        setSelectedAssignmentId(assignmentRow.id);
      } else {
        // Entry exists locally; summary row may appear on next render — use entry id as fallback key.
        setSelectedAssignmentId(entryId);
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
    setChainConfigNotice(null);
    const nextRow = supplyChainSummaryRows.find((row) => row.id === nextId);
    if (!nextRow?.brand) {
      setFocusSupplyChainEntryId('');
      return;
    }

    // Prefer an existing saved entry. Only create a local draft when the brand has no
    // profile row yet — that draft is discardable until the supplier saves.
    const existingId = findProfileEntryIdForBrand(nextRow.brand);
    if (existingId) {
      setFocusSupplyChainEntryId(existingId);
      return;
    }
    if (hasEffectiveRoleForBrand(nextRow.brand)) {
      setFocusSupplyChainEntryId('');
      return;
    }
    const entryId = ensureBrandEntryForSupplyChain(nextRow.brand);
    setFocusSupplyChainEntryId(entryId || '');
  };

  const handleBrandPickedWithoutRole = useCallback(
    (brandName) => {
      const label = String(brandName || '').trim();
      if (!label) return;
      if (hasEffectiveRoleForBrand(label)) return;
      // Suppliers never create supply-chain roles — only select admin-configured ones.
      // Navigate to role setup so the form can show role options or the admin-wait message.
      navigateToAddRole(label);
      if (!brandHasAdminConfiguredRoles(label)) {
        setChainConfigNotice({
          brand: label,
          tone: 'warning',
          message:
            'No supply-chain roles are currently configured for this brand. Please contact Admin or wait until a role is configured.'
        });
      } else {
        setChainConfigNotice(null);
      }
    },
    [brandHasAdminConfiguredRoles, hasEffectiveRoleForBrand, navigateToAddRole]
  );

  const handleFocusEntryHandled = useCallback(() => {
    setFocusSupplyChainEntryId('');
  }, []);

  const handleSaveEntry = async (entryId, entryIndexHint = -1) => {
    if (!profile || savingBrandApproval || discarding) return;
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

    const selectedBrand = String(selectedEntry.brands || '').trim();
    if (!selectedBrand) {
      alert(BRAND_REQUIRED_BEFORE_SAVE_MESSAGE);
      setBrandSectionExpanded(true);
      return;
    }    const selectedBrandState = assignmentChainInfo.data?.brands?.find(
      (row) =>
        brandKeyForDuplicateCheck(row?.brand || row?.normalizedBrand) ===
        brandKeyForDuplicateCheck(selectedBrand)
    );
    if (
      selectedBrand &&
      !isBrandApprovedForSupplyChainStep(
        selectedBrand,
        effectiveApprovedBrands,
        selectedBrandState || null,
        profile?.supplierBrandRequests || [],
        catalogBrands
      )
    ) {
      alert(BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE);
      return;
    }

    const roleChanges = detectEntryRoleChanges(baseline, profile).filter(
      (change) => String(change.entryId || '') === String(selectedEntry.id || '')
    );

    const entryValidation = validateSelectYourselfChainEntries([selectedEntry]);
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
      const response = await fetch(resolveApiPath('/api/profile'), {
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
    if (!profile || savingBrandApproval || discarding || !!savingEntryId) return;
    if (
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands,
        submittedSignature: brandApprovalSubmittedSignature,
        extraPendingBrandNames:
          brandSubmissionNotice?.tone === 'pending' && Array.isArray(brandSubmissionNotice.brands)
            ? brandSubmissionNotice.brands.map((row) => row?.name).filter(Boolean)
            : []
      })
    ) {
      return;
    }

    const allEntries = getCompanyInfoEntriesForSave(profile);
    const uniqueBrandsCheck = validateUniqueBrandsAcrossEntries(allEntries);
    if (!uniqueBrandsCheck.ok) {
      alert(uniqueBrandsCheck.message);
      return;
    }

    if (!profileHasConfiguredBrand(allEntries)) {
      alert(BRAND_REQUIRED_BEFORE_SAVE_MESSAGE);
      setBrandSectionExpanded(true);
      return;
    }

    const brandsBeingSaved = [
      ...new Set(
        allEntries
          .map((entry) => String(entry?.brands || '').trim())
          .filter(Boolean)
      )
    ];
    if (brandsBeingSaved.length === 0) {
      alert(BRAND_REQUIRED_BEFORE_SAVE_MESSAGE);
      setBrandSectionExpanded(true);
      return;
    }
    // Block brand requests that match an approved catalog brand by exact identity only.
    // Soft suggestions while typing must not block save — suppliers pick from the list to use Path A.
    for (const brandName of brandsBeingSaved) {
      const catalogMatch = findApprovedCatalogBrandMatch(brandName, catalogBrands);
      if (!catalogMatch?.name) continue;
      const isLiteralCatalogPick = (Array.isArray(catalogBrands) ? catalogBrands : []).some(
        (item) => {
          const name = typeof item === 'string' ? item : item?.name;
          return String(name || '').trim().toLowerCase() === brandName.toLowerCase();
        }
      );
      if (isLiteralCatalogPick) continue;
      alert(formatApprovedCatalogBrandMatchMessage(brandName, catalogMatch.name));
      setBrandSectionExpanded(true);
      return;
    }

    try {
      setSavingBrandApproval(true);
      const token = localStorage.getItem('token');
      const response = await fetch(resolveApiPath('/api/profile'), {
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

      const nextProfile = data.profile || null;
      const requestSource = nextProfile?.supplierBrandRequests || profile?.supplierBrandRequests || [];
      const approvalFailureRows = (Array.isArray(data.brandApprovals) ? data.brandApprovals : [])
        .map((row) => {
          const name = String(row?.brand || row?.name || '').trim();
          if (!name) return null;
          const code = String(row?.code || '').toLowerCase();
          const status =
            String(row?.status || '').toLowerCase() ||
            (code === 'brand_approval_pending' || code === 'brand_approval_required' ? 'pending' : '');
          if (status !== 'pending' && code !== 'brand_approval_pending') return null;
          const submittedAt =
            row?.submittedAt || row?.requestedAt || new Date().toISOString();
          return {
            name,
            status: 'pending',
            submittedAt,
            requestedAt: row?.requestedAt || submittedAt
          };
        })
        .filter(Boolean);

      const approvedCatalogKeys = new Set(
        (Array.isArray(catalogBrands) ? catalogBrands : [])
          .filter((item) => {
            const status =
              typeof item === 'object' ? String(item?.status || 'approved').toLowerCase() : 'approved';
            return status === 'approved';
          })
          .map((item) => brandKeyForDuplicateCheck(typeof item === 'string' ? item : item?.name))
          .filter(Boolean)
      );
      const adminApprovedKeys = new Set(
        (Array.isArray(nextProfile?.adminApprovedBrands)
          ? nextProfile.adminApprovedBrands
          : Array.isArray(profile?.adminApprovedBrands)
            ? profile.adminApprovedBrands
            : []
        )
          .map((item) =>
            brandKeyForDuplicateCheck(typeof item === 'string' ? item : item?.name)
          )
          .filter(Boolean)
      );

      const submittedRows = brandsBeingSaved.map((brandName) => {
        const request = findSupplierBrandRequest(brandName, [
          ...requestSource,
          ...approvalFailureRows
        ]);
        const brandKey = brandKeyForDuplicateCheck(brandName);
        const alreadyApproved =
          (brandKey &&
            (approvedCatalogKeys.has(brandKey) ||
              adminApprovedKeys.has(brandKey) ||
              effectiveApprovedBrands.some(
                (row) => brandKeyForDuplicateCheck(row?.name) === brandKey
              ))) ||
          String(request?.status || '').toLowerCase() === 'approved';
        // Prefer real request status; never default catalog-approved brands to pending.
        const status = alreadyApproved
          ? 'approved'
          : String(
              request?.status ||
                (data.brandApprovalRequested || approvalFailureRows.length > 0 ? 'pending' : 'approved')
            ).toLowerCase();
        return {
          name: brandName,
          status,
          submittedAt:
            request?.submittedAt ||
            request?.requestedAt ||
            (status === 'pending' ? new Date().toISOString() : null)
        };
      });
      const pendingRows = submittedRows.filter((row) => row.status === 'pending');
      const approvedRows = submittedRows.filter((row) => row.status === 'approved');

      const profileWithRequests = mergeSupplierBrandRequestsIntoProfile(
        nextProfile || profile,
        [
          ...requestSource,
          ...approvalFailureRows,
          ...pendingRows
        ]
      );

      if (!applyProfileFromResponse(profileWithRequests)) {
        const fetched = await fetchProfile();
        if (fetched && pendingRows.length > 0) {
          setProfile((prev) => mergeSupplierBrandRequestsIntoProfile(prev, pendingRows));
        }
      } else if (pendingRows.length > 0 || approvalFailureRows.length > 0) {
        // Ensure Brand status flips to pending even if API profile omitted the request row.
        setProfile((prev) =>
          mergeSupplierBrandRequestsIntoProfile(prev, [
            ...approvalFailureRows,
            ...pendingRows
          ])
        );
      }

      // API flags win when the server already classified this save.
      if (data.brandAlreadyApproved && pendingRows.length === 0) {
        setBrandSubmissionNotice({
          tone: 'success',
          title: approvedRows.length === 1
            ? `"${approvedRows[0].name}" is already approved`
            : 'Selected brands are already approved',
          brands: approvedRows.length > 0 ? approvedRows : submittedRows,
          submittedAt: null,
          message:
            data.message ||
            'Path A: this brand is already approved by admin. You can continue with supply-chain role selection below.'
        });
      } else if (data.brandApprovalRequested || pendingRows.length > 0) {
        const rowsForNotice = pendingRows.length > 0 ? pendingRows : submittedRows;
        const submittedAt =
          rowsForNotice.find((row) => row.submittedAt)?.submittedAt || new Date().toISOString();
        setBrandSubmissionNotice({
          tone: 'pending',
          title: rowsForNotice.length === 1
            ? `Brand request submitted for "${rowsForNotice[0].name}"`
            : `${rowsForNotice.length} brand requests submitted`,
          brands: rowsForNotice,
          submittedAt,
              message:
            data.message ||
            (rowsForNotice.length === 1
              ? 'Path B: your brand request was sent for admin approval. After it is approved, select it and configure your supply-chain role below.'
              : 'Path B: your brand requests were sent for admin approval. After approval, select each brand and configure your supply-chain role below.')
        });
        setBrandSectionExpanded(true);
        setBrandApprovalSubmittedSignature(
          buildBrandApprovalDetailsSignature(
            mergeSupplierBrandRequestsIntoProfile(profileWithRequests || profile, [
              ...approvalFailureRows,
              ...pendingRows
            ]),
            catalogBrands
          )
        );
      } else if (approvedRows.length > 0) {
        setBrandSubmissionNotice({
          tone: 'success',
          title: approvedRows.length === 1
            ? `"${approvedRows[0].name}" is already approved`
            : 'Selected brands are already approved',
          brands: approvedRows,
          submittedAt: approvedRows.find((row) => row.submittedAt)?.submittedAt || null,
          message: 'Path A: these brands are ready for supply-chain role selection below.'
        });
      } else {
        setBrandSubmissionNotice({
          tone: 'success',
          title: 'Brand saved',
          brands: submittedRows,
          submittedAt: new Date().toISOString(),
          message: data.message || 'Brand saved. Supply-chain role setup is ready below.'
        });
      }
    } catch (e) {
      console.error('Failed to save brand approval:', e);
      alert('Failed to save brand request. Please try again.');
    } finally {
      setSavingBrandApproval(false);
    }
  };

  const handleDiscard = async () => {
    if (discarding || savingBrandApproval || !!savingEntryId || !hasUnsavedChanges) return;

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
          {hasUnsavedChanges ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleDiscard}
              disabled={savingBrandApproval || !!savingEntryId || discarding}
              title="Revert unsaved edits"
            >
              <RotateCcw size={18} strokeWidth={2} aria-hidden />
              {discarding ? 'Discarding…' : 'Discard changes'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="profile-content">
        <p className="supplier-select-page-intro">
          Choose how you want to set up your supply chain. If your brand is already approved, select it and choose
          your role. If it is not listed yet, request admin approval first — then continue with role setup after it is
          approved.
        </p>

        {!hasSavedBrandEntries && approvedBrandCount > 0 ? (
          <div className="supplier-select-alert supplier-select-alert--draft">
            <strong>Welcome — start with an approved brand</strong>
            <p>
              There {approvedBrandCount === 1 ? 'is' : 'are'} {approvedBrandCount} admin-approved brand
              {approvedBrandCount === 1 ? '' : 's'} available
              {chainReadyBrandCount > 0
                ? ` (${chainReadyBrandCount} with a supply chain ready for role setup)`
                : ''}
              . Select an approved brand below, then choose your supply-chain role. You only need to request a new
              brand if yours is not in the approved list.
            </p>
          </div>
        ) : null}

        <div className="supplier-select-flow-card" aria-label="Two ways to set up your brand">
          <div className="supplier-select-flow-card__step supplier-select-flow-card__step--primary">
            <span className="supplier-select-flow-card__badge supplier-select-flow-card__badge--primary">
              Path A
            </span>
            <div className="supplier-select-flow-card__copy">
              <strong>Use an approved brand</strong>
              <span>Select from the approved list, then choose your supply-chain role.</span>
            </div>
          </div>
          <div className="supplier-select-flow-card__divider" aria-hidden>
            or
          </div>
          <div className="supplier-select-flow-card__step">
            <span className="supplier-select-flow-card__badge">Path B</span>
            <div className="supplier-select-flow-card__copy">
              <strong>Request a new brand</strong>
              <span>If your brand is unlisted, request approval. Configure your role after admin approves it.</span>
            </div>
          </div>
        </div>

        {supplyChainSummaryRows.length > 0 ? (
          <div className="supplier-select-assignments" aria-label="Your supply chain by brand">
            <strong>Approved brands ({approvedBrandCount})</strong>
            <p className="supplier-select-assignments__hint">
              Path A: these are the same admin-approved brands from the catalog. Brands marked “supply chain ready”
              already have roles you can select below.
            </p>
            <div className="supplier-select-assignments__picker">
              <label className="supplier-select-assignments__picker-label" htmlFor="assignment-brand-select">
                Select approved brand
              </label>
              <select
                id="assignment-brand-select"
                className="supplier-select-assignments__picker-select"
                value={selectedAssignmentId}
                onChange={handleAssignmentBrandChange}
              >
                <option value="">Select approved brand</option>
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
                  ) : !selectedAssignmentHasAdminChain && !assignmentChainInfo.loading ? (
                    <span className="supplier-select-assignments__status supplier-select-assignments__status--pending">
                      Waiting for admin
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
                {!assignmentChainInfo.loading && !selectedAssignmentHasAdminChain ? (
                  <div className="supplier-select-alert supplier-select-alert--pending" role="status">
                    <strong>No supply-chain roles configured</strong>
                    <p>{SUPPLY_CHAIN_NOT_DEFINED_MESSAGE}</p>
                    <button
                      type="button"
                      className="supplier-select-alert__dismiss"
                      disabled={requestingChainConfigBrand === selectedAssignment.brand}
                      onClick={async () => {
                        setRequestingChainConfigBrand(selectedAssignment.brand);
                        const result = await requestChainConfigurationForBrand(selectedAssignment.brand);
                        setRequestingChainConfigBrand('');
                        setChainConfigNotice({
                          brand: selectedAssignment.brand,
                          tone: result.ok ? 'success' : 'warning',
                          message: result.message
                        });
                      }}
                    >
                      {requestingChainConfigBrand === selectedAssignment.brand
                        ? 'Notifying admin…'
                        : 'Request Role Configuration'}
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
              Finish your supply-chain role details for the selected brand and save that brand registration to submit
              for admin approval.
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
              <span className="supplier-select-section__label">Brand setup</span>
              Select or request a brand
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
                disabled={
                  savingBrandApproval ||
                  !!savingEntryId ||
                  discarding ||
                  brandSaveBlockedForPending
                }
                title={
                  brandSaveBlockedForPending
                    ? 'Brand request already submitted. Change the brand name or documents to enable Save brand again, or wait for admin approval.'
                    : undefined
                }
              >
                {savingBrandApproval
                  ? 'Saving…'
                  : brandSaveBlockedForPending
                    ? 'Request submitted'
                    : 'Save brand'}
              </button>
            </div>
          </div>
          <p className="supplier-select-section__intro">
            <strong>Path A (recommended):</strong> pick an already-approved brand from the list and save.
            <strong> Path B (optional):</strong> if your brand is not listed, use{' '}
            <strong>Request a new brand instead</strong> — after admin approval you can configure your role below.
          </p>

          {catalogBrandsError ? (
            <div className="supplier-select-alert supplier-select-alert--rejected" role="alert">
              <strong>Could not load approved brands</strong>
              <p>
                {catalogBrandsError} Approved brands configured by admin should appear in the Select brand dropdown.
              </p>
              <button type="button" className="supplier-select-alert__dismiss" onClick={reloadCatalogBrands}>
                Retry loading brands
              </button>
            </div>
          ) : null}

          {!catalogBrandsLoading && !catalogBrandsError && catalogBrandNames.length === 0 ? (
            <div className="supplier-select-alert supplier-select-alert--draft" role="status">
              <strong>No approved brands in the catalog yet</strong>
              <p>
                Ask admin to approve brands or define supply chains. Until then you can still request a new brand
                (Path B).
              </p>
              <button type="button" className="supplier-select-alert__dismiss" onClick={reloadCatalogBrands}>
                Retry loading brands
              </button>
            </div>
          ) : null}

          {brandSubmissionNotice ? (
            <div
              className={`supplier-select-alert supplier-select-alert--${
                brandSubmissionNotice.tone === 'success' ? 'draft' : 'pending'
              }`}
              role="status"
            >
              <strong>{brandSubmissionNotice.title}</strong>
              <p>{brandSubmissionNotice.message}</p>
              <p className="supplier-select-alert__meta">
                Submitted:{' '}
                {brandSubmissionNotice.submittedAt
                  ? formatDateTimeIST(brandSubmissionNotice.submittedAt, '—')
                  : 'just now'}
              </p>
              {Array.isArray(brandSubmissionNotice.brands) && brandSubmissionNotice.brands.length > 0 ? (
                <ul className="supplier-select-alert__list">
                  {brandSubmissionNotice.brands.map((row) => (
                    <li key={row.name}>
                      <strong>{row.name}</strong>
                      {' — submitted '}
                      {row.submittedAt
                        ? formatDateTimeIST(row.submittedAt, '—')
                        : brandSubmissionNotice.submittedAt
                          ? formatDateTimeIST(brandSubmissionNotice.submittedAt, '—')
                          : 'just now'}
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                className="supplier-select-alert__dismiss"
                onClick={() => setBrandSubmissionNotice(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {!brandSubmissionNotice && pendingBrandRequests.length > 0 ? (
            <div className="supplier-select-alert supplier-select-alert--pending" role="status">
              <strong>
                {pendingBrandRequests.length === 1
                  ? `Brand request submitted for “${pendingBrandRequests[0].name}”`
                  : `${pendingBrandRequests.length} brand requests submitted`}
              </strong>
              <p>
                These Path B requests are awaiting admin approval. After approval, select the brand and configure your
                supply-chain role below.
              </p>
              <ul className="supplier-select-alert__list">
                {pendingBrandRequests.map((row) => (
                  <li key={row.name}>
                    <strong>{row.name}</strong>
                    {' — submitted '}
                    {row.submittedAt ? formatDateTimeIST(row.submittedAt, '—') : 'date unavailable'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
              startInNewBrandMode={false}
              supplierApprovedBrands={effectiveApprovedBrands}
              supplierBrandRequests={profile?.supplierBrandRequests || []}
              catalogBrands={catalogBrands}
              catalogBrandsLoading={catalogBrandsLoading}
              catalogBrandsError={catalogBrandsError}
              onReloadCatalogBrands={reloadCatalogBrands}
            />
          ) : null}
        </div>

        <div
          ref={supplyChainSectionRef}
          className="profile-section supplier-select-section supplier-select-section--form"
        >
          <h2>
            <span className="supplier-select-section__label">Role setup</span>
            Choose your supply-chain role
          </h2>
          <p className="supplier-select-section__intro">
            After you select an approved brand above, choose your role in that brand&apos;s admin-defined supply chain
            and upload documents. The brand name is filled automatically.
          </p>

          {chainConfigNotice ? (
            <div
              className={`supplier-select-alert supplier-select-alert--${
                chainConfigNotice.tone === 'success' ? 'draft' : 'pending'
              }`}
              role="status"
            >
              <strong>
                {chainConfigNotice.tone === 'success'
                  ? 'Admin notified'
                  : `No roles configured${chainConfigNotice.brand ? ` for ${chainConfigNotice.brand}` : ''}`}
              </strong>
              <p>{chainConfigNotice.message}</p>
              <button
                type="button"
                className="supplier-select-alert__dismiss"
                onClick={() => setChainConfigNotice(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {!selectedAssignmentId ? (
            <div className="supplier-select-alert supplier-select-alert--draft">
              <strong>
                {supplyChainSummaryRows.length === 0
                  ? 'No approved brands ready yet'
                  : 'Select an approved brand to continue'}
              </strong>
              <p>
                {supplyChainSummaryRows.length === 0
                  ? 'Select an approved brand in Path A above, or request a new brand (Path B) and wait for admin approval. Once the brand is approved, choose your supply-chain role here.'
                  : 'Pick any brand from Your approved brands above. If admin has defined its supply chain, your role options appear here automatically.'}
              </p>
            </div>
          ) : null}

          {!supplyChainFormProfile?.companyInfoEntries?.length && selectedAssignmentId ? (
            <div className="supplier-select-alert supplier-select-alert--draft">
              <strong>No supply-chain forms yet</strong>
              <p>
                Select an approved brand in Path A above. A matching supply-chain role form will appear here with that
                brand filled in.
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
              supplierApprovedBrands={effectiveApprovedBrands}
              supplierBrandRequests={profile?.supplierBrandRequests || []}
              catalogBrands={catalogBrands}
              catalogBrandsLoading={catalogBrandsLoading}
              catalogBrandsError={catalogBrandsError}
              onReloadCatalogBrands={reloadCatalogBrands}
              onRequestChainConfiguration={requestChainConfigurationForBrand}
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
