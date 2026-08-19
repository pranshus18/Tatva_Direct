import React, { useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { Save, Plus, Trash2 } from 'lucide-react';
import './Dashboard.css';
import './SupplierBCOV.css';
import { useLocation, useNavigate } from 'react-router-dom';
import SupplierProductAdditionSteps from '../components/SupplierProductAdditionSteps';
import {
  BRAND_COV_FIELD_LABEL,
  BRAND_COV_LABEL,
  PLATFORM_COV_FIELD_LABEL,
  PLATFORM_COV_LABEL,
  SUPPLIER_COV_FIELD_LABEL,
  SUPPLIER_COV_LABEL,
  SUPPLIER_COV_PRICE_FIELD_LABEL,
  SUPPLIER_COV_PRICE_LABEL,
  SUPPLIER_MRP_LABEL
} from '../utils/supplierStockLabel';
import { formatRupee } from '../utils/formatRupee';
import RupeeInput from '../components/RupeeInput';

const createDefaultRow = (index = 0) => ({
  id: null,
  levelName: `Level ${index + 1}`,
  buyerBcov: '',
  buyerCov: '',
  buyerPcov: '',
  price: ''
});

const isDefaultLevelName = (value) => /^Level\s+\d+$/i.test(String(value || '').trim());

const parseCovThresholdNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const sanitized = raw.replace(/,/g, '');
  const match = sanitized.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const isBlankRow = (row) => {
  if (!row) return true;
  const hasCovValues =
    String(row.buyerBcov || '').trim() !== '' ||
    String(row.buyerCov || '').trim() !== '' ||
    String(row.buyerPcov || '').trim() !== '' ||
    String(row.price || '').trim() !== '';
  if (!hasCovValues) {
    // Default "Level N" alone is still an empty draft row (not ready to save).
    const levelName = String(row.levelName || '').trim();
    return levelName === '' || isDefaultLevelName(levelName);
  }
  return false;
};

const getValidationErrorsForRows = (rowsToValidate, catalogMrp) => {
  const errs = [];
  const hasFilledRows = rowsToValidate.some((row) => !isBlankRow(row));
  const mrp =
    catalogMrp === null || catalogMrp === undefined || catalogMrp === ''
      ? null
      : Number(catalogMrp);

  if (hasFilledRows && (mrp === null || !Number.isFinite(mrp) || mrp < 0)) {
    errs.push(
      `Set catalog ${SUPPLIER_MRP_LABEL} for this variant in Manage Inventory before saving Product_COV.`
    );
    return errs;
  }

  rowsToValidate.forEach((row, idx) => {
    if (isBlankRow(row)) return;
    const label = `Row ${idx + 1}`;
    const levelName = String(row.levelName || '').trim();
    if (!levelName) errs.push(`${label}: Level is required`);
    const buyerBcov = String(row.buyerBcov || '').trim();
    if (!buyerBcov) {
      errs.push(`${label}: ${SUPPLIER_COV_LABEL} is required`);
    }
    const supplierCovThreshold = parseCovThresholdNumber(buyerBcov);
    if (buyerBcov && (supplierCovThreshold === null || supplierCovThreshold < 0)) {
      errs.push(`${label}: ${SUPPLIER_COV_LABEL} must be 0 or more`);
    }

    const buyerCov = Number(row.buyerCov);
    if (!Number.isFinite(buyerCov) || buyerCov < 0) {
      errs.push(`${label}: ${BRAND_COV_LABEL} must be 0 or more`);
    } else if (supplierCovThreshold !== null && buyerCov >= supplierCovThreshold) {
      errs.push(`${label}: ${BRAND_COV_LABEL} must be less than ${SUPPLIER_COV_LABEL}`);
    }
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) {
      errs.push(`${label}: ${SUPPLIER_COV_PRICE_LABEL} must be 0 or more`);
    } else if (price > mrp) {
      errs.push(
        `${label}: ${formatRupee(price)} cannot be higher than catalog ${SUPPLIER_MRP_LABEL} ${formatRupee(mrp)}.`
      );
    }
    const hasBuyerPcov = String(row.buyerPcov).trim() !== '';
    if (hasBuyerPcov) {
      const buyerPcov = Number(row.buyerPcov);
      if (!Number.isFinite(buyerPcov) || buyerPcov < 0) {
        errs.push(`${label}: ${PLATFORM_COV_LABEL} must be 0 or more`);
      } else if (Number.isFinite(buyerCov) && buyerCov === buyerPcov) {
        errs.push(`${label}: ${BRAND_COV_LABEL} must not be equal to ${PLATFORM_COV_LABEL}`);
      } else if (Number.isFinite(buyerCov) && buyerCov >= buyerPcov) {
        errs.push(`${label}: ${BRAND_COV_LABEL} must be less than ${PLATFORM_COV_LABEL}`);
      } else if (supplierCovThreshold !== null && buyerPcov < supplierCovThreshold) {
        errs.push(`${label}: ${PLATFORM_COV_LABEL} must be greater than or equal to ${SUPPLIER_COV_LABEL}`);
      }
    }
  });
  return errs;
};

