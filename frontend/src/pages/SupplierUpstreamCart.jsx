import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl, authFetch } from '../config/api';
import './Dashboard.css';
import { Pencil } from 'lucide-react';

const SUPPLIER_UPSTREAM_CART_RESUME_KEY = 'supplierUpstreamCartResumeDraft';
const emitSupplierCartUpdated = () => window.dispatchEvent(new Event('supplier-upstream-cart-updated'));

const SupplierUpstreamCart = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [selectedMine, setSelectedMine] = useState({});
  const [selectedUpstreamOffer, setSelectedUpstreamOffer] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [brandFilter, setBrandFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [products, setProducts] = useState([]);
  const [cartName, setCartName] = useState('');
  const [editingCartName, setEditingCartName] = useState(false);
  const [cartNameDraft, setCartNameDraft] = useState('');
  const [savingCartName, setSavingCartName] = useState(false);

  const productBySupplierProductId = useMemo(() => {
    const map = {};
    (products || []).forEach((p) => {
      if (p?.supplier_product_id) {
        map[p.supplier_product_id] = p;
      }
    });
    return map;
  }, [products]);

  const selectedRows = useMemo(() => {
    return Object.entries(selectedMine || {})
      .map(([mineId, qty]) => {
        const product = productBySupplierProductId[mineId];
        return {
          mineId,
          quantity: Number.isFinite(Number(qty)) && Number(qty) > 0 ? Math.floor(Number(qty)) : 1,
          product
        };
      })
      .filter((row) => row.product);
  }, [selectedMine, productBySupplierProductId]);

  const loadCart = async () => {
    setLoading(true);
    setError('');
    try {
      const [cartRes, productsRes] = await Promise.all([
        authFetch('/api/supplier/upstream/cart', { cache: 'no-cache' }),
        authFetch('/api/supplier/products', { cache: 'no-cache' })
      ]);

      const cartData = await cartRes.json();
      const productsData = await productsRes.json();

      if (!cartRes.ok || cartData.status !== 'success') {
        throw new Error(cartData.message || 'Failed to load cart');
      }
      if (!productsRes.ok || productsData.status !== 'success') {
        throw new Error(productsData.message || 'Failed to load products');
      }

      const draft = cartData?.cart?.draft && typeof cartData.cart.draft === 'object' ? cartData.cart.draft : {};
      setSelectedMine(draft.selectedMine && typeof draft.selectedMine === 'object' ? draft.selectedMine : {});
      setSelectedUpstreamOffer(
        draft.selectedUpstreamOffer && typeof draft.selectedUpstreamOffer === 'object'
          ? draft.selectedUpstreamOffer
          : {}
      );
      setSuggestions(Array.isArray(draft.suggestions) ? draft.suggestions : []);
      setBrandFilter(String(draft.brandFilter || ''));
      setSearchTerm(String(draft.searchTerm || ''));
      setCartName(String(draft.cartName || 'Supplier Cart'));
      setCartNameDraft(String(draft.cartName || 'Supplier Cart'));
      setProducts(Array.isArray(productsData.products) ? productsData.products : []);
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to load supplier cart');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCart();
  }, []);

  const persistCart = async (nextDraft, options = {}) => {
    const silent = options.silent === true;
    if (!silent) {
      setSaving(true);
    }
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(nextDraft)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to save cart');
      }
      return true;
    } catch (e) {
      setError(e.message || 'Failed to save cart');
      return false;
    } finally {
      if (!silent) {
        setSaving(false);
      }
    }
  };

  const updateQuantity = async (mineId, nextQty) => {
    const qty = Number(nextQty);
    if (!Number.isFinite(qty) || qty < 1) return;
    const nextSelectedMine = {
      ...selectedMine,
      [mineId]: Math.floor(qty)
    };
    const nextDraft = {
      selectedMine: nextSelectedMine,
      selectedUpstreamOffer,
      suggestions,
      brandFilter,
      searchTerm,
      cartName
    };
    const ok = await persistCart(nextDraft, { silent: true });
    if (ok) {
      setSelectedMine(nextSelectedMine);
      emitSupplierCartUpdated();
    }
  };

  const removeLine = async (mineId) => {
    const nextSelectedMine = { ...selectedMine };
    delete nextSelectedMine[mineId];
    const nextSelectedUpstreamOffer = { ...selectedUpstreamOffer };
    delete nextSelectedUpstreamOffer[mineId];
    const nextDraft = {
      selectedMine: nextSelectedMine,
      selectedUpstreamOffer: nextSelectedUpstreamOffer,
      suggestions,
      brandFilter,
      searchTerm,
      cartName
    };
    const ok = await persistCart(nextDraft, { silent: true });
    if (ok) {
      setSelectedMine(nextSelectedMine);
      setSelectedUpstreamOffer(nextSelectedUpstreamOffer);
      emitSupplierCartUpdated();
    }
  };

  const clearCart = async () => {
    const confirmed = window.confirm('Clear supplier cart?');
    if (!confirmed) return;
    setClearing(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to clear cart');
      }
      setSelectedMine({});
      setSelectedUpstreamOffer({});
      setSuggestions([]);
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to clear cart');
    } finally {
      setClearing(false);
    }
  };

  const continueToUpstream = () => {
    localStorage.setItem(
      SUPPLIER_UPSTREAM_CART_RESUME_KEY,
      JSON.stringify({
        selectedMine,
        selectedUpstreamOffer,
        suggestions,
        brandFilter,
        searchTerm,
        cartName
      })
    );
    navigate('/supplier-upstream');
  };

  const handleSaveCartName = async () => {
    const nextName = String(cartNameDraft || '').trim();
    if (!nextName) {
      setError('Project name cannot be empty.');
      return;
    }
    setSavingCartName(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/upstream/cart/name'), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ cartName: nextName })
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update project name');
      }
      setCartName(nextName);
      setEditingCartName(false);
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to update project name');
    } finally {
      setSavingCartName(false);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          {editingCartName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                maxLength={120}
                value={cartNameDraft}
                onChange={(e) => setCartNameDraft(e.target.value)}
                style={{ height: 38, minWidth: 260, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 0.65rem' }}
              />
              <button className="btn-primary" disabled={savingCartName} onClick={handleSaveCartName}>
                {savingCartName ? 'Saving...' : 'Save'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditingCartName(false);
                  setCartNameDraft(cartName || 'Supplier Cart');
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
              {cartName || 'Supplier Cart'}
              <button
                type="button"
                className="btn-icon"
                onClick={() => setEditingCartName(true)}
                aria-label="Edit project name"
                style={{ color: '#64748b' }}
              >
                <Pencil size={16} />
              </button>
            </h1>
          )}
          <p style={{ color: '#475569' }}>
            Review selected inventory lines, adjust quantities, and continue upstream supplier selection.
          </p>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Cart Items</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn-secondary" disabled={loading || saving} onClick={loadCart}>
                Refresh
              </button>
              <button
                className="btn-secondary"
                disabled={loading || clearing || selectedRows.length === 0}
                onClick={clearCart}
              >
                {clearing ? 'Clearing...' : 'Clear cart'}
              </button>
            </div>
          </div>

          {error ? (
            <div style={{ marginBottom: '0.9rem', color: '#b91c1c', fontWeight: 600 }}>{error}</div>
          ) : null}

          {loading ? (
            <p>Loading cart...</p>
          ) : selectedRows.length === 0 ? (
            <div className="empty-state">
              <h3>Your supplier cart is empty</h3>
              <p>Add products from Upstream Orders.</p>
              <button className="btn-primary" onClick={() => navigate('/supplier-upstream')}>
                Go to Upstream Orders
              </button>
            </div>
          ) : (
            <div className="items-list">
              {selectedRows.map((row) => {
                const mineId = row.mineId;
                const p = row.product;
                const minQty = Number(p?.min_order_quantity || 1) || 1;
                return (
                  <div key={mineId} className="item-card">
                    <div className="item-info">
                      <h4>{p?.name || 'Product'}</h4>
                      <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                        Brand: <strong>{p?.brandModel || p?.brand || 'N/A'}</strong>
                      </p>
                      <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                        Stock: <strong>{p?.stock ?? 0}</strong> | Min order: <strong>{minQty}</strong>
                      </p>
                    </div>
                    <div className="item-status" style={{ alignItems: 'flex-end', gap: '0.6rem' }}>
                      <label style={{ fontSize: '0.85rem', color: '#334155' }}>Quantity</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={row.quantity}
                        onChange={(e) => updateQuantity(mineId, e.target.value)}
                        style={{ width: 110, padding: '0.4rem 0.55rem', border: '1px solid #e2e8f0', borderRadius: 8 }}
                      />
                      <button className="btn-secondary" onClick={() => removeLine(mineId)}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedRows.length > 0 ? (
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="btn-primary" disabled={saving} onClick={continueToUpstream}>
                {saving ? 'Saving...' : 'Continue to Upstream Suppliers'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default SupplierUpstreamCart;
