import React, { useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { Save, Plus, Trash2 } from 'lucide-react';
import './Dashboard.css';
import './SupplierBCOV.css';
import { useLocation } from 'react-router-dom';
import SupplierProductAdditionSteps from '../components/SupplierProductAdditionSteps';

const EMPTY_ROW = {
  id: null,
  levelName: '',
  buyerBcov: '',
  buyerCov: '',
  buyerPcov: '',
  price: ''
};

const isBlankRow = (row) => {
  if (!row) return true;
  return (
    String(row.levelName || '').trim() === '' &&
    String(row.buyerBcov || '').trim() === '' &&
    String(row.buyerCov || '').trim() === '' &&
    String(row.buyerPcov || '').trim() === '' &&
    String(row.price || '').trim() === ''
  );
};

const getValidationErrorsForRows = (rowsToValidate) => {
  const errs = [];
  rowsToValidate.forEach((row, idx) => {
    if (isBlankRow(row)) return;
    const label = `Row ${idx + 1}`;
    const levelName = String(row.levelName || '').trim();
    if (!levelName) errs.push(`${label}: Level is required`);
    const buyerBcov = String(row.buyerBcov || '').trim();
    if (!buyerBcov) errs.push(`${label}: Supplier_COV is required`);

    const buyerCov = Number(row.buyerCov);
    if (!Number.isFinite(buyerCov) || buyerCov < 0) {
      errs.push(`${label}: Brand_cov must be 0 or more`);
    }
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) {
      errs.push(`${label}: Price must be 0 or more`);
    }
    const hasBuyerPcov = String(row.buyerPcov).trim() !== '';
    if (hasBuyerPcov) {
      const buyerPcov = Number(row.buyerPcov);
      if (!Number.isFinite(buyerPcov) || buyerPcov <= buyerCov) {
        errs.push(`${label}: Platform_COV must be greater than Brand_cov`);
      }
    }
  });
  return errs;
};

const SupplierBCOV = () => {
  const location = useLocation();
  const [rows, setRows] = useState([{ ...EMPTY_ROW }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [isStepCompleted, setIsStepCompleted] = useState(false);

  const { variantKey, variantAsin, variantName } = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return {
      variantKey: String(params.get('variantKey') || params.get('variantAsin') || '').trim(),
      variantAsin: String(params.get('variantAsin') || '').trim(),
      variantName: String(
        params.get('variantName') || params.get('productName') || params.get('brand') || ''
      ).trim()
    };
  }, [location.search]);

  const validationErrors = useMemo(() => getValidationErrorsForRows(rows), [rows]);

  const loadRows = async () => {
    if (!variantKey) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch(
        getApiUrl(`/api/supplier/bcov-levels?variantKey=${encodeURIComponent(variantKey)}`),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.status === 'success') {
        const mapped = (data.levels || []).map((item) => ({
          id: item.id || null,
          levelName: item.levelName ?? '',
          buyerBcov: item.buyerBcov ?? '',
          buyerCov: item.buyerCov ?? item.minPurchaseQty ?? '',
          buyerPcov: item.buyerPcov ?? item.maxPurchaseQty ?? '',
          price: item.price ?? ''
        }));
        setRows(mapped.length > 0 ? mapped : [{ ...EMPTY_ROW, levelName: 'Level 1' }]);
        setIsStepCompleted(mapped.length > 0);
      } else {
        alert(data.message || 'Failed to load Product_COV table');
      }
    } catch (e) {
      console.error('Failed to load Product_COV table:', e);
      alert('Failed to load Product_COV table');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [variantKey]);

  const updateRow = (index, key, value) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { ...EMPTY_ROW, levelName: `Level ${prev.length + 1}` }
    ]);
  };

  const removeRow = (index) => {
    setRows((prev) => {
      if (prev.length === 1) return [{ ...EMPTY_ROW }];
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSave = async () => {
    if (!variantKey) {
      alert('No variant selected. Please open this page from a product variant.');
      return;
    }
    if (validationErrors.length > 0) {
      alert(validationErrors[0]);
      return;
    }

    const payloadRows = rows.filter((row) => !isBlankRow(row)).map((row) => ({
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
          levels: payloadRows
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setSaveMessage('Product_COV table saved successfully.');
        setIsStepCompleted(true);
        await loadRows();
      } else {
        alert(data.message || 'Failed to save Product_COV table');
      }
    } catch (e) {
      console.error('Failed to save Product_COV table:', e);
      alert('Failed to save Product_COV table');
    } finally {
      setSaving(false);
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

  return (
    <div className="dashboard-container bcov-page">
      <div className="dashboard-header">
        <div>
          <h1>Product_COV</h1>
          <p className="bcov-subtitle">
            Set pricing levels for variant: <strong>{variantName || variantKey}</strong>
          </p>
          <p className="bcov-subtitle" style={{ fontSize: '0.8rem', opacity: 0.7 }}>
            Variant Key: {variantKey}{variantAsin ? ` | ASIN: ${variantAsin}` : ''}
          </p>
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
          <h2>{variantName || variantKey}</h2>
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
                <th>Supplier_COV</th>
                <th>Brand_cov</th>
                <th>Platform_COV</th>
                <th>Price (INR)</th>
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
                    <input
                      className="bcov-input"
                      type="text"
                      value={row.buyerBcov}
                      onChange={(e) => updateRow(index, 'buyerBcov', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="bcov-input"
                      type="number"
                      min="0"
                      step="1"
                      value={row.buyerCov}
                      onChange={(e) => updateRow(index, 'buyerCov', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="bcov-input"
                      type="number"
                      min="0"
                      step="1"
                      value={row.buyerPcov}
                      onChange={(e) => updateRow(index, 'buyerPcov', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="bcov-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.price}
                      onChange={(e) => updateRow(index, 'price', e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-icon bcov-delete-btn"
                      onClick={() => removeRow(index)}
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
