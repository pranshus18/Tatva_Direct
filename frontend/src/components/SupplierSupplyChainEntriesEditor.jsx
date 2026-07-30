import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { getApiUrl, resolveApiPath } from '../config/api';
import BrandAuthorizationDocuments from './BrandAuthorizationDocuments';
import BrandSelect from './BrandSelect';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import { brandKeyForDuplicateCheck, dedupeBrandNames, findApprovedCatalogBrandMatch, findApprovedCatalogBrandSuggestions, formatApprovedCatalogBrandMatchMessage, formatApprovedCatalogBrandSuggestionMessage } from '../utils/supplierChainEntryValidation';
import {
  formatSupplyChainRoleLabel,
  getApprovedRoleForEntry,
  matchCompanyInfoEntry,
  isBrandApprovedForSupplyChainStep,
  findSupplierBrandRequest,
  BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE,
  SUPPLY_CHAIN_NOT_DEFINED_MESSAGE
} from '../utils/supplierSelectYourselfProfile';
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
  normalizeEntryDocumentFields
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

function sanitizeCustomBrandInput(raw) {
  return String(raw || '')
    .replace(/[,;\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  allowEntryRemove = false,
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
  supplierApprovedBrands = [],
  supplierBrandRequests = [],
  highlighted = false,
  onRequestChainConfiguration = null
}) => {
  const selectedBrand = normalizeSingleBrand(entry.brands);
  const catalogBrandSelected =
    !!selectedBrand &&
    catalogBrandNames.some((name) => name.toLowerCase() === selectedBrand.toLowerCase());
  const brandNameEditable = editing && (!useBrandNameTextInput || !catalogBrandSelected);
  const hasBrandValue = !!selectedBrand;
  const approvedCatalogMatch =
    useBrandNameTextInput && hasBrandValue && !catalogBrandSelected
      ? findApprovedCatalogBrandMatch(selectedBrand, catalogBrandNames)
      : null;
  const brandRequest = findSupplierBrandRequest(selectedBrand, supplierBrandRequests);
  const brandRequestStatus = String(brandRequest?.status || '').toLowerCase();
  const brandRequestSubmittedAt =
    brandRequest?.submittedAt || brandRequest?.requestedAt || brandRequest?.createdAt || null;
  const isPendingBrandRequest = brandRequestStatus === 'pending';
  const isRejectedBrandRequest = brandRequestStatus === 'rejected';
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
    ? formatApprovedCatalogBrandMatchMessage(selectedBrand, approvedCatalogMatch.name)
    : '';
  const approvedCatalogSuggestionMessage = primarySuggestion?.name
    ? formatApprovedCatalogBrandSuggestionMessage(selectedBrand, primarySuggestion.name)
    : '';
  const applySuggestedApprovedBrand = (brandName) => {
    const next = String(brandName || '').trim();
    if (!next) return;
    if (typeof onSelectApprovedCatalogBrand === 'function') {
      onSelectApprovedCatalogBrand(next);
      return;
    }
    onUpdate('brands', next);
  };
  const [requestingChainConfig, setRequestingChainConfig] = useState(false);
  const [chainConfigRequestFeedback, setChainConfigRequestFeedback] = useState('');
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
  const roleSelectOptions = (() => {
    const opts = Array.isArray(availableRoleOptions) ? [...availableRoleOptions] : [];
    if (currentRoleValue && !opts.some((o) => o.value === currentRoleValue)) {
      const fallback = SUPPLY_CHAIN_ROLE_OPTIONS.find((o) => o.value === currentRoleValue);
      opts.push(fallback || { value: currentRoleValue, label: formatSupplyChainRoleLabel(currentRoleValue) });
    }
    return opts;
  })();
  const brandOnlyApproved = isBrandOnlyStep && catalogBrandSelected;
  const brandOnlyPendingSubmitted =
    isBrandOnlyStep &&
    hasBrandValue &&
    !catalogBrandSelected &&
    !approvedCatalogMatchMessage &&
    isPendingBrandRequest;
  const brandOnlyRejected =
    isBrandOnlyStep && hasBrandValue && isRejectedBrandRequest;
  const brandOnlyReadyToSubmit =
    isBrandOnlyStep &&
    hasBrandValue &&
    !catalogBrandSelected &&
    !approvedCatalogMatchMessage &&
    !brandRequest;
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
  const statusTone = isBrandOnlyStep
    ? !hasBrandValue
      ? 'neutral'
      : brandOnlyApproved || brandRequestStatus === 'approved'
        ? 'success'
        : approvedCatalogMatchMessage
          ? 'warning'
          : brandOnlyPendingSubmitted
            ? 'warning'
            : brandOnlyRejected
              ? 'danger'
              : brandOnlyReadyToSubmit
                ? 'neutral'
                : 'neutral'
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
    ? !hasBrandValue
      ? 'Select a brand first'
      : brandOnlyApproved || brandRequestStatus === 'approved'
        ? 'Approved by admin'
        : approvedCatalogMatchMessage
          ? 'Already approved — select from list'
          : brandOnlyPendingSubmitted
            ? 'Request submitted — pending admin approval'
            : brandOnlyRejected
              ? 'Rejected by admin'
              : brandOnlyReadyToSubmit
                ? 'Ready to submit for approval'
                : 'Not requested yet'
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
  const statusDetailLines = (() => {
    const lines = [];
    if (hasBrandValue && resolvedBrandName) {
      lines.push(resolvedBrandName);
    }
    const showPendingDetails =
      brandOnlyPendingSubmitted ||
      isPendingBrandRequest ||
      (!isBrandOnlyStep && (brandStatus === 'pending' || brandLayers.approvalStatus === 'pending'));
    const showRejectedDetails = brandOnlyRejected || isRejectedBrandRequest;

    if (approvedCatalogMatchMessage && !showPendingDetails && !showRejectedDetails) {
      lines.push(approvedCatalogMatchMessage);
      lines.push('Select the approved brand below to continue with role setup.');
    } else if (showPendingDetails) {
      lines.push('Your brand approval request was submitted. Waiting for admin review — no need to submit again.');
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
    } else if (brandOnlyReadyToSubmit) {
      lines.push('Click Save brand to send this request to admin.');
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
  const roleSelectionEnabled =
    editing && brandApprovalReadyForRole && !roleOptionsLoading && hasResolvedChainRoles;
  const roleDocumentsEnabled = editing && brandApprovalReadyForRole;
  const showBrandNotApprovedStep2Message =
    isSupplyChainOnlyStep && hasBrandValue && !brandApprovedForSupplyChain;
  const showChainNotDefinedStep2Message =
    isSupplyChainOnlyStep &&
    hasBrandValue &&
    brandApprovedForSupplyChain &&
    !chainDefined &&
    !hasResolvedChainRoles &&
    !roleOptionsLoading;
  const approvedRoleLabel = approvedRole ? formatSupplyChainRoleLabel(approvedRole) : '';
  const pendingRoleChange =
    !!approvedRole && !!entry.role && String(entry.role).trim() !== String(approvedRole).trim();
  const showCustomBrandNameField =
    useBrandNameTextInput &&
    editing &&
    (!selectedBrand || !catalogBrandSelected) &&
    (!brandPickerAtTop || showBrandStepCustomInput);
  const showBrandApprovalSection = sectionView !== 'form';
  const showFormDetailsSection = sectionView !== 'brand';
  const showEntrySave = editing && showFormDetailsSection && !!onSaveEntry && allowEntrySave && brandApprovalReadyForRole;
  const showEntryRemove = canRemove && editing && allowEntryRemove && isBrandOnlyStep;
  const showHeader =
    sectionView === 'brand'
      ? totalEntries > 0
      : !(sectionView === 'brand' && forceExpanded && !allowEntryManagement);

  const handleBrandNameInput = (nextBrand) => {
    onUpdate('brands', sanitizeCustomBrandInput(nextBrand));
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
                {brandDocUrls.length > 0 ? `Brand docs: ${brandDocUrls.length}` : 'Brand docs: optional'}
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
              disabled={savingThisEntry}
              title="Save this entry"
            >
              {savingThisEntry ? 'Saving…' : 'Save entry'}
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
                    value={selectedBrand}
                    onChange={(e) => handleBrandNameInput(e.target.value)}
                    disabled={!brandNameEditable}
                    placeholder="Enter your brand name for admin approval"
                    required={editing}
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
                      ? 'This exact brand is already approved — select it to continue.'
                      : 'Finish typing your full brand name. Matching approved brands appear as suggestions only.'}
                  </p>
                </div>
                ) : brandPickerAtTop && selectedBrand ? (
                  <div className="chain-field chain-field--full">
                    <span className="chain-field__label">Selected brand</span>
                    <div className="chain-selected-brand-row">
                      <div className="chain-selected-brand-pill" aria-live="polite">
                        {selectedBrand}
                      </div>
                      {editing && onChangeBrand ? (
                        <button
                          type="button"
                          className="chain-change-brand-btn"
                          onClick={() => onChangeBrand(entry.id)}
                        >
                          Change brand
                        </button>
                      ) : null}
                    </div>
                    {editing && onChangeBrand ? (
                      <p className="chain-field__sublabel">
                        Click Change brand to clear this selection and choose a different brand above.
                      </p>
                    ) : null}
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
                  <BrandAuthorizationDocuments
                    entry={entry}
                    editing={editing}
                    uploading={uploadingBrandDocsForThisEntry}
                    removingUrl={removingBrandDocumentUrl}
                    onUpload={(files) => onBrandDocumentUpload?.(entry.id, files)}
                    onRemove={(url) => onBrandDocumentRemove?.(entry.id, url)}
                    resolveUrls={resolveBrandApprovalDocumentUrls}
                  />
                </div>
              </div>
              ) : isBrandOnlyStep ? (
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
                  <label className="chain-field__label">Brand documents (optional)</label>
                  <BrandAuthorizationDocuments
                    entry={entry}
                    editing={editing}
                    uploading={uploadingBrandDocsForThisEntry}
                    removingUrl={removingBrandDocumentUrl}
                    onUpload={(files) => onBrandDocumentUpload?.(entry.id, files)}
                    onRemove={(url) => onBrandDocumentRemove?.(entry.id, url)}
                    resolveUrls={resolveBrandApprovalDocumentUrls}
                  />
                </div>
              </div>
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
              {showBrandNotApprovedStep2Message ? (
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
              ) : roleOptionsMessage && !approvedRole && !hasResolvedChainRoles ? (
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
              <div className="chain-field chain-field--full">
                <label className="chain-field__label" htmlFor={`role-${entry.id}`}>
                  {isSupplyChainOnlyStep ? 'Select your position' : 'Supply-chain role'}
                  {adminChainReady ? <RequiredMark /> : null}
                </label>
                <select
                  id={`role-${entry.id}`}
                  className="chain-field__control"
                  value={currentRoleValue}
                  onChange={(e) => onUpdate('role', e.target.value)}
                  disabled={!roleSelectionEnabled}
                  required={editing && brandApprovalReadyForRole}
                  aria-required={editing && brandApprovalReadyForRole ? 'true' : 'false'}
                >
                  <option value="">
                    {showChainNotDefinedStep2Message ||
                    (!roleOptionsLoading &&
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
                {approvedRoleLabel ? (
                  <p className="chain-field__sublabel">
                    Approved role: <strong>{approvedRoleLabel}</strong>
                    {pendingRoleChange
                      ? '. Changing role requires admin approval after you save.'
                      : ''}
                  </p>
                ) : null}
                {pendingRoleChange ? (
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
            <h4 className="chain-section__title">Supply-chain role documents</h4>
            <div className="chain-section__panel">
              <div className="chain-field chain-field--full">
                <label className="chain-field__label">
                  Role verification documents
                  <RequiredMark />
                </label>
                <BrandAuthorizationDocuments
                  entry={entry}
                  editing={roleDocumentsEnabled}
                  uploading={uploadingRoleDocsForThisEntry}
                  removingUrl={removingRoleDocumentUrl}
                  onUpload={(files) => onRoleDocumentUpload?.(entry.id, files)}
                  onRemove={(url) => onRoleDocumentRemove?.(entry.id, url)}
                  resolveUrls={resolveRoleVerificationDocumentUrls}
                />
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
                <p className="chain-callout chain-callout--info">
                  Downstream partners must meet this order total when buying from you in this layer.
                </p>
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
  showAddEntry = null,
  approvedBaselineEntries = [],
  focusEntryId = '',
  onFocusEntryHandled = null,
  onBrandPickedWithoutRole = null,
  filterBrandName = '',
  supplierApprovedBrands = [],
  supplierBrandRequests = [],
  startInNewBrandMode = false,
  catalogBrands: catalogBrandsProp = null,
  catalogBrandsLoading = null,
  catalogBrandsError = '',
  onReloadCatalogBrands = null,
  onRequestChainConfiguration = null
}) {
  const [uploadingRoleDocsEntryId, setUploadingRoleDocsEntryId] = useState(null);
  const [uploadingBrandDocsEntryId, setUploadingBrandDocsEntryId] = useState(null);
  const [removingRoleDocument, setRemovingRoleDocument] = useState(null);
  const [removingBrandDocument, setRemovingBrandDocument] = useState(null);
  const [entryRoleOptions, setEntryRoleOptions] = useState({});
  const [expandedEntryIds, setExpandedEntryIds] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [brandStepOtherMode, setBrandStepOtherMode] = useState(false);
  const [brandStepOtherExplicit, setBrandStepOtherExplicit] = useState(false);
  const newBrandModeInitializedRef = useRef(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState('');
  const isBrandStepPicker = sectionView === 'brand' && selectionMode === 'dropdown';
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
    const appendDocument =
      documentType === 'brand_approval' ? appendBrandApprovalDocumentUrl : appendAuthorizationCertificateUrl;
    const removeDocument =
      documentType === 'brand_approval' ? removeBrandApprovalDocumentUrl : removeAuthorizationCertificateUrl;

    if (entryId === 'legacy') {
      let certificateFields =
        mode === 'remove'
          ? removeDocument(profile, url)
          : appendDocument(profile, url);
      if (documentType === 'brand_approval' && mode !== 'remove') {
        certificateFields = stripBrandDocumentsFromRoleFields(certificateFields);
      }
      if (documentType === 'brand_approval') {
        setProfile({
          ...stripBrandDocumentsFromRoleFields({
            ...profile,
            brandApprovalDocumentUrls: certificateFields.brandApprovalDocumentUrls,
            brandApprovalDocumentUrl: certificateFields.brandApprovalDocumentUrl
          }),
          brandApprovalDocumentPath:
            certificateFields.brandApprovalDocumentUrl ? profile?.brandApprovalDocumentPath : ''
        });
      } else {
        setProfile({
          ...profile,
          authorizationCertificateUrls: certificateFields.authorizationCertificateUrls,
          authorizationCertificateUrl: certificateFields.authorizationCertificateUrl,
          authorizationCertificatePath:
            certificateFields.authorizationCertificateUrl ? profile?.authorizationCertificatePath : ''
        });
      }
      return;
    }

    const displayEntries = getDisplayEntries();
    const targetEntry = displayEntries.find((entry) => entry.id === entryId) || null;
    const targetBrand = normalizeSingleBrand(targetEntry?.brands);
    const baseEntries =
      Array.isArray(profile?.companyInfoEntries) && profile.companyInfoEntries.length > 0
        ? profile.companyInfoEntries.map((entry) => ({ ...entry }))
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
    setProfile(syncProfileFromEntries(profile, entries));
  };

  const displayEntries = getDisplayEntries();
  const duplicateBrandMessages = buildDuplicateBrandMessages(displayEntries);
  const shouldShowAddEntry = showAddEntry ?? allowEntryManagement;
  const indexedEntries = displayEntries.map((entry, index) => ({ entry, index }));
  const entryIdsSignature = JSON.stringify(displayEntries.map((entry) => entry.id));
  const firstEmptyBrandEntryId =
    displayEntries.find((entry) => !normalizeSingleBrand(entry?.brands))?.id || '';
  const defaultEntryId = isBrandStepPicker
    ? firstEmptyBrandEntryId
    : displayEntries[0]?.id || '';
  const resolvedSelectedEntryId =
    selectionMode === 'dropdown'
      ? selectedEntryId && displayEntries.some((entry) => entry.id === selectedEntryId)
        ? selectedEntryId
        : defaultEntryId
      : '';

  const activeEntryForBrandPicker = displayEntries.find((entry) => entry.id === resolvedSelectedEntryId) || null;
  const activeEntryBrandValue = normalizeSingleBrand(activeEntryForBrandPicker?.brands);
  const brandStepHasActiveDraft =
    isBrandStepPicker && (brandStepOtherMode || brandStepOtherExplicit || !!activeEntryBrandValue);

  useEffect(() => {
    if (selectionMode !== 'dropdown') return;
    if (selectedEntryId && displayEntries.some((entry) => entry.id === selectedEntryId)) return;
    setSelectedEntryId(defaultEntryId);
  }, [selectionMode, entryIdsSignature, defaultEntryId, selectedEntryId, displayEntries]);

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

      if (data.savedToProfile === false) {
        alert(
          data.message ||
            'Document removed in this form. Click Save on Select yourself to persist the change.'
        );
      }
    } catch (error) {
      console.error('Failed to remove document:', error);
      alert('Failed to remove document. Please try again.');
    } finally {
      setRemovingState(null);
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

    const setUploadingState =
      documentType === 'brand_approval' ? setUploadingBrandDocsEntryId : setUploadingRoleDocsEntryId;
    setUploadingState(entryId);
    let pendingSaveNotice = false;
    try {
      for (const file of fileList) {
        const data = await uploadSingleDocumentForEntry(entryId, file, documentType);
        if (data.savedToProfile === false) pendingSaveNotice = true;
      }
      if (pendingSaveNotice) {
        alert(
          'Documents uploaded. Click Save on this page to keep them linked to your profile entry.'
        );
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
      alert(error?.message || 'Failed to upload document. Please try again.');
    } finally {
      setUploadingState(null);
    }
  };

  const handleBrandStepClearSelection = (entryId = resolvedSelectedEntryId) => {
    const targetId = String(entryId || '').trim();
    setBrandStepOtherMode(false);
    setBrandStepOtherExplicit(false);
    if (targetId) {
      const currentEntries = getDisplayEntries();
      const target = currentEntries.find((entry) => entry.id === targetId);
      if (target && normalizeSingleBrand(target?.brands)) {
        updateCompanyInfoEntry(targetId, 'brands', '');
      }
      setSelectedEntryId(targetId);
    }
    window.requestAnimationFrame(() => {
      document.getElementById(`entry-selector-${sectionView}`)?.focus();
    });
  };

  const handleBrandStepChangeBrand = (entryId) => {
    handleBrandStepClearSelection(entryId || resolvedSelectedEntryId);
  };

  const handleBrandStepCatalogPick = (nextBrand) => {
    const brand = sanitizeCustomBrandInput(nextBrand);
    if (!brand) {
      handleBrandStepClearSelection(resolvedSelectedEntryId);
      return;
    }

    setBrandStepOtherMode(false);
    setBrandStepOtherExplicit(false);

    const currentEntries = getDisplayEntries();
    const matchKey = brandKeyForDuplicateCheck(brand);
    const existing = currentEntries.find(
      (entry) => brandKeyForDuplicateCheck(normalizeSingleBrand(entry?.brands)) === matchKey
    );

    const notifyIfRoleMissing = (entry) => {
      const currentRole = String(entry?.role || '').trim();
      const approvedRole = getApprovedRoleForEntry(approvedBaselineEntries, entry);
      if (!currentRole && !approvedRole) {
        onBrandPickedWithoutRole?.(brand);
      }
    };

    if (existing) {
      setSelectedEntryId(existing.id);
      notifyIfRoleMissing(existing);
      return;
    }

    const activeEntry = currentEntries.find((entry) => entry.id === resolvedSelectedEntryId);

    // Replace brand on the active entry (change selection) instead of locking it.
    if (activeEntry) {
      updateCompanyInfoEntry(activeEntry.id, 'brands', brand);
      notifyIfRoleMissing({ ...activeEntry, brands: brand });
      setSelectedEntryId(activeEntry.id);
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
    notifyIfRoleMissing(newEntry);
  };

  const handleBrandStepAddAnother = () => {
    const newEntryId = appendEmptyBrandEntry();
    setSelectedEntryId(newEntryId);
    setBrandStepOtherMode(false);
    setBrandStepOtherExplicit(false);
    setExpandedEntryIds((prev) => (prev.includes(newEntryId) ? prev : [...prev, newEntryId]));
    window.requestAnimationFrame(() => {
      document.getElementById(`entry-selector-${sectionView}`)?.focus();
    });
  };

  const handleBrandStepShowCatalogPicker = () => {
    // Clear the custom typed brand so Path A picker stays visible and selection can progress.
    handleBrandStepClearSelection(resolvedSelectedEntryId);
  };

  useEffect(() => {
    if (!isBrandStepPicker || !startInNewBrandMode || newBrandModeInitializedRef.current) return;
    newBrandModeInitializedRef.current = true;
    handleBrandStepOtherSelection();
  }, [isBrandStepPicker, startInNewBrandMode]);

  const activeEntryUsesCustomBrand =
    !!activeEntryBrandValue &&
    !catalogBrandNames.some((name) => name.toLowerCase() === activeEntryBrandValue.toLowerCase());
  const showBrandStepCustomInput = isBrandStepPicker && (brandStepOtherMode || activeEntryUsesCustomBrand);

  useEffect(() => {
    if (!isBrandStepPicker || brandStepOtherExplicit) return;
    if (!activeEntryBrandValue) return;
    const inCatalog = catalogBrandNames.some(
      (name) => name.toLowerCase() === activeEntryBrandValue.toLowerCase()
    );
    setBrandStepOtherMode(!inCatalog);
  }, [isBrandStepPicker, brandStepOtherExplicit, activeEntryBrandValue, catalogBrandNames]);

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
          <div className="chain-entry-selector chain-entry-selector--brand-step">
            {brandStepOtherExplicit ? (
              <>
                <p className="chain-field__sublabel chain-entry-selector__intro">
                  Path B: enter your brand name and upload supporting documents below. This brand is not in the
                  approved catalog yet and will be sent to admin for approval. After approval, configure your
                  supply-chain role.
                </p>
                <button
                  type="button"
                  className="chain-entry-selector__link"
                  onClick={handleBrandStepShowCatalogPicker}
                  disabled={!editing}
                >
                  Choose from approved brands instead (Path A)
                </button>
              </>
            ) : (
              <>
                <label className="chain-field__label" htmlFor={`entry-selector-${sectionView}`}>
                  {activeEntryBrandValue ? 'Selected approved brand' : 'Select approved brand'}
                </label>
                <BrandSelect
                  id={`entry-selector-${sectionView}`}
                  name={`entry-selector-${sectionView}`}
                  value={brandStepHasActiveDraft ? activeEntryBrandValue : ''}
                  onChange={handleBrandStepCatalogPick}
                  onSelectionModeChange={(mode) => {
                    if (mode === 'other') {
                      handleBrandStepOtherSelection();
                    } else if (mode === 'catalog') {
                      setBrandStepOtherMode(false);
                      setBrandStepOtherExplicit(false);
                    } else if (mode === 'empty') {
                      // Clearing is handled by onChange('') → handleBrandStepCatalogPick.
                      setBrandStepOtherMode(false);
                      setBrandStepOtherExplicit(false);
                    }
                  }}
                  disabled={!editing}
                  required={false}
                  allowOther
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
                  {activeEntryBrandValue ? (
                    <button
                      type="button"
                      className="chain-entry-selector__link"
                      onClick={() => handleBrandStepChangeBrand(resolvedSelectedEntryId)}
                      disabled={!editing}
                    >
                      Change brand
                    </button>
                  ) : null}
                  {activeEntryBrandValue || displayEntries.some((entry) => normalizeSingleBrand(entry?.brands)) ? (
                    <button
                      type="button"
                      className="chain-entry-selector__link"
                      onClick={handleBrandStepAddAnother}
                      disabled={!editing}
                    >
                      Add another brand
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="chain-entry-selector__link"
                    onClick={handleBrandStepOtherSelection}
                    disabled={!editing}
                  >
                    Request a new brand instead
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

        {visibleEntriesToRender.map(({ entry, index }) => {
          const roleUiState = entryRoleOptions[entry.id] || {};
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
            roleOptionsLoading={!!roleUiState.loading}
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
            supplierApprovedBrands={supplierApprovedBrands}
            supplierBrandRequests={supplierBrandRequests}
            highlighted={highlightedEntryId === entry.id}
            onRequestChainConfiguration={onRequestChainConfiguration}
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
