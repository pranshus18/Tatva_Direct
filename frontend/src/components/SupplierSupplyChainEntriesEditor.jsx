import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Pencil, Plus, X } from 'lucide-react';
import { getApiUrl } from '../config/api';
import BrandAuthorizationDocuments from './BrandAuthorizationDocuments';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import { validateCompanyInfoEntriesList } from '../utils/supplierChainEntryValidation';
import {
  appendAuthorizationCertificateUrl,
  certificateLabelFromUrl,
  isImageCertificateUrl,
  removeAuthorizationCertificateUrl,
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
  const certificateUrls = resolveAuthorizationCertificateUrls(entry);
  return !!(brand && role && certificateUrls.length > 0);
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
  const certificateFields = setAuthorizationCertificateUrls(
    {},
    resolveAuthorizationCertificateUrls(first)
  );
  return {
    ...currentProfile,
    companyInfoEntries: nextEntries,
    supplierRole: first.role ?? '',
    brands: first.brands ?? '',
    gstin: first.gstin ?? '',
    companyName: first.companyName ?? '',
    ownershipDetails: first.ownershipDetails ?? '',
    minimumOrderValue: first.minimumOrderValue ?? '',
    authorizationCertificateUrls: certificateFields.authorizationCertificateUrls,
    authorizationCertificateUrl: certificateFields.authorizationCertificateUrl
  };
}

