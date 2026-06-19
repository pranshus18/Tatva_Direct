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
import UpstreamProductDisplay, { collectProductImages } from '../components/UpstreamProductDisplay';
import SupplierProductDetailsModal from '../components/SupplierProductDetailsModal';
import { SUPPLIER_CURRENT_STOCK_LABEL } from '../utils/supplierStockLabel';
import { formatRupee } from '../utils/formatRupee';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import { formatDateIST } from '../utils/dateTime';
import { normalizeSupplierProductsFromApi } from '../utils/supplierProductRow';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

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
  const [cartProjects, setCartProjects] = useState([]);
  const [addCartDialogOpen, setAddCartDialogOpen] = useState(false);
  const [pendingCartProduct, setPendingCartProduct] = useState(null);
  const [targetCartProjectId, setTargetCartProjectId] = useState('__new__');
  const [newCartProjectName, setNewCartProjectName] = useState('');
  const [newCartRequiredDate, setNewCartRequiredDate] = useState('');

  const [supplierDetailsOpen, setSupplierDetailsOpen] = useState(false);
  const [supplierDetails, setSupplierDetails] = useState(null);
  const [supplierOfferDetails, setSupplierOfferDetails] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);

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

  const loadSupplierCartProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return [];
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        return [];
      }
      const projects = Array.isArray(data?.cart?.draft?.projects) ? data.cart.draft.projects : [];
      const normalized = projects
        .filter((project) => String(project?.projectId || '').trim())
        .map((project) => ({
          projectId: String(project.projectId),
          cartName: String(project?.cartName || '').trim() || 'Supplier Project',
          requiredDate: String(project?.requiredDate || '').trim().slice(0, 10)
        }));
      setCartProjects(normalized);
      return normalized;
    } catch {
      return [];
    }
  };

  const openAddToCartDialog = async (product) => {
    const mineId = normalizeSupplierProductKey(product?.supplier_product_id);
    if (!mineId) return;
    const projects = await loadSupplierCartProjects();
    setPendingCartProduct(product);
    setTargetCartProjectId(projects[0]?.projectId || '__new__');
    setNewCartProjectName(String(product?.name || '').trim() || 'Supplier Project');
    setNewCartRequiredDate('');
    setAddCartDialogOpen(true);
  };

  const handleAddSingleProductToCart = async () => {
    const product = pendingCartProduct;
    const mineId = normalizeSupplierProductKey(product?.supplier_product_id);
    if (!mineId) return;
    const minQty = Math.max(1, product?.min_order_quantity ?? 1);
    const parsedQty = parseSupplierStockQuantity(selectedMine?.[mineId]);
    const nextQty = parsedQty != null && parsedQty > 0 ? Math.max(minQty, parsedQty) : minQty;
    const isNewProject = targetCartProjectId === '__new__';
    if (isNewProject && !newCartProjectName.trim()) {
      alert('Please enter project name for new supplier project.');
      return;
    }
    if (isNewProject && !newCartRequiredDate) {
      alert('Please select expected delivery date for new supplier project.');
      return;
    }

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
          quantity: nextQty,
          ...(isNewProject
            ? { cartName: newCartProjectName.trim(), requiredDate: newCartRequiredDate }
            : { projectId: targetCartProjectId })
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

    setAddCartDialogOpen(false);
    setPendingCartProduct(null);
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

      <div className="us-kpis">
        <div className="us-kpi">
          <div className="us-kpi__value">{selectedMineIds.length}</div>
          <div className="us-kpi__label">Selected items</div>
        </div>
        <div className="us-kpi">
          <div className="us-kpi__value">{visibleInventoryCount}</div>
          <div className="us-kpi__label">Inventory lines</div>
        </div>
        <div className="us-kpi">
          <div className="us-kpi__value">{suggestedGroupCount}</div>
          <div className="us-kpi__label">Suggested groups</div>
        </div>
      </div>

      <p className="us-routing-note">
        <Info size={15} aria-hidden />
        <span>
          <strong>Routing:</strong> purchases follow the admin brand chain (e.g. MGF → Stockist → … → Retailer).
          Layers not defined in admin are skipped; you buy from the tier directly above you.
        </span>
      </p>

      <div className="dashboard-content">
        <div className="dashboard-section upstream-section us-select-panel">
          <div className="us-select-panel__header">
            <div className="us-select-panel__title-block">
              <h2>Select Brand + Products</h2>
            </div>
            <div className="us-select-panel__summary">
              <span className="us-select-panel__summary-item">
                <strong>{selectedMineIds.length}</strong> selected
              </span>
              <span className="us-select-panel__summary-divider" aria-hidden />
              <span className="us-select-panel__summary-item">
                <strong>{filteredProducts.length}</strong> lines shown
              </span>
            </div>
          </div>

          <div className="us-select-panel__filters">
            <label className="us-field">
              <span className="us-field__label">Brand / model</span>
              <div className="us-field__control search-box upstream-filter">
                <Search size={15} />
                <input
                  type="search"
                  placeholder="e.g. acc, Amul"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                />
              </div>
            </label>
            <label className="us-field">
              <span className="us-field__label">Product name</span>
              <div className="us-field__control search-box upstream-filter">
                <Search size={15} />
                <input
                  type="search"
                  placeholder="Search by name"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </label>
          </div>

          <div className="us-product-table">
            <div className="us-product-table__head">
              <span aria-hidden />
              <span aria-hidden />
              <span>Product</span>
              <span>{SUPPLIER_CURRENT_STOCK_LABEL}</span>
              <span>Order</span>
            </div>

            <div className="us-product-table__body">
              {filteredProducts.length === 0 ? (
                <div className="us-product-table__empty">
                  <Package size={28} />
                  <h3>No matching products</h3>
                  <p>Adjust brand or name filters.</p>
                </div>
              ) : (
                filteredProducts.map((p) => {
                  const mineId = normalizeSupplierProductKey(p.supplier_product_id);
                  const minQty = Math.max(1, p.min_order_quantity ?? 1);
                  const isSelected = !!selectedMine[mineId];
                  const isAddingToCart = !!addingCartByMineId[mineId];
                  const productImages = collectProductImages(p);
                  const brandLabel = p.brandModel || p.brand || '—';

                  return (
                    <div
                      key={mineId}
                      className={`us-product-row ${isSelected ? 'us-product-row--selected' : ''}`}
                    >
                      <div className="us-product-row__check">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleMine(mineId)}
                          aria-label={`Select ${p.name || 'product'}`}
                        />
                      </div>

                      <div
                        className="us-product-row__thumb us-product-row__clickable"
                        onClick={() => setViewingProduct(p)}
                        onKeyDown={(e) => e.key === 'Enter' && setViewingProduct(p)}
                        role="button"
                        tabIndex={0}
                        title="View full details"
                      >
                        {productImages.length > 0 ? (
                          <ProductImageCarousel
                            images={productImages}
                            alt={p.name || 'Product'}
                            height={56}
                            rounded={6}
                          />
                        ) : (
                          <div className="us-product-row__thumb-placeholder" aria-hidden />
                        )}
                      </div>

                      <div
                        className="us-product-row__main us-product-row__clickable"
                        onClick={() => setViewingProduct(p)}
                        onKeyDown={(e) => e.key === 'Enter' && setViewingProduct(p)}
                        role="button"
                        tabIndex={0}
                        title="View full details"
                      >
                        <h4 className="us-product-row__name">{p.name}</h4>
                        <dl className="us-facts">
                          <div className="us-facts__item">
                            <dt>Brand</dt>
                            <dd>{brandLabel}</dd>
                          </div>
                          <div className="us-facts__item">
                            <dt>Category</dt>
                            <dd>{p.category || '—'}</dd>
                          </div>
                          <div className="us-facts__item">
                            <dt>Min order</dt>
                            <dd>
                              {p.min_order_quantity ?? 1}
                              {p.unit ? ` ${p.unit}` : ''}
                            </dd>
                          </div>
                        </dl>
                        <UpstreamProductDisplay
                          product={p}
                          showImage={false}
                          showDescription={false}
                          maxSpecs={24}
                          specLayout="grid"
                          collapsibleSpecs
                          compact
                        />
                      </div>

                      <div className="us-product-row__stock us-product-row__cell">
                        <span className="us-product-row__cell-label">{SUPPLIER_CURRENT_STOCK_LABEL}</span>
                        <span className="us-product-row__stock-value">
                          {p.stock ?? 0}
                          {p.unit ? ` ${p.unit}` : ''}
                        </span>
                      </div>

                      <div className="us-product-row__order us-product-row__cell">
                        <span className="us-product-row__cell-label">Quantity</span>
                        {isSelected ? (
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
                            className="upstream-qty-input us-product-row__qty"
                          />
                        ) : (
                          <span className="us-product-row__qty-hint">Select row</span>
                        )}
                        <button
                          type="button"
                          className="btn-secondary us-product-row__cart-btn"
                          onClick={() => openAddToCartDialog(p)}
                          disabled={isAddingToCart}
                        >
                          {isAddingToCart ? 'Adding…' : 'Add to cart'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="us-select-panel__footer">
            <p className="us-select-panel__footer-hint">
              {selectedMineIds.length > 0
                ? `${selectedMineIds.length} product${selectedMineIds.length !== 1 ? 's' : ''} ready to find suppliers.`
                : 'Select one or more products, then find upstream suppliers.'}
            </p>
            <div className="us-select-panel__footer-actions">
              <button
                type="button"
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
              <button
                type="button"
                className="btn-primary upstream-inline-btn"
                onClick={fetchUpstreamSuggestions}
                disabled={suggestionsLoading}
              >
                {suggestionsLoading ? <Loader2 size={16} className="upstream-spin" /> : null}
                Find upstream suppliers
              </button>
            </div>
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

      {viewingProduct ? (
        <SupplierProductDetailsModal product={viewingProduct} onClose={() => setViewingProduct(null)} />
      ) : null}
      <Dialog open={addCartDialogOpen} onOpenChange={setAddCartDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select supplier project</DialogTitle>
            <DialogDescription>
              Choose an existing project or create a new one for this cart item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Project</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={targetCartProjectId}
                onChange={(event) => {
                  const nextProjectId = event.target.value;
                  setTargetCartProjectId(nextProjectId);
                  if (nextProjectId !== '__new__') {
                    setNewCartRequiredDate('');
                  }
                }}
              >
                {cartProjects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.cartName}
                  </option>
                ))}
                <option value="__new__">+ Create new project</option>
              </select>
            </div>
            {targetCartProjectId === '__new__' ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Project name</label>
                  <Input
                    maxLength={120}
                    value={newCartProjectName}
                    onChange={(event) => setNewCartProjectName(event.target.value)}
                    placeholder="e.g. July restock"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Expected delivery date</label>
                  <Input
                    type="date"
                    value={newCartRequiredDate}
                    onChange={(event) => setNewCartRequiredDate(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Expected delivery date for this project:{' '}
                {(() => {
                  const requiredDate = cartProjects.find((project) => project.projectId === targetCartProjectId)?.requiredDate;
                  return requiredDate ? formatDateIST(requiredDate, '—') : 'Not set';
                })()}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCartDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddSingleProductToCart}>Add to cart</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </SpPageLayout>
  );
};

export default SupplierUpstream;

