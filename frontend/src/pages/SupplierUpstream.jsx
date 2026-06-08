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
  Loader2,
  AlertTriangle,
  X,
  Info
} from 'lucide-react';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpStatCard from '../components/sp/SpStatCard';
import UpstreamProductDisplay, { collectProductImages } from '../components/UpstreamProductDisplay';
import { SUPPLIER_CURRENT_STOCK_LABEL } from '../utils/supplierStockLabel';
import { formatRupee } from '../utils/formatRupee';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import { normalizeSupplierProductsFromApi } from '../utils/supplierProductRow';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const SUPPLIER_UPSTREAM_CART_RESUME_KEY = 'supplierUpstreamCartResumeDraft';
const SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY = 'supplierUpstreamOrderDraft';
/** Set when returning from Place Order so upstream page restores in-progress draft once. */
const SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY = 'supplierUpstreamRestoreFromOrder';
const emitSupplierCartUpdated = () => window.dispatchEvent(new Event('supplier-upstream-cart-updated'));

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

/** Stable keys for supplier_products junction IDs (avoids string/UUID mismatches in selection state). */
const normalizeSupplierProductKey = (value) => String(value ?? '').trim();

const normalizeSelectionMap = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  const next = {};
  Object.entries(raw).forEach(([key, val]) => {
    const normalizedKey = normalizeSupplierProductKey(key);
    if (normalizedKey) next[normalizedKey] = val;
  });
  return next;
};

const normalizeVariantToken = (value) => String(value ?? '').trim().toLowerCase();

