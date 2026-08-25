import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { getApiUrl, resolveApiPath } from '../config/api';
import BrandAuthorizationDocuments from './BrandAuthorizationDocuments';
import BrandSelect from './BrandSelect';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import { brandKeyForDuplicateCheck, dedupeBrandNames, findApprovedCatalogBrandMatch, findApprovedCatalogBrandSuggestions, formatApprovedCatalogBrandMatchMessage, formatApprovedCatalogBrandSuggestionMessage, areBrandNamesExactDuplicates } from '../utils/supplierChainEntryValidation';
import {
  formatSupplyChainRoleLabel,
  getApprovedRoleForEntry,
  matchCompanyInfoEntry,
  isBrandApprovedForSupplyChainStep,
  findSupplierBrandRequest,
  resolveSelectYourselfBrandStepStatus,
  isSelectYourselfBrandAlreadyApproved,
  BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE,
  SUPPLY_CHAIN_NOT_DEFINED_MESSAGE
} from '../utils/supplierSelectYourselfProfile';
import {
  getSelectYourselfEntrySaveState,
  SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE,
  SELECT_YOURSELF_MOV_REQUIRED_MESSAGE,
  REQUEST_ROLE_CHANGE_LABEL,
  CHANGE_ROLE_LABEL,
  isEntrySupplyChainOnboardingComplete,
  getActiveApprovedRoleForEntry,
  entryMinimumOrderValueChanged,
  findSavedBaselineEntry,
  entryMatchesSavedBaseline
} from '../utils/supplierSelectYourselfValidation';
import {
  resolveSupplierBrandSetupLayers,
  supplierCanSelectBrandRoles
} from '../utils/supplierBrandLayerContract';
import { formatDateTimeIST } from '../utils/dateTime';
import {
  appendAuthorizationCertificateUrl,
  appendBrandApprovalDocumentUrl,
  removeBrandApprovalDocumentUrl,
  removeAuthorizationCertificateUrl,
  resolveBrandApprovalDocumentUrls,
  resolveAuthorizationCertificateUrls,
  resolveRoleVerificationDocumentUrls,
  setAuthorizationCertificateUrls,
  setBrandApprovalDocumentUrls,
  stripBrandDocumentsFromRoleFields,
  normalizeEntryDocumentFields,
  entryIncludesDocumentUrl
} from '../utils/authorizationCertificateUrls';
import './SupplierSupplyChainEntriesEditor.css';

function parseBrandsList(brands) {
  if (brands == null || brands === '') return [];
  if (Array.isArray(brands)) {
    return [...new Set(brands.map(String).map((s) => s.trim()).filter(Boolean))];
  }
  return [
    ...new Set(
      String(brands)
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ];
}

function normalizeSingleBrand(brands) {
  const list = parseBrandsList(brands);
  return list[0] || '';
}

function sanitizeBrandNameWhileTyping(raw) {
  return String(raw || '').replace(/[,;\n]/g, ' ');
}

function sanitizeCustomBrandInput(raw) {
  return sanitizeBrandNameWhileTyping(raw).replace(/\s+/g, ' ').trim();
}

function normalizeBrandToken(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDuplicateBrandMessages(entries = []) {
  const messages = new Map();
  const seen = new Map();

  for (const entry of entries) {
    const brand = normalizeSingleBrand(entry?.brands);
    if (!brand) continue;
    const key = brandKeyForDuplicateCheck(brand);
    if (!key) continue;
    if (seen.has(key)) {
      messages.set(
        entry.id,
        `"${brand}" is already registered in another entry. Each brand can have only one supply-chain role.`
      );
    } else {
      seen.set(key, entry.id);
    }
  }

  return messages;
}

function reservedBrandsForEntry(entries = [], entryId) {
  return entries
    .filter((entry) => entry.id !== entryId)
    .map((entry) => normalizeSingleBrand(entry?.brands))
    .filter(Boolean);
}

const SUPPLY_CHAIN_ROLE_OPTIONS = [
  { value: 'manufacturer', label: 'Manufacturer (MGF)' },
  { value: 'stockist', label: 'Stockist' },
  { value: 'regional_distributor', label: 'Regional Distributor' },
  { value: 'local_distributor', label: 'Local Distributor' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'retailer', label: 'Retailer' }
];
const SUPPLY_CHAIN_ROLE_LABEL_BY_VALUE = SUPPLY_CHAIN_ROLE_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

function genEntryId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `entry-${Date.now()}`;
}

function isEntryCompletedForCompact(entry) {
  const brand = normalizeSingleBrand(entry?.brands);
  const role = String(entry?.role || '').trim();
  const roleDocs = resolveRoleVerificationDocumentUrls(entry);
  return !!(brand && role && roleDocs.length > 0);
}

function RequiredMark() {
  return (
    <span className="field-required" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

function syncProfileFromEntries(currentProfile, entries) {
  const nextEntries = (Array.isArray(entries) ? entries : []).map(normalizeEntryDocumentFields);
  const base = {
    ...currentProfile,
    companyInfoEntries: nextEntries
  };

  if (nextEntries.length !== 1) {
    return base;
  }

  const first = nextEntries[0] || {};
  const roleCertificateFields = setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(first));
  const brandCertificateFields = setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(first));
  return {
    ...base,
    supplierRole: first.role ?? '',
    brands: first.brands ?? '',
    gstin: first.gstin ?? '',
    companyName: first.companyName ?? '',
    ownershipDetails: first.ownershipDetails ?? '',
    minimumOrderValue: first.minimumOrderValue ?? '',
    authorizationCertificateUrls: roleCertificateFields.authorizationCertificateUrls,
    authorizationCertificateUrl: roleCertificateFields.authorizationCertificateUrl,
    brandApprovalDocumentUrls: brandCertificateFields.brandApprovalDocumentUrls,
    brandApprovalDocumentUrl: brandCertificateFields.brandApprovalDocumentUrl
  };
}

function getDisplayEntriesForProfile(profileSnapshot) {
  const entries = profileSnapshot?.companyInfoEntries;
  if (entries && entries.length > 0) return entries;
  return [
    {
      id: 'legacy',
      role: profileSnapshot?.supplierRole || '',
      brands: profileSnapshot?.brands || '',
      gstin: profileSnapshot?.gstin || '',
      companyName: profileSnapshot?.companyName || '',
      ownershipDetails: profileSnapshot?.ownershipDetails || '',
      ...setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(profileSnapshot || {})),
      ...setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(profileSnapshot || {})),
      minimumOrderValue: profileSnapshot?.minimumOrderValue ?? ''
    }
  ];
}

function profileSnapshotIncludesDocument(profileSnapshot, entryId, url, documentType, brand = '') {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl || !profileSnapshot) return false;

  if (entryId === 'legacy') {
    return entryIncludesDocumentUrl(profileSnapshot, normalizedUrl, documentType);
  }

  const entries = getDisplayEntriesForProfile(profileSnapshot);
  const entry =
    entries.find((row) => String(row?.id || '').trim() === String(entryId || '').trim()) ||
    entries.find((row) => matchCompanyInfoEntry(row, { entryId, brand }));
  return entryIncludesDocumentUrl(entry, normalizedUrl, documentType);
}