const SupplierBCOV = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([createDefaultRow(0)]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [isStepCompleted, setIsStepCompleted] = useState(false);
  const [catalogMrp, setCatalogMrp] = useState(null);
  const [covEligible, setCovEligible] = useState(true);
  const [covBlockedMessage, setCovBlockedMessage] = useState('');

  const { variantKey, variantAsin, variantName, supplierProductId } = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return {
      variantKey: String(params.get('variantKey') || '').trim(),
      variantAsin: String(params.get('variantAsin') || '').trim(),
      variantName: String(
        params.get('variantName') || params.get('productName') || params.get('brand') || ''
      ).trim(),
      supplierProductId: String(
        params.get('supplierProductId') || params.get('supplier_product_id') || ''
      ).trim()
    };
  }, [location.search]);

  const validationErrors = useMemo(
    () => getValidationErrorsForRows(rows, catalogMrp),
    [rows, catalogMrp]
  );

  const loadRows = async ({ silent = false } = {}) => {
    if (!variantKey) {
      if (!silent) setLoading(false);
      return false;
    }
    try {
      if (!silent) {
        setLoading(true);
        // Never flash previous variant's Product_COV while the next offer loads.
        setRows([createDefaultRow(0)]);
        setIsStepCompleted(false);
      }
      const token = localStorage.getItem('token');
      const query = new URLSearchParams({ variantKey });
      if (supplierProductId) query.set('supplierProductId', supplierProductId);
      const res = await fetch(
        getApiUrl(`/api/supplier/bcov-levels?${query.toString()}`),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.status === 'success') {
        const mrp =
          data.catalogMrp === null || data.catalogMrp === undefined
            ? null
            : Number(data.catalogMrp);
        setCatalogMrp(Number.isFinite(mrp) && mrp >= 0 ? mrp : null);
        const eligible = data.covEligible !== false;
        setCovEligible(eligible);
        setCovBlockedMessage(
          eligible
            ? ''
            : String(
                data.covBlockedMessage ||
                  'This product is not eligible for Product_COV configuration yet.'
              )
        );

        const mapped = (data.levels || []).map((item, index) => ({
          id: item.id || null,
          levelName: String(item.levelName || '').trim() || `Level ${index + 1}`,
          buyerBcov: item.buyerBcov ?? '',
          buyerCov: item.buyerCov ?? item.minPurchaseQty ?? '',
          buyerPcov: item.buyerPcov ?? item.maxPurchaseQty ?? '',
          price: item.price ?? ''
        }));
        setRows(mapped.length > 0 ? mapped : [createDefaultRow(0)]);
        setIsStepCompleted(mapped.length > 0);
        return true;
      }
      alert(data.message || 'Failed to load Product_COV table');
      return false;
    } catch (e) {
      console.error('Failed to load Product_COV table:', e);
      alert('Failed to load Product_COV table');
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [variantKey, supplierProductId]);

  const updateRow = (index, key, value) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, createDefaultRow(prev.length)]);
  };

  const buildPayloadRows = (rowsToSend) =>
    rowsToSend
      .filter((row) => !isBlankRow(row))
      .map((row) => ({
        id: row.id || undefined,
        variantKey,
        variantAsin: variantAsin || undefined,
        variantName: variantName || undefined,
        levelName: String(row.levelName || '').trim() || null,
        buyerBcov: String(row.buyerBcov || '').trim() || null,
        buyerCov: Number(row.buyerCov),
        buyerPcov: String(row.buyerPcov).trim() === '' ? null : Number(row.buyerPcov),
        price: Number(row.price)
      }));

  const persistRows = async (rowsToSend, { showSuccess = false } = {}) => {
    if (!variantKey) {
      return { ok: false };
    }
    if (!covEligible) {
      alert(
        covBlockedMessage ||
          'Inventory completion is required before Product COV. Complete all mandatory Inventory details in Manage Inventory, then try again.'
      );
      return { ok: false };
    }

    const filledRows = rowsToSend.filter((row) => !isBlankRow(row));
    if (filledRows.length > 0) {
      const errs = getValidationErrorsForRows(rowsToSend, catalogMrp);
      if (errs.length > 0) {
        alert(errs[0]);
        return { ok: false };
      }
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/bcov-levels'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          variantKey,
          variantAsin: variantAsin || undefined,
          variantName: variantName || undefined,
          supplierProductId: supplierProductId || undefined,
          levels: buildPayloadRows(rowsToSend)
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        if (showSuccess) {
          setSaveMessage('Product_COV table saved successfully.');
        } else {
          setSaveMessage('');
        }
        setIsStepCompleted(filledRows.length > 0);
        return { ok: true, data };
      }
      alert(data.message || 'Failed to save Product_COV table');
      return { ok: false };
    } catch (e) {
      console.error('Failed to save Product_COV table:', e);
      alert('Failed to save Product_COV table');
      return { ok: false };
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (index) => {
    let nextRows;
    setRows((prev) => {
      if (prev.length === 1) {
        nextRows = [createDefaultRow(0)];
        return nextRows;
      }
      nextRows = prev.filter((_, i) => i !== index);
      if (nextRows.length === 0) {
        nextRows = [createDefaultRow(0)];
      } else {
        // Keep Level labels sequential after delete when they still use defaults.
        nextRows = nextRows.map((row, i) =>
          isDefaultLevelName(row.levelName) ? { ...row, levelName: `Level ${i + 1}` } : row
        );
      }
      return nextRows;
    });

    const result = await persistRows(nextRows);
    if (!result.ok) {
      await loadRows({ silent: true });
      return;
    }
    await loadRows({ silent: true });
  };

  const handleSave = async () => {
    if (!variantKey) {
      alert('No variant selected. Please open this page from a product variant.');
      return;
    }
    if (!covEligible) {
      alert(
        covBlockedMessage ||
          'This product is not eligible for Product_COV configuration yet.'
      );
      return;
    }
    if (validationErrors.length > 0) {
      alert(validationErrors[0]);
      return;
    }

    const result = await persistRows(rows, { showSuccess: true });
    if (result.ok) {
      await loadRows();
    }
  };

  if (!variantKey) {
    return (
      <div className="dashboard-container bcov-page">
        <div className="dashboard-header">
          <h1>Product_COV</h1>
        </div>
        <div className="bcov-empty">
          <p>No variant selected. Please open this page from a product variant to set pricing levels.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading Product_COV table...</p>
      </div>
    );
  }

  if (!covEligible) {
    return (
      <div className="dashboard-container bcov-page">
        <div className="dashboard-header">
          <div>
            <h1>Product_COV</h1>
            <p className="bcov-subtitle">
              Variant: <strong>{variantName || variantKey}</strong>
            </p>
          </div>
        </div>
        <div className="bcov-empty">
          <p>
            {covBlockedMessage ||
              'This product is rejected. Correct it and wait for admin approval before configuring Product_COV.'}
          </p>
          {/inventory/i.test(String(covBlockedMessage || '')) ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate('/manage-inventory')}
              style={{ marginTop: '1rem' }}
            >
              Go to Manage Inventory
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container bcov-page">
      <div className="dashboard-header">
        <div>
          <h1>Product_COV</h1>
          <p className="bcov-subtitle">
            Set pricing levels for variant:{' '}
            <strong>{variantName || variantKey}</strong>
            {variantAsin ? (
              <span style={{ marginLeft: '0.5rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.85em', color: '#6366f1', fontWeight: 600 }}>
                [{variantAsin}]
              </span>
            ) : null}
          </p>
          <p className="bcov-subtitle" style={{ fontSize: '0.8rem', opacity: 0.7 }}>
            Variant Key: {variantKey}{variantAsin ? ` | TSIN: ${variantAsin}` : ''}
          </p>
          {catalogMrp != null ? (
            <p className="bcov-catalog-mrp">
              Catalog {SUPPLIER_MRP_LABEL} for this variant:{' '}
              <strong>{formatRupee(catalogMrp)}</strong>
              {' '}— each level {SUPPLIER_COV_PRICE_LABEL} must be at or below this amount.
            </p>
          ) : (
            <p className="bcov-catalog-mrp bcov-catalog-mrp--missing">
              Catalog {SUPPLIER_MRP_LABEL} is not set for this variant. Add it in Manage Inventory before
              saving Product_COV.
            </p>
          )}
          <SupplierProductAdditionSteps
            variant={saveMessage || isStepCompleted ? 'bcov-done' : 'bcov'}
            hint="Step 3 of 3: save Product_COV table for this variant to complete product setup for pricing on purchase orders."
          />
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Product_COV Table'}
        </button>
      </div>

      {saveMessage && <div className="bcov-success-banner">{saveMessage}</div>}

      <div className="dashboard-section bcov-card">
        <div className="section-header">
          <h2>
            {variantName || variantKey}
            {variantAsin ? (
              <span style={{ marginLeft: '0.5rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.7em', color: '#6366f1', fontWeight: 500 }}>
                [{variantAsin}]
              </span>
            ) : null}
          </h2>
          <button className="btn-secondary" onClick={addRow}>
            <Plus size={16} />
            Add Level
          </button>
        </div>

        <div className="bcov-table-wrap">
          <table className="order-items-table bcov-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>{SUPPLIER_COV_FIELD_LABEL}</th>
                <th>{BRAND_COV_FIELD_LABEL}</th>
                <th>{PLATFORM_COV_FIELD_LABEL}</th>
                <th>{SUPPLIER_COV_PRICE_FIELD_LABEL}</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.id || 'new'}-${index}`}>
                  <td>
                    <input
                      className="bcov-input"
                      type="text"
                      value={row.levelName}
                      onChange={(e) => updateRow(index, 'levelName', e.target.value)}
                      placeholder="e.g. Level 1"
                    />
                  </td>
                  <td>
                    <RupeeInput
                      className="bcov-rupee-input"
                      inputClassName="bcov-input"
                      type="text"
                      inputMode="decimal"
                      value={row.buyerBcov}
                      onChange={(e) => updateRow(index, 'buyerBcov', e.target.value)}
                      aria-label={SUPPLIER_COV_FIELD_LABEL}
                    />
                  </td>
                  <td>
                    <RupeeInput
                      className="bcov-rupee-input"
                      inputClassName="bcov-input"
                      type="number"
                      min="0"
                      step="1"
                      value={row.buyerCov}
                      onChange={(e) => updateRow(index, 'buyerCov', e.target.value)}
                      aria-label={BRAND_COV_FIELD_LABEL}
                    />
                  </td>
                  <td>
                    <RupeeInput
                      className="bcov-rupee-input"
                      inputClassName="bcov-input"
                      type="number"
                      min="0"
                      step="1"
                      value={row.buyerPcov}
                      onChange={(e) => updateRow(index, 'buyerPcov', e.target.value)}
                      aria-label={PLATFORM_COV_FIELD_LABEL}
                    />
                  </td>
                  <td>
                    <RupeeInput
                      className="bcov-rupee-input"
                      inputClassName="bcov-input"
                      type="number"
                      min="0"
                      max={catalogMrp != null ? catalogMrp : undefined}
                      step="0.01"
                      value={row.price}
                      onChange={(e) => updateRow(index, 'price', e.target.value)}
                      aria-label={SUPPLIER_COV_PRICE_FIELD_LABEL}
                      title={
                        catalogMrp != null
                          ? `Max ${SUPPLIER_COV_PRICE_LABEL}: catalog ${SUPPLIER_MRP_LABEL} ${formatRupee(catalogMrp)}`
                          : undefined
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="btn-icon bcov-delete-btn"
                      onClick={() => removeRow(index)}
                      disabled={saving}
                      title="Delete row"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {validationErrors.length > 0 && (
          <div className="bcov-error">
            {validationErrors[0]}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierBCOV;
