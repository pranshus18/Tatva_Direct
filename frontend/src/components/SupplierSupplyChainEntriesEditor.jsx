import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { getApiUrl } from '../config/api';
import BrandAuthorizationDocuments from './BrandAuthorizationDocuments';
import { validateCompanyInfoEntriesList } from '../utils/supplierChainEntryValidation';
import {
  appendAuthorizationCertificateUrl,
  appendBrandApprovalDocumentUrl,
  removeBrandApprovalDocumentUrl,
  removeAuthorizationCertificateUrl,
  resolveBrandApprovalDocumentUrls,
  setBrandApprovalDocumentUrls,
  resolveAuthorizationCertificateUrls,
  setAuthorizationCertificateUrls
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

const SUPPLY_CHAIN_ROLE_OPTIONS = [
  { value: 'manufacturer', label: 'Manufacturer (MGF)' },
  { value: 'stockist', label: 'Stockist' },
  { value: 'regional_distributor', label: 'Regional Distributor' },
  { value: 'local_distributor', label: 'Local Distributor' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'retailer', label: 'Retailer' }
];

function genEntryId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `entry-${Date.now()}`;
}

function isEntryCompletedForCompact(entry) {
  const brand = normalizeSingleBrand(entry?.brands);
  const role = String(entry?.role || '').trim();
  const roleDocs = resolveAuthorizationCertificateUrls(entry);
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
  const nextEntries = Array.isArray(entries) ? entries : [];
  const first = nextEntries[0] || {};
  const roleCertificateFields = setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(first));
  const brandCertificateFields = setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(first));
  return {
    ...currentProfile,
    companyInfoEntries: nextEntries,
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
  brandMeta = null,
  sectionView = 'all',
  allowEntryManagement = true,
  forceExpanded = false,
  expanded = true,
  onToggleExpand = null,
  onSaveEntry = null,
  savingThisEntry = false
}) => {
  const selectedBrand = normalizeSingleBrand(entry.brands);
  const roleLabel = SUPPLY_CHAIN_ROLE_OPTIONS.find((o) => o.value === entry.role)?.label || null;
  const brandDocUrls = resolveBrandApprovalDocumentUrls(entry);
  const roleDocUrls = resolveAuthorizationCertificateUrls(entry);
  const resolvedBrandName =
    String(brandMeta?.brand || '').trim() || String(brandMeta?.normalizedBrand || '').trim() || selectedBrand;
  const brandStatus = String(brandMeta?.status || (selectedBrand ? 'missing' : 'unselected')).toLowerCase();
  const chainDefined = !!brandMeta?.hasSupplyChainDefinition;
  const hasBrandValue = !!selectedBrand;
  const statusTone =
    brandStatus === 'approved' && chainDefined
      ? 'success'
      : brandStatus === 'pending'
        ? 'warning'
        : brandStatus === 'rejected'
          ? 'danger'
          : 'neutral';
  const statusLabel =
    !hasBrandValue
      ? 'Select a brand first'
      : brandStatus === 'approved' && chainDefined
        ? 'Approved by admin'
        : brandStatus === 'approved'
          ? 'Approved (chain setup pending)'
          : brandStatus === 'pending'
            ? 'Pending admin approval'
            : brandStatus === 'rejected'
              ? 'Rejected by admin'
              : 'Not requested yet';
  const brandApprovalReadyForRole = hasBrandValue && brandStatus === 'approved' && chainDefined;
  const roleSelectionEnabled =
    editing && brandApprovalReadyForRole && !roleOptionsLoading && availableRoleOptions.length > 0;
  const showBrandApprovalSection = sectionView !== 'form';
  const showFormDetailsSection = sectionView !== 'brand';
  const showEntrySave = editing && showFormDetailsSection && allowEntryManagement && !!onSaveEntry;
  const showEntryRemove = canRemove && editing && showFormDetailsSection && allowEntryManagement;
  const showHeader = !(sectionView === 'brand' && forceExpanded && !allowEntryManagement);

  const handleBrandNameInput = (e) => {
    onUpdate('brands', sanitizeCustomBrandInput(e.target.value));
  };

  return (
    <article className="chain-entry-card">
      {showHeader ? <header className="chain-entry-header">
        <div className="chain-entry-header__main">
          <span className="chain-entry-header__eyebrow">
            Entry {entryIndex} of {totalEntries}
          </span>
          <div className="chain-entry-header__chips">
            <span className={`chain-chip ${roleLabel ? 'chain-chip--role' : 'chain-chip--muted'}`}>
              {roleLabel || 'Role pending'}
            </span>
            <span className={`chain-chip ${selectedBrand ? 'chain-chip--brand' : 'chain-chip--muted'}`}>
              {selectedBrand || 'Brand pending'}
            </span>
            <span className={`chain-chip ${brandDocUrls.length > 0 ? 'chain-chip--brand' : 'chain-chip--muted'}`}>
              {brandDocUrls.length > 0 ? `Brand docs: ${brandDocUrls.length}` : 'Brand docs: optional'}
            </span>
            <span className={`chain-chip ${roleDocUrls.length > 0 ? 'chain-chip--brand' : 'chain-chip--muted'}`}>
              {roleDocUrls.length > 0 ? `Role docs: ${roleDocUrls.length}` : 'Role docs pending'}
            </span>
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
                    onChange={handleBrandNameInput}
                    disabled={!editing}
                    placeholder="Enter one brand name"
                    required={editing}
                    aria-required="true"
                  />
                </div>
              </div>
              <div className="chain-brand-approval-grid">
                <div className="chain-field">
                  <label className="chain-field__label">Status</label>
                  <div className={`chain-status-card chain-status-card--${statusTone}`}>
                    <strong>{statusLabel}</strong>
                    {hasBrandValue ? <span>{resolvedBrandName}</span> : null}
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
            </div>
          </section>

        </div>
        ) : null}

        {showFormDetailsSection ? (
        <div className="chain-entry-form-block">
          <h3 className="chain-entry-block-title">Form details</h3>
          {hasBrandValue ? (
            <div className="chain-form-brand-summary">
              <div className={`chain-status-card chain-status-card--${statusTone}`}>
                <strong>{statusLabel}</strong>
                <span>{resolvedBrandName}</span>
              </div>
              {roleOptionsMessage ? (
                <p className="chain-callout chain-callout--warning">{roleOptionsMessage}</p>
              ) : adminChainStatusText ? (
                <p className="chain-callout chain-callout--info">{adminChainStatusText}</p>
              ) : null}
            </div>
          ) : (
            <p className="chain-callout chain-callout--warning">
              Add and save your brand in Step 1 first. Supply-chain role options appear here after the brand is
              admin-approved and the supply chain is defined.
            </p>
          )}
          <section className="chain-section">
            <h4 className="chain-section__title">Supply-chain role</h4>
            <div className="chain-section__panel">
              <div className="chain-field chain-field--full">
                <label className="chain-field__label" htmlFor={`role-${entry.id}`}>
                  Supply-chain role
                  {adminChainReady ? <RequiredMark /> : null}
                </label>
                <select
                  id={`role-${entry.id}`}
                  className="chain-field__control"
                  value={entry.role || ''}
                  onChange={(e) => onUpdate('role', e.target.value)}
                  disabled={!roleSelectionEnabled}
                  required={editing && brandApprovalReadyForRole}
                  aria-required={editing && brandApprovalReadyForRole ? 'true' : 'false'}
                >
                  <option value="">Select your role</option>
                  {availableRoleOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
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
                  editing={editing}
                  uploading={uploadingRoleDocsForThisEntry}
                  removingUrl={removingRoleDocumentUrl}
                  onUpload={(files) => onRoleDocumentUpload?.(entry.id, files)}
                  onRemove={(url) => onRoleDocumentRemove?.(entry.id, url)}
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
                  disabled={!editing}
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
  savingEntryId = null
}) {
  const [uploadingRoleDocsEntryId, setUploadingRoleDocsEntryId] = useState(null);
  const [uploadingBrandDocsEntryId, setUploadingBrandDocsEntryId] = useState(null);
  const [removingRoleDocument, setRemovingRoleDocument] = useState(null);
  const [removingBrandDocument, setRemovingBrandDocument] = useState(null);
  const [entryRoleOptions, setEntryRoleOptions] = useState({});
  const [expandedEntryIds, setExpandedEntryIds] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState('');

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
      const certificateFields =
        mode === 'remove'
          ? removeDocument(profile, url)
          : appendDocument(profile, url);
      if (documentType === 'brand_approval') {
        setProfile({
          ...profile,
          brandApprovalDocumentUrls: certificateFields.brandApprovalDocumentUrls,
          brandApprovalDocumentUrl: certificateFields.brandApprovalDocumentUrl,
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

    const entries = (profile?.companyInfoEntries || []).map((entry) => {
      if (entry.id !== entryId) return entry;
      return mode === 'remove' ? removeDocument(entry, url) : appendDocument(entry, url);
    });
    setProfile(syncProfileFromEntries(profile, entries));
  };

  const displayEntries = getDisplayEntries();
  const indexedEntries = displayEntries.map((entry, index) => ({ entry, index }));

  useEffect(() => {
    if (selectionMode !== 'dropdown') return;
    const firstId = displayEntries[0]?.id || '';
    const exists = displayEntries.some((entry) => entry.id === selectedEntryId);
    if (!exists) {
      setSelectedEntryId(firstId);
    }
  }, [selectionMode, displayEntries, selectedEntryId]);

  const entriesToRender =
    selectionMode === 'dropdown'
      ? indexedEntries.filter((item) => item.entry.id === selectedEntryId)
      : indexedEntries;
  const compactSignature = JSON.stringify(
    displayEntries.map((entry) => ({
      id: entry.id,
      completed: isEntryCompletedForCompact(entry)
    }))
  );

  useEffect(() => {
    setExpandedEntryIds((prev) => {
      const prevSet = new Set(prev);
      const nextExpanded = [];
      for (const entry of displayEntries) {
        if (prevSet.has(entry.id)) {
          nextExpanded.push(entry.id);
          continue;
        }
        if (!isEntryCompletedForCompact(entry)) {
          nextExpanded.push(entry.id);
        }
      }
      return nextExpanded;
    });
  }, [compactSignature]);

  const entryBrandSignature = JSON.stringify(
    displayEntries.map((entry) => ({
      id: entry.id,
      brands: String(entry?.brands || '').trim()
    }))
  );

  useEffect(() => {
    if (!editing) return;
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

        nextState[entry.id] = { loading: true, options: [], message: '' };
        if (!isCancelled) setEntryRoleOptions((prev) => ({ ...prev, ...nextState }));

        try {
          const response = await fetch(
            getApiUrl(`/api/profile/supplier/chain-role-options?brands=${encodeURIComponent(brandsValue)}`),
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const data = await response.json().catch(() => ({}));
          const roleSet = new Set(Array.isArray(data?.roles) ? data.roles : []);
          const options = SUPPLY_CHAIN_ROLE_OPTIONS.filter((opt) => roleSet.has(opt.value));
          const brandStates = Array.isArray(data?.brands) ? data.brands : [];
          const selectedBrandState = brandStates.find((b) => {
            const key = normalizeBrandToken(b?.normalizedBrand || b?.brand);
            return key && key === normalizeBrandToken(brandsValue);
          });
          const brandStatusText = Array.isArray(data?.brands)
            ? data.brands
                .map((b) => {
                  const brandName = b?.brand || b?.normalizedBrand || 'Brand';
                  const approved = String(b?.status || '') === 'approved';
                  const chainDefined = !!b?.hasSupplyChainDefinition;
                  if (approved && chainDefined) return `${brandName} approved + chain defined`;
                  if (!approved) return `${brandName} not admin approved`;
                  return `${brandName} chain not defined by admin`;
                })
                .join(' | ')
            : '';
          nextState[entry.id] = {
            loading: false,
            options,
            brandMeta: selectedBrandState || null,
            adminChainReady: !!data?.eligible && options.length > 0,
            adminChainStatusText: brandStatusText,
            message:
              options.length > 0
                ? ''
                : data?.message ||
                  'No role available. Brand must be admin approved and supply chain must be defined by admin.'
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
  }, [editing, entryBrandSignature]);

  const addCompanyInfoEntry = () => {
    let base = [...(profile?.companyInfoEntries || [])];
    if (base.length === 0) {
      const hasLegacy =
        !!(
          profile?.supplierRole ||
          (profile?.brands && String(profile.brands).trim()) ||
          (profile?.gstin && String(profile.gstin).trim()) ||
          (profile?.companyName && String(profile.companyName).trim()) ||
          (profile?.ownershipDetails && String(profile.ownershipDetails).trim())
        );
      if (hasLegacy) {
        base = [
          {
            id: genEntryId(),
            role: profile?.supplierRole || '',
            brands: profile?.brands || '',
            gstin: profile?.gstin || '',
            companyName: profile?.companyName || '',
            ownershipDetails: profile?.ownershipDetails || '',
            brandApprovalDocumentUrl: profile?.brandApprovalDocumentUrl || '',
            authorizationCertificateUrl: profile?.authorizationCertificateUrl || '',
            minimumOrderValue: profile?.minimumOrderValue ?? ''
          }
        ];
      }
    }
    const next = [
      ...base,
      {
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
      }
    ];
    setProfile(syncProfileFromEntries(profile, next));
  };

  const updateCompanyInfoEntry = (entryId, field, value) => {
    const nextValue = field === 'brands' ? normalizeSingleBrand(value) : value;
    if (entryId === 'legacy') {
      const legacy = {
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
      setProfile(syncProfileFromEntries(profile, [legacyEntry]));
      return;
    }
    const entries = (profile?.companyInfoEntries || []).map((e) =>
      e.id === entryId ? { ...e, [field]: nextValue } : e
    );
    setProfile(syncProfileFromEntries(profile, entries));
  };

  const removeCompanyInfoEntry = (entryId) => {
    if (entryId === 'legacy') {
      setProfile({
        ...profile,
        companyInfoEntries: [],
        supplierRole: '',
        brands: '',
        gstin: '',
        companyName: '',
        ownershipDetails: ''
      });
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

  return (
    <div
      className={`supplier-select-yourself-editor supplier-select-yourself-editor--${sectionView} supplier-select-yourself-editor--${selectionMode}`}
    >
      <div className="chain-entries">
        {selectionMode === 'dropdown' && displayEntries.length > 0 ? (
          <div className="chain-entry-selector">
            <label className="chain-field__label" htmlFor={`entry-selector-${sectionView}`}>
              Select brand
            </label>
            <select
              id={`entry-selector-${sectionView}`}
              className="chain-field__control"
              value={selectedEntryId}
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
          </div>
        ) : null}

        {entriesToRender.map(({ entry, index }) => {
          const roleUiState = entryRoleOptions[entry.id] || {};
          const expanded = expandedEntryIds.includes(entry.id);
          return (
          <CompanyInfoEntryCard
            key={entry.id}
            entry={entry}
            entryIndex={index + 1}
            totalEntries={displayEntries.length}
            onUpdate={(field, value) => updateCompanyInfoEntry(entry.id, field, value)}
            onRemove={() => removeCompanyInfoEntry(entry.id)}
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
            canRemove={displayEntries.length > 1}
            availableRoleOptions={roleUiState.options || []}
            roleOptionsLoading={!!roleUiState.loading}
            roleOptionsMessage={roleUiState.message || ''}
            adminChainReady={!!roleUiState.adminChainReady}
            adminChainStatusText={roleUiState.adminChainStatusText || ''}
            brandMeta={roleUiState.brandMeta || null}
            sectionView={sectionView}
            allowEntryManagement={allowEntryManagement}
            forceExpanded={selectionMode === 'dropdown'}
            expanded={expanded}
            onSaveEntry={onSaveEntry}
            savingThisEntry={savingEntryId === entry.id}
            onToggleExpand={() =>
              setExpandedEntryIds((prev) =>
                prev.includes(entry.id) ? prev.filter((id) => id !== entry.id) : [...prev, entry.id]
              )
            }
          />
          );
        })}
      </div>

      {editing && sectionView !== 'brand' && allowEntryManagement ? (
        <div className="chain-add-entry">
          <p className="chain-add-entry__hint">
            Need another role or brand? Add a separate entry below.
          </p>
          <button type="button" className="chain-add-entry__btn" onClick={addCompanyInfoEntry}>
            <Plus size={16} />
            Add another entry
          </button>
        </div>
      ) : null}
    </div>
  );
}