const CompanyInfoEntryCard = ({
  entry,
  entryIndex,
  totalEntries,
  onUpdate,
  onRemove,
  onBrandDocumentUpload,
  onBrandDocumentRemove,
  onRoleDocumentUpload,
  onRoleDocumentRemove,
  onDocumentUploadIntent = null,
  uploadingBrandDocsForThisEntry,
  uploadingRoleDocsForThisEntry,
  removingBrandDocumentUrl,
  removingRoleDocumentUrl,
  editing,
  canRemove,
  availableRoleOptions = SUPPLY_CHAIN_ROLE_OPTIONS,
  roleOptionsLoading = false,
  roleOptionsMessage = '',
  adminChainReady = false,
  adminChainStatusText = '',
  adminChainPathText = '',
  brandMeta = null,
  sectionView = 'all',
  allowEntryManagement = true,
  forceExpanded = false,
  expanded = true,
  onToggleExpand = null,
  onSaveEntry = null,
  savingThisEntry = false,
  allowEntrySave = false,
  savedBaselineEntries = [],
  allowEntryRemove = false,
  approvedBaselineEntries = [],
  catalogBrandNames = [],
  catalogBrands = null,
  catalogBrandsLoading = null,
  catalogBrandsError = '',
  onReloadCatalogBrands = null,
  useBrandNameTextInput = false,
  excludeBrands = [],
  duplicateBrandMessage = '',
  brandPickerAtTop = false,
  showBrandStepCustomInput = false,
  onChangeBrand = null,
  onSelectApprovedCatalogBrand = null,
  approvedRole = '',
  activeApprovedRole = '',
  supplierApprovedBrands = [],
  supplierBrandRequests = [],
  extraPendingBrandNames = [],
  highlighted = false,
  onRequestChainConfiguration = null,
  chainProfileApprovalStatus = '',
  roleChangeRequestActive = false,
  onRequestRoleChange = null,
  onCancelRoleChangeRequest = null
}) => {
  const selectedBrand = normalizeSingleBrand(entry.brands);
  const catalogBrandSelected =
    !!selectedBrand &&
    catalogBrandNames.some((name) => areBrandNamesExactDuplicates(name, selectedBrand));
  // Path B must keep the text field editable even when the typed value momentarily equals
  // an approved brand (e.g. typing "pransh" passes through "pran").
  const pathBTypingMode = !!showBrandStepCustomInput;
  const hasBrandValue = !!selectedBrand;
  const approvedCatalogMatch =
    useBrandNameTextInput && hasBrandValue && (!catalogBrandSelected || pathBTypingMode)
      ? findApprovedCatalogBrandMatch(selectedBrand, catalogBrandNames)
      : null;
  const brandRequest = findSupplierBrandRequest(selectedBrand, supplierBrandRequests);
  const brandRequestStatus = String(brandRequest?.status || '').toLowerCase();
  const brandRequestSubmittedAt =
    brandRequest?.submittedAt || brandRequest?.requestedAt || brandRequest?.createdAt || null;
  const brandAlreadyApproved =
    !!selectedBrand &&
    isSelectYourselfBrandAlreadyApproved(selectedBrand, {
      catalogBrands,
      supplierApprovedBrands,
      supplierBrandRequests
    });
  const extraPendingKey = brandKeyForDuplicateCheck(selectedBrand);
  const extraPendingRequest =
    !!extraPendingKey &&
    (Array.isArray(extraPendingBrandNames) ? extraPendingBrandNames : []).some(
      (name) => brandKeyForDuplicateCheck(name) === extraPendingKey
    );
  // Stale pending request rows must not win after Admin approval / catalog access.
  const isPendingBrandRequest =
    (brandRequestStatus === 'pending' || extraPendingRequest) && !brandAlreadyApproved;
  const isRejectedBrandRequest = brandRequestStatus === 'rejected' && !brandAlreadyApproved;
  const brandNameEditable =
    editing &&
    !isPendingBrandRequest &&
    (!useBrandNameTextInput || !catalogBrandSelected || pathBTypingMode);
  const approvedCatalogSuggestions =
    useBrandNameTextInput &&
    hasBrandValue &&
    !catalogBrandSelected &&
    !approvedCatalogMatch &&
    !isPendingBrandRequest &&
    !isRejectedBrandRequest
      ? findApprovedCatalogBrandSuggestions(selectedBrand, catalogBrandNames)
      : [];
  const primarySuggestion = approvedCatalogSuggestions[0] || null;
  const approvedCatalogMatchMessage = approvedCatalogMatch?.name
    ? pathBTypingMode
      ? `"${approvedCatalogMatch.name}" is already approved. Keep typing if your brand name is longer, or switch to Path A to use “${approvedCatalogMatch.name}”.`
      : formatApprovedCatalogBrandMatchMessage(selectedBrand, approvedCatalogMatch.name)
    : '';
  const approvedCatalogSuggestionMessage = primarySuggestion?.name
    ? formatApprovedCatalogBrandSuggestionMessage(selectedBrand, primarySuggestion.name)
    : '';
  const applySuggestedApprovedBrand = (brandName) => {
    const next = String(brandName || '').trim();
    if (!next) return;
    setTypedBrandName(next);
    setBrandNameFieldFocused(false);
    if (typeof onSelectApprovedCatalogBrand === 'function') {
      onSelectApprovedCatalogBrand(next);
      return;
    }
    onUpdate('brands', next);
  };
  const [typedBrandName, setTypedBrandName] = useState(selectedBrand);
  const [brandNameFieldFocused, setBrandNameFieldFocused] = useState(false);
  useEffect(() => {
    if (brandNameFieldFocused) return;
    setTypedBrandName(selectedBrand);
  }, [selectedBrand, brandNameFieldFocused]);
  const [requestingChainConfig, setRequestingChainConfig] = useState(false);
  const [chainConfigRequestFeedback, setChainConfigRequestFeedback] = useState('');
  const [roleSelectUnlocked, setRoleSelectUnlocked] = useState(false);
  useEffect(() => {
    if (roleChangeRequestActive) {
      setRoleSelectUnlocked(true);
      return;
    }
    setRoleSelectUnlocked(false);
  }, [roleChangeRequestActive]);
  const handleRequestChainConfiguration = async () => {
    if (typeof onRequestChainConfiguration !== 'function' || !selectedBrand || requestingChainConfig) return;
    setRequestingChainConfig(true);
    setChainConfigRequestFeedback('');
    try {
      const result = await onRequestChainConfiguration(selectedBrand);
      setChainConfigRequestFeedback(
        result?.message ||
          (result?.ok
            ? 'Admin has been notified to configure supply-chain roles for this brand.'
            : 'Failed to notify admin. Please try again.')
      );
    } finally {
      setRequestingChainConfig(false);
    }
  };
  const roleLabel = SUPPLY_CHAIN_ROLE_OPTIONS.find((o) => o.value === entry.role)?.label || null;
  const brandDocUrls = resolveBrandApprovalDocumentUrls(entry);
  const roleDocUrls = resolveRoleVerificationDocumentUrls(entry);
  const resolvedBrandName =
    String(brandMeta?.brand || '').trim() || String(brandMeta?.normalizedBrand || '').trim() || selectedBrand;
  const isUnifiedRegistration = sectionView === 'all';
  const isBrandOnlyStep = sectionView === 'brand';
  const isSupplyChainOnlyStep = sectionView === 'form';
  const hasResolvedChainRoles = availableRoleOptions.length > 0;
  const currentRoleValue = String(entry.role || '').trim();
  const assignedRoleValue = currentRoleValue || String(activeApprovedRole || approvedRole || '').trim();
  const hasChosenRole = Boolean(assignedRoleValue);
  const assignedRoleLabel = assignedRoleValue
    ? formatSupplyChainRoleLabel(assignedRoleValue)
    : '';
  const roleSelectOptions = (() => {
    const opts = Array.isArray(availableRoleOptions) ? [...availableRoleOptions] : [];
    if (currentRoleValue && !opts.some((o) => o.value === currentRoleValue)) {
      const fallback = SUPPLY_CHAIN_ROLE_OPTIONS.find((o) => o.value === currentRoleValue);
      opts.push(fallback || { value: currentRoleValue, label: formatSupplyChainRoleLabel(currentRoleValue) });
    }
    return opts;
  })();
  const brandOnlyApproved = isBrandOnlyStep && catalogBrandSelected;
  const showBrandDocumentsUpload = editing && !brandAlreadyApproved && !isPendingBrandRequest;
  const brandStatus = String(
    brandMeta?.approvalStatus ||
      brandMeta?.status ||
      brandRequestStatus ||
      (hasResolvedChainRoles ? 'approved' : selectedBrand ? 'missing' : 'unselected')
  ).toLowerCase();
  const brandLayers = resolveSupplierBrandSetupLayers({
    brandName: resolvedBrandName || selectedBrand,
    catalogBrands,
    supplierApprovedBrands,
    supplierBrandRequests,
    brandMeta
  });
  const chainDefined =
    brandLayers.hasSupplyChainDefinition ||
    !!brandMeta?.hasSupplyChainDefinition ||
    hasResolvedChainRoles;
  const brandStepStatus = isBrandOnlyStep
    ? pathBTypingMode && catalogBrandSelected
      ? {
          tone: 'warning',
          label: 'Approved name exists — keep typing or use Path A',
          detailLines: [
            selectedBrand,
            `"${selectedBrand}" is already an approved brand. Keep typing if your full brand name is longer (for example continues after this), or switch to Path A to select it.`
          ]
        }
      : resolveSelectYourselfBrandStepStatus({
          brandName: selectedBrand,
          catalogBrandNames,
          catalogBrands,
          supplierBrandRequests,
          supplierApprovedBrands,
          approvedCatalogMatchMessage,
          approvedCatalogSuggestionMessage,
          extraPendingBrandNames
        })
    : null;
  const statusTone = isBrandOnlyStep
    ? brandStepStatus.tone
    : brandLayers.canSelectRoles
      ? 'success'
      : brandLayers.supplierHasAccess
        ? 'warning'
        : brandLayers.approvalStatus === 'pending'
          ? 'warning'
          : brandLayers.approvalStatus === 'rejected'
            ? 'danger'
            : 'neutral';
  const statusLabel = isBrandOnlyStep
    ? brandStepStatus.label
    : !hasBrandValue
      ? 'Select a brand first'
      : brandLayers.canSelectRoles
        ? 'Approved — roles available'
        : brandLayers.supplierHasAccess
          ? 'Approved (chain setup pending)'
          : brandLayers.approvalStatus === 'pending' || isPendingBrandRequest
            ? 'Request submitted — pending admin approval'
            : brandLayers.approvalStatus === 'rejected' || isRejectedBrandRequest
              ? 'Rejected by admin'
              : 'Brand access required';
  const statusDetailLines = isBrandOnlyStep
    ? brandStepStatus.detailLines
    : (() => {
        const lines = [];
        if (hasBrandValue && resolvedBrandName) {
          lines.push(resolvedBrandName);
        }
        const showPendingDetails =
          isPendingBrandRequest ||
          brandStatus === 'pending' ||
          brandLayers.approvalStatus === 'pending';
        const showRejectedDetails = isRejectedBrandRequest;

        if (approvedCatalogMatchMessage && !showPendingDetails && !showRejectedDetails) {
          lines.push(approvedCatalogMatchMessage);
          lines.push('Select the approved brand below to continue with role setup.');
        } else if (showPendingDetails) {
          lines.push(
            'Your brand approval request was submitted. Waiting for admin review — no need to submit again.'
          );
          lines.push(
            brandRequestSubmittedAt
              ? `Submitted: ${formatDateTimeIST(brandRequestSubmittedAt, '—')}`
              : 'Submitted: date will appear after refresh if admin review is still pending.'
          );
        } else if (showRejectedDetails) {
          if (brandRequest?.rejectionReason) {
            lines.push(brandRequest.rejectionReason);
          }
          lines.push(
            brandRequestSubmittedAt
              ? `Originally submitted: ${formatDateTimeIST(brandRequestSubmittedAt, '—')}`
              : 'Originally submitted: date unavailable'
          );
        } else if (approvedCatalogSuggestionMessage) {
          lines.push(approvedCatalogSuggestionMessage);
        } else if ((brandOnlyApproved || brandRequestStatus === 'approved') && brandRequestSubmittedAt) {
          lines.push(`Submitted: ${formatDateTimeIST(brandRequestSubmittedAt, '—')}`);
        }
        return lines;
      })();
  const brandApprovedForSupplyChain = brandLayers.supplierHasAccess;
  const brandCanSelectRoles =
    typeof brandMeta?.canSelectRoles === 'boolean'
      ? brandMeta.canSelectRoles && brandApprovedForSupplyChain
      : supplierCanSelectBrandRoles({
          brandName: resolvedBrandName || selectedBrand,
          catalogBrands,
          supplierApprovedBrands,
          supplierBrandRequests,
          brandMeta
        });
  // Layer 2 access + Layer 3 chain (or already-loaded roles) before role setup UI unlocks.
  const brandApprovalReadyForRole =
    hasBrandValue && brandApprovedForSupplyChain && (chainDefined || hasResolvedChainRoles || brandCanSelectRoles);
  const approvedRoleLabel = (activeApprovedRole || approvedRole)
    ? formatSupplyChainRoleLabel(activeApprovedRole || approvedRole)
    : '';
  const pendingRoleChange =
    !!(activeApprovedRole || approvedRole) &&
    !!entry.role &&
    String(entry.role).trim() !== String(activeApprovedRole || approvedRole).trim();
  const movChanged = entryMinimumOrderValueChanged(entry, savedBaselineEntries);
  const roleLocked =
    isSupplyChainOnlyStep &&
    isEntrySupplyChainOnboardingComplete(entry, { chainProfileApprovalStatus }, savedBaselineEntries) &&
    !!(activeApprovedRole || approvedRole) &&
    !roleChangeRequestActive;
  const showRoleSelect =
    editing &&
    (!hasChosenRole || roleSelectUnlocked || roleChangeRequestActive) &&
    !roleLocked;
  const showBrandNotApprovedStep2Message =
    isSupplyChainOnlyStep && hasBrandValue && !brandApprovedForSupplyChain;
  const catalogLoading = Boolean(catalogBrandsLoading);
  const supplyChainRolesLoading =
    roleOptionsLoading || (isSupplyChainOnlyStep && hasBrandValue && catalogLoading);
  const showSupplyChainRolesLoading =
    isSupplyChainOnlyStep &&
    hasBrandValue &&
    brandApprovedForSupplyChain &&
    supplyChainRolesLoading &&
    !hasResolvedChainRoles;
  const showChainNotDefinedStep2Message =
    isSupplyChainOnlyStep &&
    hasBrandValue &&
    brandApprovedForSupplyChain &&
    !chainDefined &&
    !hasResolvedChainRoles &&
    !supplyChainRolesLoading;
  const roleSelectionEnabled =
    editing &&
    brandApprovalReadyForRole &&
    !supplyChainRolesLoading &&
    hasResolvedChainRoles &&
    (!roleLocked || roleChangeRequestActive);
  const roleDocumentsEnabled =
    editing && brandApprovalReadyForRole && (!roleLocked || roleChangeRequestActive);
  const movOnlySavePending = roleLocked && !roleChangeRequestActive && movChanged;
  const showCustomBrandNameField =
    useBrandNameTextInput &&
    editing &&
    // Path B: never swap the text input for a locked pill while the supplier is still typing,
    // even if the current value exactly matches an approved brand (pran → pransh).
    (pathBTypingMode || !selectedBrand || !catalogBrandSelected) &&
    (!brandPickerAtTop || pathBTypingMode);
  const showBrandApprovalSection = sectionView !== 'form';
  const showFormDetailsSection = sectionView !== 'brand';
  const showEntrySave =
    editing &&
    showFormDetailsSection &&
    !!onSaveEntry &&
    allowEntrySave &&
    brandApprovalReadyForRole &&
    (!roleLocked || roleChangeRequestActive || movOnlySavePending);
  const entrySaveState = showEntrySave
    ? getSelectYourselfEntrySaveState(
        entry,
        savedBaselineEntries,
        approvedBaselineEntries,
        activeApprovedRole || approvedRole
      )
    : { ok: true, message: '', field: '', missing: [], alreadySaved: false, enabled: true };
  const entrySaveEnabled =
    (entrySaveState.enabled || movOnlySavePending) && !savingThisEntry;
  const entrySaveTitle = savingThisEntry
    ? 'Saving this entry…'
    : movOnlySavePending
      ? 'Save minimum order value'
      : entrySaveState.alreadySaved
      ? 'This entry is already saved'
      : entrySaveState.enabled && !entrySaveState.ok
        ? entrySaveState.pendingApprovedRoleChange
          ? `${entrySaveState.message || 'Complete required fields, then save to submit this role change for admin approval.'}`
          : entrySaveState.message || 'Complete required fields, then save this entry'
        : entrySaveState.ok
          ? entrySaveState.pendingApprovedRoleChange
            ? 'Submit role change request for admin approval'
            : 'Save this entry'
          : entrySaveState.message;
  const showEntryRemove = canRemove && editing && allowEntryRemove && isBrandOnlyStep;
  const showHeader =
    sectionView === 'brand'
      ? totalEntries > 0
      : !(sectionView === 'brand' && forceExpanded && !allowEntryManagement);

  const handleBrandNameInput = (nextBrand) => {
    // Keep the typed characters. Suggestions never replace this unless the supplier
    // clicks Use “…”. Do not trim while typing — that made “safarii” feel like it vanished.
    const live = sanitizeBrandNameWhileTyping(nextBrand);
    setTypedBrandName(live);
    onUpdate('brands', sanitizeCustomBrandInput(live));
  };

  return (
    <article
      className={`chain-entry-card${highlighted ? ' chain-entry-card--focus-highlight' : ''}`}
      data-chain-entry-id={entry.id}
    >
      {showHeader ? <header className="chain-entry-header">
        <div className="chain-entry-header__main">
          <span className="chain-entry-header__eyebrow">
            {isBrandOnlyStep
              ? `Brand ${entryIndex} of ${totalEntries}`
              : isSupplyChainOnlyStep
                ? `Supply chain ${entryIndex} of ${totalEntries}`
                : `Entry ${entryIndex} of ${totalEntries}`}
          </span>
          <div className="chain-entry-header__chips">
            {!isBrandOnlyStep ? (
              <span className={`chain-chip ${roleLabel ? 'chain-chip--role' : 'chain-chip--muted'}`}>
                {roleLabel || 'Role pending'}
              </span>
            ) : null}
            <span className={`chain-chip ${selectedBrand ? 'chain-chip--brand' : 'chain-chip--muted'}`}>
              {selectedBrand || 'Brand pending'}
            </span>
            {isBrandOnlyStep ? (
              <span className={`chain-chip ${brandDocUrls.length > 0 ? 'chain-chip--brand' : 'chain-chip--muted'}`}>
                {brandAlreadyApproved
                  ? 'Brand docs: not required'
                  : brandDocUrls.length > 0
                    ? `Brand docs: ${brandDocUrls.length}`
                    : 'Brand docs: optional'}
              </span>
            ) : (
              <span className={`chain-chip ${roleDocUrls.length > 0 ? 'chain-chip--brand' : 'chain-chip--muted'}`}>
                {roleDocUrls.length > 0 ? `Role docs: ${roleDocUrls.length}` : 'Role docs pending'}
              </span>
            )}
          </div>
        </div>
        <div className="chain-entry-header__actions">
          {showEntrySave ? (
            <button
              type="button"
              className="chain-entry-save"
              onClick={() => onSaveEntry?.(entry.id, entryIndex - 1)}
              disabled={!entrySaveEnabled}
              title={entrySaveTitle}
              aria-disabled={!entrySaveEnabled}
            >
              {savingThisEntry
                ? 'Saving…'
                : movOnlySavePending
                  ? 'Save order rules'
                  : entrySaveState.pendingApprovedRoleChange || roleChangeRequestActive
                    ? 'Submit role change'
                    : entrySaveState.alreadySaved
                      ? 'Saved'
                      : 'Save entry'}
            </button>
          ) : null}
          {!forceExpanded ? (
            <button
              type="button"
              className="chain-entry-toggle"
              onClick={onToggleExpand}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse this entry' : 'Expand this entry'}
            >
              {expanded ? (
                <>
                  <ChevronUp size={16} />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown size={16} />
                  Expand
                </>
              )}
            </button>
          ) : null}
          {showEntryRemove ? (
            <button
              type="button"
              className="chain-entry-remove"
              onClick={onRemove}
              aria-label="Remove this entry"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </header> : null}

      {forceExpanded || expanded ? <div className="chain-entry-body">
        {showBrandApprovalSection ? (
        <div className="chain-entry-approval-block">
          <section className="chain-section">
            <div className="chain-section__panel">
              <div className="chain-brand-grid">
                {useBrandNameTextInput && !brandPickerAtTop ? (
                  <div className="chain-field chain-field--full">
                    <label className="chain-field__label" htmlFor={`brand-select-${entry.id}`}>
                      {isBrandOnlyStep ? 'Approved brand' : 'Select brand'}
                      <RequiredMark />
                    </label>
                    <BrandSelect
                      id={`brand-select-${entry.id}`}
                      name={`brand-select-${entry.id}`}
                      value={selectedBrand}
                      onChange={handleBrandNameInput}
                      disabled={!editing}
                      required={editing}
                      allowOther
                      source="catalog"
                      dropdownOnly
                      excludeBrands={excludeBrands}
                      brands={catalogBrands}
                      brandNames={catalogBrandNames}
                      loading={catalogBrandsLoading}
                      error={catalogBrandsError}
                      onRetry={onReloadCatalogBrands}
                      className="chain-brand-select"
                    />
                    {isUnifiedRegistration ? (
                      <p className="chain-field__sublabel">
                        {catalogBrandSelected
                          ? `Selected: ${selectedBrand}. Choose your supply-chain role below.`
                          : selectedBrand
                            ? `Brand "${selectedBrand}" will be used for this registration. Choose your supply-chain role below.`
                            : 'Pick a brand from the list — your role options appear in this same form.'}
                      </p>
                    ) : isBrandOnlyStep ? (
                      <p className="chain-field__sublabel">
                        {selectedBrand
                          ? `"${selectedBrand}" will appear automatically below for supply-chain role selection.`
                          : 'Pick an approved brand here. Your supply-chain role form below will fill in this brand automatically.'}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {showCustomBrandNameField ? (
                <div className="chain-field chain-field--full">
                  <label className="chain-field__label" htmlFor={`brand-name-${entry.id}`}>
                    Brand name
                    <RequiredMark />
                  </label>
                  <input
                    id={`brand-name-${entry.id}`}
                    type="text"
                    className="chain-field__control"
                    value={typedBrandName}
                    onChange={(e) => handleBrandNameInput(e.target.value)}
                    onFocus={() => setBrandNameFieldFocused(true)}
                    onBlur={() => {
                      setBrandNameFieldFocused(false);
                      const trimmed = sanitizeCustomBrandInput(typedBrandName);
                      setTypedBrandName(trimmed);
                      if (trimmed !== selectedBrand) onUpdate('brands', trimmed);
                    }}
                    disabled={!brandNameEditable}
                    placeholder="Enter your brand name for admin approval"
                    required={editing}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-required="true"
                    aria-invalid={duplicateBrandMessage || approvedCatalogMatchMessage ? 'true' : undefined}
                  />
                  {duplicateBrandMessage ? (
                    <p className="chain-field__error" role="alert">
                      {duplicateBrandMessage}
                    </p>
                  ) : approvedCatalogMatchMessage ? (
                    <div className="chain-field__hint-block" role="status">
                      <p className="chain-field__error">{approvedCatalogMatchMessage}</p>
                      {approvedCatalogMatch?.name ? (
                        <button
                          type="button"
                          className="chain-entry-selector__link"
                          onClick={() => applySuggestedApprovedBrand(approvedCatalogMatch.name)}
                        >
                          Use approved brand “{approvedCatalogMatch.name}”
                        </button>
                      ) : null}
                    </div>
                  ) : approvedCatalogSuggestionMessage ? (
                    <div className="chain-field__hint-block" role="status">
                      <p className="chain-field__sublabel">{approvedCatalogSuggestionMessage}</p>
                      {primarySuggestion?.name ? (
                        <button
                          type="button"
                          className="chain-entry-selector__link"
                          onClick={() => applySuggestedApprovedBrand(primarySuggestion.name)}
                        >
                          Use “{primarySuggestion.name}”
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="chain-field__sublabel">
                    {approvedCatalogMatchMessage
                      ? pathBTypingMode
                        ? 'You can keep typing a longer brand name, or switch to Path A to use the approved brand.'
                        : 'This exact brand is already approved — select it to continue.'
                      : 'Finish typing your full brand name. Matching approved brands appear as suggestions only.'}
                  </p>
                </div>
                ) : brandPickerAtTop && selectedBrand ? (
                  <div className="chain-field chain-field--full">
                    <span className="chain-field__label">Selected brand for this setup</span>
                    <div className="chain-selected-brand-row">
                      <div
                        className={`chain-selected-brand-pill${
                          catalogBrandSelected ? ' chain-selected-brand-pill--locked' : ''
                        }`}
                        aria-live="polite"
                      >
                        {selectedBrand}
                      </div>
                    </div>
                    <p className="chain-field__sublabel">
                      {catalogBrandSelected
                        ? 'Path A is locked for this setup. Use Change brand or Cancel setup above to pick a different brand.'
                        : 'Path B request is in progress. Use Change brand or Cancel setup above to switch paths.'}
                    </p>
                  </div>
                ) : catalogBrandSelected && isUnifiedRegistration ? (
                  <div className="chain-field chain-field--full">
                    <span className="chain-field__label">Brand for this registration</span>
                    <div className="chain-selected-brand-row">
                      <div className="chain-selected-brand-pill" aria-live="polite">
                        {selectedBrand}
                      </div>
                      {editing ? (
                        <button
                          type="button"
                          className="chain-change-brand-btn"
                          onClick={() => onUpdate('brands', '')}
                        >
                          Change brand
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {duplicateBrandMessage && !showCustomBrandNameField ? (
                  <p className="chain-field__error chain-field__error--full" role="alert">
                    {duplicateBrandMessage}
                  </p>
                ) : null}
              </div>
              {!isUnifiedRegistration && !isBrandOnlyStep ? (
              <div className="chain-brand-approval-grid">
                <div className="chain-field">
                  <label className="chain-field__label">Status</label>
                  <div className={`chain-status-card chain-status-card--${statusTone}`}>
                    <strong>{statusLabel}</strong>
                    {statusDetailLines.map((line, index) => (
                      <span
                        key={`${index}-${line}`}
                        className={
                          /^Submitted:|^Originally submitted:/i.test(line)
                            ? 'chain-status-card__submitted'
                            : undefined
                        }
                      >
                        {line}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="chain-field">
                  <label className="chain-field__label">
                    Brand documents
                  </label>
                  {showBrandDocumentsUpload ? (
                    <BrandAuthorizationDocuments
                      entry={entry}
                      editing={editing}
                      uploading={uploadingBrandDocsForThisEntry}
                      removingUrl={removingBrandDocumentUrl}
                      onUpload={(files) => onBrandDocumentUpload?.(entry.id, files)}
                      onRemove={(url) => onBrandDocumentRemove?.(entry.id, url)}
                      onUploadIntent={onDocumentUploadIntent}
                      resolveUrls={resolveBrandApprovalDocumentUrls}
                    />
                  ) : brandAlreadyApproved ? (
                    <p className="chain-field__sublabel" role="status">
                      Document verification is not required — this brand is already approved. Continue with Path A
                      role setup below.
                    </p>
                  ) : isPendingBrandRequest ? (
                    <p className="chain-field__sublabel" role="status">
                      Your brand approval request is pending admin review. Documents already submitted cannot be
                      changed here.
                    </p>
                  ) : (
                    <BrandAuthorizationDocuments
                      entry={entry}
                      editing={false}
                      uploading={false}
                      removingUrl={null}
                      onUpload={null}
                      onRemove={null}
                      resolveUrls={resolveBrandApprovalDocumentUrls}
                    />
                  )}
                </div>
              </div>
              ) : isBrandOnlyStep ? (
              <>
              <div className="chain-brand-approval-grid chain-brand-approval-grid--brand-step">
                <div className="chain-field">
                  <label className="chain-field__label">Brand status</label>
                  <div className={`chain-status-card chain-status-card--${statusTone}`}>
                    <strong>{statusLabel}</strong>
                    {statusDetailLines.map((line, index) => (
                      <span
                        key={`${index}-${line}`}
                        className={
                          /^Submitted:|^Originally submitted:/i.test(line)
                            ? 'chain-status-card__submitted'
                            : undefined
                        }
                      >
                        {line}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="chain-field">
                  <label className="chain-field__label">
                    Brand documents{brandAlreadyApproved ? '' : ' (optional)'}
                  </label>
                  {showBrandDocumentsUpload ? (
                    <BrandAuthorizationDocuments
                      entry={entry}
                      editing={editing}
                      uploading={uploadingBrandDocsForThisEntry}
                      removingUrl={removingBrandDocumentUrl}
                      onUpload={(files) => onBrandDocumentUpload?.(entry.id, files)}
                      onRemove={(url) => onBrandDocumentRemove?.(entry.id, url)}
                      onUploadIntent={onDocumentUploadIntent}
                      resolveUrls={resolveBrandApprovalDocumentUrls}
                    />
                  ) : brandAlreadyApproved ? (
                    <p className="chain-field__sublabel" role="status">
                      Document verification is not required — this brand is already approved. Use Path A above or
                      continue with supply-chain role setup below.
                    </p>
                  ) : isPendingBrandRequest ? (
                    <p className="chain-field__sublabel" role="status">
                      Your brand approval request is pending admin review. Documents already submitted cannot be
                      changed here.
                    </p>
                  ) : (
                    <BrandAuthorizationDocuments
                      entry={entry}
                      editing={false}
                      uploading={false}
                      removingUrl={null}
                      onUpload={null}
                      onRemove={null}
                      resolveUrls={resolveBrandApprovalDocumentUrls}
                    />
                  )}
                </div>
              </div>
              </>
              ) : null}
            </div>
          </section>

        </div>
        ) : null}

        {showFormDetailsSection ? (
        <div className={`chain-entry-form-block${isUnifiedRegistration ? ' chain-entry-form-block--unified' : ''}${isSupplyChainOnlyStep ? ' chain-entry-form-block--supply-chain-step' : ''}`}>
          <h3 className="chain-entry-block-title">
            {isSupplyChainOnlyStep
              ? `Supply-chain role for ${resolvedBrandName || 'your brand'}`
              : 'Your supply-chain role'}
          </h3>
          {hasBrandValue ? (
            <div className="chain-form-brand-summary">
              {isSupplyChainOnlyStep ? (
                <div className="chain-field chain-field--full">
                  <label className="chain-field__label" htmlFor={`brand-readonly-${entry.id}`}>
                    Brand (from your selection above)
                  </label>
                  <input
                    id={`brand-readonly-${entry.id}`}
                    type="text"
                    className="chain-field__control chain-field__control--readonly"
                    value={resolvedBrandName}
                    readOnly
                    disabled
                    aria-readonly="true"
                  />
                  <p className="chain-field__sublabel">
                    This is the approved brand you selected. Pick your position in the supply chain below.
                  </p>
                </div>
              ) : null}
              {!isSupplyChainOnlyStep ? (
              <div className={`chain-status-card chain-status-card--${statusTone}`}>
                <strong>{statusLabel}</strong>
                {statusDetailLines.map((line, index) => (
                  <span
                    key={`${index}-${line}`}
                    className={
                      /^Submitted:|^Originally submitted:/i.test(line)
                        ? 'chain-status-card__submitted'
                        : undefined
                    }
                  >
                    {line}
                  </span>
                ))}
              </div>
              ) : null}
              {showSupplyChainRolesLoading ? (
                <div className="chain-callout chain-callout--info" role="status" aria-live="polite">
                  <p>Loading supply-chain roles for this brand…</p>
                </div>
              ) : showBrandNotApprovedStep2Message ? (
                <p className="chain-callout chain-callout--warning" role="alert">
                  {BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE}
                </p>
              ) : showChainNotDefinedStep2Message ? (
                <div className="chain-callout chain-callout--warning" role="alert">
                  <p>{SUPPLY_CHAIN_NOT_DEFINED_MESSAGE}</p>
                  {typeof onRequestChainConfiguration === 'function' ? (
                    <button
                      type="button"
                      className="chain-entry-selector__link"
                      disabled={requestingChainConfig}
                      onClick={handleRequestChainConfiguration}
                    >
                      {requestingChainConfig ? 'Notifying admin…' : 'Request Role Configuration'}
                    </button>
                  ) : null}
                  {chainConfigRequestFeedback ? (
                    <p className="chain-field__sublabel">{chainConfigRequestFeedback}</p>
                  ) : null}
                </div>
              ) : roleOptionsMessage && !approvedRole && !hasResolvedChainRoles && !supplyChainRolesLoading ? (
                <div className="chain-callout chain-callout--warning">
                  <p>{roleOptionsMessage}</p>
                  {roleOptionsMessage === SUPPLY_CHAIN_NOT_DEFINED_MESSAGE &&
                  typeof onRequestChainConfiguration === 'function' ? (
                    <button
                      type="button"
                      className="chain-entry-selector__link"
                      disabled={requestingChainConfig}
                      onClick={handleRequestChainConfiguration}
                    >
                      {requestingChainConfig ? 'Notifying admin…' : 'Request Role Configuration'}
                    </button>
                  ) : null}
                  {chainConfigRequestFeedback ? (
                    <p className="chain-field__sublabel">{chainConfigRequestFeedback}</p>
                  ) : null}
                </div>
              ) : adminChainPathText ? (
                <p className="chain-callout chain-callout--info">{adminChainPathText}</p>
              ) : adminChainStatusText ? (
                <p className="chain-callout chain-callout--info">{adminChainStatusText}</p>
              ) : null}
            </div>
          ) : (
            <p className="chain-callout chain-callout--warning">
              {isSupplyChainOnlyStep
                ? 'Brand missing. Select an approved brand above first.'
                : isUnifiedRegistration
                  ? 'Select a brand in the dropdown above. Your supply-chain role options will appear here automatically.'
                  : 'Select a brand first. Supply-chain role options appear here once the brand is admin-approved and the supply chain is defined.'}
            </p>
          )}
          <section className="chain-section">
            <h4 className="chain-section__title">
              {isSupplyChainOnlyStep ? 'Your position in supply chain' : 'Supply-chain role'}
            </h4>
            <div className="chain-section__panel">
              {roleLocked ? (
                <div className="chain-callout chain-callout--success" role="status">
                  <strong>Active approved role: {approvedRoleLabel}</strong>
                  <p>
                    Your supply-chain onboarding is complete for this brand. Your assigned role stays active until
                    admin approves any change.
                  </p>
                  <div className="chain-role-lock-actions">
                    {typeof onRequestRoleChange === 'function' ? (
                      <button
                        type="button"
                        className="chain-entry-selector__link"
                        onClick={() => onRequestRoleChange(entry.id)}
                      >
                        {REQUEST_ROLE_CHANGE_LABEL}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {roleChangeRequestActive ? (
                <div className="chain-callout chain-callout--warning" role="status">
                  <strong>Role change request</strong>
                  <p>
                    Choose your new supply-chain role and upload verification documents, then submit for admin approval.
                    Your current approved role ({approvedRoleLabel}) stays active until the change is approved.
                  </p>
                  {typeof onCancelRoleChangeRequest === 'function' ? (
                    <button
                      type="button"
                      className="chain-entry-selector__link"
                      onClick={() => onCancelRoleChangeRequest(entry.id)}
                    >
                      Cancel role change
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="chain-field chain-field--full">
                <label className="chain-field__label" htmlFor={`role-${entry.id}`}>
                  {roleLocked || (hasChosenRole && !showRoleSelect)
                    ? 'Assigned supply-chain role'
                    : isSupplyChainOnlyStep
                      ? 'Select your position'
                      : 'Supply-chain role'}
                  {adminChainReady && showRoleSelect && !roleLocked ? <RequiredMark /> : null}
                </label>
                {roleLocked || (hasChosenRole && !showRoleSelect) ? (
                  <>
                    <input
                      id={`role-${entry.id}`}
                      type="text"
                      className="chain-field__control chain-field__control--readonly"
                      value={approvedRoleLabel || assignedRoleLabel}
                      readOnly
                      disabled
                      aria-readonly="true"
                    />
                    {editing && brandApprovalReadyForRole && !roleLocked ? (
                      <div className="chain-role-lock-actions">
                        <button
                          type="button"
                          className="chain-entry-selector__link"
                          onClick={() => setRoleSelectUnlocked(true)}
                        >
                          {CHANGE_ROLE_LABEL}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <select
                    id={`role-${entry.id}`}
                    className="chain-field__control"
                    value={currentRoleValue}
                    onChange={(e) => {
                      const nextRole = e.target.value;
                      onUpdate('role', nextRole);
                      if (nextRole) setRoleSelectUnlocked(false);
                    }}
                    disabled={!roleSelectionEnabled || supplyChainRolesLoading}
                    required={editing && brandApprovalReadyForRole}
                    aria-required={editing && brandApprovalReadyForRole ? 'true' : 'false'}
                    aria-busy={supplyChainRolesLoading ? 'true' : 'false'}
                  >
                    <option value="">
                      {supplyChainRolesLoading
                        ? 'Loading supply-chain roles…'
                        : showChainNotDefinedStep2Message ||
                          (!supplyChainRolesLoading &&
                            !hasResolvedChainRoles &&
                            roleOptionsMessage === SUPPLY_CHAIN_NOT_DEFINED_MESSAGE)
                          ? 'No roles configured by admin'
                          : 'Select your role'}
                    </option>
                    {roleSelectOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {hasChosenRole && showRoleSelect && !roleChangeRequestActive ? (
                  <div className="chain-role-lock-actions">
                    <button
                      type="button"
                      className="chain-entry-selector__link"
                      onClick={() => setRoleSelectUnlocked(false)}
                    >
                      Keep current role
                    </button>
                  </div>
                ) : null}
                {approvedRoleLabel && !roleLocked && showRoleSelect ? (
                  <p className="chain-field__sublabel">
                    Approved role: <strong>{approvedRoleLabel}</strong>
                    {pendingRoleChange
                      ? '. Changing role requires admin approval after you save.'
                      : ''}
                  </p>
                ) : null}
                {pendingRoleChange && !roleLocked && showRoleSelect ? (
                  <p className="chain-callout chain-callout--warning">
                    You selected {formatSupplyChainRoleLabel(entry.role)} instead of your approved role (
                    {approvedRoleLabel}). Save this entry to submit the change for admin approval. Your current approved
                    role stays active until admin approves.
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="chain-section">
            <h4 className="chain-section__title">
              {roleLocked ? 'Approved role documents' : 'Supply-chain role documents'}
            </h4>
            <div className="chain-section__panel">
              <div className="chain-field chain-field--full">
                <label className="chain-field__label">
                  Role verification documents
                  {!roleLocked ? <RequiredMark /> : null}
                </label>
                <BrandAuthorizationDocuments
                  entry={entry}
                  editing={roleDocumentsEnabled}
                  uploading={uploadingRoleDocsForThisEntry}
                  removingUrl={removingRoleDocumentUrl}
                  onUpload={(files) => onRoleDocumentUpload?.(entry.id, files)}
                  onRemove={(url) => onRoleDocumentRemove?.(entry.id, url)}
                  onUploadIntent={onDocumentUploadIntent}
                  resolveUrls={resolveRoleVerificationDocumentUrls}
                />
                {showEntrySave && entrySaveState.missing.includes('documents') ? (
                  <p className="chain-field__error" role="status">
                    {SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {entry.role && entry.role !== 'retailer' ? (
            <section className="chain-section">
              <h4 className="chain-section__title">Order rules</h4>
              <div className="chain-field chain-field--full">
                <label className="chain-field__label" htmlFor={`mov-${entry.id}`}>
                  Minimum order value (₹)
                  <RequiredMark />
                </label>
                <input
                  id={`mov-${entry.id}`}
                  type="number"
                  min={0}
                  step={1}
                  className="chain-field__control"
                  value={entry.minimumOrderValue ?? ''}
                  onChange={(e) => onUpdate('minimumOrderValue', e.target.value)}
                  disabled={!editing || !brandApprovalReadyForRole}
                  placeholder="e.g. 25000"
                  required={editing}
                  aria-required="true"
                />
                {showEntrySave && entrySaveState.missing.includes('minimumOrderValue') ? (
                  <p className="chain-field__error" role="status">
                    {SELECT_YOURSELF_MOV_REQUIRED_MESSAGE}
                  </p>
                ) : (
                  <p className="chain-callout chain-callout--info">
                    Downstream partners must meet this order total when buying from you in this layer. You can
                    change this anytime — it saves immediately without admin approval.
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </div>
        ) : null}
      </div> : null}
    </article>
  );
};

/**
 * Supply-chain role + brands + certificates (one block per layer). Used on the dedicated Select yourself page.
 */
export default function SupplierSupplyChainEntriesEditor({
  profile,
  setProfile,
  editing,
  sectionView = 'all',
  selectionMode = 'all',
  allowEntryManagement = true,
  onSaveEntry = null,
  onRemoveEntry = null,
  savingEntryId = null,
  savedBaselineEntries = [],
  showAddEntry = null,
  approvedBaselineEntries = [],
  focusEntryId = '',
  onFocusEntryHandled = null,
  onBrandPickedWithoutRole = null,
  filterBrandName = '',
  supplierApprovedBrands = [],
  supplierBrandRequests = [],
  extraPendingBrandNames = [],
  startInNewBrandMode = false,
  catalogBrands: catalogBrandsProp = null,
  catalogBrandsLoading = null,
  catalogBrandsError = '',
  onReloadCatalogBrands = null,
  onRequestChainConfiguration = null,
  onBrandSelectionCleared = null,
  /** When set, Path A brand selection is locked to this brand until Change/Cancel. */
  lockedBrandName = '',
  /** Controlled path: null | 'pathA' | 'pathB' — keeps Path A and Path B mutually exclusive. */
  brandPathMode = null,
  onBrandPathModeChange = null,
  /** True when parent profile differs from last saved baseline (Select yourself page). */
  hasUnsavedChanges = false,
  /** Block parent profile reloads while uploads / local drafts are in flight. */
  onProtectLocalDraft = null,
  chainProfileApprovalStatus = ''
}) {
  const [uploadingRoleDocsEntryId, setUploadingRoleDocsEntryId] = useState(null);
  const [uploadingBrandDocsEntryId, setUploadingBrandDocsEntryId] = useState(null);
  const [removingRoleDocument, setRemovingRoleDocument] = useState(null);
  const [removingBrandDocument, setRemovingBrandDocument] = useState(null);
  const [documentSaveNotice, setDocumentSaveNotice] = useState('');
  const [entryRoleOptions, setEntryRoleOptions] = useState({});
  const [expandedEntryIds, setExpandedEntryIds] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [brandStepOtherMode, setBrandStepOtherMode] = useState(false);
  const [brandStepOtherExplicit, setBrandStepOtherExplicit] = useState(false);
  const [roleChangeRequestEntryId, setRoleChangeRequestEntryId] = useState('');
  const newBrandModeInitializedRef = useRef(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState('');
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const protectLocalDraft = useCallback(
    (options = {}) => {
      onProtectLocalDraft?.(options);
    },
    [onProtectLocalDraft]
  );

  const handleRequestRoleChange = useCallback((entryId) => {
    setRoleChangeRequestEntryId(String(entryId || '').trim());
  }, []);

  const handleCancelRoleChangeRequest = useCallback(
    (entryId) => {
      const targetId = String(entryId || '').trim();
      if (!targetId || !profileRef.current) {
        setRoleChangeRequestEntryId('');
        return;
      }
      const entries = getDisplayEntriesForProfile(profileRef.current);
      const entry = entries.find((row) => String(row?.id || '') === targetId);
      const savedEntry = findSavedBaselineEntry(entry, savedBaselineEntries);
      if (savedEntry) {
        setProfile(
          syncProfileFromEntries(
            profileRef.current,
            entries.map((row) =>
              String(row?.id || '') === targetId ? { ...savedEntry, id: targetId } : row
            )
          )
        );
      }
      setRoleChangeRequestEntryId('');
    },
    [savedBaselineEntries, setProfile]
  );

  useEffect(() => {
    if (chainProfileApprovalStatus === 'pending') {
      setRoleChangeRequestEntryId('');
    }
  }, [chainProfileApprovalStatus]);

  // Drop stale request state only if the entry disappears (e.g. removed). Do NOT clear
  // just because role still equals the approved role — that made "Request Role Change"
  // appear to do nothing (request opened, then immediately cancelled).
  useEffect(() => {
    if (!roleChangeRequestEntryId) return;
    const entries = getDisplayEntriesForProfile(profile);
    const entry = entries.find((row) => String(row?.id || '') === roleChangeRequestEntryId);
    if (!entry) {
      setRoleChangeRequestEntryId('');
    }
  }, [roleChangeRequestEntryId, profile]);
  const isBrandStepPicker = sectionView === 'brand' && selectionMode === 'dropdown';
  const lockedBrandKey = brandKeyForDuplicateCheck(lockedBrandName);
  const brandSetupLocked = isBrandStepPicker && !!lockedBrandKey;
  const pathAExclusive = brandSetupLocked || brandPathMode === 'pathA';
  const pathBExclusive =
    isBrandStepPicker && !pathAExclusive && (brandPathMode === 'pathB' || brandStepOtherExplicit);
  const usesBrandCatalogFields = sectionView === 'brand' || sectionView === 'all';
  const parentProvidesCatalog = Array.isArray(catalogBrandsProp);
  const {
    brands: fetchedCatalogBrands,
    brandNames: fetchedCatalogBrandNames,
    loading: fetchedCatalogLoading,
    error: fetchedCatalogError,
    reload: reloadFetchedCatalog
  } = useSupplierBrands({
    source: 'catalog',
    enabled: usesBrandCatalogFields && !parentProvidesCatalog
  });
  const catalogBrands = parentProvidesCatalog ? catalogBrandsProp : fetchedCatalogBrands;
  const catalogBrandNames = parentProvidesCatalog
    ? dedupeBrandNames(
        catalogBrands.map((row) => (typeof row === 'string' ? row : row?.name)).filter(Boolean)
      )
    : fetchedCatalogBrandNames;
  const catalogLoading =
    catalogBrandsLoading != null ? Boolean(catalogBrandsLoading) : fetchedCatalogLoading;
  const catalogError = catalogBrandsError || fetchedCatalogError || '';
  const reloadCatalogBrands = onReloadCatalogBrands || reloadFetchedCatalog;

  const getDisplayEntries = () => {
    const entries = profile?.companyInfoEntries;
    if (entries && entries.length > 0) return entries;
    return [
      {
        id: 'legacy',
        role: profile?.supplierRole || '',
        brands: profile?.brands || '',
        gstin: profile?.gstin || '',
        companyName: profile?.companyName || '',
        ownershipDetails: profile?.ownershipDetails || '',
        ...setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(profile || {})),
        ...setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(profile || {})),
        minimumOrderValue: profile?.minimumOrderValue ?? ''
      }
    ];
  };

  const applyDocumentUrlToEntry = (entryId, url, mode = 'append', documentType = 'role_authorization') => {
    const currentProfile = profileRef.current;
    const appendDocument =
      documentType === 'brand_approval' ? appendBrandApprovalDocumentUrl : appendAuthorizationCertificateUrl;
    const removeDocument =
      documentType === 'brand_approval' ? removeBrandApprovalDocumentUrl : removeAuthorizationCertificateUrl;

    if (entryId === 'legacy') {
      let certificateFields =
        mode === 'remove'
          ? removeDocument(currentProfile, url)
          : appendDocument(currentProfile, url);
      if (documentType === 'brand_approval' && mode !== 'remove') {
        certificateFields = stripBrandDocumentsFromRoleFields(certificateFields);
      }
      const nextProfile =
        documentType === 'brand_approval'
          ? {
              ...stripBrandDocumentsFromRoleFields({
                ...currentProfile,
                brandApprovalDocumentUrls: certificateFields.brandApprovalDocumentUrls,
                brandApprovalDocumentUrl: certificateFields.brandApprovalDocumentUrl
              }),
              brandApprovalDocumentPath:
                certificateFields.brandApprovalDocumentUrl ? currentProfile?.brandApprovalDocumentPath : ''
            }
          : {
              ...currentProfile,
              authorizationCertificateUrls: certificateFields.authorizationCertificateUrls,
              authorizationCertificateUrl: certificateFields.authorizationCertificateUrl,
              authorizationCertificatePath:
                certificateFields.authorizationCertificateUrl ? currentProfile?.authorizationCertificatePath : ''
            };
      if (
        mode !== 'remove' &&
        !profileSnapshotIncludesDocument(nextProfile, entryId, url, documentType)
      ) {
        throw new Error('Could not attach the uploaded document to this role entry. Please try again.');
      }
      setProfile(nextProfile);
      profileRef.current = nextProfile;
      return nextProfile;
    }

    const displayEntries = getDisplayEntriesForProfile(currentProfile);
    const targetEntry = displayEntries.find((entry) => entry.id === entryId) || null;
    const targetBrand = normalizeSingleBrand(targetEntry?.brands);
    const baseEntries =
      Array.isArray(currentProfile?.companyInfoEntries) && currentProfile.companyInfoEntries.length > 0
        ? currentProfile.companyInfoEntries.map((entry) => ({ ...entry }))
        : displayEntries.map((entry) => ({ ...entry }));

    let updatedOne = false;
    const entries = baseEntries.map((entry) => {
      if (updatedOne) return entry;
      if (!matchCompanyInfoEntry(entry, { entryId, brand: targetBrand })) return entry;
      updatedOne = true;
      const updated =
        mode === 'remove' ? removeDocument(entry, url) : appendDocument(entry, url);
      return documentType === 'brand_approval' && mode !== 'remove'
        ? stripBrandDocumentsFromRoleFields(updated)
        : updated;
    });
    if (!updatedOne) {
      throw new Error('Could not attach the uploaded document to this role entry. Please try again.');
    }
    const nextProfile = syncProfileFromEntries(currentProfile, entries);
    if (
      mode !== 'remove' &&
      !profileSnapshotIncludesDocument(nextProfile, entryId, url, documentType, targetBrand)
    ) {
      throw new Error('Could not attach the uploaded document to this role entry. Please try again.');
    }
    setProfile(nextProfile);
    profileRef.current = nextProfile;
    return nextProfile;
  };

  const displayEntries = getDisplayEntries();
  const duplicateBrandMessages = buildDuplicateBrandMessages(displayEntries);
  const shouldShowAddEntry = (showAddEntry ?? allowEntryManagement) && !brandSetupLocked;
  const indexedEntries = displayEntries.map((entry, index) => ({ entry, index }));
  const entryIdsSignature = JSON.stringify(displayEntries.map((entry) => entry.id));
  const firstEmptyBrandEntryId =
    displayEntries.find((entry) => !normalizeSingleBrand(entry?.brands))?.id || '';
  const lockedBrandEntryId = lockedBrandKey
    ? displayEntries.find(
        (entry) => brandKeyForDuplicateCheck(normalizeSingleBrand(entry?.brands)) === lockedBrandKey
      )?.id || ''
    : '';
  const defaultEntryId = isBrandStepPicker
    ? lockedBrandEntryId || firstEmptyBrandEntryId
    : displayEntries[0]?.id || '';
  const resolvedSelectedEntryId =
    selectionMode === 'dropdown'
      ? selectedEntryId && displayEntries.some((entry) => entry.id === selectedEntryId)
        ? selectedEntryId
        : defaultEntryId
      : '';

  const activeEntryForBrandPicker = displayEntries.find((entry) => entry.id === resolvedSelectedEntryId) || null;
  const activeEntryBrandValue = brandSetupLocked
    ? String(lockedBrandName || '').trim() || normalizeSingleBrand(activeEntryForBrandPicker?.brands)
    : normalizeSingleBrand(activeEntryForBrandPicker?.brands);
  const brandStepHasActiveDraft =
    isBrandStepPicker && (brandStepOtherMode || brandStepOtherExplicit || !!activeEntryBrandValue);

  useEffect(() => {
    if (selectionMode !== 'dropdown') return;
    if (brandSetupLocked && lockedBrandEntryId) {
      if (selectedEntryId !== lockedBrandEntryId) setSelectedEntryId(lockedBrandEntryId);
      return;
    }
    if (selectedEntryId && displayEntries.some((entry) => entry.id === selectedEntryId)) return;
    setSelectedEntryId(defaultEntryId);
  }, [
    selectionMode,
    entryIdsSignature,
    defaultEntryId,
    selectedEntryId,
    displayEntries,
    brandSetupLocked,
    lockedBrandEntryId
  ]);

  const entriesToRender =
    selectionMode === 'dropdown'
      ? indexedEntries.filter((item) => {
          if (item.entry.id !== resolvedSelectedEntryId) return false;
          if (isBrandStepPicker && !brandStepHasActiveDraft) return false;
          return true;
        })
      : indexedEntries;

  const activeBrandFilterKey = brandKeyForDuplicateCheck(filterBrandName);
  const visibleEntriesToRender = activeBrandFilterKey
    ? entriesToRender.filter(
        (item) => brandKeyForDuplicateCheck(normalizeSingleBrand(item.entry?.brands)) === activeBrandFilterKey
      )
    : entriesToRender;

  useEffect(() => {
    setExpandedEntryIds((prev) => {
      const validIds = new Set(displayEntries.map((entry) => entry.id));
      return prev.filter((id) => validIds.has(id));
    });
  }, [entryIdsSignature, sectionView]);

  const entryBrandSignature = JSON.stringify(
    displayEntries.map((entry) => ({
      id: entry.id,
      brands: String(entry?.brands || '').trim()
    }))
  );

  useEffect(() => {
    if (!editing) return;
    if (sectionView === 'brand') return;
    let isCancelled = false;

    const loadRoleOptions = async () => {
      const token = localStorage.getItem('token');
      const nextState = {};
      for (const entry of displayEntries) {
        const brandsValue = String(entry?.brands || '').trim();
        if (!brandsValue) {
          nextState[entry.id] = {
            loading: false,
            options: [],
            message: 'Add at least one brand first. Role options appear only after admin-approved brand chain setup.'
          };
          continue;
        }

        const entryBrandKey = brandKeyForDuplicateCheck(brandsValue);
        nextState[entry.id] = {
          loading: true,
          options: [],
          message: '',
          brandMeta: null,
          adminChainReady: false,
          brandKey: entryBrandKey
        };
        if (!isCancelled) {
          setEntryRoleOptions((prev) => {
            const previous = prev[entry.id] || {};
            const sameBrand =
              previous.brandKey && entryBrandKey && previous.brandKey === entryBrandKey;
            return {
              ...prev,
              [entry.id]: {
                ...previous,
                ...nextState[entry.id],
                options: sameBrand && Array.isArray(previous.options) ? previous.options : [],
                brandMeta: sameBrand ? previous.brandMeta || null : null,
                adminChainReady: sameBrand ? !!previous.adminChainReady : false,
                adminChainStatusText: sameBrand ? previous.adminChainStatusText || '' : '',
                adminChainPathText: sameBrand ? previous.adminChainPathText || '' : '',
                brandKey: entryBrandKey
              }
            };
          });
        }

        try {
          const response = await fetch(
            resolveApiPath(`/api/profile/supplier/chain-role-options?brands=${encodeURIComponent(brandsValue)}`),
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const data = await response.json().catch(() => ({}));
          const brandStates = Array.isArray(data?.brands) ? data.brands : [];
          const selectedBrandState = brandStates.find((b) => {
            const stateKey = brandKeyForDuplicateCheck(b?.brand || b?.normalizedBrand);
            const entryKey = brandKeyForDuplicateCheck(brandsValue);
            return stateKey && entryKey && stateKey === entryKey;
          });
          const perBrandChainRoles = Array.isArray(selectedBrandState?.roles)
            ? selectedBrandState.roles
            : [];
          const brandCanSelectRoles =
            typeof selectedBrandState?.canSelectRoles === 'boolean'
              ? selectedBrandState.canSelectRoles
              : selectedBrandState?.supplierHasAccess !== false &&
                !!selectedBrandState?.hasSupplyChainDefinition &&
                perBrandChainRoles.length > 0;
          const effectiveRoles =
            Array.isArray(data?.roles) && data.roles.length > 0
              ? data.roles
              : brandCanSelectRoles && perBrandChainRoles.length > 0
                ? perBrandChainRoles
                : [];
          const roleSet = new Set(effectiveRoles);
          const options = SUPPLY_CHAIN_ROLE_OPTIONS.filter((opt) => roleSet.has(opt.value));
          const brandStatusText = Array.isArray(data?.brands)
            ? data.brands
                .map((b) => {
                  const brandName = b?.brand || b?.normalizedBrand || 'Brand';
                  const hasAccess =
                    typeof b?.supplierHasAccess === 'boolean'
                      ? b.supplierHasAccess
                      : String(b?.approvalStatus || b?.status || '').toLowerCase() === 'approved' ||
                        !!b?.inApprovedCatalog;
                  const chainDefined = !!b?.hasSupplyChainDefinition;
                  const canSelect =
                    typeof b?.canSelectRoles === 'boolean'
                      ? b.canSelectRoles
                      : hasAccess && chainDefined;
                  if (canSelect) return `${brandName}: access ok + chain defined`;
                  if (!hasAccess) return `${brandName}: waiting for brand approval`;
                  return `${brandName}: chain not defined by admin`;
                })
                .join(' | ')
            : '';
          const selectedBrandRoles = Array.isArray(selectedBrandState?.roles)
            ? selectedBrandState.roles
            : [];
          const selectedBrandChainPath =
            selectedBrandRoles.length > 0
              ? selectedBrandRoles
                  .map((role) => SUPPLY_CHAIN_ROLE_LABEL_BY_VALUE[role] || role)
                  .join(' -> ')
              : '';
          const fallbackMessage = (() => {
            if (options.length > 0) return '';
            if (data?.message) return data.message;
            if (selectedBrandState?.supplierHasAccess === false) {
              return BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE;
            }
            if (selectedBrandState?.hasSupplyChainDefinition) {
              return BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE;
            }
            return SUPPLY_CHAIN_NOT_DEFINED_MESSAGE;
          })();
          nextState[entry.id] = {
            loading: false,
            options,
            brandKey: entryBrandKey,
            brandMeta: selectedBrandState || null,
            adminChainReady: options.length > 0 && !!selectedBrandState?.hasSupplyChainDefinition,
            adminChainStatusText: brandStatusText,
            adminChainPathText: selectedBrandChainPath
              ? `Admin-defined chain for this brand: ${selectedBrandChainPath}`
              : '',
            message: fallbackMessage
          };
        } catch (_err) {
          nextState[entry.id] = {
            loading: false,
            options: [],
            adminChainReady: false,
            adminChainStatusText: '',
            message: 'Failed to load role options for selected brands.'
          };
        }
      }
      if (!isCancelled) setEntryRoleOptions((prev) => ({ ...prev, ...nextState }));
    };

    loadRoleOptions();
    return () => {
      isCancelled = true;
    };
  }, [editing, entryBrandSignature, sectionView]);

  const appendEmptyBrandEntry = () => {
    const currentEntries = getDisplayEntries();
    let base = [...(profile?.companyInfoEntries || [])];
    if (base.length === 0 && currentEntries.length > 0) {
      base = currentEntries.map((entry) =>
        entry.id === 'legacy'
          ? {
              ...entry,
              id: genEntryId()
            }
          : { ...entry }
      );
    }
    const newEntry = {
      id: genEntryId(),
      role: '',
      brands: '',
      gstin: '',
      companyName: '',
      ownershipDetails: '',
      brandApprovalDocumentUrls: [],
      brandApprovalDocumentUrl: '',
      authorizationCertificateUrls: [],
      authorizationCertificateUrl: '',
      minimumOrderValue: ''
    };
    const next = [...base, newEntry];
    setProfile(syncProfileFromEntries(profile, next));
    return newEntry.id;
  };

  const focusBrandEntryForOtherInput = (entryId) => {
    if (!entryId) return;
    setSelectedEntryId(entryId);
    setBrandStepOtherMode(true);
    setBrandStepOtherExplicit(true);
    setExpandedEntryIds((prev) => (prev.includes(entryId) ? prev : [...prev, entryId]));
    window.requestAnimationFrame(() => {
      const card = document.querySelector(`[data-chain-entry-id="${entryId}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => {
        document.getElementById(`brand-name-${entryId}`)?.focus();
      }, 180);
    });
  };

  const handleBrandStepOtherSelection = () => {
    if (brandSetupLocked || pathAExclusive) return;
    setBrandStepOtherMode(true);
    setBrandStepOtherExplicit(true);
    onBrandPathModeChange?.('pathB');

    const currentEntries = getDisplayEntries();
    const activeEntry = currentEntries.find((entry) => entry.id === resolvedSelectedEntryId);
    const activeBrandEmpty = !normalizeSingleBrand(activeEntry?.brands);

    if (activeEntry && activeBrandEmpty) {
      focusBrandEntryForOtherInput(activeEntry.id);
      return;
    }

    const existingEmpty = currentEntries.find((entry) => !normalizeSingleBrand(entry?.brands));
    if (existingEmpty) {
      focusBrandEntryForOtherInput(existingEmpty.id);
      return;
    }

    focusBrandEntryForOtherInput(appendEmptyBrandEntry());
  };

  const addCompanyInfoEntry = () => {
    const newEntryId = appendEmptyBrandEntry();
    if (selectionMode === 'dropdown' && isBrandStepPicker) {
      setSelectedEntryId(newEntryId);
      setBrandStepOtherMode(false);
      setBrandStepOtherExplicit(false);
      window.requestAnimationFrame(() => {
        document.getElementById(`entry-selector-${sectionView}`)?.focus();
      });
    } else if (selectionMode === 'dropdown') {
      setSelectedEntryId(newEntryId);
    }
  };

  const updateCompanyInfoEntry = (entryId, field, value) => {
    if (field === 'brands' && sectionView === 'form') return;

    // Do not block brand typing with alerts. Duplicate detection is exact complete-name
    // matching only (H is not a duplicate of HP) and is surfaced inline after the value is set.
    const nextValue = field === 'brands' ? normalizeSingleBrand(value) : value;
    const currentEntries = getDisplayEntries();

    if (entryId === 'legacy') {
      const legacy = currentEntries[0] || {
        role: profile?.supplierRole || '',
        brands: profile?.brands || '',
        gstin: profile?.gstin || '',
        companyName: profile?.companyName || '',
        ownershipDetails: profile?.ownershipDetails || '',
        minimumOrderValue: profile?.minimumOrderValue ?? ''
      };
      const updated = { ...legacy, [field]: nextValue };
      const legacyEntry = {
        id: genEntryId(),
        ...updated,
        brandApprovalDocumentUrl:
          updated.brandApprovalDocumentUrl || profile?.brandApprovalDocumentUrl || '',
        authorizationCertificateUrl:
          updated.authorizationCertificateUrl || profile?.authorizationCertificateUrl || ''
      };
      const nextEntries =
        Array.isArray(profile?.companyInfoEntries) && profile.companyInfoEntries.length > 0
          ? profile.companyInfoEntries.map((entry, index) => (index === 0 ? { ...entry, ...legacyEntry, id: entry.id } : entry))
          : [legacyEntry];
      setProfile(syncProfileFromEntries(profile, nextEntries));
      return;
    }
    const targetEntry = currentEntries.find((entry) => entry.id === entryId) || null;
    const targetBrand = normalizeSingleBrand(targetEntry?.brands);
    const baseEntries =
      Array.isArray(profile?.companyInfoEntries) && profile.companyInfoEntries.length > 0
        ? profile.companyInfoEntries.map((entry) => ({ ...entry }))
        : currentEntries.map((entry) => ({ ...entry }));

    let updatedOne = false;
    const entries = baseEntries.map((e) => {
      if (updatedOne) return e;
      if (!matchCompanyInfoEntry(e, { entryId, brand: targetBrand })) return e;
      updatedOne = true;
      const updated = { ...e, [field]: nextValue };
      if (field === 'brands' && normalizeSingleBrand(nextValue)) {
        updated.supplyChainRegistrationStarted = true;
      }
      if (field === 'role' && String(nextValue || '').trim()) {
        updated.supplyChainRegistrationStarted = true;
      }
      return updated;
    });
    if (!updatedOne) return;
    setProfile(syncProfileFromEntries(profile, entries));
  };

  const removeCompanyInfoEntry = (entryId) => {
    if (entryId === 'legacy') {
      const remaining = (profile?.companyInfoEntries || []).filter((e) => e.id !== 'legacy');
      setProfile(syncProfileFromEntries(profile, remaining));
      return;
    }
    const entries = (profile?.companyInfoEntries || []).filter((e) => e.id !== entryId);
    setProfile(syncProfileFromEntries(profile, entries));
  };

  const handleDocumentRemoveForEntry = async (entryId, url, documentType = 'role_authorization') => {
    if (!url) return;
    if (!window.confirm('Remove this document?')) {
      return;
    }

    protectLocalDraft({ blockMs: 15000 });
    const setRemovingState =
      documentType === 'brand_approval' ? setRemovingBrandDocument : setRemovingRoleDocument;
    setRemovingState({ entryId, url });
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('Please sign in again to remove documents.');
        return;
      }

      const params = new URLSearchParams();
      if (entryId !== 'legacy') params.set('entryId', entryId);
      params.set('url', url);
      params.set('documentType', documentType);
      const response = await fetch(
        getApiUrl(`/api/profile/supplier/authorization-certificate?${params.toString()}`),
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.status !== 'success') {
        alert(data.message || `Failed to remove document (${response.status})`);
        return;
      }

      applyDocumentUrlToEntry(entryId, url, 'remove', documentType);

      if (data.savedToProfile === true) {
        setDocumentSaveNotice('Document removed from your profile.');
      } else if (
        !profileSnapshotIncludesDocument(profileRef.current, entryId, url, documentType)
      ) {
        alert('Document could not be removed from this entry. Please refresh and try again.');
      }
    } catch (error) {
      console.error('Failed to remove document:', error);
      alert('Failed to remove document. Please try again.');
    } finally {
      setRemovingState(null);
      protectLocalDraft({ blockMs: 8000 });
    }
  };

  const uploadSingleDocumentForEntry = async (entryId, file, documentType = 'role_authorization') => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Please sign in again to upload documents.');
    }

    const formData = new FormData();
    formData.append('file', file);
    if (entryId !== 'legacy') formData.append('entryId', entryId);
    formData.append('documentType', documentType);

    const response = await fetch(getApiUrl('/api/profile/supplier/authorization-certificate'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== 'success' || !data.url) {
      throw new Error(data.message || `Failed to upload document (${response.status})`);
    }

    applyDocumentUrlToEntry(entryId, data.url, 'append', documentType);
    if (!profileSnapshotIncludesDocument(profileRef.current, entryId, data.url, documentType)) {
      throw new Error(
        'Document uploaded, but it could not be linked to this entry. Select your brand and role, then try again.'
      );
    }
    return data;
  };

  const handleDocumentUploadForEntry = async (entryId, files, documentType = 'role_authorization') => {
    const fileList = Array.from(files || []);
    if (!fileList.length) return;

    if (documentType === 'role_authorization' && sectionView === 'form') {
      const targetEntry = getDisplayEntries().find((entry) => entry.id === entryId) || null;
      const targetBrand = normalizeSingleBrand(targetEntry?.brands);
      const roleUi = entryRoleOptions[entryId] || {};
      if (
        targetBrand &&
        !isBrandApprovedForSupplyChainStep(
          targetBrand,
          supplierApprovedBrands,
          roleUi.brandMeta || null,
          supplierBrandRequests,
          catalogBrands
        )
      ) {
        alert(BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE);
        return;
      }
    }

    protectLocalDraft({ blockMs: 30000 });
    const setUploadingState =
      documentType === 'brand_approval' ? setUploadingBrandDocsEntryId : setUploadingRoleDocsEntryId;
    setUploadingState(entryId);
    let savedToProfile = true;
    try {
      for (const file of fileList) {
        const data = await uploadSingleDocumentForEntry(entryId, file, documentType);
        if (data.savedToProfile !== true) savedToProfile = false;
      }
      if (savedToProfile) {
        setDocumentSaveNotice(
          documentType === 'brand_approval'
            ? 'Brand documents uploaded and linked to your profile. Submit the brand approval request when you are ready.'
            : 'Role documents uploaded and linked to your profile. Click Save on this role form when you are ready.'
        );
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
      setDocumentSaveNotice('');
      alert(error?.message || 'Failed to upload document. Please try again.');
    } finally {
      setUploadingState(null);
      protectLocalDraft({ blockMs: 8000 });
    }
  };

  const handleBrandStepClearSelection = (entryId = resolvedSelectedEntryId) => {
    const currentEntries = getDisplayEntries();
    const requestedId = String(entryId || '').trim();
    const lockedKey = brandKeyForDuplicateCheck(lockedBrandName || activeEntryBrandValue);
    const target =
      (requestedId &&
        currentEntries.find((entry) => String(entry?.id || '').trim() === requestedId)) ||
      (lockedKey &&
        currentEntries.find(
          (entry) => brandKeyForDuplicateCheck(normalizeSingleBrand(entry?.brands)) === lockedKey
        )) ||
      null;
    const targetId = String(target?.id || requestedId || '').trim();
    const clearedBrand =
      normalizeSingleBrand(target?.brands) ||
      String(lockedBrandName || activeEntryBrandValue || '').trim();

    setBrandStepOtherMode(false);
    setBrandStepOtherExplicit(false);
    onBrandPathModeChange?.(null);

    // Always drop the local Path A draft. Previously the locked path returned before
    // clearing, so leftover catalog brands immediately re-locked the chooser.
    if (target && (normalizeSingleBrand(target?.brands) || String(target?.role || '').trim())) {
      const targetBrand = normalizeSingleBrand(target?.brands);
      const baseEntries =
        Array.isArray(profile?.companyInfoEntries) && profile.companyInfoEntries.length > 0
          ? profile.companyInfoEntries.map((entry) => ({ ...entry }))
          : currentEntries.map((entry) => ({ ...entry }));
      let updatedOne = false;
      const entries = baseEntries.map((entry) => {
        if (updatedOne) return entry;
        if (!matchCompanyInfoEntry(entry, { entryId: targetId, brand: targetBrand })) return entry;
        updatedOne = true;
        return {
          ...entry,
          brands: '',
          role: '',
          authorizationCertificateUrl: '',
          authorizationCertificateUrls: [],
          supplyChainRegistrationStarted: false
        };
      });
      if (updatedOne) {
        setProfile(syncProfileFromEntries(profile, entries));
      }
    }

    if (targetId) setSelectedEntryId(targetId);
    onBrandSelectionCleared?.(clearedBrand);
    window.requestAnimationFrame(() => {
      document.getElementById(`entry-selector-${sectionView}`)?.focus();
    });
  };

  const handleBrandStepChangeBrand = (entryId) => {
    if (brandSetupLocked || pathAExclusive || pathBExclusive) {
      if (!hasUnsavedChanges) {
        handleBrandStepClearSelection(entryId || resolvedSelectedEntryId);
        return;
      }
      const confirmed = window.confirm(
        pathBExclusive
          ? 'Leave Path B?\n\nThis clears the new-brand request draft so you can choose Path A or Path B again.'
          : 'Change brand?\n\nThis cancels the current Path A supply-chain setup for the selected brand and clears its incomplete role details.'
      );
      if (!confirmed) return;
    }
    handleBrandStepClearSelection(entryId || resolvedSelectedEntryId);
  };

  const handleBrandStepStartOver = (entryId) => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        brandSetupLocked || pathAExclusive
          ? 'Cancel Path A setup?\n\nThis clears the selected approved brand and its incomplete supply-chain role details so you can choose Path A or Path B again.'
          : pathBExclusive
            ? 'Cancel Path B?\n\nThis clears the new-brand request draft so you can choose Path A or Path B again.'
            : 'Clear the selected brand and start over?\n\nYou can then choose Path A (approved brand) or Path B (request a new brand).'
      );
      if (!confirmed) return;
    }
    handleBrandStepClearSelection(entryId || resolvedSelectedEntryId);
  };

  const handleBrandStepCatalogPick = (nextBrand) => {
    if (brandSetupLocked) return;
    const brand = sanitizeCustomBrandInput(nextBrand);
    if (!brand) {
      handleBrandStepClearSelection(resolvedSelectedEntryId);
      return;
    }

    const approvedForPathA = isSelectYourselfBrandAlreadyApproved(brand, {
      catalogBrands,
      supplierApprovedBrands,
      supplierBrandRequests
    });
    // Path B is for new-brand requests only — already-approved names must use Path A.
    if (pathBExclusive && !approvedForPathA) return;

    setBrandStepOtherMode(false);
    setBrandStepOtherExplicit(false);
    onBrandPathModeChange?.('pathA');

    const currentEntries = getDisplayEntries();
    const matchKey = brandKeyForDuplicateCheck(brand);
    const existing = currentEntries.find(
      (entry) => brandKeyForDuplicateCheck(normalizeSingleBrand(entry?.brands)) === matchKey
    );

    const notifyBrandSelectedForSetup = () => {
      // Always hand off to role setup / assignment lock — Path A and Path B stay mutually exclusive.
      onBrandPickedWithoutRole?.(brand);
    };

    if (existing) {
      setSelectedEntryId(existing.id);
      notifyBrandSelectedForSetup();
      return;
    }

    const activeEntry = currentEntries.find((entry) => entry.id === resolvedSelectedEntryId);

    // Replace brand on the active entry (change selection) instead of locking it.
    if (activeEntry) {
      updateCompanyInfoEntry(activeEntry.id, 'brands', brand);
      setSelectedEntryId(activeEntry.id);
      notifyBrandSelectedForSetup();
      return;
    }

    let base = [...(profile?.companyInfoEntries || [])];
    if (base.length === 0 && currentEntries.length > 0) {
      base = currentEntries.map((entry) =>
        entry.id === 'legacy'
          ? {
              ...entry,
              id: genEntryId()
            }
          : { ...entry }
      );
    }

    const newEntry = {
      id: genEntryId(),
      role: '',
      brands: brand,
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

    const next = [...base, newEntry];
    setProfile(syncProfileFromEntries(profile, next));
    setSelectedEntryId(newEntry.id);
    notifyBrandSelectedForSetup();
  };

  // Path B needs a selectable row to type the new brand into. Recreate it when the profile
  // has no empty row (e.g. every saved row already holds an approved Path A brand).
  useEffect(() => {
    if (!isBrandStepPicker || !editing) return;
    if (brandSetupLocked || pathAExclusive) return;
    if (!brandStepOtherExplicit && !brandStepOtherMode && !pathBExclusive) return;
    if (resolvedSelectedEntryId) return;
    const nextEntryId = appendEmptyBrandEntry();
    if (nextEntryId) setSelectedEntryId(nextEntryId);
  }, [
    isBrandStepPicker,
    editing,
    brandSetupLocked,
    pathAExclusive,
    pathBExclusive,
    brandStepOtherExplicit,
    brandStepOtherMode,
    resolvedSelectedEntryId
  ]);

  const handleBrandStepShowCatalogPicker = () => {
    if (brandSetupLocked || pathAExclusive) return;
    // Leaving Path B returns to the chooser so Path A can be selected cleanly.
    handleBrandStepClearSelection(resolvedSelectedEntryId);
  };

  useEffect(() => {
    if (!isBrandStepPicker || !startInNewBrandMode || newBrandModeInitializedRef.current) return;
    if (brandSetupLocked || pathAExclusive) return;
    newBrandModeInitializedRef.current = true;
    handleBrandStepOtherSelection();
  }, [isBrandStepPicker, startInNewBrandMode, brandSetupLocked, pathAExclusive]);

  useEffect(() => {
    if (!isBrandStepPicker) return;
    // Sync from parent-controlled path only. Do not clear local Path B when mode is
    // still null — that races the "Or use Path B" click before the parent updates.
    // Change brand / Cancel / Switch clear local state explicitly.
    if (brandPathMode === 'pathB' && !brandStepOtherExplicit) {
      setBrandStepOtherMode(true);
      setBrandStepOtherExplicit(true);
      return;
    }
    if (brandPathMode === 'pathA' || brandSetupLocked) {
      setBrandStepOtherMode(false);
      setBrandStepOtherExplicit(false);
    }
  }, [isBrandStepPicker, brandPathMode, brandStepOtherExplicit, brandSetupLocked]);

  const activeEntryUsesCustomBrand =
    !!activeEntryBrandValue &&
    !catalogBrandNames.some((name) => areBrandNamesExactDuplicates(name, activeEntryBrandValue));
  const showBrandStepCustomInput =
    isBrandStepPicker &&
    !pathAExclusive &&
    (pathBExclusive || brandStepOtherMode || activeEntryUsesCustomBrand);
  // Path A lock: only an explicit Path A session (selected assignment / path mode).
  // Do not lock just because a catalog brand remains on an entry — that made
  // Change brand / Cancel setup appear to do nothing after unlocking.
  const brandStepPathALocked = pathAExclusive;
  // Path B lock: supplier is mid-request for a new brand — hide Path A picker.
  const brandStepPathBLocked =
    isBrandStepPicker &&
    !pathAExclusive &&
    (pathBExclusive || brandStepOtherExplicit || (brandStepOtherMode && activeEntryUsesCustomBrand));

  useEffect(() => {
    if (!isBrandStepPicker || brandStepOtherExplicit || brandSetupLocked || pathAExclusive) return;
    if (!activeEntryBrandValue) return;
    const inCatalog = catalogBrandNames.some((name) =>
      areBrandNamesExactDuplicates(name, activeEntryBrandValue)
    );
    setBrandStepOtherMode(!inCatalog);
  }, [
    isBrandStepPicker,
    brandStepOtherExplicit,
    activeEntryBrandValue,
    catalogBrandNames,
    brandSetupLocked,
    pathAExclusive
  ]);

  useEffect(() => {
    if (!isBrandStepPicker || !showBrandStepCustomInput || !resolvedSelectedEntryId) return;
    setExpandedEntryIds((prev) =>
      prev.includes(resolvedSelectedEntryId) ? prev : [...prev, resolvedSelectedEntryId]
    );
  }, [isBrandStepPicker, showBrandStepCustomInput, resolvedSelectedEntryId]);

  useEffect(() => {
    const targetId = String(focusEntryId || '').trim();
    if (!targetId) return;

    const targetEntry = displayEntries.find((entry) => String(entry?.id || '').trim() === targetId);
    if (!targetEntry) {
      onFocusEntryHandled?.();
      return;
    }

    setExpandedEntryIds((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]));
    setHighlightedEntryId(targetId);

    const scrollTimer = window.setTimeout(() => {
      const card = document.querySelector(`[data-chain-entry-id="${targetId}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onFocusEntryHandled?.();
    }, 120);

    const highlightTimer = window.setTimeout(() => {
      setHighlightedEntryId('');
    }, 2400);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(highlightTimer);
    };
  }, [focusEntryId, entryIdsSignature, onFocusEntryHandled, displayEntries]);

  return (
    <div
      className={`supplier-select-yourself-editor supplier-select-yourself-editor--${sectionView} supplier-select-yourself-editor--${selectionMode}`}
    >
      <div className="chain-entries">
        {isBrandStepPicker ? (
          <div
            className={`chain-entry-selector chain-entry-selector--brand-step${
              brandStepPathALocked || brandStepPathBLocked ? ' chain-entry-selector--locked' : ''
            }`}
          >
            {brandStepPathALocked ? (
              <>
                <p className="chain-field__sublabel chain-entry-selector__intro">
                  Path A only — approved brand locked for this supply-chain setup. Path B is not available until you
                  Change brand or Cancel setup.
                </p>
                <span className="chain-field__label">Selected approved brand</span>
                <div className="chain-selected-brand-row">
                  <div className="chain-selected-brand-pill chain-selected-brand-pill--locked" aria-live="polite">
                    {activeEntryBrandValue}
                  </div>
                </div>
                <div className="chain-entry-selector__actions">
                  <button
                    type="button"
                    className="chain-change-brand-btn"
                    onClick={() => handleBrandStepChangeBrand(resolvedSelectedEntryId)}
                    disabled={!editing}
                  >
                    Change brand
                  </button>
                  <button
                    type="button"
                    className="chain-entry-selector__link"
                    onClick={() => handleBrandStepStartOver(resolvedSelectedEntryId)}
                    disabled={!editing}
                  >
                    Cancel setup
                  </button>
                </div>
              </>
            ) : brandStepOtherExplicit || brandStepPathBLocked ? (
              <>
                <p className="chain-field__sublabel chain-entry-selector__intro">
                  Path B only — request a new brand for admin approval. Path A stays hidden until you switch or cancel.
                </p>
                {activeEntryBrandValue ? (
                  <div className="chain-selected-brand-row">
                    <div className="chain-selected-brand-pill" aria-live="polite">
                      {activeEntryBrandValue}
                    </div>
                  </div>
                ) : null}
                <div className="chain-entry-selector__actions">
                  <button
                    type="button"
                    className="chain-entry-selector__link"
                    onClick={handleBrandStepShowCatalogPicker}
                    disabled={!editing}
                  >
                    Switch to Path A
                  </button>
                  <button
                    type="button"
                    className="chain-entry-selector__link"
                    onClick={() => handleBrandStepStartOver(resolvedSelectedEntryId)}
                    disabled={!editing}
                  >
                    Cancel setup
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="chain-field__label" htmlFor={`entry-selector-${sectionView}`}>
                  Path A — select approved brand
                </label>
                <BrandSelect
                  id={`entry-selector-${sectionView}`}
                  name={`entry-selector-${sectionView}`}
                  value={brandStepHasActiveDraft ? activeEntryBrandValue : ''}
                  onChange={handleBrandStepCatalogPick}
                  onSelectionModeChange={(mode) => {
                    if (mode === 'catalog') {
                      setBrandStepOtherMode(false);
                      setBrandStepOtherExplicit(false);
                      onBrandPathModeChange?.('pathA');
                    } else if (mode === 'empty') {
                      setBrandStepOtherMode(false);
                      setBrandStepOtherExplicit(false);
                      onBrandPathModeChange?.(null);
                    }
                  }}
                  disabled={!editing}
                  required={false}
                  allowOther={false}
                  source="catalog"
                  dropdownOnly
                  brands={catalogBrands}
                  brandNames={catalogBrandNames}
                  loading={catalogLoading}
                  error={catalogError}
                  onRetry={reloadCatalogBrands}
                  className="chain-brand-select"
                />
                <div className="chain-entry-selector__actions">
                  <button
                    type="button"
                    className="chain-entry-selector__link"
                    onClick={handleBrandStepOtherSelection}
                    disabled={!editing}
                  >
                    Or use Path B — request a new brand
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {selectionMode === 'dropdown' && !isBrandStepPicker && displayEntries.length > 0 ? (
          <div className="chain-entry-selector">
            <label className="chain-field__label" htmlFor={`entry-selector-${sectionView}`}>
              Select brand ({displayEntries.length} in your profile)
            </label>
            <select
              id={`entry-selector-${sectionView}`}
              className="chain-field__control"
              value={resolvedSelectedEntryId}
              onChange={(e) => setSelectedEntryId(e.target.value)}
              disabled={!editing}
            >
              {displayEntries.map((entry, idx) => {
                const brandName = String(entry?.brands || '').trim() || `Entry ${idx + 1}`;
                return (
                  <option key={entry.id} value={entry.id}>
                    {brandName}
                  </option>
                );
              })}
            </select>
            {displayEntries.length > 1 ? (
              <div className="chain-entry-brand-chips" role="list" aria-label="Your brands">
                {displayEntries.map((entry, idx) => {
                  const brandName = String(entry?.brands || '').trim() || `Entry ${idx + 1}`;
                  const isActive = entry.id === resolvedSelectedEntryId;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="listitem"
                      className={`chain-chip chain-chip--brand chain-entry-brand-chip${isActive ? ' chain-entry-brand-chip--active' : ''}`}
                      onClick={() => setSelectedEntryId(entry.id)}
                      disabled={!editing}
                      aria-pressed={isActive}
                    >
                      {brandName}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {documentSaveNotice ? (
          <div className="chain-callout chain-callout--info" role="status">
            <p>{documentSaveNotice}</p>
            <button
              type="button"
              className="chain-entry-selector__link"
              onClick={() => setDocumentSaveNotice('')}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {visibleEntriesToRender.map(({ entry, index }) => {
          const roleUiState = entryRoleOptions[entry.id] || {};
          const entryBrandKey = brandKeyForDuplicateCheck(String(entry?.brands || '').trim());
          const roleOptionsFetchSettled =
            !!entryBrandKey &&
            roleUiState.brandKey === entryBrandKey &&
            roleUiState.loading === false;
          const roleOptionsPending =
            sectionView === 'form' && !!entryBrandKey && !roleOptionsFetchSettled;
          const roleOptionsLoadingEffective = !!roleUiState.loading || roleOptionsPending;
          const expanded = expandedEntryIds.includes(entry.id);
          return (
          <CompanyInfoEntryCard
            key={entry.id}
            entry={entry}
            entryIndex={index + 1}
            totalEntries={displayEntries.length}
            onUpdate={(field, value) => updateCompanyInfoEntry(entry.id, field, value)}
            onRemove={() =>
              onRemoveEntry ? onRemoveEntry(entry.id) : removeCompanyInfoEntry(entry.id)
            }
            onBrandDocumentUpload={(targetEntryId, files) =>
              handleDocumentUploadForEntry(targetEntryId, files, 'brand_approval')
            }
            onBrandDocumentRemove={(targetEntryId, url) =>
              handleDocumentRemoveForEntry(targetEntryId, url, 'brand_approval')
            }
            onRoleDocumentUpload={(targetEntryId, files) =>
              handleDocumentUploadForEntry(targetEntryId, files, 'role_authorization')
            }
            onRoleDocumentRemove={(targetEntryId, url) =>
              handleDocumentRemoveForEntry(targetEntryId, url, 'role_authorization')
            }
            onDocumentUploadIntent={() => protectLocalDraft({ blockMs: 30000 })}
            uploadingBrandDocsForThisEntry={uploadingBrandDocsEntryId === entry.id}
            uploadingRoleDocsForThisEntry={uploadingRoleDocsEntryId === entry.id}
            removingBrandDocumentUrl={
              removingBrandDocument?.entryId === entry.id ? removingBrandDocument.url : null
            }
            removingRoleDocumentUrl={
              removingRoleDocument?.entryId === entry.id ? removingRoleDocument.url : null
            }
            editing={editing}
            canRemove={displayEntries.length > 1 && (sectionView === 'all' || allowEntryManagement)}
            availableRoleOptions={roleUiState.options || []}
            roleOptionsLoading={roleOptionsLoadingEffective}
            roleOptionsMessage={roleUiState.message || ''}
            adminChainReady={!!roleUiState.adminChainReady}
            adminChainStatusText={roleUiState.adminChainStatusText || ''}
            adminChainPathText={roleUiState.adminChainPathText || ''}
            brandMeta={roleUiState.brandMeta || null}
            sectionView={sectionView}
            allowEntryManagement={allowEntryManagement}
            forceExpanded={sectionView === 'brand' || sectionView === 'form'}
            expanded={expanded}
            onSaveEntry={onSaveEntry}
            savingThisEntry={savingEntryId === entry.id}
            savedBaselineEntries={savedBaselineEntries}
            approvedBaselineEntries={approvedBaselineEntries}
            allowEntrySave={allowEntryManagement || !!onSaveEntry}
            allowEntryRemove={
              sectionView !== 'brand' && (sectionView === 'all' || allowEntryManagement || !!onRemoveEntry)
            }
            catalogBrandNames={usesBrandCatalogFields ? catalogBrandNames : []}
            catalogBrands={usesBrandCatalogFields ? catalogBrands : []}
            catalogBrandsLoading={usesBrandCatalogFields ? catalogLoading : false}
            catalogBrandsError={usesBrandCatalogFields ? catalogError : ''}
            onReloadCatalogBrands={usesBrandCatalogFields ? reloadCatalogBrands : null}
            useBrandNameTextInput={usesBrandCatalogFields}
            excludeBrands={reservedBrandsForEntry(displayEntries, entry.id)}
            duplicateBrandMessage={duplicateBrandMessages.get(entry.id) || ''}
            brandPickerAtTop={isBrandStepPicker}
            showBrandStepCustomInput={showBrandStepCustomInput}
            onChangeBrand={isBrandStepPicker ? handleBrandStepChangeBrand : null}
            onSelectApprovedCatalogBrand={isBrandStepPicker ? handleBrandStepCatalogPick : null}
            approvedRole={getApprovedRoleForEntry(approvedBaselineEntries, entry)}
            activeApprovedRole={getActiveApprovedRoleForEntry(
              entry,
              { chainProfileApprovalStatus },
              approvedBaselineEntries,
              savedBaselineEntries
            )}
            supplierApprovedBrands={supplierApprovedBrands}
            supplierBrandRequests={supplierBrandRequests}
            extraPendingBrandNames={extraPendingBrandNames}
            highlighted={highlightedEntryId === entry.id}
            onRequestChainConfiguration={onRequestChainConfiguration}
            chainProfileApprovalStatus={chainProfileApprovalStatus}
            roleChangeRequestActive={roleChangeRequestEntryId === entry.id}
            onRequestRoleChange={sectionView === 'form' ? handleRequestRoleChange : null}
            onCancelRoleChangeRequest={sectionView === 'form' ? handleCancelRoleChangeRequest : null}
            onToggleExpand={() =>
              setExpandedEntryIds((prev) =>
                prev.includes(entry.id) ? prev.filter((id) => id !== entry.id) : [...prev, entry.id]
              )
            }
          />
          );
        })}
      </div>

      {editing && shouldShowAddEntry ? (
        <div className="chain-add-entry">
          <p className="chain-add-entry__hint">
            {sectionView === 'brand' || sectionView === 'all'
              ? 'Add another approved brand, or request a new one if it is not listed'
              : 'Need another role or brand? Add a separate entry below.'}
          </p>
          <button type="button" className="chain-add-entry__btn" onClick={addCompanyInfoEntry}>
            <Plus size={16} />
            {sectionView === 'brand' || sectionView === 'all' ? 'Add another brand' : 'Add another entry'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
