import React, { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import { useNavigate } from 'react-router-dom';
import { Package, MapPin, Box, Save, ArrowRight } from 'lucide-react';
import tatvaLogo from '../images/tatva_d.png';
import SupplierProductAdditionSteps from '../components/SupplierProductAdditionSteps';
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
  const [specifications, setSpecifications] = useState({});
  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const navigate = useNavigate();

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
    if (!name || !category) return;

    const timeout = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(
          getApiUrl(`/api/supplier/products/lookup?name=${encodeURIComponent(name)}&category=${encodeURIComponent(category)}`),
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const data = await res.json();
        if (data.status === 'success' && data.found && data.unit) {
          setFormData(prev => ({ ...prev, unit: data.unit }));
        }
        if (data.status === 'success' && data.found) {
          setRecommendedPrice(
            typeof data.recommendedPrice === 'number' ? data.recommendedPrice : null
          );
          setRecommendedPriceStats(data.priceStats || null);
          // Prefill price only if supplier hasn't typed it yet
          if (!priceTouched && (formData.price === '' || formData.price === null || formData.price === undefined)) {
            if (typeof data.recommendedPrice === 'number' && Number.isFinite(data.recommendedPrice)) {
              setFormData(prev => ({ ...prev, price: String(Number(data.recommendedPrice).toFixed(2)) }));
            }
          }
        } else {
          setRecommendedPrice(null);
          setRecommendedPriceStats(null);
        }
      } catch (e) {
        // silent
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [formData.name, formData.category]);

  // Load admin-defined specs for selected category + product/model hint.
  useEffect(() => {
    const category = String(formData.category || '').trim().toLowerCase();
    const modelHint = String(formData.name || '').trim();
    if (!category) {
      setSpecifications({});
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        setLoadingSpecs(true);
        const token = localStorage.getItem('token');
        const query = modelHint ? `?model=${encodeURIComponent(modelHint)}` : '';
        const resp = await fetch(
          getApiUrl(`/api/supplier/categories/${encodeURIComponent(category)}/specifications${query}`),
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-cache'
          }
        );
        if (!resp.ok) {
          setSpecifications({});
          return;
        }
        const data = await resp.json();
        const specsObj =
          data?.status === 'success' && data?.specifications && typeof data.specifications === 'object'
            ? data.specifications
            : {};
        setSpecifications((prev) => {
          const next = {};
          Object.keys(specsObj || {}).forEach((k) => {
            next[k] = Object.prototype.hasOwnProperty.call(prev || {}, k) ? prev[k] : specsObj[k];
          });
          return next;
        });
      } catch (_err) {
        setSpecifications({});
      } finally {
        setLoadingSpecs(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [formData.category, formData.name]);

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
          stock: parseInt(formData.stock),
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
        if (nextBrand) params.set('brand', nextBrand);
        if (nextProductName) params.set('productName', nextProductName);
        params.set('from', 'product-setup');

        alert('Inventory saved. Final step: set ProductCOV levels for this product brand.');
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
            <div className="input-wrapper">
              <input
                type="text"
                id="brand"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                placeholder="e.g. ACC, TATA"
              />
            </div>
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
                <option value="steel">Steel & Metal</option>
                <option value="cement">Cement & Concrete</option>
                <option value="aggregates">Aggregates</option>
                <option value="masonry">Masonry</option>
                <option value="electrical">Electrical</option>
                <option value="plumbing">Plumbing</option>
                <option value="hardware">Hardware</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="price">
                Price *
              </label>
              <div className="input-wrapper">
                <input
                  type="number"
                  id="price"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  required
                />
                {typeof recommendedPrice === 'number' && Number.isFinite(recommendedPrice) && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: '#0369a1' }}>
                    Recommended avg price: <strong>₹{Number(recommendedPrice).toFixed(2)}</strong>
                    {recommendedPriceStats?.supplierCountOthers > 0 && (
                      <span style={{ color: '#64748b' }}>
                        {' '}({recommendedPriceStats.supplierCountOthers} other supplier{recommendedPriceStats.supplierCountOthers > 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                )}
              </div>
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
              Available Stock *
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
                placeholder="Add any additional details about your product..."
                rows="3"
                className="textarea-input"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Specifications</label>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', background: '#f9fafb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#334155' }}>
                  Admin/product template keys are auto-loaded when available.
                </span>
                <button type="button" className="btn-secondary" onClick={addSpecificationKey}>
                  + Add key
                </button>
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
                    <input
                      type="text"
                      value={specifications[key] || ''}
                      onChange={(e) => setSpecifications((prev) => ({ ...(prev || {}), [key]: e.target.value }))}
                      placeholder="Value"
                    />
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
