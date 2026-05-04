import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { getApiUrl } from '../config/api';

const PRESET_SUPPLIER_BRANDS = ['Asian Paints', 'Oil', 'Cement'];

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

function brandsListToString(list) {
  return list.join(', ');
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

const CompanyInfoEntryCard = ({
  entry,
  entryIndex,
  totalEntries,
  onUpdate,
  onRemove,
  onCertificateUpload,
  uploadingForThisEntry,
  editing,
  canRemove,
  availableRoleOptions = SUPPLY_CHAIN_ROLE_OPTIONS,
  roleOptionsLoading = false,
  roleOptionsMessage = '',
  adminChainReady = false,
  adminChainStatusText = ''
}) => {
  const list = parseBrandsList(entry.brands);
  const roleLabel = SUPPLY_CHAIN_ROLE_OPTIONS.find((o) => o.value === entry.role)?.label || null;
  const brandsPreview = (entry.brands || '').trim() || (list.length ? list.join(', ') : '');

  const addPresetBrand = (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v || !editing) return;
    if (list.includes(v)) return;
    onUpdate('brands', brandsListToString([...list, v]));
  };

  const removeBrand = (name) => {
    onUpdate('brands', brandsListToString(list.filter((b) => b !== name)));
  };

  return (
    <div className="company-info-entry-card">
      <div className="company-info-entry-header">
        <div className="company-info-entry-title-block">
          <span className="company-info-entry-number">
            Entry {entryIndex} of {totalEntries}
          </span>
          <span className="company-info-entry-badge">
            {roleLabel || 'Role not selected yet'}
          </span>
          {(brandsPreview || list.length > 0) && (
            <p className="company-info-entry-brands-preview">
              <strong>Brands:</strong> {brandsPreview || list.join(', ')}
            </p>
          )}
        </div>
        {canRemove && editing && (
          <button
            type="button"
            className="btn-remove"
            onClick={onRemove}
            aria-label="Remove this entry"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="form-grid company-info-entry-fields">
        <div className="form-group">
          <label className="brands-handled-label-cap">Your role for this block (one layer only)</label>
          <select
            value={entry.role || ''}
            onChange={(e) => onUpdate('role', e.target.value)}
            disabled={!editing || roleOptionsLoading || availableRoleOptions.length === 0}
            className="brands-preset-select"
          >
            <option value="">Select type</option>
            {availableRoleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {roleOptionsLoading ? (
            <p className="brands-handled-hint" style={{ marginTop: 8 }}>Loading role options...</p>
          ) : null}
          {!roleOptionsLoading && roleOptionsMessage ? (
            <p className="brands-handled-hint" style={{ marginTop: 8 }}>{roleOptionsMessage}</p>
          ) : null}
        </div>
        <div className="form-group span-2">
          <label className="brands-handled-label-cap">Brands handled</label>
          {adminChainStatusText ? (
            <p
              className="brands-handled-hint"
              style={{
                marginTop: 0,
                marginBottom: 8,
                color: adminChainReady ? '#166534' : '#b45309',
                fontWeight: 600
              }}
            >
              {adminChainReady ? 'Admin chain ready:' : 'Admin chain pending:'} {adminChainStatusText}
            </p>
          ) : null}
          <select
            className="brands-preset-select"
            value=""
            onChange={addPresetBrand}
            disabled={!editing}
            aria-label="Add preset brand"
          >
            <option value="">Add brand from list...</option>
            {PRESET_SUPPLIER_BRANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {list.length > 0 && (
            <div className="brand-chips" role="list">
              {list.map((b) => (
                <span key={b} className="brand-chip" role="listitem">
                  {b}
                  {editing && (
                    <button
                      type="button"
                      className="brand-chip-remove"
                      aria-label={`Remove ${b}`}
                      onClick={() => removeBrand(b)}
                    >
                      <X size={14} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <textarea
            rows={2}
            value={entry.brands || ''}
            onChange={(e) => onUpdate('brands', e.target.value)}
            disabled={!editing}
            placeholder="e.g. Asian Paints, Oil, Cement..."
            className="brands-entry-textarea"
          />
        </div>
        <div className="form-group">
          <label>GSTIN</label>
          <input
            type="text"
            value={entry.gstin || ''}
            onChange={(e) => onUpdate('gstin', e.target.value)}
            disabled={!editing}
            placeholder="22AAAAA0000A1Z5"
          />
        </div>
        <div className="form-group">
          <label>Company Name</label>
          <input
            type="text"
            value={entry.companyName || ''}
            onChange={(e) => onUpdate('companyName', e.target.value)}
            disabled={!editing}
          />
        </div>
        <div className="form-group span-2">
          <label>Ownership Details</label>
          <textarea
            rows={3}
            value={entry.ownershipDetails || ''}
            onChange={(e) => onUpdate('ownershipDetails', e.target.value)}
            disabled={!editing}
            placeholder="Proprietorship / Partnership / Pvt. Ltd. / LLP etc."
          />
        </div>
        {entry.role && entry.role !== 'retailer' ? (
          <div className="form-group span-2">
            <label>Minimum order value (₹) — upstream B2B buyers</label>
            <input
              type="number"
              min={0}
              step={1}
              value={entry.minimumOrderValue ?? ''}
              onChange={(e) => onUpdate('minimumOrderValue', e.target.value)}
              disabled={!editing}
              placeholder="e.g. 25000 — minimum order total when partners buy from you"
            />
            <p className="brands-handled-hint" style={{ marginTop: 8 }}>
              When <strong>you</strong> are the seller in this layer, downstream partners must meet this order total
              (not used for the Retailer layer). Leave empty for no minimum.
            </p>
          </div>
        ) : null}
        <div className="form-group span-2">
          <label>Brand authorisation certificate (this entry)</label>
          <input
            type="file"
            accept=".pdf,image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file && onCertificateUpload) onCertificateUpload(entry.id, file);
            }}
            disabled={!editing || uploadingForThisEntry}
          />
          {uploadingForThisEntry && <p className="cert-upload-status">Uploading...</p>}
          {entry.authorizationCertificateUrl && !uploadingForThisEntry && (
            <p className="cert-upload-status">
              <a href={entry.authorizationCertificateUrl} target="_blank" rel="noopener noreferrer">
                View uploaded certificate
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Supply-chain role + brands + certificates (one block per layer). Used on the dedicated Select yourself page.
 */
export default function SupplierSupplyChainEntriesEditor({ profile, setProfile, editing }) {
  const [uploadingCertificateEntryId, setUploadingCertificateEntryId] = useState(null);
  const [entryRoleOptions, setEntryRoleOptions] = useState({});

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
        authorizationCertificateUrl: profile?.authorizationCertificateUrl || '',
        minimumOrderValue: profile?.minimumOrderValue ?? ''
      }
    ];
  };

  const displayEntries = getDisplayEntries();

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
    const first = next[0] || {};
    setProfile({
      ...profile,
      companyInfoEntries: next,
      supplierRole: first.role ?? '',
      brands: first.brands ?? '',
      gstin: first.gstin ?? '',
      companyName: first.companyName ?? '',
      ownershipDetails: first.ownershipDetails ?? ''
    });
  };

  const updateCompanyInfoEntry = (entryId, field, value) => {
    if (entryId === 'legacy') {
      const legacy = {
        role: profile?.supplierRole || '',
        brands: profile?.brands || '',
        gstin: profile?.gstin || '',
        companyName: profile?.companyName || '',
        ownershipDetails: profile?.ownershipDetails || '',
        minimumOrderValue: profile?.minimumOrderValue ?? ''
      };
      const updated = { ...legacy, [field]: value };
      setProfile({
        ...profile,
        companyInfoEntries: [{ id: genEntryId(), ...updated }],
        supplierRole: updated.role,
        brands: updated.brands,
        gstin: updated.gstin,
        companyName: updated.companyName,
        ownershipDetails: updated.ownershipDetails,
        minimumOrderValue: updated.minimumOrderValue
      });
      return;
    }
    const entries = (profile?.companyInfoEntries || []).map((e) =>
      e.id === entryId ? { ...e, [field]: value } : e
    );
    setProfile({ ...profile, companyInfoEntries: entries });
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
    setProfile({ ...profile, companyInfoEntries: entries });
  };

  const handleCertificateUploadForEntry = async (entryId, file) => {
    if (!file) return;
    setUploadingCertificateEntryId(entryId);
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);
      if (entryId !== 'legacy') formData.append('entryId', entryId);

      const response = await fetch(getApiUrl('/api/profile/supplier/authorization-certificate'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      const data = await response.json();

      if (data.status === 'success' && data.url) {
        if (entryId === 'legacy') {
          setProfile({ ...profile, authorizationCertificateUrl: data.url });
        } else {
          updateCompanyInfoEntry(entryId, 'authorizationCertificateUrl', data.url);
        }
      } else {
        alert(data.message || 'Failed to upload authorization certificate');
      }
    } catch (error) {
      console.error('Failed to upload authorization certificate:', error);
      alert('Failed to upload authorization certificate. Please try again.');
    } finally {
      setUploadingCertificateEntryId(null);
    }
  };

  return (
    <div className="supplier-select-yourself-editor">
      <p className="modal-chain-hint" style={{ marginTop: 0 }}>
        <strong>One block = one supply-chain layer.</strong> Choose a single role per block (e.g. Dealer only in that
        block—do not combine layers). Full order toward the customer is:{' '}
        <strong>Manufacturer → Stockist → Regional → Local → Dealer → Retailer</strong>. Upstream ordering and partner
        lists use these layers so they stay separate. Each block is a full form (role, brands, GSTIN, company,
        ownership). Use <strong>Add another</strong> for a <em>different</em> role below.
      </p>

      <div className="company-info-entries-list">
        {displayEntries.map((entry, idx) => {
          const roleUiState = entryRoleOptions[entry.id] || {};
          return (
          <CompanyInfoEntryCard
            key={entry.id}
            entry={entry}
            entryIndex={idx + 1}
            totalEntries={displayEntries.length}
            onUpdate={(field, value) => updateCompanyInfoEntry(entry.id, field, value)}
            onRemove={() => removeCompanyInfoEntry(entry.id)}
            onCertificateUpload={handleCertificateUploadForEntry}
            uploadingForThisEntry={uploadingCertificateEntryId === entry.id}
            editing={editing}
            canRemove={displayEntries.length > 1}
            availableRoleOptions={roleUiState.options || []}
            roleOptionsLoading={!!roleUiState.loading}
            roleOptionsMessage={roleUiState.message || ''}
            adminChainReady={!!roleUiState.adminChainReady}
            adminChainStatusText={roleUiState.adminChainStatusText || ''}
          />
          );
        })}
      </div>

      {editing && (
        <div className="add-another-entry-block add-another-entry-block--inline">
          <p className="add-another-entry-hint">
            When this entry is complete, add another form below for a different role (e.g. Dealer) and its brands.
          </p>
          <button type="button" className="btn-add btn-add-another-entry" onClick={addCompanyInfoEntry}>
            <Plus size={16} />
            Add another (role + brands)
          </button>
        </div>
      )}
    </div>
  );
}
