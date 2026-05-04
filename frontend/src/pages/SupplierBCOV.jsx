import React, { useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { Save, Plus, Trash2, Calculator } from 'lucide-react';
import './Dashboard.css';
import './SupplierBCOV.css';
import { useLocation } from 'react-router-dom';
import SupplierProductAdditionSteps from '../components/SupplierProductAdditionSteps';

const EMPTY_ROW = {
  id: null,
  brand: '',
  levelName: '',
  buyerBcov: '',
  buyerCov: '',
  buyerPcov: '',
  price: '',
  notes: ''
};

const isBlankRow = (row) => {
  if (!row) return true;
  return (
    String(row.brand || '').trim() === '' &&
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
    const brand = String(row.brand || '').trim();
    if (!brand) errs.push(`${label}: Brand is required`);
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
  const [brandForCheck, setBrandForCheck] = useState('');
  const [purchaseQty, setPurchaseQty] = useState('');
  const [resolvedPrice, setResolvedPrice] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [handoffMessage, setHandoffMessage] = useState('');
  const [isStepCompleted, setIsStepCompleted] = useState(false);

  const currentTableKey = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(
      params.get('variantAsin') ||
      params.get('variantKey') ||
      params.get('supplierProductId') ||
      params.get('brand') ||
      params.get('productName') ||
      ''
    ).trim();
  }, [location.search]);

  const canResolve = brandForCheck.trim() && String(purchaseQty).trim() !== '';
  const brandGroups = useMemo(() => {
    const brands = [...new Set(rows.map((r) => String(r.brand || '').trim()).filter(Boolean))];
    return brands.map((brand) => ({
      brand,
      rows: rows
        .map((row, index) => ({ ...row, index }))
        .filter((row) => String(row.brand || '').trim() === brand)
    }));
  }, [rows]);

  const fallbackTableKey = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    const fromQuery = String(
      params.get('variantAsin') ||
      params.get('variantKey') ||
      params.get('supplierProductId') ||
      params.get('brand') ||
      params.get('productName') ||
      ''
    ).trim();
    if (fromQuery) return fromQuery;
    const fromRows = rows.map((r) => String(r.brand || '').trim()).find(Boolean);
    return fromRows || '';
  }, [location.search, rows]);

  const normalizedRows = useMemo(
    () =>
      rows.map((row) => {
        const currentBrand = String(row.brand || '').trim();
        if (currentBrand || !fallbackTableKey || isBlankRow(row)) return row;
        return { ...row, brand: fallbackTableKey };
      }),
    [rows, fallbackTableKey]
  );

  const validationErrors = useMemo(() => getValidationErrorsForRows(normalizedRows), [normalizedRows]);

  const loadRows = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const scopeParam = currentTableKey ? `?scopeKey=${encodeURIComponent(currentTableKey)}` : '';
      const res = await fetch(getApiUrl(`/api/supplier/bcov-levels${scopeParam}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.status === 'success') {
        const mapped = (data.levels || []).map((item) => ({
          id: item.id || null,
          brand: item.brand || '',
          levelName: item.levelName ?? '',
          buyerBcov: item.buyerBcov ?? item.notes ?? '',
          buyerCov: item.buyerCov ?? item.minPurchaseQty ?? '',
          buyerPcov: item.buyerPcov ?? item.maxPurchaseQty ?? '',
          price: item.price ?? '',
          notes: item.notes || ''
        }));
        setRows(mapped.length > 0 ? mapped : [{ ...EMPTY_ROW }]);
        const hasSavedForCurrentContext = currentTableKey
          ? mapped.some(
              (r) => String(r.brand || '').trim().toLowerCase() === currentTableKey.toLowerCase()
            )
          : mapped.some((r) => !isBlankRow(r));
        setIsStepCompleted(hasSavedForCurrentContext);
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
  }, [currentTableKey]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const brand = String(params.get('brand') || '').trim();
    const productName = String(params.get('productName') || '').trim();
    const tableKey = brand || productName;
    if (!tableKey) return;

    setHandoffMessage(
      productName
        ? `Final step for "${productName}": set Product_COV table levels.`
        : `Final step: set Product_COV table levels.`
    );

    setRows((prev) => {
      const cleaned = prev.filter((r) => !isBlankRow(r));
      const base = cleaned.length > 0 ? cleaned : [{ ...EMPTY_ROW }];
      const hasBrand = base.some(
        (r) => String(r.brand || '').trim().toLowerCase() === tableKey.toLowerCase()
      );
      if (hasBrand) return base;
      if (base.length === 1 && isBlankRow(base[0])) {
        return [
          {
            ...EMPTY_ROW,
            brand: tableKey,
            levelName: 'Level 1'
          }
        ];
      }
      return [
        ...base,
        {
          ...EMPTY_ROW,
          brand: tableKey,
          levelName: 'Level 1'
        }
      ];
    });
    setBrandForCheck(tableKey);
  }, [location.search]);

  const updateRow = (index, key, value) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  const addRow = (brand = '') => {
    setRows((prev) => [
      ...prev,
      {
        ...EMPTY_ROW,
        brand,
        levelName: brand ? `Level ${prev.filter((r) => String(r.brand || '').trim() === brand).length + 1}` : ''
      }
    ]);
  };

  const removeRow = (index) => {
    setRows((prev) => {
      if (prev.length === 1) return [{ ...EMPTY_ROW }];
      return prev.filter((_, i) => i !== index);
    });
  };

  const addBrand = () => {
    const brand = String(window.prompt('Enter variant/product/brand scope key for the new Product_COV table:') || '').trim();
    if (!brand) return;
    const alreadyExists = rows.some((r) => String(r.brand || '').trim() === brand);
    if (!alreadyExists) {
      addRow(brand);
    }
  };

  const handleSave = async () => {
    if (validationErrors.length > 0) {
      alert(validationErrors[0]);
      return;
    }

    const payloadRows = normalizedRows.filter((row) => !isBlankRow(row)).map((row) => ({
      id: row.id || undefined,
      brand: String(row.brand || '').trim(),
      levelName: String(row.levelName || '').trim() || null,
      buyerBcov: String(row.buyerBcov || '').trim() || null,
      buyerCov: Number(row.buyerCov),
      buyerPcov: String(row.buyerPcov).trim() === '' ? null : Number(row.buyerPcov),
      price: Number(row.price),
      notes: String(row.buyerBcov || '').trim() || null
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
          levels: payloadRows,
          scopeKey: currentTableKey || null
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

  const handleResolve = async () => {
    if (!canResolve) return;
    try {
      setResolving(true);
      setResolvedPrice(null);
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/bcov-levels/resolve-price'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          brand: brandForCheck.trim(),
          purchaseQty: Number(purchaseQty)
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setResolvedPrice(data.result || null);
      } else {
        alert(data.message || 'Unable to resolve Product_COV table price');
      }
    } catch (e) {
      console.error('Failed to resolve Product_COV table price:', e);
      alert('Failed to resolve Product_COV table price');
    } finally {
      setResolving(false);
    }
  };

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
            Configure Product_COV table with brand-wise quantity slabs and pricing. Like an Excel table: if purchased qty
            reaches this level, use this price.
          </p>
          <SupplierProductAdditionSteps
            variant={saveMessage || isStepCompleted ? 'bcov-done' : 'bcov'}
            hint="Step 3 of 3: save Product_COV table for each brand to complete product setup for pricing on purchase orders."
          />
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Product_COV Table'}
        </button>
      </div>

      {saveMessage && <div className="bcov-success-banner">{saveMessage}</div>}
      {handoffMessage && <div className="bcov-success-banner">{handoffMessage}</div>}

      <div className="dashboard-section bcov-card">
        <div className="section-header">
          <h2>Product_COV</h2>
          {brandGroups.length > 0 && (
            <button className="btn-secondary" onClick={addBrand}>
              <Plus size={16} />
              Add Another Product Table
            </button>
          )}
        </div>

        {brandGroups.length === 0 ? (
          <div className="bcov-empty">
            <p style={{ marginBottom: '0.75rem' }}>No product table available yet.</p>
            <button className="btn-secondary" onClick={addBrand}>
              <Plus size={16} />
              Add Product Table
            </button>
          </div>
        ) : (
          brandGroups.map((group) => (
            <div key={group.brand} className="bcov-brand-group">
              <div className="bcov-brand-group-header">
                <h3>{group.brand}</h3>
                <button className="btn-secondary" onClick={() => addRow(group.brand)}>
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
                    {group.rows.map((row) => (
                      <tr key={`${row.id || 'new'}-${row.index}`}>
                        <td>
                          <input
                            className="bcov-input"
                            type="text"
                            value={row.levelName}
                            onChange={(e) => updateRow(row.index, 'levelName', e.target.value)}
                            placeholder="e.g. Level 1"
                          />
                        </td>
                        <td>
                          <input
                            className="bcov-input"
                            type="text"
                            value={row.buyerBcov}
                            onChange={(e) => updateRow(row.index, 'buyerBcov', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="bcov-input"
                            type="number"
                            min="0"
                            step="1"
                            value={row.buyerCov}
                            onChange={(e) => updateRow(row.index, 'buyerCov', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="bcov-input"
                            type="number"
                            min="0"
                            step="1"
                            value={row.buyerPcov}
                            onChange={(e) => updateRow(row.index, 'buyerPcov', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="bcov-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.price}
                            onChange={(e) => updateRow(row.index, 'price', e.target.value)}
                          />
                        </td>
                        <td>
                          <button
                            className="btn-icon bcov-delete-btn"
                            onClick={() => removeRow(row.index)}
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
            </div>
          ))
        )}
        {validationErrors.length > 0 && (
          <div className="bcov-error">
            {validationErrors[0]}
          </div>
        )}
      </div>

      <div className="dashboard-section bcov-card">
        <div className="section-header">
          <h2>Price Checker</h2>
        </div>
        <div className="bcov-checker-grid">
          <input
            className="bcov-input"
            type="text"
            placeholder="Brand"
            value={brandForCheck}
            onChange={(e) => setBrandForCheck(e.target.value)}
          />
          <input
            className="bcov-input"
            type="number"
            min="0"
            step="1"
            placeholder="Purchase quantity"
            value={purchaseQty}
            onChange={(e) => setPurchaseQty(e.target.value)}
          />
          <button className="btn-secondary" onClick={handleResolve} disabled={!canResolve || resolving}>
            <Calculator size={16} />
            {resolving ? 'Checking...' : 'Resolve Price'}
          </button>
        </div>

        {resolvedPrice && (
          <div className={`bcov-check-result ${resolvedPrice.matched ? 'matched' : 'not-matched'}`}>
            {resolvedPrice.matched ? (
              <p>
                Matched slab: <strong>₹{Number(resolvedPrice.price).toFixed(2)}</strong> for brand{' '}
                <strong>{resolvedPrice.brand}</strong> at qty <strong>{resolvedPrice.purchaseQty}</strong>.
              </p>
            ) : (
              <p>No Product_COV table slab matched for the provided brand and quantity.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierBCOV;
