import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getApiUrl, authFetch } from '../config/api';
import './SupplierUpstream.css';
import './ProductDiscovery.css';
import './CreatePO.css';
import {
  Network,
  Package,
  ShoppingCart,
  Search,
  Loader2,
  AlertTriangle,
  X,
  Info,
  MapPin,
  Check,
  ChevronLeft,
  ChevronRight,
  ImageOff
} from 'lucide-react';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpEmptyState from '../components/sp/SpEmptyState';
import UpstreamProductDisplay, { collectProductImages } from '../components/UpstreamProductDisplay';
import SupplierProductDetailsModal from '../components/SupplierProductDetailsModal';
import { SUPPLIER_CURRENT_STOCK_LABEL } from '../utils/supplierStockLabel';
import { formatRupee, formatRupeePerUnit } from '../utils/formatRupee';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import { dedupeCategoryStrings } from '../utils/categoryNormalize';
import { formatDateIST, getTodayDateInputValue, isDateBeforeToday } from '../utils/dateTime';
import {
  createUpstreamCheckoutSessionId,
  clearCheckoutHoldExpired,
  reserveUpstreamCheckoutInventory,
  SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY
} from '../utils/upstreamCheckoutReservation';
import { filterSupplierProductsForUpstream, normalizeSupplierProductKey } from '../utils/supplierProductRow';
import {
  UPSTREAM_SOURCING_PATH,
  openUpstreamProductDetailInNewTab
} from '../utils/discoveryNavigation';
import { getProductImageList } from '../utils/productImages';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import {
  formatShippingAddressLabel,
  formatShippingAddressPreview,
  normalizeShippingAddressBookEntry
} from '../utils/shippingAddressLabel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const blankShippingAddress = {
  label: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: ''
};

const emptyProjectFieldErrors = {
  projectName: '',
  expectedDispatchDate: ''
};

const todayDateMin = getTodayDateInputValue();

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

function formatPrice(price, unit) {
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) return null;
  return formatRupeePerUnit(num, unit, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function SpecBadges({ specifications }) {
  if (!specifications || typeof specifications !== 'object') return null;
  const entries = Object.entries(specifications).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim()
  );
  if (!entries.length) return null;
  return (
    <div className="pd-specs">
      {entries.slice(0, 4).map(([key, val]) => (
        <span key={key} className="pd-spec-badge">
          <strong>{key}:</strong> {String(val)}
        </span>
      ))}
      {entries.length > 4 && <span className="pd-spec-badge pd-spec-more">+{entries.length - 4} more</span>}
    </div>
  );
}

const UPSTREAM_PAGE_SIZE = 24;

/** Stable keys for supplier_products junction IDs (avoids string/UUID mismatches in selection state). */
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