const CompanyInfoEntryCard = ({
  entry,
  entryIndex,
  totalEntries,
  onUpdate,
  onRemove,
  onCertificateUpload,
  onCertificateRemove,
  uploadingForThisEntry,
  removingCertificateUrl,
  editing,
  canRemove,
  availableRoleOptions = SUPPLY_CHAIN_ROLE_OPTIONS,
  roleOptionsLoading = false,
  roleOptionsMessage = '',
  adminChainReady = false,
  adminChainStatusText = '',
  catalogBrandNames = [],
  catalogBrandsLoading = false,
  expanded = true,
  onToggleExpand = null,
  onSaveEntry = null,
  savingThisEntry = false
}) => {
  const selectedBrand = normalizeSingleBrand(entry.brands);
  const roleLabel = SUPPLY_CHAIN_ROLE_OPTIONS.find((o) => o.value === entry.role)?.label || null;
  const isCatalogBrand = selectedBrand && catalogBrandNames.includes(selectedBrand);
  const certificateUrls = resolveAuthorizationCertificateUrls(entry);

  const handleCatalogBrandSelect = (e) => {
    const value = e.target.value;
    if (value) onUpdate('brands', value);
  };

  const handleBrandNameInput = (e) => {
    onUpdate('brands', sanitizeCustomBrandInput(e.target.value));
  };

  return (
    <article className="chain-entry-card">
      <header className="chain-entry-header">
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
            <span className={`chain-chip ${certificateUrls.length > 0 ? 'chain-chip--brand' : 'chain-chip--muted'}`}>
              {certificateUrls.length > 0
                ? `Certification: ${certificateUrls.length} document(s)`
                : 'Certification pending'}
            </span>
          </div>
        </div>
        <div className="chain-entry-header__actions">
          {editing ? (
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
          {canRemove && editing ? (
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
      </header>

      {expanded ? <div className="chain-entry-body">
        <section className="chain-section">
          <h3 className="chain-section__title">Brand &amp; role</h3>
          <div className="chain-section__panel">
            {adminChainStatusText ? (
              <p
                className={`chain-callout ${
                  adminChainReady ? 'chain-callout--success' : 'chain-callout--warning'
                }`}
              >
                {adminChainReady ? 'Admin chain ready:' : 'Admin chain pending:'} {adminChainStatusText}
              </p>
            ) : null}

            <div className="chain-brand-grid">
              {catalogBrandNames.length > 0 ? (
                <div className="chain-field">
                  <label className="chain-field__sublabel" htmlFor={`catalog-brand-${entry.id}`}>
                    Pick from catalog
                  </label>
                  <select
                    id={`catalog-brand-${entry.id}`}
                    className="chain-field__control"
                    value={isCatalogBrand ? selectedBrand : ''}
                    onChange={handleCatalogBrandSelect}
                    disabled={!editing || catalogBrandsLoading}
                    aria-label="Pick brand from catalog"
                  >
                    <option value="">
                      {catalogBrandsLoading ? 'Loading brands…' : 'Select from catalog…'}
                    </option>
                    {catalogBrandNames.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className={`chain-field${catalogBrandNames.length === 0 ? ' chain-field--full' : ''}`}>
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
                disabled={!editing || roleOptionsLoading || availableRoleOptions.length === 0}
                required={editing && adminChainReady}
                aria-required={editing && adminChainReady ? 'true' : 'false'}
              >
                <option value="">Select your role</option>
                {availableRoleOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {roleOptionsLoading ? (
                <p className="chain-callout chain-callout--info">Loading role options…</p>
              ) : null}
              {!roleOptionsLoading && roleOptionsMessage ? (
                <p className="chain-callout chain-callout--info">{roleOptionsMessage}</p>
              ) : null}
            </div>
          </div>
        </section>

        {entry.role && entry.role !== 'retailer' ? (
          <section className="chain-section">
            <h3 className="chain-section__title">Order rules</h3>
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

        <section className="chain-section">
          <h3 className="chain-section__title">Authorisation documents</h3>
          <div className="chain-section__panel">
            <div className="chain-field chain-field--full">
              <label className="chain-field__label">
                Brand authorisation documents
                <RequiredMark />
              </label>
              <BrandAuthorizationDocuments
                entry={entry}
                editing={editing}
                uploading={uploadingForThisEntry}
                removingUrl={removingCertificateUrl}
                onUpload={(files) => onCertificateUpload?.(entry.id, files)}
                onRemove={(url) => onCertificateRemove?.(entry.id, url)}
              />
            </div>
          </div>
        </section>
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
  onSaveEntry = null,
  savingEntryId = null
}) {
  const [uploadingCertificateEntryId, setUploadingCertificateEntryId] = useState(null);
  const [removingCertificate, setRemovingCertificate] = useState(null);
  const [entryRoleOptions, setEntryRoleOptions] = useState({});
  const [expandedEntryIds, setExpandedEntryIds] = useState([]);
  const { brandNames: catalogBrandNames, loading: catalogBrandsLoading } = useSupplierBrands();

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
        ...setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(profile || {})),
        minimumOrderValue: profile?.minimumOrderValue ?? ''
      }
    ];
  };

  const applyCertificateUrlToEntry = (entryId, url, mode = 'append') => {
    if (entryId === 'legacy') {
      const certificateFields =
        mode === 'remove'
          ? removeAuthorizationCertificateUrl(profile, url)
          : appendAuthorizationCertificateUrl(profile, url);
      setProfile({
        ...profile,
        authorizationCertificateUrls: certificateFields.authorizationCertificateUrls,
        authorizationCertificateUrl: certificateFields.authorizationCertificateUrl,
        authorizationCertificatePath:
          certificateFields.authorizationCertificateUrl ? profile?.authorizationCertificatePath : ''
      });
      return;
    }

    const entries = (profile?.companyInfoEntries || []).map((entry) => {
      if (entry.id !== entryId) return entry;
      return mode === 'remove'
        ? removeAuthorizationCertificateUrl(entry, url)
        : appendAuthorizationCertificateUrl(entry, url);
    });
    setProfile(syncProfileFromEntries(profile, entries));
  };

  const displayEntries = getDisplayEntries();
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

  const handleCertificateRemoveForEntry = async (entryId, url) => {
    if (!url) return;
    if (!window.confirm('Remove this authorisation document?')) {
      return;
    }

    setRemovingCertificate({ entryId, url });
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('Please sign in again to remove certificates.');
        return;
      }

      const params = new URLSearchParams();
      if (entryId !== 'legacy') params.set('entryId', entryId);
      params.set('url', url);
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

      applyCertificateUrlToEntry(entryId, url, 'remove');

      if (data.savedToProfile === false) {
        alert(
          data.message ||
            'Document removed in this form. Click Save on Select yourself to persist the change.'
        );
      }
    } catch (error) {
      console.error('Failed to remove authorization certificate:', error);
      alert('Failed to remove authorization document. Please try again.');
    } finally {
      setRemovingCertificate(null);
    }
  };

  const uploadSingleCertificateForEntry = async (entryId, file) => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Please sign in again to upload certificates.');
    }

    const formData = new FormData();
    formData.append('file', file);
    if (entryId !== 'legacy') formData.append('entryId', entryId);

    const response = await fetch(getApiUrl('/api/profile/supplier/authorization-certificate'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== 'success' || !data.url) {
      throw new Error(data.message || `Failed to upload authorization document (${response.status})`);
    }

    applyCertificateUrlToEntry(entryId, data.url, 'append');
    return data;
  };

  const handleCertificateUploadForEntry = async (entryId, files) => {
    const fileList = Array.from(files || []);
    if (!fileList.length) return;

    setUploadingCertificateEntryId(entryId);
    let pendingSaveNotice = false;
    try {
      for (const file of fileList) {
        const data = await uploadSingleCertificateForEntry(entryId, file);
        if (data.savedToProfile === false) pendingSaveNotice = true;
      }
      if (pendingSaveNotice) {
        alert(
          'Documents uploaded. Click Save on this page to keep them linked to your profile entry.'
        );
      }
    } catch (error) {
      console.error('Failed to upload authorization certificate:', error);
      alert(error?.message || 'Failed to upload authorization document. Please try again.');
    } finally {
      setUploadingCertificateEntryId(null);
    }
  };

  return (
    <div className="supplier-select-yourself-editor">
      <p className="chain-intro">
        <strong>One block = one supply-chain layer.</strong> Add a single role per block. Chain order:{' '}
        <strong>Manufacturer → Stockist → Regional → Local → Dealer → Retailer</strong>.
      </p>

      <div className="chain-entries">
        {displayEntries.map((entry, idx) => {
          const roleUiState = entryRoleOptions[entry.id] || {};
          const expanded = expandedEntryIds.includes(entry.id);
          return (
          <CompanyInfoEntryCard
            key={entry.id}
            entry={entry}
            entryIndex={idx + 1}
            totalEntries={displayEntries.length}
            onUpdate={(field, value) => updateCompanyInfoEntry(entry.id, field, value)}
            onRemove={() => removeCompanyInfoEntry(entry.id)}
            onCertificateUpload={handleCertificateUploadForEntry}
            onCertificateRemove={handleCertificateRemoveForEntry}
            uploadingForThisEntry={uploadingCertificateEntryId === entry.id}
            removingCertificateUrl={
              removingCertificate?.entryId === entry.id ? removingCertificate.url : null
            }
            editing={editing}
            canRemove={displayEntries.length > 1}
            availableRoleOptions={roleUiState.options || []}
            roleOptionsLoading={!!roleUiState.loading}
            roleOptionsMessage={roleUiState.message || ''}
            adminChainReady={!!roleUiState.adminChainReady}
            adminChainStatusText={roleUiState.adminChainStatusText || ''}
            catalogBrandNames={catalogBrandNames}
            catalogBrandsLoading={catalogBrandsLoading}
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

      {editing ? (
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
