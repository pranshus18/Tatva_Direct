import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl, authFetch } from '../config/api';
import './Dashboard.css';
import './SupplierUpstream.css';
import {
  Network,
  Package,
  ShoppingCart,
  Search,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  X,
  Info,
  RefreshCw,
  QrCode
} from 'lucide-react';
import { buildOrderUpiPayUri, qrServerImageUrl } from '../utils/upiPaymentQr';
import { formatDateTimeIST } from '../utils/dateTime';
import ProductImageCarousel from '../components/ProductImageCarousel';

const SUPPLIER_UPSTREAM_CART_RESUME_KEY = 'supplierUpstreamCartResumeDraft';
const SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY = 'supplierUpstreamOrderDraft';

/** Display names for each supply-chain tier (must match backend role keys). */
const SELLER_LAYER_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional distributor',
  local_distributor: 'Local distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};
const formatLayerLabel = (role) => (role ? SELLER_LAYER_LABELS[role] || role : 'N/A');

const formatAddressText = (address) => {
  if (!address) return '';
  if (typeof address === 'string') return address.trim();
  if (typeof address !== 'object') return '';
  return [
    address.line1 || address.street || address.address_line1,
    address.line2,
    address.city,
    address.state || address.region,
    address.zipCode || address.pincode || address.postal_code,
    address.country
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(', ');
};

const SupplierUpstream = ({ user }) => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);

  const [brandFilter, setBrandFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Selected mine items (supplier_products junction IDs) -> quantity desired
  const [selectedMine, setSelectedMine] = useState({});

  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  /** From API: rankPriority, limit — sort order for upstream options */
  const [suggestionMeta, setSuggestionMeta] = useState(null);

  // mineSupplierProductId -> chosen upstreamSupplierProductId
  const [selectedUpstreamOffer, setSelectedUpstreamOffer] = useState({});

  const [creating, setCreating] = useState(false);
  const [savingCart, setSavingCart] = useState(false);
  const [createdOrders, setCreatedOrders] = useState([]);

  const [supplierDetailsOpen, setSupplierDetailsOpen] = useState(false);
  const [supplierDetails, setSupplierDetails] = useState(null);
  const [supplierOfferDetails, setSupplierOfferDetails] = useState(null);

  const [orderModalId, setOrderModalId] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [ordersRefreshing, setOrdersRefreshing] = useState(false);
  const [updatingPayment, setUpdatingPayment] = useState(false);

  const sortStatusHistory = (raw) =>
    [...(raw || [])].sort((a, b) => {
      const ta = new Date(a.timestamp || a.at || 0).getTime();
      const tb = new Date(b.timestamp || b.at || 0).getTime();
      return ta - tb;
    });

  const filteredProducts = useMemo(() => {
    const bf = brandFilter.trim().toLowerCase();
    const st = searchTerm.trim().toLowerCase();

    return (products || []).filter((p) => {
      const brandModel = String(p?.brandModel || '').toLowerCase();
      const name = String(p?.name || '').toLowerCase();

      const matchesBrand = !bf || (brandModel && brandModel.includes(bf));
      const matchesSearch = !st || name.includes(st);
      return matchesBrand && matchesSearch;
    });
  }, [products, brandFilter, searchTerm]);

  const fetchMyProducts = async () => {
    try {
      const res = await authFetch('/api/supplier/products', {
        cache: 'no-cache'
      });
      const data = await res.json();
      if (data.status === 'success') setProducts(data.products || []);
    } catch (e) {
      console.error('Failed to fetch supplier products:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchUpstreamOrders = async () => {
    try {
      const res = await authFetch('/api/supplier/upstream/orders', {
        cache: 'no-cache'
      });
      const data = await res.json();
      if (data.status === 'success') setCreatedOrders(data.orders || []);
    } catch (e) {
      console.error('Failed to fetch upstream orders:', e);
    }
  };

  const refreshUpstreamOrdersList = async () => {
    setOrdersRefreshing(true);
    try {
      await fetchUpstreamOrders();
    } finally {
      setOrdersRefreshing(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await Promise.allSettled([
        fetchMyProducts(),
        fetchUpstreamOrders()
      ]);
    };
    init();
  }, []);

  useEffect(() => {
    try {
      const cartRaw = localStorage.getItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
      const orderRaw = localStorage.getItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
      const raw = cartRaw || orderRaw;
      if (!raw) return;

      const draft = JSON.parse(raw);
      if (draft && typeof draft === 'object') {
        if (draft.selectedMine && typeof draft.selectedMine === 'object') {
          setSelectedMine(draft.selectedMine);
        }
        if (draft.selectedUpstreamOffer && typeof draft.selectedUpstreamOffer === 'object') {
          setSelectedUpstreamOffer(draft.selectedUpstreamOffer);
        }
        if (Array.isArray(draft.suggestions)) {
          setSuggestions(draft.suggestions);
        }
        if (typeof draft.brandFilter === 'string') setBrandFilter(draft.brandFilter);
        if (typeof draft.searchTerm === 'string') setSearchTerm(draft.searchTerm);
      }

      // Cart resume is one-time; order draft is resumable until Place Order succeeds.
      if (cartRaw) localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
    } catch (_) {
      localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
    }
  }, []);

  const selectedMineIds = useMemo(() => Object.keys(selectedMine || {}), [selectedMine]);

  const handleToggleMine = (mineId) => {
    setSelectedMine((prev) => {
      const next = { ...(prev || {}) };
      if (next[mineId]) {
        delete next[mineId];
      } else {
        // Default quantity: 1 (backend will also validate min_order_quantity)
        next[mineId] = 1;
      }
      return next;
    });
  };

  const fetchUpstreamSuggestions = async () => {
    if (!selectedMineIds.length) {
      alert('Select at least one product from your inventory.');
      return;
    }

    setSuggestionsLoading(true);
    setSuggestions(null);
    setSuggestionMeta(null);

    try {
      const token = localStorage.getItem('token');
      const ids = selectedMineIds.join(',');
      const res = await fetch(
        getApiUrl(
          `/api/supplier/upstream/suggestions?supplierProductIds=${encodeURIComponent(ids)}&limit=5&_=${Date.now()}`
        ),
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store'
        }
      );
      const responseText = await res.text();
      let data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (parseErr) {
        console.error('Upstream suggestions: non-JSON response', parseErr, responseText);
      }
      if (!res.ok || !data || data.status !== 'success') {
        const backendMessage = data?.message || responseText || `HTTP ${res.status}`;
        alert(`Failed to load upstream suggestions: ${backendMessage}`);
        return;
      }

      setSuggestions(data.items || []);
      setSuggestionMeta({
        rankPriority: data.rankPriority || null,
        limit: data.limit ?? 5,
        distanceAvailable: data.distanceAvailable !== false,
        buyerGeoSource: data.buyerGeoSource || null,
        distanceRanking: data.distanceRanking || null,
        buyerGeoDiagnostics: data.buyerGeoDiagnostics || null
      });

      // Auto-pick the first upstream offer for each item (when available)
      const auto = {};
      (data.items || []).forEach((it) => {
        if (Array.isArray(it.upstreamOffers) && it.upstreamOffers.length > 0) {
          auto[it.mineSupplierProductId] = String(it.upstreamOffers[0].upstreamSupplierProductId);
        }
      });
      setSelectedUpstreamOffer(auto);
    } catch (e) {
      console.error('Upstream suggestions error:', e);
      alert(`Failed to load upstream suggestions: ${e?.message || 'Please check your connection and try again.'}`);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const resolveMineProduct = (mineSupplierProductId) => {
    return (products || []).find((p) => p?.supplier_product_id === mineSupplierProductId) || null;
  };

  const handleProceedToPlaceOrder = async () => {
    if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
      alert('Load upstream suggestions first.');
      return;
    }

    setCreating(true);
    try {
      const selectedItems = suggestions
        .filter((it) => selectedMineIds.includes(String(it.mineSupplierProductId)));

      const selectedLinesDetailed = selectedItems
        .filter((it) => selectedUpstreamOffer[it.mineSupplierProductId])
        .map((it) => {
          const mineId = it.mineSupplierProductId;
          const upstreamOfferId = selectedUpstreamOffer[mineId];
          const mine = resolveMineProduct(mineId);
          const chosenOffer = Array.isArray(it.upstreamOffers)
            ? it.upstreamOffers.find((o) => String(o.upstreamSupplierProductId) === String(upstreamOfferId))
            : null;
          const qty = Number(selectedMine[mineId] || 1) || 1;
          const unitPrice = Number(chosenOffer?.price || 0) || 0;

          return {
            mineSupplierProductId: mineId,
            upstreamSupplierProductId: upstreamOfferId,
            quantity: qty,
            productName: mine?.name || 'Product',
            supplierName: chosenOffer?.supplierName || 'Supplier',
            supplierId: chosenOffer?.supplierId || null,
            unitPrice,
            lineTotal: unitPrice * qty
          };
        });

      const lines = selectedLinesDetailed.map((l) => ({
        mineSupplierProductId: l.mineSupplierProductId,
        upstreamSupplierProductId: l.upstreamSupplierProductId,
        quantity: l.quantity
      }));

      const skipped = selectedItems.length - lines.length;
      if (lines.length === 0) {
        alert('No upstream offers selected for any of your items.');
        return;
      }
      if (skipped > 0) {
        alert(`Skipped ${skipped} item(s) that had no upstream offer selected.`);
      }

      const totalAmountEstimate = selectedLinesDetailed.reduce((sum, l) => sum + (Number(l.lineTotal) || 0), 0);

      // Persist a draft so the next page can ask required date + payment method.
      localStorage.setItem(
        SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY,
        JSON.stringify({
          lines,
          requiredDate: '',
          paymentMethod: 'online',
          itemCount: lines.length,
          totalAmountEstimate,
          reviewLines: selectedLinesDetailed,
          selectedMine,
          selectedUpstreamOffer,
          suggestions,
          brandFilter,
          searchTerm
        })
      );

      navigate('/supplier-place-order');
    } catch (e) {
      console.error('Proceed to place order error:', e);
      alert('Failed to proceed to place order. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveToCart = async () => {
    if (!selectedMineIds.length) {
      alert('Select at least one item before saving cart.');
      return;
    }
    setSavingCart(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          selectedMine,
          selectedUpstreamOffer,
          suggestions: Array.isArray(suggestions) ? suggestions : [],
          brandFilter,
          searchTerm
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save upstream cart');
        return;
      }
      setSelectedMine({});
      setSelectedUpstreamOffer({});
      setSuggestions(null);
      setSuggestionMeta(null);
      setBrandFilter('');
      setSearchTerm('');
      alert('Upstream cart saved successfully.');
      navigate('/supplier-cart');
    } catch (e) {
      console.error('Save upstream cart error:', e);
      alert('Failed to save upstream cart.');
    } finally {
      setSavingCart(false);
    }
  };

  const fetchOrderDetails = async (orderNumberOrId) => {
    if (!orderNumberOrId) return;
    setLoadingOrderDetails(true);
    setOrderDetails(null);

    try {
      const token = localStorage.getItem('token');
      const encoded = encodeURIComponent(orderNumberOrId);
      const res = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encoded}`), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-cache'
      });
      const data = await res.json();
      if (data.status === 'success') {
        setOrderDetails(data.order);
      } else {
        alert(data.message || 'Failed to load order details.');
      }
    } catch (e) {
      console.error('Order details fetch error:', e);
      alert('Failed to load order details. Please try again.');
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!orderModalId) return;
    if (String(orderDetails?.paymentMethod || '').toLowerCase() === 'credit') {
      alert('Credit / pay-later orders are settled on account. Mark as paid is disabled for credit mode.');
      return;
    }

    const confirmed = window.confirm(
      `Mark payment as paid for Order ${orderDetails?.orderNumber}?\nAmount: ₹${orderDetails?.totalAmount?.toLocaleString()}`
    );
    if (!confirmed) return;

    setUpdatingPayment(true);
    try {
      const token = localStorage.getItem('token');
      const encodedOrderId = encodeURIComponent(orderModalId);
      const response = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encodedOrderId}/payment`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          paymentStatus: 'paid',
          paymentMethod: orderDetails?.paymentMethod || 'online'
        })
      });

      const data = await response.json();
      if (data.status === 'success') {
        alert('Payment status updated to paid successfully');
        await fetchOrderDetails(orderModalId);
        await fetchUpstreamOrders();
      } else {
        alert(data.message || 'Failed to update payment status. Please try again.');
      }
    } catch (error) {
      console.error('Failed to update payment status:', error);
      alert('Failed to update payment status. Please check your connection and try again.');
    } finally {
      setUpdatingPayment(false);
    }
  };

  const statusBadge = (status) => {
    const normalized = String(status || 'pending');
    const map = {
      delivered: { bg: '#d1fae5', color: '#065f46', icon: CheckCircle },
      confirmed: { bg: '#dbeafe', color: '#1d4ed8', icon: CheckCircle },
      pending: { bg: '#fef3c7', color: '#92400e', icon: AlertTriangle },
      cancelled: { bg: '#fee2e2', color: '#991b1b', icon: AlertTriangle },
      processing: { bg: '#e0f2fe', color: '#075985', icon: AlertTriangle },
      shipped: { bg: '#e0f2fe', color: '#075985', icon: AlertTriangle },
      returned: { bg: '#fee2e2', color: '#991b1b', icon: AlertTriangle }
    };
    const cfg = map[normalized] || map.pending;
    const Icon = cfg.icon;
    return (
      <span style={{ background: cfg.bg, color: cfg.color, padding: '0.25rem 0.5rem', borderRadius: 999, fontWeight: 700 }}>
        <Icon size={14} style={{ marginRight: 6 }} />
        {normalized}
      </span>
    );
  };

  const paymentMethodLabel = (method) => {
    const pm = String(method || '').toLowerCase();
    if (pm === 'cash') return 'Cash on delivery';
    if (pm === 'online') return 'Pay online';
    if (pm === 'upi') return 'UPI';
    if (pm === 'bank_transfer') return 'Bank transfer';
    if (pm === 'card') return 'Credit / Debit Card';
    if (pm === 'credit') return 'Credit / pay later';
    if (!pm) return 'Pay online';
    return pm.replace(/_/g, ' ');
  };

  const openSupplierDetailsForOffer = (offer) => {
    const details = offer?.supplierDetails || null;
    if (!details) {
      alert('Supplier details not available for this upstream option.');
      return;
    }
    setSupplierDetails(details);
    setSupplierOfferDetails(offer);
    setSupplierDetailsOpen(true);
  };

  const offerLocationText = useMemo(() => {
    const fromOffer = String(supplierOfferDetails?.location || '').trim();
    if (fromOffer) return fromOffer;
    const fromOfferOutletAddress = String(supplierOfferDetails?.offerOutletAddress || '').trim();
    if (fromOfferOutletAddress) return fromOfferOutletAddress;
    const fromSupplierAddress = formatAddressText(supplierDetails?.address);
    if (fromSupplierAddress) return fromSupplierAddress;
    return '—';
  }, [supplierOfferDetails, supplierDetails]);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading your supplier inventory…</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1>Upstream Orders</h1>
          <p style={{ maxWidth: '56rem', lineHeight: 1.55, color: '#334155' }}>
            <strong>You are the buyer here.</strong> You place stock orders to partners in the tier <em>above</em> yours (upstream). For each brand, routing follows the admin-defined
            chain first; if no brand chain exists, it falls back to your profile role flow (<strong>Manufacturer → Stockist → Regional → Local → Dealer → Retailer</strong>).
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn-secondary" onClick={() => navigate('/supplier-dashboard')} style={{ whiteSpace: 'nowrap' }}>
            Back to Dashboard
          </button>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Select Brand + Products</h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.9rem' }}>
              <Network size={18} />
              Inventory tied to role and brand-chain routing
            </span>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div className="search-box" style={{ flex: '1 1 260px', minWidth: 240 }}>
              <Search size={16} />
              <input
                type="text"
                placeholder="Filter by brandModel (e.g. Amul)"
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
              />
            </div>

            <div className="search-box" style={{ flex: '1 1 260px', minWidth: 240 }}>
              <Search size={16} />
              <input
                type="text"
                placeholder="Search product name"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="items-list" style={{ maxHeight: '44vh', overflowY: 'auto' }}>
            {filteredProducts.length === 0 ? (
              <div className="empty-state">
                <Package size={48} />
                <h3>No matching products</h3>
                <p>Update brand filter or search term.</p>
              </div>
            ) : (
              filteredProducts.map((p) => {
                const mineId = p.supplier_product_id;
                const isSelected = !!selectedMine[mineId];

                return (
                  <div
                    key={mineId}
                    className="item-card upstream-select-card"
                    style={{
                      borderColor: isSelected ? '#4f46e5' : '#e5e7eb',
                      background: isSelected ? '#eef2ff' : 'white'
                    }}
                  >
                    <div className="item-info upstream-select-card-info">
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 18 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleMine(mineId)}
                          />
                        </div>
                        <div>
                          <h4 style={{ marginBottom: 6 }}>{p.name}</h4>
                          <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 4 }}>
                            Brand: <strong>{p.brandModel || p.brand || 'N/A'}</strong>
                          </p>
                          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: 0 }}>
                            Stock: <strong>{p.stock ?? 0}</strong> • Min order: <strong>{p.min_order_quantity ?? 1}</strong>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="item-status upstream-select-card-status">
                      {isSelected ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                          <label style={{ fontSize: '0.9rem', color: '#334155' }}>
                            Quantity
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={selectedMine[mineId]}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              setSelectedMine((prev) => ({ ...prev, [mineId]: Number.isFinite(v) && v > 0 ? v : 1 }));
                            }}
                            style={{ width: 110, padding: '0.45rem 0.6rem', borderRadius: 8, border: '1px solid #e5e7eb' }}
                          />
                        </div>
                      ) : (
                        <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Select to order upstream</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              onClick={fetchUpstreamSuggestions}
              disabled={suggestionsLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {suggestionsLoading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              Find Upstream Suppliers
            </button>

            <button
              className="btn-secondary"
              onClick={() => {
                setSelectedMine({});
                setSuggestions(null);
                setSuggestionMeta(null);
                setSelectedUpstreamOffer({});
              }}
              disabled={suggestionsLoading || creating}
            >
              Clear selection
            </button>
          </div>
        </div>

        <div className="dashboard-section">
          <div className="section-header">
            <div>
              <h2 style={{ marginBottom: suggestionMeta?.rankPriority ? 8 : 0 }}>Choose upstream supplier (top {suggestionMeta?.limit ?? 5} matches)</h2>
              {suggestionMeta?.rankPriority ? (
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b', maxWidth: '52rem', lineHeight: 1.45 }}>
                  Order: <strong>1)</strong> nearest upstream partners (km — minimum distance from <strong>any</strong> of your outlets to theirs, so a new dealer closer to you can jump to #1 next time){' '}
                  <strong>2)</strong> highest stock <strong>3)</strong> lowest price <strong>4)</strong> highest supplier rating. Unrated partners are last on ties.
                </p>
              ) : null}
              {suggestionMeta?.distanceRanking ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#94a3b8', maxWidth: '52rem', lineHeight: 1.4 }}>
                  {suggestionMeta.distanceRanking}
                </p>
              ) : null}
              {suggestionMeta?.distanceAvailable === false ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#b45309', maxWidth: '52rem', lineHeight: 1.4 }}>
                  Distance priority is currently off. Update your outlet/profile address to enable nearest-first ranking.
                  {suggestionMeta?.buyerGeoDiagnostics ? (
                    <>
                      {' '}
                      (outlets checked: {suggestionMeta.buyerGeoDiagnostics.outletsChecked || 0}, resolved:{' '}
                      {suggestionMeta.buyerGeoDiagnostics.outletsResolved || 0}; profile address tried:{' '}
                      {suggestionMeta.buyerGeoDiagnostics.profileAddressTried ? 'yes' : 'no'}, resolved:{' '}
                      {suggestionMeta.buyerGeoDiagnostics.profileAddressResolved ? 'yes' : 'no'}; branches tried:{' '}
                      {suggestionMeta.buyerGeoDiagnostics.branchesTried || 0}, resolved:{' '}
                      {suggestionMeta.buyerGeoDiagnostics.branchesResolved || 0}; inventory locations tried:{' '}
                      {suggestionMeta.buyerGeoDiagnostics.inventoryLocationTried || 0}, resolved:{' '}
                      {suggestionMeta.buyerGeoDiagnostics.inventoryLocationResolved || 0}).
                    </>
                  ) : null}
                </p>
              ) : null}
              {suggestionMeta?.distanceAvailable && suggestionMeta?.buyerGeoSource ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#64748b', maxWidth: '52rem', lineHeight: 1.4 }}>
                  Buyer location source: <strong>{suggestionMeta.buyerGeoSource.replace(/_/g, ' ')}</strong>.
                </p>
              ) : null}
            </div>
            <button
              className="btn-primary"
              onClick={handleProceedToPlaceOrder}
              disabled={creating || !suggestions || !Array.isArray(suggestions) || suggestions.length === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {creating ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <ShoppingCart size={18} />}
              Proceed to Place Order
            </button>
            <button
              className="btn-secondary"
              onClick={handleSaveToCart}
              disabled={savingCart}
              style={{ marginLeft: '0.75rem' }}
            >
              {savingCart ? 'Saving Cart...' : 'Save to Cart'}
            </button>
          </div>

          {!suggestionsLoading && !suggestions ? (
            <div className="empty-state" style={{ marginTop: '1rem' }}>
              <Network size={48} />
              <h3>No upstream suggestions yet</h3>
              <p>Select your products above and click “Find Upstream Suppliers”.</p>
            </div>
          ) : suggestions && suggestions.length === 0 ? (
            <div className="empty-state" style={{ marginTop: '1rem' }}>
              <AlertTriangle size={48} />
              <h3>No upstream offers found</h3>
              <p>Try a different brand or select fewer products.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
              {(suggestions || []).map((it) => {
                const mine = resolveMineProduct(it.mineSupplierProductId);
                const mineSelectedQty = selectedMine[it.mineSupplierProductId] || 1;
                const offers = Array.isArray(it.upstreamOffers) ? it.upstreamOffers : [];
                const chosen = selectedUpstreamOffer[it.mineSupplierProductId] || '';
                const radioGroup = `upstream-offer-${it.mineSupplierProductId}`;

                const selectUpstreamOffer = (nextUpstreamOfferId) => {
                  const chosenOffer = offers.find((o) => String(o.upstreamSupplierProductId) === String(nextUpstreamOfferId));
                  const minQty = parseInt(chosenOffer?.minOrderQuantity || 1, 10) || 1;
                  setSelectedUpstreamOffer((prev) => ({ ...prev, [it.mineSupplierProductId]: String(nextUpstreamOfferId) }));
                  setSelectedMine((prev) => {
                    const current = parseInt(prev?.[it.mineSupplierProductId] || 1, 10) || 1;
                    const nextQty = current < minQty ? minQty : current;
                    return { ...prev, [it.mineSupplierProductId]: nextQty };
                  });
                };

                return (
                  <div
                    key={it.mineSupplierProductId}
                    className="item-card"
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}
                  >
                    <div className="item-info" style={{ width: '100%' }}>
                      <h4 style={{ marginBottom: 6 }}>{mine?.name || 'Product'}</h4>
                      <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 0 }}>
                        Brand: <strong>{it.brandModel || mine?.brandModel || 'N/A'}</strong> • Qty: <strong>{mineSelectedQty}</strong>
                      </p>
                      {it.chainRouting?.requiredUpstreamRole ? (
                        <p style={{ color: '#4338ca', fontSize: '0.84rem', marginTop: 6, marginBottom: 0 }}>
                          Route rule: <strong>Your layer:</strong> {formatLayerLabel(it.chainRouting.buyerRole)} {' | '}
                          <strong>Next allowed seller layer:</strong> {formatLayerLabel(it.chainRouting.requiredUpstreamRole)}
                          {it.chainRouting?.source === 'admin_chain' ? ' (admin brand chain)' : ''}
                        </p>
                      ) : (
                        <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 6, marginBottom: 0 }}>
                          Route rule: using profile fallback chain for this brand.
                        </p>
                      )}
                    </div>

                    {offers.length === 0 ? (
                      <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No upstream offers for this item.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
                          Best options first — choose the upstream seller ({offers.length} shown). Each row shows that seller’s <strong>layer</strong> (not yours).
                        </p>
                        {offers.map((o, offerIdx) => {
                          const id = String(o.upstreamSupplierProductId);
                          const isSelected = chosen === id;
                          const ratingLabel =
                            o.averageRating != null && o.ratingCount > 0
                              ? `${o.averageRating}★ (${o.ratingCount} review${o.ratingCount === 1 ? '' : 's'})`
                              : 'no ratings yet';
                          return (
                            <label
                              key={id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.65rem',
                                padding: '0.65rem 0.75rem',
                                borderRadius: 10,
                                border: isSelected ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                                background: isSelected ? '#eef2ff' : '#fff',
                                cursor: 'pointer',
                                flexWrap: 'wrap'
                              }}
                            >
                              <input
                                type="radio"
                                name={radioGroup}
                                checked={isSelected}
                                onChange={() => selectUpstreamOffer(id)}
                                style={{ flexShrink: 0 }}
                              />
                              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, color: '#0f172a' }}>{o.supplierName}</span>
                                  {o.upstreamRole ? (
                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        fontWeight: 600,
                                        color: '#4338ca',
                                        background: '#eef2ff',
                                        padding: '0.12rem 0.45rem',
                                        borderRadius: 6,
                                        whiteSpace: 'nowrap'
                                      }}
                                      title="This partner's supply-chain layer (seller)"
                                    >
                                      Seller layer: {formatLayerLabel(o.upstreamRole)}
                                    </span>
                                  ) : null}
                                  {offerIdx === 0 ? (
                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        background: '#ecfdf5',
                                        color: '#047857',
                                        padding: '0.15rem 0.45rem',
                                        borderRadius: 6
                                      }}
                                    >
                                      {typeof o.distanceKm === 'number' ? '#1 nearest' : '#1 best match'}
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>#{offerIdx + 1}</span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 4 }}>
                                  ₹{Number(o.price || 0).toLocaleString()} • stock {o.stock ?? 0}
                                  {typeof o.distanceKm === 'number' ? ` • ${o.distanceKm} km` : ' • distance n/a'}
                                  {' • '}
                                  {ratingLabel}
                                  {Number(o.minimumOrderValueInr) > 0
                                    ? ` • min order ₹${Number(o.minimumOrderValueInr).toLocaleString('en-IN')}`
                                    : ''}
                                </div>
                                {o.rankComponents ? (
                                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>
                                    Sort keys: {o.rankComponents.distanceKm != null ? `${o.rankComponents.distanceKm} km` : '—'} · stock {o.rankComponents.stock} · ₹
                                    {Number(o.rankComponents.price || 0).toLocaleString()} · rating{' '}
                                    {o.rankComponents.averageRating != null ? `${o.rankComponents.averageRating} (${o.rankComponents.ratingCount || 0})` : '—'}
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}
                                title="View this supplier’s details"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openSupplierDetailsForOffer(o);
                                }}
                              >
                                <Info size={16} />
                                Details
                              </button>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="dashboard-section">
          <div className="section-header">
            <h2>Your Upstream Orders (track status)</h2>
            <button
              type="button"
              className="btn-secondary"
              disabled={ordersRefreshing}
              onClick={refreshUpstreamOrdersList}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
              title="Refresh list from server"
            >
              <RefreshCw size={16} style={ordersRefreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
              Refresh
            </button>
          </div>
          <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '-0.5rem 0 1rem' }}>
            Orders you place to upstream partners appear here. When your supplier updates status (processing, shipped, delivered), you will see it here and in notifications.
          </p>

          <div className="items-list">
            {createdOrders.length === 0 ? (
              <div className="empty-state">
                <ShoppingCart size={48} />
                <h3>No upstream orders yet</h3>
                <p>Create your first upstream order above.</p>
              </div>
            ) : (
              createdOrders.slice(0, 10).map((o) => (
                <div key={o.id} className="item-card" style={{ cursor: 'pointer' }} onClick={() => { setOrderModalId(o.orderNumber); fetchOrderDetails(o.orderNumber); }}>
                  <div className="item-info">
                    <h4>Order {o.orderNumber}</h4>
                    <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: 0 }}>
                      Supplier: <strong>{o.supplierName || 'Supplier'}</strong> • Items: <strong>{o.itemCount}</strong>
                    </p>
                    <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: 0 }}>
                      Amount: <strong>₹{Number(o.totalAmount || 0).toLocaleString()}</strong>
                      {o.updatedAt ? (
                        <span> • Updated {formatDateTimeIST(o.updatedAt, 'N/A')}</span>
                      ) : null}
                    </p>
                    <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 0 }}>
                      Payment: <strong>{paymentMethodLabel(o.paymentMethod)}</strong>
                      {' • '}Required by:{' '}
                      <strong>{o.expectedDeliveryDate ? formatDateTimeIST(o.expectedDeliveryDate, 'N/A') : '—'}</strong>
                    </p>
                    {o.trackingNumber ? (
                      <p style={{ color: '#475569', fontSize: '0.85rem', marginTop: 6, marginBottom: 0 }}>
                        Tracking: <strong>{o.trackingNumber}</strong>
                        {o.shippingProvider ? ` (${o.shippingProvider})` : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="item-status">
                    {statusBadge(o.status)}
                    <button
                      className="btn-icon"
                      title="Delete order"
                      style={{ marginLeft: 10, color: '#dc2626' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const confirmed = window.confirm(`Delete order ${o.orderNumber}?`);
                        if (!confirmed) return;
                        (async () => {
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encodeURIComponent(o.orderNumber)}`), {
                              method: 'DELETE',
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok || data.status !== 'success') {
                              alert(data.message || 'Failed to delete order.');
                              return;
                            }
                            // Optimistic UI removal
                            setCreatedOrders((prev) => (prev || []).filter((x) => x.orderNumber !== o.orderNumber));
                            await fetchUpstreamOrders();
                          } catch (err) {
                            console.error('Delete upstream order error:', err);
                            alert('Failed to delete order.');
                          }
                        })();
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {orderModalId && (
        <div
          className="modal-overlay"
          onClick={() => {
            setOrderModalId(null);
            setOrderDetails(null);
          }}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>Order Details - {orderModalId}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loadingOrderDetails}
                  onClick={() => fetchOrderDetails(orderModalId)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <RefreshCw size={16} style={loadingOrderDetails ? { animation: 'spin 1s linear infinite' } : undefined} />
                  Refresh
                </button>
                <button className="btn-icon" onClick={() => setOrderModalId(null)}>
                  <X size={20} />
                </button>
              </div>
            </div>

            {loadingOrderDetails ? (
              <div className="modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="spinner" />
                <p>Loading order details…</p>
              </div>
            ) : orderDetails ? (
              <div className="modal-body">
                <div className="order-info-section">
                  <h3>Supplier</h3>
                  <p><strong>Name:</strong> {orderDetails?.supplier?.name || orderDetails?.supplier?.company || 'N/A'}</p>
                  <p><strong>Amount:</strong> ₹{Number(orderDetails?.totalAmount || 0).toLocaleString()}</p>
                  <p><strong>Status:</strong> {orderDetails?.status}</p>
                  <p>
                    <strong>Payment:</strong> {orderDetails?.paymentStatus || 'pending'}{' '}
                    • {paymentMethodLabel(orderDetails?.paymentMethod)}
                  </p>
                  <p>
                    <strong>Required by:</strong>{' '}
                    {orderDetails?.expectedDeliveryDate ? formatDateTimeIST(orderDetails.expectedDeliveryDate, 'N/A') : '—'}
                  </p>
                  {orderDetails?.updatedAt ? (
                    <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                      <strong>Last updated:</strong> {formatDateTimeIST(orderDetails.updatedAt, 'N/A')}
                    </p>
                  ) : null}
                </div>

                {orderDetails?.receiptPdfUrl && (
                  <div className="order-info-section">
                    <h3>Receipt</h3>
                    <a
                      href={orderDetails.receiptPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary"
                    >
                      Download payment receipt
                    </a>
                  </div>
                )}

                {orderDetails?.invoicePdfUrl && (
                  <div className="order-info-section">
                    <h3>Invoice</h3>
                    <a
                      href={orderDetails.invoicePdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary"
                    >
                      Download invoice PDF
                    </a>
                  </div>
                )}

                {(orderDetails?.trackingNumber || orderDetails?.trackingUrl || orderDetails?.shippingProvider) && (
                  <div className="order-info-section">
                    <h3>Shipment</h3>
                    {orderDetails.shippingProvider ? <p><strong>Carrier:</strong> {orderDetails.shippingProvider}</p> : null}
                    {orderDetails.trackingNumber ? <p><strong>Tracking #:</strong> {orderDetails.trackingNumber}</p> : null}
                    {orderDetails.trackingUrl ? (
                      <p>
                        <a href={orderDetails.trackingUrl} target="_blank" rel="noopener noreferrer">
                          Open tracking link
                        </a>
                      </p>
                    ) : null}
                  </div>
                )}

                {Array.isArray(orderDetails?.statusHistory) && orderDetails.statusHistory.length > 0 && (
                  <div className="order-info-section">
                    <h3>Status timeline</h3>
                    <ol style={{ margin: 0, paddingLeft: '1.25rem', color: '#334155', fontSize: '0.9rem' }}>
                      {sortStatusHistory(orderDetails.statusHistory).map((ev, idx) => (
                        <li key={idx} style={{ marginBottom: '0.5rem' }}>
                          <strong>{ev.status || '—'}</strong>
                          {ev.timestamp || ev.at ? (
                            <span style={{ color: '#64748b' }}> — {formatDateTimeIST(ev.timestamp || ev.at, 'N/A')}</span>
                          ) : null}
                          {ev.notes ? <div style={{ color: '#64748b', marginTop: 2 }}>{ev.notes}</div> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className="order-info-section">
                  <h3>Items</h3>
                  {Array.isArray(orderDetails.items) && orderDetails.items.length > 0 ? (
                    <table className="order-items-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Qty</th>
                          <th>Unit</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderDetails.items.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              {(item.productImage || item.product?.image || item.images?.[0] || item.product?.images?.[0]) && (
                                <div style={{ marginBottom: '0.35rem' }}>
                                  <ProductImageCarousel
                                    images={[
                                      item.productImage,
                                      item.product?.image,
                                      ...(Array.isArray(item.images) ? item.images : []),
                                      ...(Array.isArray(item.product?.images) ? item.product.images : [])
                                    ]}
                                    alt={item.product?.name || item.name || 'Product'}
                                    height={80}
                                    rounded={6}
                                  />
                                </div>
                              )}
                              <div>
                                <strong>{item.product?.name || item.name || 'Product'}</strong>
                              </div>
                              {item.brandModel && (
                                <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 4 }}>
                                  {item.brandModel}
                                </div>
                              )}
                            </td>
                            <td>{item.quantity}</td>
                            <td>₹{Number(item.unitPrice || 0).toLocaleString()}</td>
                            <td>₹{Number(item.totalPrice || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: '#64748b' }}>No items found in this order.</p>
                  )}
                </div>

                {orderDetails.status === 'delivered' && (
                  <div
                    className="order-info-section"
                    style={{
                      textAlign: 'center',
                      padding: '2rem',
                      backgroundColor: '#f8fafc',
                      borderRadius: '12px',
                      border: '2px solid #e2e8f0'
                    }}
                  >
                    {orderDetails?.paymentMethod === 'online' ? (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            marginBottom: '1rem'
                          }}
                        >
                          <QrCode size={20} color="#4f46e5" />
                          <h3 style={{ margin: 0, color: '#1e293b' }}>Payment QR code</h3>
                        </div>
                        <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                          After delivery, scan to pay ₹{Number(orderDetails.totalAmount || 0).toLocaleString()} to the supplier (UPI).
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'center',
                            padding: '1.5rem',
                            backgroundColor: 'white',
                            borderRadius: '8px',
                            marginBottom: '1rem',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                          }}
                        >
                          {(() => {
                            const upiUri = buildOrderUpiPayUri({
                              amountRupees: orderDetails.totalAmount,
                              orderNumber: orderDetails.orderNumber,
                              payeeName: orderDetails.supplier?.company || orderDetails.supplier?.name,
                              payeeVpa: orderDetails.supplier?.upiVpa
                            });
                            return (
                              <img
                                src={qrServerImageUrl(upiUri, 200)}
                                alt="UPI payment QR"
                                style={{
                                  width: '200px',
                                  height: '200px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '4px'
                                }}
                              />
                            );
                          })()}
                        </div>
                      </>
                    ) : (
                      <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                        Payment method: <strong>{paymentMethodLabel(orderDetails?.paymentMethod)}</strong>. After payment, mark payment as paid.
                      </p>
                    )}
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: '#64748b',
                        lineHeight: '1.6',
                        marginBottom: '1rem'
                      }}
                    >
                      <p style={{ margin: '0.25rem 0' }}>
                        <strong>Order:</strong> {orderDetails.orderNumber}
                      </p>
                      <p style={{ margin: '0.25rem 0' }}>
                        <strong>Amount:</strong> ₹{Number(orderDetails.totalAmount || 0).toLocaleString()}
                      </p>
                      <p style={{ margin: '0.25rem 0' }}>
                        <strong>Pay to:</strong> {orderDetails.supplier?.name || orderDetails.supplier?.company || 'Supplier'}
                      </p>
                    </div>
                    {orderDetails.paymentStatus !== 'paid' && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleMarkAsPaid}
                        disabled={updatingPayment || String(orderDetails?.paymentMethod || '').toLowerCase() === 'credit'}
                        style={{
                          width: '100%',
                          marginTop: '1rem',
                          padding: '0.75rem 1.5rem',
                          fontSize: '1rem',
                          fontWeight: '600'
                        }}
                      >
                        {String(orderDetails?.paymentMethod || '').toLowerCase() === 'credit'
                          ? 'Credit order (auto settle on account)'
                          : updatingPayment
                            ? 'Processing…'
                            : '✓ Mark payment as paid'}
                      </button>
                    )}
                    {orderDetails.paymentStatus === 'paid' && (
                      <div
                        style={{
                          padding: '0.75rem',
                          backgroundColor: '#d1fae5',
                          borderRadius: '8px',
                          color: '#065f46',
                          fontWeight: '600',
                          textAlign: 'center',
                          marginTop: '1rem'
                        }}
                      >
                        ✓ Payment completed
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
                <p style={{ color: '#dc2626' }}>Failed to load order details.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {supplierDetailsOpen && supplierDetails && (
        <div
          className="modal-overlay"
          onClick={() => {
            setSupplierDetailsOpen(false);
            setSupplierDetails(null);
            setSupplierOfferDetails(null);
          }}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '780px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>Upstream Supplier Details</h2>
              <button className="btn-icon" onClick={() => setSupplierDetailsOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div className="order-info-section">
                <h3>Offer Location</h3>
                <p>
                  <strong>Location:</strong> {offerLocationText}
                  {typeof supplierOfferDetails?.distanceKm === 'number' ? ` • ${supplierOfferDetails.distanceKm} km` : ''}
                </p>
                {supplierOfferDetails?.offerGeoLocation &&
                typeof supplierOfferDetails.offerGeoLocation.lat === 'number' &&
                typeof supplierOfferDetails.offerGeoLocation.lng === 'number' ? (
                  <p style={{ color: '#64748b' }}>
                    <strong>Geo:</strong> {supplierOfferDetails.offerGeoLocation.lat}, {supplierOfferDetails.offerGeoLocation.lng}
                  </p>
                ) : null}
              </div>

              <div className="order-info-section">
                <h3>Supplier</h3>
                <p><strong>Name:</strong> {supplierDetails.name || 'N/A'}</p>
                <p><strong>Company:</strong> {supplierDetails.company || 'N/A'}</p>
                <p><strong>Role:</strong> {supplierDetails.supplierRoleLabel || supplierDetails.supplierRole || 'N/A'}</p>
                {supplierDetails.email ? <p><strong>Email:</strong> {supplierDetails.email}</p> : null}
                {supplierDetails.phone ? <p><strong>Phone:</strong> {supplierDetails.phone}</p> : null}
              </div>

              <div className="order-info-section">
                <h3>Brands & Compliance</h3>
                <p><strong>Brands:</strong> {supplierDetails.brands?.trim ? (supplierDetails.brands.trim() ? supplierDetails.brands : '—') : (supplierDetails.brands || '—')}</p>
                {supplierDetails.gstin ? <p><strong>GSTIN:</strong> {supplierDetails.gstin}</p> : null}
                {supplierDetails.ownershipDetails ? <p><strong>Ownership:</strong> {supplierDetails.ownershipDetails}</p> : null}
                {supplierDetails.authorizationCertificateUrl ? (
                  <p>
                    <strong>Certificate:</strong>{' '}
                    <a href={supplierDetails.authorizationCertificateUrl} target="_blank" rel="noreferrer">
                      View
                    </a>
                  </p>
                ) : null}
              </div>

              <div className="order-info-section">
                <h3>Address</h3>
                <p style={{ color: '#64748b' }}>
                  {[
                    supplierDetails?.address?.street || supplierDetails?.address?.line1,
                    supplierDetails?.address?.city,
                    supplierDetails?.address?.state,
                    supplierDetails?.address?.zipCode || supplierDetails?.address?.pincode
                  ].filter(Boolean).join(', ') || '—'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierUpstream;

