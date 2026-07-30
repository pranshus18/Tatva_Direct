import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { UserCheck, RotateCcw } from 'lucide-react';
import { resolveApiPath } from '../config/api';
import SupplierSupplyChainEntriesEditor from '../components/SupplierSupplyChainEntriesEditor';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import {
  brandKeyForDuplicateCheck,
  findApprovedCatalogBrandMatch,
  formatApprovedCatalogBrandMatchMessage,
  validateUniqueBrandsAcrossEntries,
  areBrandNamesExactDuplicates
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
  BRAND_REQUEST_ALREADY_PENDING_MESSAGE,
  BRAND_ALREADY_APPROVED_SAVE_MESSAGE,
  listPendingBrandNamesBlockingSave,
  listApprovedBrandNamesBlockingSave,
  SUPPLY_CHAIN_NOT_DEFINED_MESSAGE
} from '../utils/supplierSelectYourselfProfile';
import { resolveActiveBrandPath } from '../utils/supplierSelectYourselfPaths';
import { formatDateTimeIST } from '../utils/dateTime';
import { resolveRoleVerificationDocumentUrls } from '../utils/authorizationCertificateUrls';
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
  /** null = choose path; pathA / pathB = mutually exclusive supplier scenarios */
  const [brandPathMode, setBrandPathMode] = useState(null);
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
    const noticeApprovedNames =
      brandSubmissionNotice?.tone === 'success' && Array.isArray(brandSubmissionNotice.brands)
        ? brandSubmissionNotice.brands.map((row) => row?.name).filter(Boolean)
        : [];
    return isBrandApprovalSaveBlockedForPendingRequests({
      profile,
      catalogBrands,
      submittedSignature: brandApprovalSubmittedSignature,
      extraPendingBrandNames: noticePendingNames,
      extraApprovedBrandNames: noticeApprovedNames
    });
  }, [profile, catalogBrands, brandApprovalSubmittedSignature, brandSubmissionNotice]);

  const pendingBrandsBlockingSave = useMemo(() => {
    const noticePendingNames =
      brandSubmissionNotice?.tone === 'pending' && Array.isArray(brandSubmissionNotice.brands)
        ? brandSubmissionNotice.brands.map((row) => row?.name).filter(Boolean)
        : [];
    return listPendingBrandNamesBlockingSave({
      profile,
      extraPendingBrandNames: noticePendingNames
    });
  }, [profile, brandSubmissionNotice]);

  const approvedBrandsBlockingSave = useMemo(() => {
    const noticeApprovedNames =
      brandSubmissionNotice?.tone === 'success' && Array.isArray(brandSubmissionNotice.brands)
        ? brandSubmissionNotice.brands.map((row) => row?.name).filter(Boolean)
        : [];
    return listApprovedBrandNamesBlockingSave({
      profile,
      catalogBrands,
      extraApprovedBrandNames: noticeApprovedNames
    });
  }, [profile, catalogBrands, brandSubmissionNotice]);

  const brandSaveBlockedByPendingRequest =
    brandSaveBlockedForPending && pendingBrandsBlockingSave.length > 0;
  const brandSaveBlockedByApprovedBrand =
    brandSaveBlockedForPending &&
    !brandSaveBlockedByPendingRequest &&
    approvedBrandsBlockingSave.length > 0;

  const brandSaveButtonLabel = useMemo(() => {
    if (savingBrandApproval) return 'Saving…';
    if (!brandSaveBlockedForPending) return 'Save brand';
    if (brandSaveBlockedByPendingRequest) return 'Request already pending';
    if (brandSaveBlockedByApprovedBrand) return 'Already approved';
    return 'Saved';
  }, [
    savingBrandApproval,
    brandSaveBlockedForPending,
    brandSaveBlockedByPendingRequest,
    brandSaveBlockedByApprovedBrand
  ]);

  const brandSaveButtonTitle = brandSaveBlockedForPending
    ? brandSaveBlockedByPendingRequest
      ? BRAND_REQUEST_ALREADY_PENDING_MESSAGE
      : brandSaveBlockedByApprovedBrand
        ? BRAND_ALREADY_APPROVED_SAVE_MESSAGE
        : 'Brand setup is saved. Change the brand or documents to enable Save brand again.'
    : undefined;

  const chainReadyBrandCount = useMemo(
    () => supplyChainSummaryRows.filter((row) => row.hasAdminSupplyChain).length,
    [supplyChainSummaryRows]
  );
  const approvedBrandCount = supplyChainSummaryRows.length;

  const selectedAssignment = useMemo(
    () => supplyChainSummaryRows.find((row) => row.id === selectedAssignmentId) || null,
    [supplyChainSummaryRows, selectedAssignmentId]
  );

  // Path A selection always wins for mutual exclusion while role setup is locked.
  const activeBrandPath = resolveActiveBrandPath({
    selectedAssignmentId,
    brandPathMode
  });

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

    // Remap stale ids (legacy catalog-* / entry UUID) onto the stable brand-* row.
    if (selectedAssignmentId) {
      const staleKey = String(selectedAssignmentId).replace(/^(catalog-|brand-)/, '');
      const remapped =
        supplyChainSummaryRows.find((row) => row.id === `brand-${staleKey}`) ||
        supplyChainSummaryRows.find((row) => String(row.entryId || '') === selectedAssignmentId) ||
        null;
      if (remapped?.id) {
        setSelectedAssignmentId(remapped.id);
        return;
      }
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
    const brandSignature = buildBrandApprovalDetailsSignature(snapshot, catalogBrands);
    const hasConfiguredBrand = getCompanyInfoEntriesForSave(snapshot).some((entry) =>
      String(entry?.brands || '').trim()
    );
    // Treat the loaded brand-setup state as already saved so Save brand stays idle
    // until the supplier changes a brand name or documents.
    setBrandApprovalSubmittedSignature(hasConfiguredBrand ? brandSignature : '');
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

  // Catalog brands often load after profile. Refresh the idle Save-brand signature once
  // catalog data arrives, but only when the supplier has not edited brand details locally.
  useEffect(() => {
    if (!profile || !baseline || catalogBrandsLoading) return;
    const profileBrandSig = buildBrandApprovalDetailsSignature(profile, catalogBrands);
    const baselineBrandSig = buildBrandApprovalDetailsSignature(baseline, catalogBrands);
    if (!profileBrandSig || profileBrandSig !== baselineBrandSig) return;
    setBrandApprovalSubmittedSignature((prev) => (prev === profileBrandSig ? prev : profileBrandSig));
  }, [profile, baseline, catalogBrands, catalogBrandsLoading]);

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

      const brandKey = brandKeyForDuplicateCheck(brandLabel);
      const assignmentRow =
        row?.id && supplyChainSummaryRows.some((item) => item.id === row.id)
          ? row
          : supplyChainSummaryRows.find(
              (item) => brandKeyForDuplicateCheck(item.brand) === brandKey
            ) || null;
      // Prefer stable brand-* summary id so selection survives entry creation.
      const stableAssignmentId =
        assignmentRow?.id || (brandKey ? `brand-${brandKey}` : '') || entryId;
      setBrandPathMode('pathA');
      setSelectedAssignmentId(stableAssignmentId);
      setFocusSupplyChainEntryId(entryId);
      window.requestAnimationFrame(() => {
        supplyChainSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [ensureBrandEntryForSupplyChain, supplyChainSummaryRows]
  );

  const clearIncompleteBrandSetup = useCallback(
    (brandLabel) => {
      const label = String(brandLabel || '').trim();
      if (!label || !profile) return null;

      const brandKey = brandKeyForDuplicateCheck(label);
      const baselineEntry =
        approvedBaselineEntries.find(
          (entry) => brandKeyForDuplicateCheck(entry?.brands) === brandKey
        ) || null;
      const baselineRole = String(baselineEntry?.role || '').trim();
      const baselineComplete =
        !!baselineRole && resolveRoleVerificationDocumentUrls(baselineEntry).length > 0;

      const entries = getCompanyInfoEntriesForSave(profile).map((entry) => {
        if (brandKeyForDuplicateCheck(entry?.brands) !== brandKey) return entry;

        // Keep a previously approved completed assignment; only drop the incomplete draft.
        if (baselineComplete) {
          return {
            ...entry,
            ...baselineEntry,
            id: entry.id || baselineEntry.id,
            brands: baselineEntry.brands || label,
            role: baselineEntry.role || '',
            supplyChainRegistrationStarted: true
          };
        }

        return {
          ...entry,
          brands: '',
          role: '',
          gstin: '',
          companyName: '',
          ownershipDetails: '',
          minimumOrderValue: '',
          authorizationCertificateUrl: '',
          authorizationCertificateUrls: [],
          supplyChainRegistrationStarted: false
        };
      });

      const nextProfile = buildSupplierChainSavePayload(
        profile,
        syncBrandEntriesForSupplyChainStep(entries)
      );
      setProfile(nextProfile);
      // Cancel/Change must not leave a dirty Save-brand state for an unchanged setup.
      setBaseline(cloneProfileSnapshot(nextProfile));
      const nextSignature = buildBrandApprovalDetailsSignature(nextProfile, catalogBrands);
      const hasConfiguredBrand = getCompanyInfoEntriesForSave(nextProfile).some((entry) =>
        String(entry?.brands || '').trim()
      );
      setBrandApprovalSubmittedSignature(hasConfiguredBrand ? nextSignature : '');
      setBrandSubmissionNotice(null);
      return nextProfile;
    },
    [approvedBaselineEntries, catalogBrands, profile]
  );

  const unlockBrandSelection = useCallback(
    (brandLabel) => {
      setSelectedAssignmentId('');
      setFocusSupplyChainEntryId('');
      setChainConfigNotice(null);
      setBrandPathMode(null);
      if (brandLabel) clearIncompleteBrandSetup(brandLabel);
    },
    [clearIncompleteBrandSetup]
  );

  const handleChangeSelectedAssignment = useCallback(() => {
    const brandLabel = String(selectedAssignment?.brand || '').trim();
    const hasIncompleteDraft =
      !!brandLabel &&
      (!selectedAssignment?.hasRole || !selectedAssignment?.hasRoleDocuments);

    if (hasIncompleteDraft) {
      const confirmed = window.confirm(
        'Change brand?\n\nThis cancels the current supply-chain setup for the selected brand and clears its incomplete role details before you pick another brand.'
      );
      if (!confirmed) return;
    }

    unlockBrandSelection(brandLabel);
  }, [selectedAssignment, unlockBrandSelection]);

  const handleCancelBrandSetup = useCallback(() => {
    const brandLabel = String(selectedAssignment?.brand || '').trim();
    const confirmed = window.confirm(
      'Cancel setup?\n\nThis clears the selected brand and its incomplete supply-chain role details so you can start again.'
    );
    if (!confirmed) return;
    unlockBrandSelection(brandLabel);
  }, [selectedAssignment?.brand, unlockBrandSelection]);

  const handleBrandSelectionClearedFromEditor = useCallback(() => {
    const brandLabel = String(selectedAssignment?.brand || '').trim();
    unlockBrandSelection(brandLabel);
  }, [selectedAssignment?.brand, unlockBrandSelection]);

  const handleAssignmentBrandChange = (event) => {
    if (selectedAssignmentId) return;
    const nextId = event.target.value;
    if (!nextId) {
      setSelectedAssignmentId('');
      setBrandPathMode(null);
      setFocusSupplyChainEntryId('');
      return;
    }
    setBrandPathMode('pathA');
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

  const handleBrandPathModeChange = useCallback((mode) => {
    setBrandPathMode(mode === 'pathA' || mode === 'pathB' ? mode : null);
  }, []);

  const handleBrandPickedWithoutRole = useCallback(
    (brandName) => {
      const label = String(brandName || '').trim();
      if (!label) return;
      // Path A selection always proceeds to role setup for that brand (locked until Change brand / Start over).
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
    [brandHasAdminConfiguredRoles, navigateToAddRole]
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
    }
    const selectedBrandState = assignmentChainInfo.data?.brands?.find(
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
    // Path A uses an already-approved brand — brand-request save is Path B only.
    if (activeBrandPath === 'pathA') return;
    const noticePendingNames =
      brandSubmissionNotice?.tone === 'pending' && Array.isArray(brandSubmissionNotice.brands)
        ? brandSubmissionNotice.brands.map((row) => row?.name).filter(Boolean)
        : [];
    const noticeApprovedNames =
      brandSubmissionNotice?.tone === 'success' && Array.isArray(brandSubmissionNotice.brands)
        ? brandSubmissionNotice.brands.map((row) => row?.name).filter(Boolean)
        : [];
    if (
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands,
        submittedSignature: brandApprovalSubmittedSignature,
        extraPendingBrandNames: noticePendingNames,
        extraApprovedBrandNames: noticeApprovedNames
      })
    ) {
      const pendingNames = listPendingBrandNamesBlockingSave({
        profile,
        extraPendingBrandNames: noticePendingNames
      });
      if (pendingNames.length > 0) {
        const brandLabel =
          pendingNames.length === 1
            ? `"${pendingNames[0]}"`
            : `${pendingNames.length} brand requests`;
        alert(
          pendingNames.length === 1
            ? `Brand request for ${brandLabel} is already pending admin approval. Wait for admin to approve or reject it before submitting again.`
            : `${brandLabel} are already pending admin approval. Wait for admin to approve or reject them before submitting again.`
        );
        return;
      }
      const approvedNames = listApprovedBrandNamesBlockingSave({
        profile,
        catalogBrands,
        extraApprovedBrandNames: noticeApprovedNames
      });
      if (approvedNames.length > 0) {
        alert(BRAND_ALREADY_APPROVED_SAVE_MESSAGE);
      }
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
          return areBrandNamesExactDuplicates(name, brandName);
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
        const requestStatus = String(request?.status || '').toLowerCase();
        // Only treat as approved when brands-table / admin approved catalog says so.
        // Never default Path B saves to approved from UI heuristics alone.
        const alreadyApproved =
          requestStatus === 'approved' ||
          (brandKey && (approvedCatalogKeys.has(brandKey) || adminApprovedKeys.has(brandKey)));
        let status = 'pending';
        if (alreadyApproved) {
          status = 'approved';
        } else if (requestStatus === 'pending' || requestStatus === 'rejected') {
          status = requestStatus;
        } else if (data.brandApprovalRequested || approvalFailureRows.length > 0) {
          status = 'pending';
        } else if (data.brandAlreadyApproved) {
          status = 'approved';
        }
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

      // Always merge submitted request outcomes into profile so Brand status cannot stay
      // on "Ready to submit" while the page notice says pending/already approved.
      const profileWithRequests = mergeSupplierBrandRequestsIntoProfile(
        nextProfile || profile,
        [
          ...requestSource,
          ...approvalFailureRows,
          ...pendingRows,
          ...approvedRows.map((row) => ({
            name: row.name,
            status: 'approved',
            submittedAt: row.submittedAt || null,
            requestedAt: row.submittedAt || null
          }))
        ]
      );

      if (!applyProfileFromResponse(profileWithRequests)) {
        const fetched = await fetchProfile();
        if (fetched && (pendingRows.length > 0 || approvedRows.length > 0 || approvalFailureRows.length > 0)) {
          setProfile((prev) =>
            mergeSupplierBrandRequestsIntoProfile(prev, [
              ...approvalFailureRows,
              ...pendingRows,
              ...approvedRows.map((row) => ({
                name: row.name,
                status: 'approved',
                submittedAt: row.submittedAt || null,
                requestedAt: row.submittedAt || null
              }))
            ])
          );
        }
      } else if (pendingRows.length > 0 || approvedRows.length > 0 || approvalFailureRows.length > 0) {
        // Ensure Brand status flips even if API profile omitted the request row.
        setProfile((prev) =>
          mergeSupplierBrandRequestsIntoProfile(prev, [
            ...approvalFailureRows,
            ...pendingRows,
            ...approvedRows.map((row) => ({
              name: row.name,
              status: 'approved',
              submittedAt: row.submittedAt || null,
              requestedAt: row.submittedAt || null
            }))
          ])
        );
      }

      // API flags win when the server already classified this save.
      // "Already approved" only when the brand is truly in the approved catalog / brands table.
      const savedBrandSignature = buildBrandApprovalDetailsSignature(
        profileWithRequests || nextProfile || profile,
        catalogBrands
      );
      if (data.brandAlreadyPending) {
        setBrandPathMode('pathB');
        const alreadyPendingRows =
          pendingRows.length > 0
            ? pendingRows
            : brandsBeingSaved.map((name) => ({
                name,
                status: 'pending',
                submittedAt: new Date().toISOString()
              }));
        setBrandSubmissionNotice({
          tone: 'pending',
          title:
            alreadyPendingRows.length === 1
              ? `Brand request for "${alreadyPendingRows[0].name}" is already pending`
              : 'Brand request already pending admin approval',
          brands: alreadyPendingRows,
          submittedAt:
            alreadyPendingRows.find((row) => row.submittedAt)?.submittedAt || new Date().toISOString(),
          message: data.message || BRAND_REQUEST_ALREADY_PENDING_MESSAGE
        });
        setBrandSectionExpanded(true);
        setBrandApprovalSubmittedSignature(savedBrandSignature);
      } else if (data.brandAlreadyApproved && pendingRows.length === 0 && approvedRows.length > 0) {
        setBrandPathMode('pathA');
        setBrandSubmissionNotice({
          tone: 'success',
          title: approvedRows.length === 1
            ? `"${approvedRows[0].name}" is already approved`
            : 'Selected brands are already approved',
          brands: approvedRows,
          submittedAt: null,
          message:
            data.message ||
            'Path A: this brand is already approved by admin. You can continue with supply-chain role selection below.'
        });
        setBrandApprovalSubmittedSignature(savedBrandSignature);
      } else if (data.brandApprovalRequested || pendingRows.length > 0) {
        setBrandPathMode('pathB');
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
        setBrandPathMode('pathA');
        setBrandSubmissionNotice({
          tone: 'success',
          title: approvedRows.length === 1
            ? `"${approvedRows[0].name}" is already approved`
            : 'Selected brands are already approved',
          brands: approvedRows,
          submittedAt: approvedRows.find((row) => row.submittedAt)?.submittedAt || null,
          message: 'Path A: these brands are ready for supply-chain role selection below.'
        });
        setBrandApprovalSubmittedSignature(savedBrandSignature);
      } else {
        setBrandSubmissionNotice({
          tone: 'pending',
          title: 'Brand request submitted',
          brands: submittedRows,
          submittedAt: new Date().toISOString(),
          message:
            data.message ||
            'Your brand was submitted for admin approval. It will appear in Path A after an admin approves it.'
        });
        setBrandSectionExpanded(true);
        setBrandApprovalSubmittedSignature(savedBrandSignature);
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

        {activeBrandPath === 'pathA' ? (
          <div className="supplier-select-flow-card supplier-select-flow-card--active-path" role="status">
            <div className="supplier-select-flow-card__step supplier-select-flow-card__step--primary">
              <span className="supplier-select-flow-card__badge supplier-select-flow-card__badge--primary">
                Path A active
              </span>
              <div className="supplier-select-flow-card__copy">
                <strong>Using approved brand{selectedAssignment?.brand ? `: ${selectedAssignment.brand}` : ''}</strong>
                <span>
                  Path B is hidden while this setup is in progress. Use Change brand or Cancel setup to choose a
                  different scenario.
                </span>
              </div>
            </div>
          </div>
        ) : activeBrandPath === 'pathB' ? (
          <div className="supplier-select-flow-card supplier-select-flow-card--active-path" role="status">
            <div className="supplier-select-flow-card__step">
              <span className="supplier-select-flow-card__badge">Path B active</span>
              <div className="supplier-select-flow-card__copy">
                <strong>Requesting a new brand</strong>
                <span>
                  Path A is hidden while this request is in progress. Use Switch to Path A or Cancel setup to choose a
                  different scenario.
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="supplier-select-flow-card" aria-label="Choose one supplier scenario">
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
        )}

        {supplyChainSummaryRows.length > 0 && activeBrandPath !== 'pathB' ? (
          <div className="supplier-select-assignments" aria-label="Your supply chain by brand">
            <strong>Approved brands ({approvedBrandCount})</strong>
            <p className="supplier-select-assignments__hint">
              {activeBrandPath === 'pathA'
                ? 'Path A is locked for this brand. Finish role setup below, or use Change brand / Cancel setup to leave Path A.'
                : 'Path A: pick one approved brand to continue. After you select it, Path B stays hidden until you cancel this setup.'}
            </p>
            {selectedAssignment ? (
              <div className="supplier-select-assignments__locked" role="status">
                <div className="supplier-select-assignments__locked-head">
                  <span className="supplier-select-assignments__picker-label">Selected approved brand</span>
                  <div className="supplier-select-assignments__locked-actions">
                    <button
                      type="button"
                      className="supplier-select-assignments__change-btn"
                      onClick={handleChangeSelectedAssignment}
                    >
                      Change brand
                    </button>
                    <button
                      type="button"
                      className="supplier-select-assignments__change-btn supplier-select-assignments__change-btn--ghost"
                      onClick={handleCancelBrandSetup}
                    >
                      Cancel setup
                    </button>
                  </div>
                </div>
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
              </div>
            ) : (
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
            )}
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
              {activeBrandPath === 'pathA'
                ? 'Path A — approved brand'
                : activeBrandPath === 'pathB'
                  ? 'Path B — request a new brand'
                  : 'Select or request a brand'}
            </h2>
            <div className="supplier-select-section__head-actions">
              <button
                type="button"
                className="btn-secondary supplier-select-section__toggle-btn"
                onClick={() => setBrandSectionExpanded((prev) => !prev)}
              >
                {brandSectionExpanded ? 'Collapse' : 'Expand'}
              </button>
              {activeBrandPath !== 'pathA' ? (
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
                  title={brandSaveButtonTitle}
                >
                  {brandSaveButtonLabel}
                </button>
              ) : null}
            </div>
          </div>
          <p className="supplier-select-section__intro">
            {activeBrandPath === 'pathA' ? (
              <>
                <strong>Path A in progress.</strong> Continue with role configuration for the selected approved brand
                below. Path B is hidden until you use <strong>Change brand</strong> or <strong>Cancel setup</strong>.
              </>
            ) : activeBrandPath === 'pathB' ? (
              <>
                <strong>Path B in progress.</strong> Enter the new brand name and upload documents, then save for admin
                approval. Path A is hidden until you switch or cancel this request.
              </>
            ) : (
              <>
                Choose <strong>one</strong> scenario:{' '}
                <strong>Path A</strong> — pick an already-approved brand, or <strong>Path B</strong> — request a new
                brand if it is not listed. The other path stays hidden once you start.
              </>
            )}
          </p>

          {catalogBrandsError && activeBrandPath !== 'pathB' ? (
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

          {!catalogBrandsLoading &&
          !catalogBrandsError &&
          catalogBrandNames.length === 0 &&
          activeBrandPath !== 'pathA' ? (
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

          {brandSaveBlockedByPendingRequest ? (
            <div className="supplier-select-alert supplier-select-alert--pending" role="status">
              <strong>Brand request already pending admin approval</strong>
              <p>
                {pendingBrandsBlockingSave.length === 1
                  ? `“${pendingBrandsBlockingSave[0]}” was already submitted. Save brand stays disabled until an admin approves or rejects it. Use Change brand / Cancel setup to pick a different brand.`
                  : `${pendingBrandsBlockingSave.length} brand requests are already pending. Save brand stays disabled until an admin approves or rejects them.`}
              </p>
            </div>
          ) : null}

          {brandSaveBlockedByApprovedBrand && activeBrandPath !== 'pathA' ? (
            <div className="supplier-select-alert supplier-select-alert--draft" role="status">
              <strong>Brand already approved</strong>
              <p>
                {approvedBrandsBlockingSave.length === 1
                  ? `“${approvedBrandsBlockingSave[0]}” is already approved. Save brand is disabled — use Path A / Switch to Path A to continue with supply-chain role setup.`
                  : 'These brands are already approved. Save brand is disabled — continue with Path A role setup instead.'}
              </p>
            </div>
          ) : null}

          {brandSubmissionNotice &&
          !(activeBrandPath === 'pathA' && brandSubmissionNotice.tone === 'pending') ? (
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

          {!brandSubmissionNotice && pendingBrandRequests.length > 0 && activeBrandPath !== 'pathA' ? (
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
              onBrandSelectionCleared={handleBrandSelectionClearedFromEditor}
              lockedBrandName={selectedAssignment?.brand || ''}
              brandPathMode={activeBrandPath}
              onBrandPathModeChange={handleBrandPathModeChange}
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
                {activeBrandPath === 'pathB'
                  ? 'Finish Path B brand request first'
                  : supplyChainSummaryRows.length === 0
                    ? 'No approved brands ready yet'
                    : 'Select an approved brand to continue'}
              </strong>
              <p>
                {activeBrandPath === 'pathB'
                  ? 'Path A role setup stays hidden while you request a new brand. After admin approves it, select that brand and configure your supply-chain role here.'
                  : supplyChainSummaryRows.length === 0
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