const isSameVariantOfferForMine = (mineProduct, offer, mineSupplierProductId) => {
  if (!offer) return false;

  const mineVariantKey = normalizeVariantToken(mineProduct?.variantKey);
  const mineVariantAsin = normalizeVariantToken(mineProduct?.variantAsin);
  const offerVariantKey = normalizeVariantToken(offer?.upstreamVariantKey || offer?.variantKey);
  const offerVariantAsin = normalizeVariantToken(offer?.upstreamVariantAsin || offer?.variantAsin);

  if (mineVariantKey) return Boolean(offerVariantKey) && offerVariantKey === mineVariantKey;
  if (mineVariantAsin) return Boolean(offerVariantAsin) && offerVariantAsin === mineVariantAsin;

  const upstreamProductId = String(offer?.upstreamProductId || offer?.productId || '').trim();
  const mineProductId = String(mineProduct?.id || offer?.productId || '').trim();
  const mineId = normalizeSupplierProductKey(mineSupplierProductId);
  return Boolean(upstreamProductId) && Boolean(mineProductId) && upstreamProductId === mineProductId && Boolean(mineId);
};

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
  const [cartName, setCartName] = useState('');
  /** From API: rankPriority, limit — sort order for upstream options */
  const [suggestionMeta, setSuggestionMeta] = useState(null);

  // mineSupplierProductId -> chosen upstreamSupplierProductId
  const [selectedUpstreamOffer, setSelectedUpstreamOffer] = useState({});

  const [creating, setCreating] = useState(false);
  const [savingCart, setSavingCart] = useState(false);
  const [addingCartByMineId, setAddingCartByMineId] = useState({});

  const [supplierDetailsOpen, setSupplierDetailsOpen] = useState(false);
  const [supplierDetails, setSupplierDetails] = useState(null);
  const [supplierOfferDetails, setSupplierOfferDetails] = useState(null);

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
      if (data.status === 'success') {
        setProducts(normalizeSupplierProductsFromApi(data.products || []));
      }
    } catch (e) {
      console.error('Failed to fetch supplier products:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyProducts();
  }, []);

  useEffect(() => {
    try {
      const cartRaw = localStorage.getItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
      const restoreFromOrder = sessionStorage.getItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY) === '1';
      const orderRaw = restoreFromOrder ? localStorage.getItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY) : null;
      const raw = cartRaw || orderRaw;
      if (!raw) return;

      const draft = JSON.parse(raw);
      if (draft && typeof draft === 'object') {
        if (draft.selectedMine && typeof draft.selectedMine === 'object') {
          setSelectedMine(normalizeSelectionMap(draft.selectedMine));
        }
        if (draft.selectedUpstreamOffer && typeof draft.selectedUpstreamOffer === 'object') {
          setSelectedUpstreamOffer(normalizeSelectionMap(draft.selectedUpstreamOffer));
        }
        if (Array.isArray(draft.suggestions)) {
          setSuggestions(draft.suggestions);
        }
        if (typeof draft.brandFilter === 'string') setBrandFilter(draft.brandFilter);
        if (typeof draft.searchTerm === 'string') setSearchTerm(draft.searchTerm);
        if (typeof draft.cartName === 'string') setCartName(draft.cartName);
      }

      if (cartRaw) localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
      if (restoreFromOrder) sessionStorage.removeItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY);
    } catch (_) {
      localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
      sessionStorage.removeItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY);
    }
  }, []);

  const selectedMineIds = useMemo(
    () => Object.keys(normalizeSelectionMap(selectedMine || {})),
    [selectedMine]
  );
  const visibleInventoryCount = filteredProducts.length;
  const suggestedGroupCount = Array.isArray(suggestions) ? suggestions.length : 0;

  function resolveMineProduct(mineSupplierProductId) {
    const key = normalizeSupplierProductKey(mineSupplierProductId);
    return (
      (products || []).find(
        (p) => normalizeSupplierProductKey(p?.supplier_product_id) === key
      ) || null
    );
  }

  function getCompatibleOffersForItem(item) {
    const mineKey = normalizeSupplierProductKey(item?.mineSupplierProductId);
    const mine = resolveMineProduct(mineKey);
    const offers = Array.isArray(item?.upstreamOffers) ? item.upstreamOffers : [];
    return offers.filter((offer) => isSameVariantOfferForMine(mine, offer, mineKey));
  }

  const linesReadyToPlace = useMemo(() => {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return 0;
    return suggestions.filter((it) => {
      const mineId = normalizeSupplierProductKey(it.mineSupplierProductId);
      const offers = getCompatibleOffersForItem(it);
      if (!mineId || offers.length === 0) return false;
      const pick = normalizeSupplierProductKey(selectedUpstreamOffer[mineId]);
      if (!pick) return false;
      return offers.some(
        (o) => normalizeSupplierProductKey(o.upstreamSupplierProductId) === pick
      );
    }).length;
  }, [suggestions, selectedUpstreamOffer, products]);

  const handleToggleMine = (mineId) => {
    const key = normalizeSupplierProductKey(mineId);
    if (!key) return;
    setSelectedMine((prev) => {
      const next = { ...(prev || {}) };
      if (next[key]) {
        delete next[key];
      } else {
        const product = (products || []).find(
          (p) => normalizeSupplierProductKey(p.supplier_product_id) === key
        );
        const minQty = Math.max(1, product?.min_order_quantity ?? 1);
        next[key] = minQty;
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

      // Keep only upstream picks that still match this suggestion set (no auto-select).
      setSelectedUpstreamOffer((prev) => {
        const next = {};
        const normalizedPrev = normalizeSelectionMap(prev);
        (data.items || []).forEach((it) => {
          const mineId = normalizeSupplierProductKey(it.mineSupplierProductId);
          const prevPick = normalizedPrev[mineId];
          if (!mineId || !prevPick) return;
          const offers = getCompatibleOffersForItem(it);
          if (
            offers.some(
              (o) => normalizeSupplierProductKey(o.upstreamSupplierProductId) === prevPick
            )
          ) {
            next[mineId] = prevPick;
          }
        });
        return next;
      });
    } catch (e) {
      console.error('Upstream suggestions error:', e);
      alert(`Failed to load upstream suggestions: ${e?.message || 'Please check your connection and try again.'}`);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const handleProceedToPlaceOrder = async () => {
    if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
      alert('Load upstream suggestions first.');
      return;
    }

    setCreating(true);
    try {
      const selectedItems = suggestions.filter((it) => {
        const mineId = normalizeSupplierProductKey(it.mineSupplierProductId);
        const pick = normalizeSupplierProductKey(selectedUpstreamOffer[mineId]);
        const offers = getCompatibleOffersForItem(it);
        return (
          mineId &&
          pick &&
          offers.some((o) => normalizeSupplierProductKey(o.upstreamSupplierProductId) === pick)
        );
      });

      const selectedLinesDetailed = selectedItems.map((it) => {
          const mineId = normalizeSupplierProductKey(it.mineSupplierProductId);
          const upstreamOfferId = normalizeSupplierProductKey(selectedUpstreamOffer[mineId]);
          const mine = resolveMineProduct(mineId);
          const chosenOffer = getCompatibleOffersForItem(it).find(
                (o) => normalizeSupplierProductKey(o.upstreamSupplierProductId) === upstreamOfferId
              ) || null;
          const qty =
            parseSupplierStockQuantity(selectedMine[mineId]) ??
            Math.max(1, mine?.min_order_quantity ?? 1);
          const unitPrice = Number(chosenOffer?.price || 0) || 0;

          return {
            mineSupplierProductId: mineId,
            upstreamSupplierProductId: upstreamOfferId,
            quantity: qty,
            productName: mine?.name || 'Product',
            supplierName: chosenOffer?.supplierName || 'Supplier',
            supplierId: chosenOffer?.supplierId || null,
            unitPrice,
            lineTotal: unitPrice * qty,
            specifications: mine?.specifications || null,
            images: collectProductImages(mine),
            brandModel: mine?.brandModel || mine?.brand || null,
            unit: mine?.unit || 'units',
            description: mine?.description || ''
          };
        });

      const lines = selectedLinesDetailed.map((l) => ({
        mineSupplierProductId: l.mineSupplierProductId,
        upstreamSupplierProductId: l.upstreamSupplierProductId,
        quantity: l.quantity
      }));

      const suggestedWithOffers = suggestions.filter(
        (it) => getCompatibleOffersForItem(it).length > 0
      );
      const skipped = suggestedWithOffers.length - lines.length;
      if (lines.length === 0) {
        alert('No upstream offers selected. Click a supplier row to choose who to buy from.');
        return;
      }
      if (skipped > 0) {
        alert(`Skipped ${skipped} item(s) that had no upstream supplier selected.`);
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
    const ok = await persistUpstreamCartDraft({
      selectedMine,
      selectedUpstreamOffer,
      suggestions: Array.isArray(suggestions) ? suggestions : [],
      brandFilter,
      searchTerm,
      cartName
    });
    if (ok) {
      setSelectedMine({});
      setSelectedUpstreamOffer({});
      setSuggestions(null);
      setSuggestionMeta(null);
      setBrandFilter('');
      setSearchTerm('');
      emitSupplierCartUpdated();
      alert('Upstream cart saved successfully.');
      navigate('/supplier-cart');
    }
  };

  const persistUpstreamCartDraft = async (nextDraft, options = {}) => {
    const silent = options.silent === true;
    if (!silent) setSavingCart(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(nextDraft)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to save upstream cart');
      }
      return true;
    } catch (e) {
      if (!silent) {
        alert(e?.message || 'Failed to save upstream cart');
      }
      return false;
    } finally {
      if (!silent) setSavingCart(false);
    }
  };

  const handleAddSingleProductToCart = async (product) => {
    const mineId = normalizeSupplierProductKey(product?.supplier_product_id);
    if (!mineId) return;
    const minQty = Math.max(1, product?.min_order_quantity ?? 1);
    const parsedQty = parseSupplierStockQuantity(selectedMine?.[mineId]);
    const nextQty = parsedQty != null && parsedQty > 0 ? Math.max(minQty, parsedQty) : minQty;

    setAddingCartByMineId((prev) => ({ ...prev, [mineId]: true }));
    let ok = false;
    let responseMessage = '';
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart/items'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mineSupplierProductId: mineId,
          quantity: nextQty
        })
      });
      const data = await res.json();
      ok = res.ok && data.status === 'success';
      responseMessage = data?.message || '';
      if (ok && data?.item?.quantity != null) {
        const savedQty = parseSupplierStockQuantity(data.item.quantity) ?? nextQty;
        setSelectedMine((prev) => ({ ...prev, [mineId]: savedQty }));
      }
    } catch (e) {
      ok = false;
    }
    setAddingCartByMineId((prev) => {
      const { [mineId]: _removed, ...rest } = prev;
      return rest;
    });
    if (!ok) {
      alert('Failed to add this product to cart.');
      return;
    }

    emitSupplierCartUpdated();
    alert(responseMessage || 'Product added to cart.');
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
    <SpPageLayout showStepper={false}>
      <div className="dashboard-container supplier-upstream-page !max-w-none !p-0">
      <SpPageHeader
        title="Upstream Sourcing"
        description="Select inventory, find tier-above partners via brand chain routing, and build your purchase cart. Track placed orders on My Upstream Orders."
        icon={Network}
        actions={
          <>
            <Button variant="outline" className="upstream-nowrap-btn" onClick={() => navigate('/supplier-upstream-orders')}>
              My orders
            </Button>
            <Button variant="outline" className="upstream-nowrap-btn" onClick={() => navigate('/supplier-cart')}>
              View Cart
            </Button>
            <Button variant="outline" className="upstream-nowrap-btn" onClick={() => navigate('/supplier-dashboard')}>
              Back to Dashboard
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SpStatCard label="Selected Items" value={selectedMineIds.length} icon={ShoppingCart} accent="indigo" />
        <SpStatCard label="Visible Inventory Lines" value={visibleInventoryCount} icon={Package} accent="emerald" />
        <SpStatCard label="Suggested Groups" value={suggestedGroupCount} icon={Network} accent="amber" />
        <Card className="sp-market-card">
          <CardContent className="p-4">
            <p className="upstream-hero-copy !m-0">
              <strong>Routing:</strong> Brand chain first, fallback to role flow
              {' '}Layers follow the <strong>admin brand chain</strong> (e.g. MGF → Stockist → … → Retailer). Tiers not in admin—such as Dealer—are skipped; you buy from the layer directly above you.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-section upstream-section">
          <div className="section-header upstream-section-header">
            <h2>Select Brand + Products</h2>
            <span className="upstream-section-hint">
              <Network size={18} />
              Inventory tied to role and brand-chain routing
            </span>
          </div>

          <div className="upstream-filters-row">
            <div className="search-box upstream-filter">
              <Search size={16} />
              <input
                type="text"
                placeholder="Filter by brandModel (e.g. Amul)"
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
              />
            </div>

            <div className="search-box upstream-filter">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search product name"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="items-list upstream-products-scroll">
            {filteredProducts.length === 0 ? (
              <div className="empty-state">
                <Package size={48} />
                <h3>No matching products</h3>
                <p>Update brand filter or search term.</p>
              </div>
            ) : (
              filteredProducts.map((p) => {
                const mineId = normalizeSupplierProductKey(p.supplier_product_id);
                const minQty = Math.max(1, p.min_order_quantity ?? 1);
                const isSelected = !!selectedMine[mineId];
                const isAddingToCart = !!addingCartByMineId[mineId];
                const productImages = collectProductImages(p);

                return (
                  <div
                    key={mineId}
                    className={`item-card upstream-select-card ${isSelected ? 'upstream-select-card-selected' : ''}`}
                  >
                    <div className="item-info upstream-select-card-info">
                      <div className="upstream-product-main-row">
                        <div className="upstream-product-checkbox-wrap">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleMine(mineId)}
                          />
                        </div>
                        <div className="upstream-product-details">
                          <div className="upstream-product-header">
                            {productImages.length > 0 ? (
                              <div className="upstream-product-thumb">
                                <ProductImageCarousel
                                  images={productImages}
                                  alt={p.name || 'Product'}
                                  height={96}
                                  rounded={8}
                                />
                              </div>
                            ) : null}
                            <div className="upstream-product-header-text">
                              <h4 className="upstream-product-name">{p.name}</h4>
                              <p className="upstream-product-meta">
                                Brand: <strong>{p.brandModel || p.brand || 'N/A'}</strong>
                                {p.category ? (
                                  <>
                                    {' '}
                                    • Category: <strong>{p.category}</strong>
                                  </>
                                ) : null}
                              </p>
                              <p className="upstream-product-meta upstream-product-meta-tight">
                                {SUPPLIER_CURRENT_STOCK_LABEL}: <strong>{p.stock ?? 0}</strong> • Min order:{' '}
                                <strong>{p.min_order_quantity ?? 1}</strong>
                                {p.unit ? (
                                  <>
                                    {' '}
                                    • Unit: <strong>{p.unit}</strong>
                                  </>
                                ) : null}
                              </p>
                            </div>
                          </div>
                          <UpstreamProductDisplay product={p} showImage={false} maxSpecs={12} />
                        </div>
                      </div>
                    </div>

                    <div className="item-status upstream-select-card-status">
                      {isSelected ? (
                        <div className="upstream-qty-controls">
                          <label className="upstream-qty-label">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min={minQty}
                            step={1}
                            inputMode="numeric"
                            value={selectedMine[mineId] ?? minQty}
                            onChange={(e) => {
                              const v = parseSupplierStockQuantity(e.target.value);
                              setSelectedMine((prev) => ({
                                ...prev,
                                [mineId]: v != null && v > 0 ? Math.max(minQty, v) : minQty
                              }));
                            }}
                            className="upstream-qty-input"
                          />
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleAddSingleProductToCart(p)}
                            disabled={isAddingToCart}
                          >
                            {isAddingToCart ? 'Adding...' : 'Add to Cart'}
                          </button>
                        </div>
                      ) : (
                        <div className="upstream-qty-controls">
                          <div className="upstream-not-selected">Select to order upstream</div>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleAddSingleProductToCart(p)}
                            disabled={isAddingToCart}
                          >
                            {isAddingToCart ? 'Adding...' : 'Add to Cart'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="upstream-primary-actions">
            <button className="btn-primary upstream-inline-btn" onClick={fetchUpstreamSuggestions} disabled={suggestionsLoading}>
              {suggestionsLoading ? <Loader2 size={18} className="upstream-spin" /> : null}
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

        <div className="dashboard-section upstream-section">
          <div className="section-header upstream-section-header upstream-suggestions-header">
            <div>
              <h2 className={suggestionMeta?.rankPriority ? 'upstream-title-with-meta' : ''}>
                Choose upstream supplier (top {suggestionMeta?.limit ?? 5} matches)
              </h2>
              
            </div>
            <div className="upstream-suggestions-actions">
              <button
                className="btn-primary upstream-inline-btn"
                onClick={handleProceedToPlaceOrder}
                disabled={
                  creating ||
                  !suggestions ||
                  !Array.isArray(suggestions) ||
                  suggestions.length === 0 ||
                  linesReadyToPlace === 0
                }
              >
                {creating ? <Loader2 size={18} className="upstream-spin" /> : <ShoppingCart size={18} />}
                Proceed to Place Order
              </button>
              <button
                className="btn-secondary"
                onClick={handleSaveToCart}
                disabled={savingCart}
              >
                {savingCart ? 'Saving Cart...' : 'Save to Cart'}
              </button>
            </div>
          </div>

          {!suggestionsLoading && !suggestions ? (
            <div className="empty-state upstream-empty-top">
              <Network size={48} />
              <h3>No upstream suggestions yet</h3>
              <p>Select your products above and click “Find Upstream Suppliers”.</p>
            </div>
          ) : suggestions && suggestions.length === 0 ? (
            <div className="empty-state upstream-empty-top">
              <AlertTriangle size={48} />
              <h3>No upstream offers found</h3>
              <p>Try a different brand or select fewer products.</p>
            </div>
          ) : (
            <div className="upstream-suggestions-list">
              {(suggestions || []).map((it) => {
                const mine = resolveMineProduct(it.mineSupplierProductId);
                const mineKey = normalizeSupplierProductKey(it.mineSupplierProductId);
                const mineSelectedQty = selectedMine[mineKey] || 1;
                const offers = getCompatibleOffersForItem(it);
                const chosen = normalizeSupplierProductKey(selectedUpstreamOffer[mineKey]);

                const selectUpstreamOffer = (nextUpstreamOfferId) => {
                  const offerKey = normalizeSupplierProductKey(nextUpstreamOfferId);
                  if (!mineKey || !offerKey) return;
                  const chosenOffer = offers.find(
                    (o) => normalizeSupplierProductKey(o.upstreamSupplierProductId) === offerKey
                  );
                  const minQty = parseInt(chosenOffer?.minOrderQuantity || 1, 10) || 1;
                  setSelectedUpstreamOffer((prev) => ({ ...prev, [mineKey]: offerKey }));
                  setSelectedMine((prev) => {
                    const current = parseInt(prev?.[mineKey] || 1, 10) || 1;
                    const nextQty = current < minQty ? minQty : current;
                    return { ...prev, [mineKey]: nextQty };
                  });
                };

                return (
                  <div key={it.mineSupplierProductId} className="item-card upstream-offer-card">
                    <div className="item-info upstream-offer-item-info">
                      <h4 className="upstream-offer-product-title">{mine?.name || 'Product'}</h4>
                      <p className="upstream-offer-product-meta">
                        Brand: <strong>{it.brandModel || mine?.brandModel || 'N/A'}</strong> • Qty: <strong>{mineSelectedQty}</strong>
                      </p>
                      {mine ? <UpstreamProductDisplay product={mine} imageHeight={88} maxSpecs={10} /> : null}
                      {it.chainRouting?.requiredUpstreamRole ? (
                        <p className="upstream-route-rule upstream-route-rule-primary">
                          Route rule: <strong>Your layer:</strong> {formatLayerLabel(it.chainRouting.buyerRole)} {' | '}
                          <strong>Next allowed seller layer:</strong> {formatLayerLabel(it.chainRouting.requiredUpstreamRole)}
                          {it.chainRouting?.source === 'admin_chain'
                            ? ' (admin brand chain)'
                            : it.chainRouting?.source === 'admin_chain_inferred' ||
                                it.chainRouting?.source === 'admin_chain_walkback'
                              ? ' (from admin chain — uses the tier directly above you, skipping layers not in admin)'
                              : it.chainRouting?.source === 'standard_chain_walkback'
                                ? ' (default chain — no admin definition for this brand)'
                                : ''}
                        </p>
                      ) : (
                        <p className="upstream-route-rule">
                          Route rule: no seller layer resolved for this brand. Ask admin to define the supply chain in
                          Admin → Supply Chain, or ensure upstream partners are registered at the correct layer.
                        </p>
                      )}
                      {Array.isArray(it.chainRouting?.chainRoles) && it.chainRouting.chainRoles.length > 0 ? (
                        <p className="upstream-route-rule upstream-route-chain-stages">
                          Admin chain for this brand:{' '}
                          {it.chainRouting.chainRoles.map((r) => formatLayerLabel(r)).join(' → ')}
                        </p>
                      ) : null}
                    </div>

                    {offers.length === 0 ? (
                      <div className="upstream-offer-empty upstream-offer-empty-detailed">
                        {it.message || 'No upstream offers for this exact variant.'}
                      </div>
                    ) : (
                      <div className="upstream-offers-stack">
                        <p className="upstream-offers-help">
                          Best options first — <strong>select</strong> an upstream seller ({offers.length} shown). Each row shows that seller’s <strong>layer</strong> (not yours).
                        </p>
                        {offers.map((o, offerIdx) => {
                          const id = normalizeSupplierProductKey(o.upstreamSupplierProductId);
                          const isSelected = Boolean(id && chosen === id);
                          const ratingLabel =
                            o.averageRating != null && o.ratingCount > 0
                              ? `${o.averageRating}★ (${o.ratingCount} review${o.ratingCount === 1 ? '' : 's'})`
                              : 'no ratings yet';
                          return (
                            <div key={id || `offer-${offerIdx}`} className="upstream-offer-option-wrap">
                              <div
                                role="radio"
                                aria-checked={isSelected}
                                tabIndex={0}
                                className={`upstream-offer-option ${isSelected ? 'upstream-offer-option-selected' : ''}`}
                                onClick={() => selectUpstreamOffer(id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    selectUpstreamOffer(id);
                                  }
                                }}
                              >
                                <span
                                  className={`upstream-offer-radio-dot ${isSelected ? 'upstream-offer-radio-dot-checked' : ''}`}
                                  aria-hidden
                                />
                                <div className="upstream-offer-main">
                                  <div className="upstream-offer-head">
                                    <span className="upstream-offer-supplier-name">{o.supplierName}</span>
                                    {o.upstreamRole ? (
                                      <span className="upstream-role-chip" title="This partner's supply-chain layer (seller)">
                                        Seller layer: {formatLayerLabel(o.upstreamRole)}
                                      </span>
                                    ) : null}
                                    {offerIdx === 0 ? (
                                      <span className="upstream-rank-chip">
                                        {typeof o.distanceKm === 'number' ? '#1 nearest' : '#1 best match'}
                                      </span>
                                    ) : (
                                      <span className="upstream-rank-index">#{offerIdx + 1}</span>
                                    )}
                                  </div>
                                  <div className="upstream-offer-meta">
                                    {formatRupee(o.price || 0)} • {SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()} {o.stock ?? 0}
                                    {typeof o.distanceKm === 'number' ? ` • ${o.distanceKm} km` : ' • distance n/a'}
                                    {' • '}
                                    {ratingLabel}
                                    {Number(o.minimumOrderValueInr) > 0
                                      ? ` • min order ${formatRupee(o.minimumOrderValueInr)}`
                                      : ''}
                                  </div>
                                  {o.rankComponents ? (
                                    <div className="upstream-offer-rank-keys">
                                      Sort keys: {o.rankComponents.distanceKm != null ? `${o.rankComponents.distanceKm} km` : '—'} · {SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()} {o.rankComponents.stock} ·{' '}
                                      {formatRupee(o.rankComponents.price || 0)} · rating{' '}
                                      {o.rankComponents.averageRating != null ? `${o.rankComponents.averageRating} (${o.rankComponents.ratingCount || 0})` : '—'}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn-secondary upstream-details-btn"
                                title="View this supplier’s details"
                                onClick={() => openSupplierDetailsForOffer(o)}
                              >
                                <Info size={16} />
                                Details
                              </button>
                            </div>
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

      </div>

      {supplierDetailsOpen && supplierDetails && (
        <div
          className="modal-overlay"
          onClick={() => {
            setSupplierDetailsOpen(false);
            setSupplierDetails(null);
            setSupplierOfferDetails(null);
          }}
        >
          <div className="modal-content upstream-modal-content upstream-modal-content-narrow" onClick={(e) => e.stopPropagation()}>
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
                  <p className="upstream-muted-meta">
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
                <p className="upstream-muted-meta">
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
    </SpPageLayout>
  );
};

export default SupplierUpstream;