const isSameVariantOfferForMine = (mineProduct, offer, mineSupplierProductId, suggestionItem) => {
  if (!offer) return false;

  const mineVariantKey = normalizeVariantToken(
    mineProduct?.variantKey || suggestionItem?.mineVariantKey
  );
  const mineVariantAsin = normalizeVariantToken(
    mineProduct?.variantAsin || suggestionItem?.mineVariantAsin
  );
  const offerVariantKey = normalizeVariantToken(offer?.upstreamVariantKey || offer?.variantKey);
  const offerVariantAsin = normalizeVariantToken(offer?.upstreamVariantAsin || offer?.variantAsin);

  if (mineVariantKey && offerVariantKey && offerVariantKey === mineVariantKey) return true;
  if (mineVariantAsin && offerVariantAsin && offerVariantAsin === mineVariantAsin) return true;

  // Supply-chain: same catalog product from a validated upstream partner offer.
  const upstreamProductId = String(offer?.upstreamProductId || offer?.productId || '').trim();
  const mineProductId = String(
    mineProduct?.id || suggestionItem?.productId || offer?.productId || ''
  ).trim();
  if (upstreamProductId && mineProductId && upstreamProductId === mineProductId) return true;

  return false;
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

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [page, setPage] = useState(1);

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
  const [projectFieldErrors, setProjectFieldErrors] = useState(emptyProjectFieldErrors);
  const [dialogError, setDialogError] = useState('');
  const [shippingAddressBook, setShippingAddressBook] = useState([]);
  const [selectedShippingAddressId, setSelectedShippingAddressId] = useState('');
  const [newShippingAddress, setNewShippingAddress] = useState(blankShippingAddress);
  const [locatingShippingAddress, setLocatingShippingAddress] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState('');

  const [supplierDetailsOpen, setSupplierDetailsOpen] = useState(false);
  const [supplierDetails, setSupplierDetails] = useState(null);
  const [supplierOfferDetails, setSupplierOfferDetails] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const cat = selectedCategory.trim().toLowerCase();

    return (products || []).filter((p) => {
      const brandModel = String(p?.brandModel || p?.brand || '').toLowerCase();
      const name = String(p?.name || '').toLowerCase();
      const category = String(p?.category || '').toLowerCase();

      const matchesSearch = !q || name.includes(q) || brandModel.includes(q);
      const matchesCategory = !cat || category === cat;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  const categories = useMemo(
    () => dedupeCategoryStrings((products || []).map((product) => product?.category)),
    [products]
  );

  const pageCount = useMemo(() => {
    const count = filteredProducts.length;
    if (!count) return 1;
    return Math.max(1, Math.ceil(count / UPSTREAM_PAGE_SIZE));
  }, [filteredProducts.length]);

  const safePage = Math.min(Math.max(page, 1), pageCount);

  const pagedProducts = useMemo(() => {
    const start = (safePage - 1) * UPSTREAM_PAGE_SIZE;
    return filteredProducts.slice(start, start + UPSTREAM_PAGE_SIZE);
  }, [filteredProducts, safePage]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedCategory]);

  const fetchMyProducts = async () => {
    try {
      const res = await authFetch('/api/supplier/products?forUpstream=true', {
        cache: 'no-cache'
      });
      const data = await res.json();
      if (data.status === 'success') {
        setProducts(filterSupplierProductsForUpstream(data.products || []));
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

  // Handoff from the product detail page: `?add=<supplier_product_id>` reopens the cart dialog
  // for that listing so sourcing decisions stay on this page.
  const handledAddParamRef = useRef('');
  useEffect(() => {
    if (loading) return;
    const requestedMineId = normalizeSupplierProductKey(
      new URLSearchParams(window.location.search).get('add')
    );
    if (!requestedMineId || handledAddParamRef.current === requestedMineId) return;
    handledAddParamRef.current = requestedMineId;
    navigate(UPSTREAM_SOURCING_PATH, { replace: true });
    const product = (products || []).find(
      (p) => normalizeSupplierProductKey(p?.supplier_product_id) === requestedMineId
    );
    if (product) openAddToCartDialog(product);
  }, [loading, products, navigate]);

  const applyActiveCartProject = (project) => {
    if (!project || typeof project !== 'object') return;
    const projectId = String(project?.projectId || '').trim();
    if (!projectId) return;
    setActiveProjectId(projectId);
    setCartName(String(project?.cartName || '').trim());
  };

  const hydrateActiveCartProject = async (preferredProjectId = '') => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;
      const cartRes = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await cartRes.json();
      if (!cartRes.ok || data.status !== 'success') return null;

      const projects = Array.isArray(data?.cart?.draft?.projects) ? data.cart.draft.projects : [];
      const normalized = projects
        .filter((project) => String(project?.projectId || '').trim())
        .map((project) => ({
          projectId: String(project.projectId),
          cartName: String(project?.cartName || '').trim() || 'Supplier Project',
          requiredDate: String(project?.requiredDate || '').trim().slice(0, 10),
          shippingAddressId: String(project?.shippingAddressId || '').trim(),
          shippingAddress: project?.shippingAddress || null,
          location: String(project?.location || '').trim()
        }));
      setCartProjects(normalized);

      const hasShipping = (project) =>
        Boolean(
          project?.shippingAddress ||
            project?.location ||
            project?.shippingAddressId
        );
      const preferred = preferredProjectId
        ? projects.find((project) => String(project?.projectId || '') === String(preferredProjectId))
        : null;
      const active =
        (preferred && hasShipping(preferred) ? preferred : null) ||
        projects.find(hasShipping) ||
        preferred ||
        projects[0] ||
        null;
      if (active) applyActiveCartProject(active);
      return active;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let preferredProjectId = '';
    try {
      const cartRaw = localStorage.getItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
      const restoreFromOrder = sessionStorage.getItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY) === '1';
      const orderRaw = restoreFromOrder ? localStorage.getItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY) : null;
      const raw = cartRaw || orderRaw;
      if (raw) {
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
          if (typeof draft.searchQuery === 'string') {
            setSearchQuery(draft.searchQuery);
          } else {
            const legacyParts = [draft.searchTerm, draft.brandFilter]
              .map((v) => (typeof v === 'string' ? v.trim() : ''))
              .filter(Boolean);
            if (legacyParts.length) setSearchQuery(legacyParts.join(' '));
          }
          if (typeof draft.selectedCategory === 'string') setSelectedCategory(draft.selectedCategory);
          if (typeof draft.cartName === 'string') setCartName(draft.cartName);
          if (typeof draft.projectId === 'string' && draft.projectId.trim()) {
            preferredProjectId = String(draft.projectId).trim();
          }
        }

        if (cartRaw) localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
        if (restoreFromOrder) sessionStorage.removeItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY);
      }
    } catch (_) {
      localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
      sessionStorage.removeItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY);
    }

    void hydrateActiveCartProject(preferredProjectId);
  }, []);

  useEffect(() => {
    const onCartUpdated = () => {
      void hydrateActiveCartProject(activeProjectId);
    };
    window.addEventListener('supplier-upstream-cart-updated', onCartUpdated);
    return () => window.removeEventListener('supplier-upstream-cart-updated', onCartUpdated);
  }, [activeProjectId]);

  const selectedMineIds = useMemo(
    () => Object.keys(normalizeSelectionMap(selectedMine || {})),
    [selectedMine]
  );
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
    return offers.filter((offer) => isSameVariantOfferForMine(mine, offer, mineKey, item));
  }

  const resolveSuggestionShippingAddressId = () => {
    const activeProject = cartProjects.find(
      (project) => String(project?.projectId || '') === String(activeProjectId || '')
    );
    const projectAddressId = String(activeProject?.shippingAddressId || '').trim();
    if (projectAddressId) return projectAddressId;
    const selectedId = String(selectedShippingAddressId || '').trim();
    if (selectedId && selectedId !== '__new__') return selectedId;
    return String(shippingAddressBook[0]?.id || '').trim();
  };

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
      const params = new URLSearchParams({
        supplierProductIds: ids,
        limit: '5',
        _: String(Date.now())
      });
      if (activeProjectId) {
        params.set('projectId', activeProjectId);
      }
      const shippingAddressId = resolveSuggestionShippingAddressId();
      if (shippingAddressId) {
        params.set('shippingAddressId', shippingAddressId);
      }
      const res = await fetch(getApiUrl(`/api/supplier/upstream/suggestions?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
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
        deliveryAddressLabel: data.deliveryAddressLabel || null,
        buyerGeoDiagnostics: data.buyerGeoDiagnostics || null
      });

      // Keep prior picks; auto-select nearest (#1) when nothing chosen yet for that line.
      setSelectedUpstreamOffer((prev) => {
        const next = {};
        const normalizedPrev = normalizeSelectionMap(prev);
        (data.items || []).forEach((it) => {
          const mineId = normalizeSupplierProductKey(it.mineSupplierProductId);
          const prevPick = normalizedPrev[mineId];
          const offers = Array.isArray(it.upstreamOffers) ? it.upstreamOffers : [];
          if (!mineId || offers.length === 0) return;
          if (
            prevPick &&
            offers.some(
              (o) => normalizeSupplierProductKey(o.upstreamSupplierProductId) === prevPick
            )
          ) {
            next[mineId] = prevPick;
            return;
          }
          const nearestId = normalizeSupplierProductKey(offers[0]?.upstreamSupplierProductId);
          if (nearestId) next[mineId] = nearestId;
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
        supplierId: l.supplierId,
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

      const checkoutSessionId = createUpstreamCheckoutSessionId();
      clearCheckoutHoldExpired(SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY);
      const token = localStorage.getItem('token');
      const reservationPayload = selectedLinesDetailed.map((line) => ({
        mineSupplierProductId: line.mineSupplierProductId,
        upstreamSupplierProductId: line.upstreamSupplierProductId,
        supplierId: line.supplierId,
        quantity: line.quantity
      }));
      const missingSupplierLine = reservationPayload.find((line) => !line.supplierId);
      if (missingSupplierLine) {
        alert('Could not resolve the upstream supplier for one of the selected items. Please pick a supplier row again.');
        return;
      }
      const reservation = await reserveUpstreamCheckoutInventory({
        token,
        checkoutSessionId,
        lines: reservationPayload
      });

      const activeProject =
        cartProjects.find((project) => String(project?.projectId || '') === String(activeProjectId || '')) ||
        cartProjects[0] ||
        null;
      const projectShipping =
        activeProject?.shippingAddress && typeof activeProject.shippingAddress === 'object'
          ? activeProject.shippingAddress
          : null;
      const projectShippingId = String(activeProject?.shippingAddressId || '').trim();

      const reviewLinesWithShipping = selectedLinesDetailed.map((line) => ({
        ...line,
        ...(projectShipping ? { shippingAddress: projectShipping } : {})
      }));

      const shippingAddressLabel = projectShipping
        ? formatShippingAddressLabel(
            shippingAddressBook.find((entry) => entry.id === projectShippingId) || projectShipping
          )
        : projectShipping
          ? formatShippingAddressPreview(projectShipping)
          : '';

      // Persist a draft so the next page can ask required date + payment method.
      localStorage.setItem(
        SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY,
        JSON.stringify({
          lines,
          checkoutSessionId,
          reservationExpiresAt: reservation.expiresAt || null,
          requiredDate: '',
          paymentMethod: 'online',
          itemCount: lines.length,
          totalAmountEstimate,
          reviewLines: reviewLinesWithShipping,
          checkoutShippingAddress: projectShipping,
          shippingAddressId: projectShippingId || null,
          shippingAddressLabel,
          selectedMine,
          selectedUpstreamOffer,
          suggestions,
          searchQuery,
          selectedCategory,
          transportSelection: null
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
    const activeProject = cartProjects.find(
      (project) => String(project?.projectId || '') === String(activeProjectId || '')
    );
    const ok = await persistUpstreamCartDraft({
      selectedMine,
      selectedUpstreamOffer,
      suggestions: Array.isArray(suggestions) ? suggestions : [],
      searchQuery,
      selectedCategory,
      cartName: cartName || activeProject?.cartName || '',
      ...(activeProjectId
        ? {
            projectId: activeProjectId,
            requiredDate: activeProject?.requiredDate || ''
          }
        : {})
    });
    if (ok) {
      setSelectedMine({});
      setSelectedUpstreamOffer({});
      setSuggestions(null);
      setSuggestionMeta(null);
      setSearchQuery('');
      setSelectedCategory('');
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
          requiredDate: String(project?.requiredDate || '').trim().slice(0, 10),
          shippingAddressId: String(project?.shippingAddressId || '').trim()
        }));
      setCartProjects(normalized);
      return normalized;
    } catch {
      return [];
    }
  };

  const loadProfileShippingAddresses = async () => {
    const token = localStorage.getItem('token');
    if (!token) return [];
    try {
      const res = await fetch(getApiUrl('/api/profile'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || !data?.profile) return [];
      const entries = Array.isArray(data.profile.shippingAddresses)
        ? data.profile.shippingAddresses
            .map((entry) => normalizeShippingAddressBookEntry(entry))
            .filter((entry) => entry.id)
        : [];
      setShippingAddressBook(entries);
      return entries;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    loadProfileShippingAddresses().then((entries) => {
      if (entries.length > 0) {
        setSelectedShippingAddressId((current) => current || entries[0].id);
      }
    });
  }, []);

  const applyProjectShippingSelection = (projectId, projects, addresses) => {
    const project = projects.find((entry) => entry.projectId === projectId);
    const projectAddressId = String(project?.shippingAddressId || '').trim();
    if (projectAddressId && addresses.some((entry) => entry.id === projectAddressId)) {
      setSelectedShippingAddressId(projectAddressId);
      setNewShippingAddress(blankShippingAddress);
      return;
    }
    if (addresses.length > 0) {
      setSelectedShippingAddressId(addresses[0].id);
      setNewShippingAddress(blankShippingAddress);
      return;
    }
    setSelectedShippingAddressId('__new__');
  };

  const fillShippingFromCurrentLocation = async () => {
    setLocatingShippingAddress(true);
    try {
      const resolved = await resolveAddressFromCurrentLocation();
      setNewShippingAddress((prev) => ({
        ...prev,
        line1: resolved.line1 || prev.line1,
        city: resolved.city || prev.city,
        state: resolved.state || prev.state,
        pincode: resolved.pincode || prev.pincode,
        country: resolved.country || prev.country || 'India',
        label: prev.label || resolved.city || 'Current location'
      }));
      setSelectedShippingAddressId('__new__');
    } catch (error) {
      window.alert(getGeolocationErrorMessage(error));
    } finally {
      setLocatingShippingAddress(false);
    }
  };

  const resolveShippingPayload = async (token) => {
    if (!selectedShippingAddressId) {
      return { shippingAddressId: null, shippingAddress: null };
    }

    if (selectedShippingAddressId === '__new__') {
      const missing = ['line1', 'city', 'state', 'pincode', 'country'].find(
        (field) => !String(newShippingAddress?.[field] || '').trim()
      );
      if (missing) {
        throw new Error('Please complete all shipping address fields or choose a saved address.');
      }
      const saveRes = await fetch(getApiUrl('/api/profile/shipping-addresses'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          label: newShippingAddress.label?.trim() || newShippingAddress.city,
          line1: newShippingAddress.line1.trim(),
          city: newShippingAddress.city.trim(),
          state: newShippingAddress.state.trim(),
          pincode: newShippingAddress.pincode.trim(),
          country: newShippingAddress.country.trim()
        })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.status !== 'success') {
        throw new Error(saveData.message || 'Failed to save shipping address to profile.');
      }
      const saved = saveData.shippingAddress || {};
      const normalized = normalizeShippingAddressBookEntry(saved);
      setShippingAddressBook((prev) => {
        const exists = prev.some((entry) => entry.id === normalized.id);
        return exists ? prev : [...prev, normalized];
      });
      setSelectedShippingAddressId(normalized.id);
      return {
        shippingAddressId: normalized.id,
        shippingAddress: normalized.address
      };
    }

    const selected = shippingAddressBook.find((entry) => entry.id === selectedShippingAddressId);
    if (!selected) {
      throw new Error('Selected shipping address was not found. Please choose again.');
    }
    return {
      shippingAddressId: selected.id,
      shippingAddress: selected.address
    };
  };

  const openAddToCartDialog = async (product) => {
    const mineId = normalizeSupplierProductKey(product?.supplier_product_id);
    if (!mineId) return;
    const [projects, addresses] = await Promise.all([
      loadSupplierCartProjects(),
      loadProfileShippingAddresses()
    ]);
    const initialProjectId = projects[0]?.projectId || '__new__';
    setPendingCartProduct(product);
    setTargetCartProjectId(initialProjectId);
    setNewCartProjectName(String(product?.name || '').trim() || 'Supplier Project');
    setNewCartRequiredDate('');
    setProjectFieldErrors(emptyProjectFieldErrors);
    setDialogError('');
    applyProjectShippingSelection(initialProjectId, projects, addresses);
    setAddCartDialogOpen(true);
  };

  const handleAddSingleProductToCart = async () => {
    setDialogError('');
    const product = pendingCartProduct;
    const mineId = normalizeSupplierProductKey(product?.supplier_product_id);
    if (!mineId) return;
    const minQty = Math.max(1, product?.min_order_quantity ?? 1);
    const parsedQty = parseSupplierStockQuantity(selectedMine?.[mineId]);
    const nextQty = parsedQty != null && parsedQty > 0 ? Math.max(minQty, parsedQty) : minQty;
    const isNewProject = targetCartProjectId === '__new__';
    if (isNewProject) {
      const nextFieldErrors = { ...emptyProjectFieldErrors };
      if (!newCartProjectName.trim()) {
        nextFieldErrors.projectName = 'Please enter a project name.';
      }
      if (!newCartRequiredDate) {
        nextFieldErrors.expectedDispatchDate = 'Expected dispatch date is required.';
      } else if (isDateBeforeToday(newCartRequiredDate)) {
        nextFieldErrors.expectedDispatchDate = 'Expected dispatch date cannot be in the past.';
      }
      setProjectFieldErrors(nextFieldErrors);
      if (nextFieldErrors.projectName || nextFieldErrors.expectedDispatchDate) {
        return;
      }
    } else {
      setProjectFieldErrors(emptyProjectFieldErrors);
    }

    const token = localStorage.getItem('token');
    if (!token) {
      setDialogError('Please log in again to add items to cart.');
      return;
    }

    setAddingCartByMineId((prev) => ({ ...prev, [mineId]: true }));
    let ok = false;
    let responseMessage = '';
    try {
      const shippingPayload = await resolveShippingPayload(token);
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart/items'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mineSupplierProductId: mineId,
          quantity: nextQty,
          ...(product?.variantKey || product?.variant_key
            ? { variantKey: String(product.variantKey || product.variant_key) }
            : {}),
          ...(product?.variantAsin || product?.variant_asin
            ? { variantAsin: String(product.variantAsin || product.variant_asin) }
            : {}),
          ...(product?.name ? { variantLabel: String(product.name) } : {}),
          ...(isNewProject
            ? { cartName: newCartProjectName.trim(), requiredDate: newCartRequiredDate }
            : { projectId: targetCartProjectId }),
          ...(shippingPayload.shippingAddressId
            ? {
                shippingAddressId: shippingPayload.shippingAddressId,
                shippingAddress: shippingPayload.shippingAddress
              }
            : {})
        })
      });
      const data = await res.json();
      ok = res.ok && data.status === 'success';
      responseMessage = data?.message || '';
      if (!ok) {
        throw new Error(responseMessage || 'Failed to add this product to cart.');
      }
      if (data?.item?.quantity != null) {
        const savedQty = parseSupplierStockQuantity(data.item.quantity) ?? nextQty;
        setSelectedMine((prev) => ({ ...prev, [mineId]: savedQty }));
      }
      if (data?.project?.projectId) {
        await hydrateActiveCartProject(String(data.project.projectId));
      }
    } catch (e) {
      ok = false;
      responseMessage = e?.message || '';
    }
    setAddingCartByMineId((prev) => {
      const { [mineId]: _removed, ...rest } = prev;
      return rest;
    });
    if (!ok) {
      setDialogError(responseMessage || 'Failed to add this product to cart.');
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

  const openProductDetails = (product) => {
    if (!product) return;
    const catalogProductId =
      product?.catalogMissing === true ? '' : String(product?.id || product?.product_id || '').trim();
    const openedDetailPage = catalogProductId
      ? openUpstreamProductDetailInNewTab(catalogProductId, {
          variantKey: product?.variantKey || product?.variant_key || '',
          mineSupplierProductId: normalizeSupplierProductKey(product?.supplier_product_id)
        })
      : false;
    // Listings without a shared catalog id (or when the tab is blocked) keep the inline snapshot.
    if (!openedDetailPage) setViewingProduct(product);
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
      <SpPageLayout showStepper={false}>
        <SpPageHeader title="Upstream Sourcing" description="" icon={Network} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4 pt-4">
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </SpPageLayout>
    );
  }

  return (
    <SpPageLayout showStepper={false}>
      <div className="supplier-upstream-page">
      <SpPageHeader
        title="Upstream Sourcing"
        description=""
        icon={Network}
        actions={
          <>
            <Button variant="outline" className="upstream-nowrap-btn" onClick={() => navigate('/supplier-orders?direction=upstream')}>
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

      <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 p-3 shadow-sm backdrop-blur">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, brand, or model..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={selectedCategory}
          onChange={(event) => setSelectedCategory(event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <p className="us-routing-note mb-4">
        <Info size={15} aria-hidden />
        <span>
          <strong>Routing:</strong> purchases follow the admin brand chain (e.g. MGF → Stockist → … → Retailer).
          Layers not defined in admin are skipped; you buy from the tier directly above you.
        </span>
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">{filteredProducts.length}</strong> product{filteredProducts.length === 1 ? '' : 's'}
          {selectedMineIds.length > 0 ? (
            <Badge className="ml-2" variant="secondary">{selectedMineIds.length} selected</Badge>
          ) : null}
          {suggestedGroupCount > 0 ? (
            <Badge className="ml-2" variant="outline">{suggestedGroupCount} suggested</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">{safePage} / {pageCount}</span>
          <Button variant="outline" size="sm" disabled={safePage >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <SpEmptyState
          icon={Package}
          title={products.length === 0 ? 'No approved products for upstream sourcing' : 'No matching products'}
          description={
            products.length === 0
              ? 'Only admin-approved products appear here. Rejected or pending products stay on Manage Products until approved.'
              : 'Try a different search or category filter.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pagedProducts.map((p) => {
            const mineId = normalizeSupplierProductKey(p.supplier_product_id);
            const minQty = Math.max(1, p.min_order_quantity ?? 1);
            const isSelected = !!selectedMine[mineId];
            const isAddingToCart = !!addingCartByMineId[mineId];
            const imgs = getProductImageList(p);
            const brandLabel = p.brandModel || p.brand || '';
            const price = formatPrice(p?.price, p?.unit);
            const stockQty = p.stock ?? 0;
            const moq = Number(p?.min_order_quantity);

            return (
              <article
                key={mineId}
                className={`pd-card us-pd-card pd-card--clickable flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${isSelected ? 'us-pd-card--selected' : ''}`}
                onClick={() => openProductDetails(p)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openProductDetails(p);
                  }
                }}
                role="button"
                tabIndex={0}
                title="View product details"
              >
                <label
                  className="us-pd-card__select"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleMine(mineId)}
                    aria-label={`Select ${p.name || 'product'}`}
                  />
                  {isSelected ? <span className="us-pd-card__selected-badge"><Check size={12} /></span> : null}
                </label>

                <div className="pd-card__image us-pd-card__image" title="View full details">
                  {imgs.length > 0 ? (
                    <ProductImageCarousel images={imgs} alt={p.name} height={180} rounded={10} />
                  ) : (
                    <div className="pd-card__no-image">
                      <ImageOff size={36} />
                      <span>No image</span>
                    </div>
                  )}
                  {p.category ? <span className="pd-card__category-badge">{p.category}</span> : null}
                </div>

                <div className="pd-card__body">
                  <div className="pd-card__header">
                    <h3 className="pd-card__name us-pd-card__name">
                      {p.name || 'Unnamed Product'}
                    </h3>
                    {brandLabel ? <span className="pd-card__brand">{brandLabel}</span> : null}
                  </div>

                  <SpecBadges specifications={p.specifications} />

                  <div className="pd-card__details">
                    {price ? (
                      <span className="pd-card__price">{price}</span>
                    ) : (
                      <span className="pd-card__price pd-card__price--na">Your listing price n/a</span>
                    )}

                    <div className="pd-card__meta-row">
                      {p.unit ? <span className="pd-card__meta-item">Unit: {p.unit}</span> : null}
                      {moq > 1 ? <span className="pd-card__meta-item">MOQ: {moq}</span> : null}
                      <span className="pd-card__stock pd-card__stock--in">
                        {SUPPLIER_CURRENT_STOCK_LABEL}: {stockQty}{p.unit ? ` ${p.unit}` : ''}
                      </span>
                    </div>
                  </div>

                  {isSelected ? (
                    <div
                      className="us-pd-card__qty-row"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <label className="us-pd-card__qty-label">Quantity</label>
                      <div className="us-pd-card__qty-control">
                        <button
                          type="button"
                          className="us-pd-card__qty-btn"
                          onClick={() => {
                            const current = parseSupplierStockQuantity(selectedMine[mineId]) ?? minQty;
                            setSelectedMine((prev) => ({
                              ...prev,
                              [mineId]: Math.max(minQty, current - 1)
                            }));
                          }}
                          disabled={(parseSupplierStockQuantity(selectedMine[mineId]) ?? minQty) <= minQty}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="us-pd-card__qty-value">{selectedMine[mineId] ?? minQty}</span>
                        <button
                          type="button"
                          className="us-pd-card__qty-btn"
                          onClick={() => {
                            const current = parseSupplierStockQuantity(selectedMine[mineId]) ?? minQty;
                            setSelectedMine((prev) => ({
                              ...prev,
                              [mineId]: Math.max(minQty, current + 1)
                            }));
                          }}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="pd-card__footer">
                  <div className="pd-card__suppliers">
                    <span className="pd-card__view-hint">View details</span>
                    <span className="us-pd-card__hint">
                      {isSelected ? 'Selected for sourcing' : 'Select to source upstream'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="pd-card__cart-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      openAddToCartDialog(p);
                    }}
                    disabled={isAddingToCart}
                  >
                    {isAddingToCart ? (
                      <><Loader2 size={16} className="upstream-spin" /> Adding…</>
                    ) : (
                      <><ShoppingCart size={16} /> Add to Cart</>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="us-discovery-actions">
        <p className="us-discovery-actions__hint">
          {selectedMineIds.length > 0
            ? `${selectedMineIds.length} product${selectedMineIds.length !== 1 ? 's' : ''} ready to find suppliers.`
            : 'Select one or more products, then find upstream suppliers.'}
        </p>
        <div className="us-discovery-actions__buttons">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedMine({});
              setSuggestions(null);
              setSuggestionMeta(null);
              setSelectedUpstreamOffer({});
            }}
            disabled={suggestionsLoading || creating}
          >
            Clear selection
          </Button>
          <Button onClick={fetchUpstreamSuggestions} disabled={suggestionsLoading}>
            {suggestionsLoading ? <Loader2 size={16} className="upstream-spin" /> : null}
            Find upstream suppliers
          </Button>
        </div>
      </div>

        <div className="dashboard-section upstream-section us-suggestions-panel">
          <div className="section-header upstream-section-header upstream-suggestions-header">
            <div>
              <h2 className={suggestionMeta?.rankPriority ? 'upstream-title-with-meta' : ''}>
                Choose upstream supplier (top {suggestionMeta?.limit ?? 5} matches)
              </h2>
            </div>
            <div className="upstream-suggestions-actions">
              <Button
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
              </Button>
              <Button variant="outline" onClick={handleSaveToCart} disabled={savingCart}>
                {savingCart ? 'Saving Cart...' : 'Save to Cart'}
              </Button>
            </div>
          </div>

          {suggestionsLoading ? (
            <div className="us-suggestions-loading">
              <Loader2 size={28} className="upstream-spin" />
              <p>Finding upstream suppliers…</p>
            </div>
          ) : !suggestions ? (
            <SpEmptyState
              icon={Network}
              title="No upstream suggestions yet"
              description='Select your products above and click "Find upstream suppliers".'
            />
          ) : suggestions && suggestions.length === 0 ? (
            <SpEmptyState
              icon={AlertTriangle}
              title="No upstream offers found"
              description="Try a different brand or select fewer products."
            />
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
                      <h4
                        className="upstream-offer-product-title upstream-offer-product-title--clickable"
                        onClick={() => mine && openProductDetails(mine)}
                        onKeyDown={(event) => {
                          if ((event.key === 'Enter' || event.key === ' ') && mine) {
                            event.preventDefault();
                            openProductDetails(mine);
                          }
                        }}
                        role={mine ? 'button' : undefined}
                        tabIndex={mine ? 0 : undefined}
                        title={mine ? 'View product details' : undefined}
                      >
                        {mine?.name || 'Product'}
                      </h4>
                      <p className="upstream-offer-product-meta">
                        Brand: <strong>{it.chainRouting?.brand || it.brandModel || mine?.brand || mine?.brandModel || 'N/A'}</strong> • Qty: <strong>{mineSelectedQty}</strong>
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
                        {it.message || 'No upstream offers from your supply-chain partners for this product.'}
                      </div>
                    ) : (
                      <div className="upstream-offers-stack">
                        <p className="upstream-offers-help">
                          Best options first by distance to your delivery address — <strong>nearest is pre-selected</strong> ({offers.length} shown). Each row shows that seller’s <strong>layer</strong> (not yours).
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
                                    {formatRupee(o.price || 0)} • {SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()}{' '}
                                    {o.availableStock ?? o.stock ?? 0}
                                    {typeof o.distanceKm === 'number' ? ` • ${o.distanceKm} km` : ' • distance n/a'}
                                    {' • '}
                                    {ratingLabel}
                                    {Number(o.minimumOrderValueInr) > 0
                                      ? ` • min order ${formatRupee(o.minimumOrderValueInr)}`
                                      : ''}
                                    {o.variantMatchType === 'catalog_product' ? ' • partner catalog SKU' : ''}
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

      {supplierDetailsOpen && supplierDetails ? createPortal((
        <div
          className="modal-overlay"
          onClick={() => {
            setSupplierDetailsOpen(false);
            setSupplierDetails(null);
            setSupplierOfferDetails(null);
          }}
        >
          <div className="modal-content upstream-modal-content" onClick={(e) => e.stopPropagation()}>
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
      ), document.body) : null}

      {viewingProduct ? (
        <SupplierProductDetailsModal product={viewingProduct} onClose={() => setViewingProduct(null)} />
      ) : null}
      <Dialog open={addCartDialogOpen} onOpenChange={setAddCartDialogOpen}>
        <DialogContent className="flex h-full max-h-none w-full max-w-none flex-col overflow-hidden p-0">
          <div className="shrink-0 border-b px-6 py-4 pr-12">
            <DialogHeader>
              <DialogTitle>Select supplier project</DialogTitle>
              <DialogDescription>
                Choose an existing project or create a new one for this cart item.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <div className="space-y-4">
            {pendingCartProduct ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-medium">{pendingCartProduct.name || 'Product'}</div>
                {String(
                  pendingCartProduct.variantAsin ||
                    pendingCartProduct.variantKey ||
                    pendingCartProduct.variant_key ||
                    ''
                ).trim() ? (
                  <div className="mt-1 text-muted-foreground">
                    Variant:{' '}
                    {String(
                      pendingCartProduct.variantAsin ||
                        pendingCartProduct.variantKey ||
                        pendingCartProduct.variant_key
                    ).trim()}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1">
              <label className="text-sm font-medium">Project</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={targetCartProjectId}
                onChange={(event) => {
                  const nextProjectId = event.target.value;
                  setTargetCartProjectId(nextProjectId);
                  setProjectFieldErrors(emptyProjectFieldErrors);
                  setDialogError('');
                  if (nextProjectId !== '__new__') {
                    setNewCartRequiredDate('');
                  }
                  applyProjectShippingSelection(nextProjectId, cartProjects, shippingAddressBook);
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
                  <label className="text-sm font-medium" htmlFor="upstream-new-project-name">
                    Project name
                  </label>
                  <Input
                    id="upstream-new-project-name"
                    maxLength={120}
                    value={newCartProjectName}
                    aria-invalid={Boolean(projectFieldErrors.projectName)}
                    className={cn(projectFieldErrors.projectName && 'border-destructive')}
                    onChange={(event) => {
                      setNewCartProjectName(event.target.value);
                      if (projectFieldErrors.projectName) {
                        setProjectFieldErrors((prev) => ({ ...prev, projectName: '' }));
                      }
                    }}
                    placeholder="e.g. July restock"
                  />
                  {projectFieldErrors.projectName ? (
                    <p className="text-xs text-destructive" role="alert">
                      {projectFieldErrors.projectName}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="upstream-expected-dispatch-date">
                    Expected dispatch date
                  </label>
                  <Input
                    id="upstream-expected-dispatch-date"
                    type="date"
                    min={todayDateMin}
                    value={newCartRequiredDate}
                    aria-invalid={Boolean(projectFieldErrors.expectedDispatchDate)}
                    aria-describedby={
                      projectFieldErrors.expectedDispatchDate
                        ? 'upstream-expected-dispatch-date-error'
                        : undefined
                    }
                    className={cn(projectFieldErrors.expectedDispatchDate && 'border-destructive')}
                    onChange={(event) => {
                      const next = event.target.value;
                      setNewCartRequiredDate(next);
                      if (next && isDateBeforeToday(next)) {
                        setProjectFieldErrors((prev) => ({
                          ...prev,
                          expectedDispatchDate: 'Expected dispatch date cannot be in the past.'
                        }));
                        return;
                      }
                      if (projectFieldErrors.expectedDispatchDate) {
                        setProjectFieldErrors((prev) => ({ ...prev, expectedDispatchDate: '' }));
                      }
                    }}
                  />
                  {projectFieldErrors.expectedDispatchDate ? (
                    <p
                      id="upstream-expected-dispatch-date-error"
                      className="text-xs text-destructive"
                      role="alert"
                    >
                      {projectFieldErrors.expectedDispatchDate}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Expected dispatch date for this project:{' '}
                {(() => {
                  const requiredDate = cartProjects.find((project) => project.projectId === targetCartProjectId)?.requiredDate;
                  return requiredDate ? formatDateIST(requiredDate, '—') : 'Not set';
                })()}
              </p>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Shipping address</label>
                <p className="text-xs text-muted-foreground mt-1">
                  Optional. Saved to your profile when you add a new address.
                </p>
              </div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedShippingAddressId}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelectedShippingAddressId(next);
                  if (next !== '__new__') {
                    setNewShippingAddress(blankShippingAddress);
                  }
                }}
              >
                <option value="">No shipping address</option>
                {shippingAddressBook.map((entry, index) => (
                  <option key={entry.id} value={entry.id}>
                    {formatShippingAddressLabel(entry, index)}
                  </option>
                ))}
                <option value="__new__">+ Add new address</option>
              </select>

              {selectedShippingAddressId === '__new__' ? (
                <div className="space-y-3">
                  <div className="checkout-address-location-row">
                    <button
                      type="button"
                      className="checkout-location-btn"
                      onClick={fillShippingFromCurrentLocation}
                      disabled={locatingShippingAddress}
                    >
                      <MapPin size={15} aria-hidden />
                      {locatingShippingAddress ? 'Detecting location…' : 'Use my current location'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Address label</label>
                    <Input
                      maxLength={120}
                      placeholder="e.g. Warehouse, Branch"
                      value={newShippingAddress.label}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, label: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Street address</label>
                    <Input
                      placeholder="Building / street / area"
                      value={newShippingAddress.line1}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, line1: event.target.value }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">City</label>
                      <Input
                        placeholder="e.g. Pune"
                        value={newShippingAddress.city}
                        onChange={(event) =>
                          setNewShippingAddress((prev) => ({ ...prev, city: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">State</label>
                      <Input
                        placeholder="e.g. Maharashtra"
                        value={newShippingAddress.state}
                        onChange={(event) =>
                          setNewShippingAddress((prev) => ({ ...prev, state: event.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">PIN code</label>
                      <Input
                        placeholder="e.g. 411026"
                        value={newShippingAddress.pincode}
                        onChange={(event) =>
                          setNewShippingAddress((prev) => ({ ...prev, pincode: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Country</label>
                      <Input
                        placeholder="e.g. India"
                        value={newShippingAddress.country}
                        onChange={(event) =>
                          setNewShippingAddress((prev) => ({ ...prev, country: event.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {dialogError ? (
            <div
              className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {dialogError}
            </div>
          ) : null}
          </div>
          <div className="shrink-0 border-t bg-background px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setAddCartDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddSingleProductToCart}>Add to cart</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </SpPageLayout>
  );
};

export default SupplierUpstream;

