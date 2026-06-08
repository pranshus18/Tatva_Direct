import React, { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import { useNavigate } from 'react-router-dom';
import { Package, MapPin, Box, Save, ArrowRight, Sparkles } from 'lucide-react';
import {
  applyExtractResultToSpecs,
  extractSpecificationsFromDescription
} from '../utils/extractSpecificationsApi';
import { parseSpecInputToValue, specValueToInput } from '../utils/specifications';
import tatvaLogo from '../images/tatva_d.png';
import SupplierProductAdditionSteps from '../components/SupplierProductAdditionSteps';
import {
  SUPPLIER_CURRENT_STOCK_LABEL,
  SUPPLIER_MRP_FIELD_LABEL,
  SUPPLIER_MRP_LABEL
} from '../utils/supplierStockLabel';
import { formatRupee } from '../utils/formatRupee';
import RupeeInput from '../components/RupeeInput';
import BrandSelect from '../components/BrandSelect';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import './Auth.css';
import './SupplierProductSetup.css';

const IGST_OPTIONS = ['0', '5', '12', '18', '28'];
const CGST_SGST_OPTIONS = ['0', '2.5', '6', '9', '14'];

const SupplierProductSetup = ({ user }) => {
  const [formData, setFormData] = useState({
    name: '', // Product name, not supplier name
    brand: '',
    gtin: '',
    hsnCode: '',
    gsku: '', // internal / shelf code for POS when different from GTIN
    mpn: '',
    category: 'steel',
    price: '',
    unit: 'kg',
    stock: '',
    location: '',
    outlet_id: '',
    igst_rate: '',
    cgst_rate: '',
    sgst_rate: '',
    description: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState([]);
  const [recommendedPrice, setRecommendedPrice] = useState(null);
  const [recommendedPriceStats, setRecommendedPriceStats] = useState(null);
  const [priceTouched, setPriceTouched] = useState(false);
  const [lockedPrice, setLockedPrice] = useState(null);
  const [priceLocked, setPriceLocked] = useState(false);
  const [specifications, setSpecifications] = useState({});
  const [isEditingSpecValues, setIsEditingSpecValues] = useState(false);
  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const [categories, setCategories] = useState([]);
  const [extractingSpecs, setExtractingSpecs] = useState(false);
  const navigate = useNavigate();

  const handleExtractSpecifications = async () => {
    if (!formData.description?.trim()) {
      setError('Enter a description with specification details first (e.g. Finish: Matt, Volume: 20L).');
      return;
    }
    if (!formData.category?.trim()) {
      setError('Select a category before extracting specifications.');
      return;
    }

    setExtractingSpecs(true);
    setError('');
    try {
      const { response, data } = await extractSpecificationsFromDescription({
        description: formData.description,
        category: formData.category,
        productName: formData.name,
        existingSpecifications: specifications || {}
      });

      if (!response.ok && data?.status !== 'success' && data?.status !== 'warning') {
        throw new Error(data?.message || 'Extraction failed');
      }

      const result = applyExtractResultToSpecs(specifications || {}, data);
      if (!result.ok) {
        setError(result.warning || result.error || 'Could not extract specifications.');
        return;
      }

      setSpecifications(result.merged);
      if (result.filledCount === 0) {
        setError('No values found in description. Use key: value lines.');
      }
    } catch (err) {
      setError(err.message || 'Failed to extract specifications from description.');
    } finally {
      setExtractingSpecs(false);
    }
  };

  const handleChange = (e) => {
    if (e.target?.name === 'price') {
      setPriceTouched(true);
    }
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const addSpecificationKey = () => {
    setSpecifications((prev) => {
      const next = { ...(prev || {}) };
      let idx = 1;
      let candidate = 'new_spec';
      while (Object.prototype.hasOwnProperty.call(next, candidate)) {
        idx += 1;
        candidate = `new_spec_${idx}`;
      }
      next[candidate] = '';
      return next;
    });
  };

  const renameSpecificationKey = (oldKey, nextKeyRaw) => {
    const nextKey = String(nextKeyRaw || '').trim();
    if (!nextKey || nextKey === oldKey) return;
    setSpecifications((prev) => {
      const current = { ...(prev || {}) };
      if (!Object.prototype.hasOwnProperty.call(current, oldKey)) return prev;
      const oldValue = current[oldKey];
      delete current[oldKey];
      if (Object.prototype.hasOwnProperty.call(current, nextKey)) {
        const existingValue = current[nextKey];
        current[nextKey] = existingValue === '' || existingValue == null ? oldValue : existingValue;
      } else {
        current[nextKey] = oldValue;
      }
      return current;
    });
  };

  const removeSpecificationKey = (keyToRemove) => {
    setSpecifications((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, keyToRemove)) return prev;
      const next = { ...prev };
      delete next[keyToRemove];
      return next;
    });
  };

  const updateSpecificationValue = (specKey, nextValueRaw) => {
    setSpecifications((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, specKey)) return prev;
      return {
        ...prev,
        [specKey]: parseSpecInputToValue(nextValueRaw, prev[specKey])
      };
    });
  };

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(getApiUrl('/api/supplier/categories'), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.status === 'success') {
          setCategories(data.categories || []);
        }
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    };
    fetchCategories();
  }, []);

  // Fetch locations from profile on mount
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(getApiUrl('/api/supplier/locations'), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await response.json();
        if (data.status === 'success') {
          setLocations(data.locations || []);
        }
      } catch (error) {
        console.error('Failed to fetch locations:', error);
      }
    };
    fetchLocations();
  }, []);

  // Auto-fill unit when product name + category match an existing product
  useEffect(() => {
    const name = (formData.name || '').trim();
    const category = (formData.category || '').trim();
    const brand = (formData.brand || '').trim();
    if (!name || !category) return;

    const timeout = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const lookupParams = new URLSearchParams({ name, category });
        if (brand) lookupParams.set('brand', brand);
        const res = await fetch(
          getApiUrl(`/api/supplier/products/lookup?${lookupParams.toString()}`),
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const data = await res.json();
        if (data.status === 'success' && data.found && data.unit) {
          setFormData(prev => ({ ...prev, unit: data.unit }));
        }
        if (
          data.status === 'success' &&
          data.specifications &&
          typeof data.specifications === 'object' &&
          !Array.isArray(data.specifications) &&
          Object.keys(data.specifications).length > 0
        ) {
          setSpecifications(data.specifications);
        }
        if (data.status === 'success' && data.found) {
          const hasLockedPrice =
            data.priceLocked === true &&
            typeof data.lockedPrice === 'number' &&
            Number.isFinite(data.lockedPrice);
          setPriceLocked(hasLockedPrice);
          setLockedPrice(hasLockedPrice ? data.lockedPrice : null);
          setRecommendedPrice(
            typeof data.recommendedPrice === 'number' ? data.recommendedPrice : null
          );
          setRecommendedPriceStats(data.priceStats || null);
          if (hasLockedPrice) {
            setFormData(prev => ({ ...prev, price: String(Number(data.lockedPrice).toFixed(2)) }));
          } else if (!priceTouched && (formData.price === '' || formData.price === null || formData.price === undefined)) {
            // Prefill price only if supplier hasn't typed it yet
            if (typeof data.recommendedPrice === 'number' && Number.isFinite(data.recommendedPrice)) {
              setFormData(prev => ({ ...prev, price: String(Number(data.recommendedPrice).toFixed(2)) }));
            }
          }
        } else {
          setPriceLocked(false);
          setLockedPrice(null);
          setRecommendedPrice(null);
          setRecommendedPriceStats(null);
        }
      } catch (e) {
        // silent
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [formData.name, formData.category, formData.brand]);

  // Load admin-defined specs for selected category + product/model hint.
  useEffect(() => {
    const category = String(formData.category || '').trim().toLowerCase();
    const modelHint = String(formData.name || '').trim();
    const brand = String(formData.brand || '').trim();
    if (!category) {
      setSpecifications({});
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        setLoadingSpecs(true);
        const token = localStorage.getItem('token');
        const queryParams = new URLSearchParams();
        if (modelHint) queryParams.set('model', modelHint);
        if (brand) queryParams.set('brand', brand);
        const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
        const resp = await fetch(
          getApiUrl(`/api/supplier/categories/${encodeURIComponent(category)}/specifications${query}`),
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-cache'
          }
        );
        if (!resp.ok) {
          return;
        }
        const data = await resp.json();
        const specsObj =
          data?.status === 'success' && data?.specifications && typeof data.specifications === 'object'
            ? data.specifications
            : {};
        // IMPORTANT: never wipe existing filled specs when template is empty.
        setSpecifications((prev) => {
          const prevObj = prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {};
          const keys = Object.keys(specsObj || {});
          if (keys.length === 0) return { ...prevObj };
          const next = { ...prevObj };
          keys.forEach((k) => {
            if (!Object.prototype.hasOwnProperty.call(next, k)) {
              next[k] = specsObj[k];
            }
          });
          return next;
        });
      } catch (_err) {
        // Keep whatever we already have (e.g. from lookup); don't wipe on network/template errors.
      } finally {
        setLoadingSpecs(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [formData.category, formData.name, formData.brand]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate required fields
    if (
      !formData.name ||
      !formData.price ||
      !formData.stock ||
      !formData.location ||
      !formData.igst_rate ||
      !formData.cgst_rate ||
      !formData.sgst_rate
    ) {
      setError('Please fill in all required fields');
      setLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/products'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: formData.name,
          brand: formData.brand || '',
          gtin: formData.gtin || '',
          hsnCode: (formData.hsnCode || '').trim(),
          gsku: (formData.gsku || '').trim(),
          mpn: formData.mpn || '',
          category: formData.category,
          price: parseFloat(formData.price),
          unit: formData.unit,
          stock: parseSupplierStockQuantity(formData.stock) ?? 0,
          location: formData.location,
          outlet_id: formData.outlet_id || null,
          igst_rate: parseFloat(formData.igst_rate),
          cgst_rate: parseFloat(formData.cgst_rate),
          sgst_rate: parseFloat(formData.sgst_rate),
          description: formData.description || ''
          ,
          specifications
        })
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        const nextBrand = String(data?.nextStep?.brand || formData.brand || '').trim();
        const nextProductName = String(data?.nextStep?.productName || formData.name || '').trim();
        const params = new URLSearchParams();
        if (data?.nextStep?.variantAsin) params.set('variantAsin', data.nextStep.variantAsin);
        if (data?.nextStep?.variantKey) params.set('variantKey', data.nextStep.variantKey);
        if (data?.nextStep?.supplierProductId) params.set('supplierProductId', data.nextStep.supplierProductId);
        if (nextProductName) params.set('variantName', nextProductName);
        if (nextBrand) params.set('brand', nextBrand);
        if (nextProductName) params.set('productName', nextProductName);
        params.set('from', 'product-setup');

        alert('Inventory saved. Final step: set ProductCOV levels for this product variant.');
        navigate(`/supplier-bcov?${params.toString()}`);
      } else {
        if (response.status === 403 && data?.code === 'brand_approval_required') {
          setError(
            data?.message ||
              'Brand approval is required before you can submit products for approval. Please wait for admin approval.'
          );
        } else if (response.status === 403 && data?.code === 'brand_workflow_not_ready') {
          setError(data?.message || 'Brand approval workflow is not available yet. Please contact admin.');
        } else {
          setError(data.message || 'Failed to save product information');
        }
      }
    } catch (error) {
      console.error('Error saving product:', error);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card setup-card">
        <div className="auth-header">
          <img src={tatvaLogo} alt="Tatva Direct" className="auth-logo" />
          <h1>Welcome to Tatva Direct!</h1>
          <p>Let's set up your first product to get started</p>
        </div>

        <SupplierProductAdditionSteps
          variant="product-inventory"
          compact
          hint="Steps 1 & 2: enter product details and inventory below. After save, you will set ProductCOV (step 3) so the product is fully onboarded."
        />

        <form onSubmit={handleSubmit} className="auth-form setup-form">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {user?.name && (
            <div className="form-group" style={{ 
              padding: '1rem', 
              backgroundColor: '#f0f9ff', 
              borderRadius: '8px', 
              marginBottom: '1.5rem',
              border: '1px solid #bae6fd'
            }}>
              <label style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
                Supplier Information
              </label>
              <p style={{ fontSize: '1rem', fontWeight: '600', color: '#1e40af', margin: 0 }}>
                {user.name}
                {user.company && ` • ${user.company}`}
              </p>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="name">
              <Package size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
              Product Name *
            </label>
            <div className="input-wrapper">
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="What product do you want to sell?"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="brand">Brand</label>
            <BrandSelect
              id="brand"
              name="brand"
              value={formData.brand}
              onChange={(brand) => setFormData((prev) => ({ ...prev, brand }))}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="gtin">GTIN / UPC / EAN (retail barcode)</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  id="gtin"
                  name="gtin"
                  value={formData.gtin}
                  onChange={handleChange}
                  placeholder="8/12/13/14 digit code"
                  inputMode="numeric"
                />
              </div>
              <p className="field-hint" style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: '#64748b' }}>
                Use the same value you scan in Offline Product Sell (GSKU mode). It is stored as GTIN and matched at the register.
              </p>
            </div>
            <div className="form-group">
              <label htmlFor="hsnCode">HSN Code (for exact GST)</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  id="hsnCode"
                  name="hsnCode"
                  value={formData.hsnCode}
                  onChange={handleChange}
                  placeholder="e.g. 7214, 2523, 2505"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="mpn">MPN / Model Number</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  id="mpn"
                  name="mpn"
                  value={formData.mpn}
                  onChange={handleChange}
                  placeholder="Manufacturer part number"
                />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="gsku">Internal code / GSKU (optional)</label>
            <div className="input-wrapper">
              <input
                type="text"
                id="gsku"
                name="gsku"
                value={formData.gsku}
                onChange={handleChange}
                placeholder="Shelf or warehouse code if not the same as GTIN"
              />
            </div>
            <p className="field-hint" style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: '#64748b' }}>
              If your offline labels use a different code than the retail barcode, enter it here and choose GSKU mode at the register.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="category">Category *</label>
            <div className="input-wrapper">
              <select
                id="category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                required
                className="select-input"
              >
                {categories.length > 0 ? (
                  categories.map((cat) => (
                    <option key={cat.name} value={cat.name}>
                      {cat.displayName || cat.name}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="steel">Steel & Metal</option>
                    <option value="cement">Cement & Concrete</option>
                    <option value="aggregates">Aggregates</option>
                    <option value="masonry">Masonry</option>
                    <option value="electrical">Electrical</option>
                    <option value="plumbing">Plumbing</option>
                    <option value="paint">Paint</option>
                    <option value="hardware">Hardware</option>
                    <option value="other">Other</option>
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="price">
                {SUPPLIER_MRP_FIELD_LABEL} *
              </label>
              <RupeeInput
                type="number"
                id="price"
                name="price"
                value={formData.price}
                onChange={handleChange}
                placeholder="0.00"
                min="0"
                step="0.01"
                required
                readOnly={priceLocked}
              />
                {priceLocked && typeof lockedPrice === 'number' && Number.isFinite(lockedPrice) && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: '#16a34a' }}>
                    Variant MRP is locked for all suppliers: <strong>{formatRupee(lockedPrice, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                )}
                {typeof recommendedPrice === 'number' && Number.isFinite(recommendedPrice) && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: '#0369a1' }}>
                    Recommended avg {SUPPLIER_MRP_LABEL}: <strong>{formatRupee(recommendedPrice, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    {recommendedPriceStats?.supplierCountOthers > 0 && (
                      <span style={{ color: '#64748b' }}>
                        {' '}({recommendedPriceStats.supplierCountOthers} other supplier{recommendedPriceStats.supplierCountOthers > 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                )}
            </div>

            <div className="form-group">
              <label htmlFor="unit">Unit *</label>
              <div className="input-wrapper">
                <select
                  id="unit"
                  name="unit"
                  value={formData.unit}
                  onChange={handleChange}
                  required
                  className="select-input"
                >
                  <option value="kg">Kilogram (kg)</option>
                  <option value="ton">Ton</option>
                  <option value="bag">Bag</option>
                  <option value="cft">Cubic Feet (cft)</option>
                  <option value="nos">Numbers (nos)</option>
                  <option value="sqft">Square Feet (sqft)</option>
                  <option value="meter">Meter</option>
                  <option value="liter">Liter</option>
                </select>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="stock">
              <Box size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
              {SUPPLIER_CURRENT_STOCK_LABEL} *
            </label>
            <div className="input-wrapper">
              <input
                type="number"
                id="stock"
                name="stock"
                value={formData.stock}
                onChange={handleChange}
                placeholder="How many units are available?"
                min="0"
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="sgst_rate">SGST *</label>
              <div className="input-wrapper">
                <select
                  id="sgst_rate"
                  name="sgst_rate"
                  value={formData.sgst_rate}
                  onChange={handleChange}
                  required
                  className="select-input"
                >
                  <option value="">Select SGST rate</option>
                  {CGST_SGST_OPTIONS.map((rate) => (
                    <option key={rate} value={rate}>{rate}%</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="cgst_rate">CGST *</label>
              <div className="input-wrapper">
                <select
                  id="cgst_rate"
                  name="cgst_rate"
                  value={formData.cgst_rate}
                  onChange={handleChange}
                  required
                  className="select-input"
                >
                  <option value="">Select CGST rate</option>
                  {CGST_SGST_OPTIONS.map((rate) => (
                    <option key={rate} value={rate}>{rate}%</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="igst_rate">IGST *</label>
              <div className="input-wrapper">
                <select
                  id="igst_rate"
                  name="igst_rate"
                  value={formData.igst_rate}
                  onChange={handleChange}
                  required
                  className="select-input"
                >
                  <option value="">Select IGST rate</option>
                  {IGST_OPTIONS.map((rate) => (
                    <option key={rate} value={rate}>{rate}%</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="location">
              <MapPin size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
              Your Location *
            </label>
            <div className="input-wrapper">
              {locations.length > 0 ? (
                <select
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    const loc = locations.find(l => String(l.id) === selectedId);
                    setFormData(prev => ({
                      ...prev,
                      outlet_id: loc && loc.type === 'outlet' ? loc.id : '',
                      location: loc ? (loc.fullText || loc.displayText || '') : ''
                    }));
                    setError('');
                  }}
                  required
                  className="select-input"
                >
                  <option value="">Select a location/outlet from your profile</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.fullText || loc.displayText}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ 
                  padding: '0.75rem', 
                  backgroundColor: '#fef3c7', 
                  border: '1px solid #fbbf24',
                  borderRadius: '8px',
                  color: '#92400e',
                  fontSize: '0.875rem'
                }}>
                  No locations found. Please add outlets/branch locations in your <a href="/profile" target="_blank" style={{ color: '#0369a1', textDecoration: 'underline' }}>profile</a> first.
                </div>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="description">Description (Optional)</label>
            <div className="input-wrapper">
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Add product details. Use key: value lines (e.g. Finish: Matt, Volume: 20L) then click Extract Specifications."
                rows="3"
                className="textarea-input"
              />
            </div>
            {formData.description?.trim() && formData.category?.trim() ? (
              <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExtractSpecifications}
                  disabled={extractingSpecs}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: extractingSpecs ? '#9ca3af' : '#10b981',
                    color: '#fff',
                    border: 'none',
                    padding: '0.4rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem'
                  }}
                >
                  <Sparkles size={14} />
                  {extractingSpecs ? 'Extracting…' : 'Extract Specifications (AI)'}
                </button>
              </div>
            ) : null}
          </div>

          <div className="form-group">
            <label>Specifications</label>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', background: '#f9fafb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#334155' }}>
                  Admin/product template keys are auto-loaded when available.
                </span>
                <div style={{ display: 'flex', gap: '0.45rem' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setIsEditingSpecValues((prev) => !prev)}
                  >
                    {isEditingSpecValues ? 'Lock values' : 'Edit values'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={addSpecificationKey}>
                    + Add key
                  </button>
                </div>
              </div>
              {formData.category && !loadingSpecs && Object.keys(specifications || {}).length === 0 && (
                <p style={{ margin: '0 0 0.5rem 0', color: '#92400e', fontSize: '0.82rem' }}>
                  No pre-defined specification template found yet. Add keys manually.
                </p>
              )}
              <div style={{ display: 'grid', gap: '0.55rem' }}>
                {Object.keys(specifications || {}).map((key) => (
                  <div key={key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      defaultValue={key}
                      onBlur={(e) => renameSpecificationKey(key, e.target.value)}
                      placeholder="Specification key"
                    />
                    {isEditingSpecValues ? (
                      <input
                        type="text"
                        value={specValueToInput(specifications[key])}
                        onChange={(e) => updateSpecificationValue(key, e.target.value)}
                        placeholder="Specification value"
                        style={{
                          flex: 1,
                          minHeight: '36px',
                          padding: '0.45rem 0.6rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          background: '#ffffff',
                          color: '#334155',
                          fontSize: '0.9rem'
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          flex: 1,
                          minHeight: '36px',
                          padding: '0.45rem 0.6rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          background: '#f8fafc',
                          color: '#334155',
                          fontSize: '0.9rem',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                        title={String(specifications[key] || '')}
                      >
                        {String(specifications[key] || '').trim() || '—'}
                      </div>
                    )}
                    <button type="button" className="btn-secondary" onClick={() => removeSpecificationKey(key)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? (
              <div className="spinner" />
            ) : (
              <>
                <Save size={20} />
                Save Inventory & Continue to ProductCOV
                <ArrowRight size={20} />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            You can add more products and edit this information later in your dashboard
          </p>
        </div>
      </div>
    </div>
  );
};

export default SupplierProductSetup;
