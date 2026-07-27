import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Clock, RefreshCw, MapPin, Users } from 'lucide-react';
import { toast } from 'sonner';
import { resolveApiPath, authFetch, getApiUrl } from '../config/api';
import { readSpWorkflow } from '../utils/spWorkflow';
import ProductImageCarousel from '../components/ProductImageCarousel';
import SupplierTsinLine from '../components/SupplierTsinLine';
import {
  clearSupplierSelectScopeSession,
  hasFreshCartSupplierSelectSession,
  readSupplierSelectScopeSessionIfFresh,
  readSupplierSelectBoqProjectSessionIfFresh,
  dedupeSupplierSelectItems
} from '../constants/supplierSelectSession';
import {
  buildVendorRankCacheKey,
  getVendorRankCache,
  setVendorRankCache
} from '../utils/vendorRankCache';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import { isVoiceGuidedActive, prepareSupplierSelectFromVoiceCart } from '../voice/voiceCartBridge';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
import { Button } from '@/components/ui/button';
import { formatRupee } from '../utils/formatRupee';
import { formatShippingAddressPreview } from '../utils/shippingAddressLabel';
import { formatDateIST } from '../utils/dateTime';
import './VendorSelect.css';

/** Prefer in-app history so Back matches the browser back button; otherwise go to the prior workflow step. */
function navigateToPreviousStep(navigate, fallbackPath) {
  try {
    const idx = window.history.state?.idx;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
      return;
    }
  } catch {
    /* ignore */
  }
  navigate(fallbackPath);
}

function enrichBoqProjectMeta(proj) {
  if (!proj || typeof proj !== 'object') return proj;
  const location = String(proj.location || '').trim() || formatShippingAddressPreview(proj.shippingAddress);
  return location && !proj.location ? { ...proj, location } : proj;
}

/** Avoid unrelated saved BOQ (lastBoqId) when ranking from cart/discovery delivery address. */
function resolveRankBoqId({ boqId, effectiveItems, boqMeta, cartSupplierHandoff }) {
  if (boqId) return boqId;
  const fromItems = effectiveItems?.[0]?.boqId;
  if (fromItems) return fromItems;
  if (boqMeta?.boqId) return boqMeta.boqId;
  if (cartSupplierHandoff || boqMeta?.shippingAddress || boqMeta?.location) return null;
  return typeof window !== 'undefined' ? localStorage.getItem('lastBoqId') : null;
}

function getItemRequestedQty(item) {
  const qty = Number(item?.quantity);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function getVendorAvailableStock(vendor) {
  const stock = Number(vendor?.availableStock ?? vendor?.stock ?? 0);
  return Number.isFinite(stock) ? Math.max(0, stock) : 0;
}

function vendorHasSufficientStock(vendor, item) {
  return getVendorAvailableStock(vendor) >= getItemRequestedQty(item);
}

/** True when the offer is explicitly unavailable or has no stock. */
function vendorIsUnavailable(vendor) {
  if (!vendor) return true;
  const flag = vendor.isAvailable;
  if (flag === false || flag === 0 || flag === 'false' || flag === '0') return true;
  return getVendorAvailableStock(vendor) <= 0;
}

/** Supplier can fulfill only when stock covers qty and the offer is marked available. */
function vendorCanFulfill(vendor, item) {
  if (!vendor || vendorIsUnavailable(vendor)) return false;
  return vendorHasSufficientStock(vendor, item);
}

function getVendorSelectionId(vendor) {
  return String(vendor?.selectionId || vendor?.supplierProductId || vendor?.id || '');
}

/**
 * Normalize rank API / cache payloads so OOS offers cannot keep recommendation flags
 * or inconsistent stock/availability fields that confuse auto-select + badges.
 */
function sanitizeVendorOffers(itemVendors, itemsList = []) {
  const itemsById = new Map(
    (itemsList || []).map((item) => [String(item?.id ?? ''), item])
  );
  const cleaned = {};
  Object.keys(itemVendors || {}).forEach((itemId) => {
    const item = itemsById.get(String(itemId)) || null;
    const vendors = Array.isArray(itemVendors[itemId]) ? itemVendors[itemId] : [];
    cleaned[itemId] = vendors
      .filter((v) => v && v.id && v.name)
      .map((v) => {
        const availableStock = getVendorAvailableStock(v);
        const isAvailable = !(
          v.isAvailable === false ||
          v.isAvailable === 0 ||
          v.isAvailable === 'false' ||
          v.isAvailable === '0' ||
          availableStock <= 0
        );
        const canFulfill = item
          ? isAvailable && availableStock >= getItemRequestedQty(item)
          : isAvailable;
        return {
          ...v,
          stock: availableStock,
          availableStock,
          isAvailable,
          // Never keep a recommendation flag on an unfulfillable offer.
          isNearestRecommended: Boolean(v.isNearestRecommended) && canFulfill
        };
      });
  });
  return cleaned;
}

function formatInsufficientStockMessage(item, vendor) {
  const name = item?.normalizedName || item?.rawName || item?.name || 'this item';
  const supplierName = vendor?.name ? ` from ${vendor.name}` : '';
  const requested = getItemRequestedQty(item);
  const available = getVendorAvailableStock(vendor);
  const unit = vendor?.unit || item?.unit || 'units';
  if (vendor?.isAvailable === false || available <= 0) {
    return `"${name}"${supplierName} is out of stock or not available. Please choose another supplier, request this product, or pick a substitute.`;
  }
  return `Insufficient stock for "${name}"${supplierName}. Available: ${available} ${unit}, requested: ${requested}.`;
}

/** Sort fulfillable offers first, then by existing rank/distance order. */
function sortVendorsForDisplay(vendors, item) {
  return [...vendors].sort((a, b) => {
    const aOk = vendorCanFulfill(a, item) ? 0 : 1;
    const bOk = vendorCanFulfill(b, item) ? 0 : 1;
    if (aOk !== bOk) return aOk - bOk;
    const aRank = Number(a?.rank);
    const bRank = Number(b?.rank);
    if (Number.isFinite(aRank) && Number.isFinite(bRank) && aRank !== bRank) {
      return aRank - bRank;
    }
    const aDist = typeof a?.distanceKm === 'number' ? a.distanceKm : Infinity;
    const bDist = typeof b?.distanceKm === 'number' ? b.distanceKm : Infinity;
    return aDist - bDist;
  });
}

/** Pick nearest supplier when distance is known; otherwise first ranked approved option. */
function pickRecommendedVendor(vendors, item = null) {
  if (!Array.isArray(vendors) || vendors.length === 0) return null;
  const eligible = vendors.filter((v) => v && (v.selectionId || v.supplierProductId || v.id));
  if (!eligible.length) return null;

  // Never recommend / auto-select a supplier that cannot fulfill the request.
  const inStock = eligible.filter((v) => vendorCanFulfill(v, item));
  if (!inStock.length) return null;

  const preferredSupplierId =
    String(item?.nearestSupplier?.supplierId || '').trim() ||
    String(item?.supplyChainLastSupplier?.supplierId || '').trim() ||
    '';
  if (preferredSupplierId) {
    const preferred = inStock.filter((v) => String(v.id || '').trim() === preferredSupplierId);
    const preferredDistance = preferred.filter((v) => typeof v.distanceKm === 'number');
    if (preferredDistance.length) {
      return preferredDistance.reduce((best, vendor) =>
        vendor.distanceKm < best.distanceKm ? vendor : best
      );
    }
    if (preferred.length) {
      return preferred[0];
    }
  }

  const nearestFlagged = inStock.filter((v) => v.isNearestRecommended);
  if (nearestFlagged.length) {
    return nearestFlagged.reduce((best, vendor) => {
      const bestDist = typeof best.distanceKm === 'number' ? best.distanceKm : Infinity;
      const vendorDist = typeof vendor.distanceKm === 'number' ? vendor.distanceKm : Infinity;
      if (vendorDist !== bestDist) return vendorDist < bestDist ? vendor : best;
      return (Number(vendor.rank) || Infinity) < (Number(best.rank) || Infinity) ? vendor : best;
    });
  }

  const withDistance = inStock.filter(
    (v) => typeof v.distanceKm === 'number' && !Number.isNaN(v.distanceKm)
  );
  if (withDistance.length) {
    return withDistance.reduce((best, vendor) =>
      vendor.distanceKm < best.distanceKm ? vendor : best
    );
  }

  const approved = inStock.filter((v) => v.status === 'approved');
  const pool = approved.length ? approved : inStock;
  return pool.find((v) => v.rank === 1 || v.isNearestRecommended) || pool[0];
}

function hydrateItemsFromWorkflow() {
  const wf = readSpWorkflow();
  if (!Array.isArray(wf?.normalizedItems) || wf.normalizedItems.length === 0) {
    return { items: [], project: null };
  }
  return {
    items: dedupeSupplierSelectItems(wf.normalizedItems),
    project: wf.boqProject && typeof wf.boqProject === 'object' ? wf.boqProject : null
  };
}

const VendorSelect = ({ items = [], boqId = null, boqProject = null, onComplete }) => {
  const workflowSeed = useMemo(() => hydrateItemsFromWorkflow(), []);
  const [itemVendors, setItemVendors] = useState({});
  const [selections, setSelections] = useState({});
  const [expandedSpecifications, setExpandedSpecifications] = useState({});
  const [loading, setLoading] = useState(false);
  const [vendorsReady, setVendorsReady] = useState(false);
  const [effectiveItems, setEffectiveItems] = useState(() =>
    items?.length ? dedupeSupplierSelectItems(items) : workflowSeed.items
  );
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsLoadError, setItemsLoadError] = useState('');
  const [rankNotice, setRankNotice] = useState('');
  const [boqMeta, setBoqMeta] = useState(() =>
    enrichBoqProjectMeta(boqProject || workflowSeed.project || null)
  );
  const [requestingProductKey, setRequestingProductKey] = useState('');
  const [requestedProductKeys, setRequestedProductKeys] = useState(() => new Set());
  const navigate = useNavigate();
  const location = useLocation();
  const itemsPropRef = useRef(items);
  const rankFetchAbortRef = useRef(null);
  const shouldAutoSelectNearestRef = useRef(true);
  /** When set, parent `items` is ignored until it matches these line ids (avoids stale full cart overwriting one-line selection). */
  const lockedLineIdsRef = useRef(null);

  const seedItemVendorShell = (itemsList) => {
    const shell = {};
    (itemsList || []).forEach((item) => {
      const itemId = item.id?.toString() || String(item.id);
      if (itemId) shell[itemId] = [];
    });
    return shell;
  };

  // Show supplier selection UI immediately; ranking loads in the background.
  useEffect(() => {
    if (!effectiveItems?.length) return;
    setItemVendors((prev) => {
      const next = { ...prev };
      let changed = false;
      effectiveItems.forEach((item) => {
        const itemId = item.id?.toString() || String(item.id);
        if (itemId && !(itemId in next)) {
          next[itemId] = [];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [effectiveItems]);

  /** Cart → supplier select: never auto-fetch an unrelated saved BOQ (lastBoqId) or show BOQ loading copy. */
  const cartSupplierHandoff = useMemo(() => {
    try {
      if (new URLSearchParams(location.search || '').get('from') === 'cart') return true;
    } catch {
      /* ignore */
    }
    if (location?.state?.fromCartSupplierSelect === true) return true;
    return hasFreshCartSupplierSelectSession();
  }, [location.search, location.state]);

  const previousStepPath = cartSupplierHandoff ? '/cart' : '/boq-normalize';
  const previousStepLabel = cartSupplierHandoff ? 'Back to cart' : 'Back to BOQ';

  const handleBackToPreviousStep = useCallback(() => {
    navigateToPreviousStep(navigate, previousStepPath);
  }, [navigate, previousStepPath]);

  const backActions = (
    <Button variant="outline" type="button" onClick={handleBackToPreviousStep}>
      <ArrowLeft className="mr-2 h-4 w-4" />
      {previousStepLabel}
    </Button>
  );

  const rankCacheKey = useMemo(() => {
    if (!effectiveItems?.length) return '';
    const effectiveBoqId = resolveRankBoqId({
      boqId,
      effectiveItems,
      boqMeta,
      cartSupplierHandoff
    });
    return buildVendorRankCacheKey(effectiveItems, effectiveBoqId, boqMeta);
  }, [effectiveItems, boqId, boqMeta, cartSupplierHandoff]);

  const deliverySiteLabel = useMemo(() => {
    if (!boqMeta) return '';
    if (boqMeta.location) return boqMeta.location;
    if (boqMeta.shippingAddress) return formatShippingAddressPreview(boqMeta.shippingAddress);
    return '';
  }, [boqMeta]);

  const hasDeliverySiteContext = Boolean(
    boqMeta?.shippingAddress || boqMeta?.siteGeo || deliverySiteLabel
  );

  useEffect(() => {
    shouldAutoSelectNearestRef.current = true;
    setSelections({});
    setVendorsReady(false);
  }, [rankCacheKey]);

  useEffect(() => {
    if (boqMeta?.shippingAddress || boqMeta?.location) return;
    const fromSession = readSupplierSelectBoqProjectSessionIfFresh();
    if (fromSession?.shippingAddress || fromSession?.location) {
      setBoqMeta(enrichBoqProjectMeta(fromSession));
    }
  }, [boqMeta?.shippingAddress, boqMeta?.location]);

  useEffect(() => {
    let cancelled = false;

    const hydrateDeliveryFromCart = async () => {
      if (boqMeta?.shippingAddress || boqMeta?.location) return;

      const fromSession = readSupplierSelectBoqProjectSessionIfFresh();
      if (fromSession?.shippingAddress || fromSession?.location) {
        setBoqMeta(enrichBoqProjectMeta(fromSession));
        return;
      }

      if (!cartSupplierHandoff) return;
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        const res = await authFetch('/api/po/cart', { timeoutMs: 12000 });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;

        const groups = Array.isArray(data?.cart?.draft?.boqGroups) ? data.cart.draft.boqGroups : [];
        for (const group of groups) {
          const project = group?.boqProject;
          if (project?.shippingAddress || project?.location) {
            setBoqMeta(enrichBoqProjectMeta(project));
            break;
          }
        }
      } catch {
        // Non-fatal — ranking still runs without delivery geo.
      }
    };

    hydrateDeliveryFromCart();
    return () => {
      cancelled = true;
    };
  }, [cartSupplierHandoff, boqMeta?.shippingAddress, boqMeta?.location]);

  useEffect(() => {
    itemsPropRef.current = items;
  }, [items]);

  // Cart passes router state + session backup. In production, `location.state` is often dropped
  // (hosting / hard reload); we must read session *without* clearing it first. BOQ clears session
  // before opening this page so a stale cart backup cannot override a new BOQ flow.
  useLayoutEffect(() => {
    let scoped = location?.state?.supplierSelectItems;
    if (!Array.isArray(scoped) || scoped.length === 0) {
      const recovered = readSupplierSelectScopeSessionIfFresh();
      if (recovered) scoped = recovered;
    }

    if (!Array.isArray(scoped) || scoped.length === 0) return;

    const deduped = dedupeSupplierSelectItems(scoped);
    const ids = new Set(deduped.map((it) => String(it?.id ?? '').trim()).filter(Boolean));
    lockedLineIdsRef.current = ids.size > 0 ? ids : null;

    setEffectiveItems(deduped);
    const proj =
      location.state?.supplierSelectBoqProject || readSupplierSelectBoqProjectSessionIfFresh();
    if (proj && typeof proj === 'object') {
      setBoqMeta(enrichBoqProjectMeta(proj));
    }
  }, [location.pathname, location.search, location.state]);

  useEffect(() => {
    const voiceQuery = (() => {
      try {
        return new URLSearchParams(location.search || '').get('voice') === '1';
      } catch {
        return false;
      }
    })();
    if (!voiceQuery && !isVoiceGuidedActive()) return;
    if (effectiveItems.length > 0) return;

    let cancelled = false;
    (async () => {
      const items = await prepareSupplierSelectFromVoiceCart();
      if (!cancelled && items.length) {
        const deduped = dedupeSupplierSelectItems(items);
        lockedLineIdsRef.current = new Set(
          deduped.map((it) => String(it?.id ?? '').trim()).filter(Boolean)
        );
        setEffectiveItems(deduped);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search, effectiveItems.length]);

  const normalizeIdPart = (value) => (value === null || value === undefined ? '' : String(value).trim());
  const firstNonEmpty = (...values) => {
    for (const value of values) {
      const normalized = normalizeIdPart(value);
      if (normalized) return normalized;
    }
    return '';
  };
  const getProductIdentification = (item = {}, vendor = null) => {
    const specs = item.specifications || {};
    const skuNo = firstNonEmpty(vendor?.skuNo, item.skuNo, specs.skuNo, specs.sku, specs.SKU, specs.gsku, specs.GSKU);
    const modelBrand = firstNonEmpty(vendor?.modelBrand, item.brandModel, item.modelBrand, specs.modelBrand, specs.brandModel, specs.brand);
    const parts = [skuNo, modelBrand].map(normalizeIdPart);
    if (parts.every((p) => !p)) return '';
    return parts.join('');
  };
  const normalizeSpecifications = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const seen = new Set();
    return Object.entries(value).reduce((acc, [key, rawValue]) => {
      const cleanKey = String(key || '').trim();
      if (!cleanKey) return acc;
      if (rawValue === null || rawValue === undefined) return acc;
      const cleanValue = String(rawValue).trim();
      if (!cleanValue) return acc;
      const dedupeKey = cleanKey.toLowerCase();
      if (seen.has(dedupeKey)) return acc;
      seen.add(dedupeKey);
      acc[cleanKey] = cleanValue;
      return acc;
    }, {});
  };

  useEffect(() => {
    if (
      boqProject &&
      (boqProject.location ||
        boqProject.requiredDate ||
        boqProject.siteGeo ||
        boqProject.shippingAddress)
    ) {
      setBoqMeta(enrichBoqProjectMeta(boqProject));
    }
  }, [boqProject]);

  // Keep local working copy of items so we can restore after refresh/navigation
  useEffect(() => {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    const lock = lockedLineIdsRef.current;
    if (lock && lock.size > 0) {
      const parentIds = new Set(items.map((it) => String(it?.id ?? '').trim()).filter(Boolean));
      const lockOk = [...lock].every((id) => parentIds.has(id)) && parentIds.size === lock.size;
      if (!lockOk) {
        return;
      }
      lockedLineIdsRef.current = null;
    }
    setEffectiveItems(dedupeSupplierSelectItems(items));
    setLoadingItems(false);
    setItemsLoadError('');
  }, [items]);

  // If items are missing (sidebar revisit), use saved workflow first, then BOQ API — not when coming from cart.
  useEffect(() => {
    let cancelled = false;

    const loadItems = async () => {
      setItemsLoadError('');

      if (effectiveItems?.length > 0 || itemsPropRef.current?.length > 0) {
        setLoadingItems(false);
        return;
      }

      if (cartSupplierHandoff) {
        setLoadingItems(false);
        return;
      }

      const wf = hydrateItemsFromWorkflow();
      if (wf.items.length > 0) {
        if (cancelled) return;
        if (itemsPropRef.current?.length > 0) return;
        setEffectiveItems(wf.items);
        if (wf.project) setBoqMeta(wf.project);
        setLoadingItems(false);
        return;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        setLoadingItems(false);
        return;
      }

      const id = boqId || localStorage.getItem('lastBoqId');
      if (!id) {
        setLoadingItems(false);
        return;
      }

      setLoadingItems(true);
      try {
        const res = await authFetch(`/api/boq/${encodeURIComponent(id)}/items`, {
          timeoutMs: 12000
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (itemsPropRef.current?.length > 0) return;

        if (res.ok && data.status === 'success' && Array.isArray(data.items)) {
          const withBoq = data.items.map((it) => ({
            ...it,
            boqId: data.boqId || id
          }));
          setEffectiveItems(withBoq);
          if (data.project && (data.project.location || data.project.requiredDate)) {
            setBoqMeta(data.project);
          }
        } else {
          setItemsLoadError(data.message || 'Could not load saved BOQ items.');
        }
      } catch (e) {
        if (cancelled) return;
        if (itemsPropRef.current?.length > 0) return;
        const msg =
          e?.name === 'AbortError'
            ? 'Loading BOQ items timed out. Check your connection and try again.'
            : e?.message || 'Could not load saved BOQ items.';
        setItemsLoadError(msg);
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    };

    loadItems();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqId, effectiveItems.length, cartSupplierHandoff]);

  const normalizeRankResponse = (data) => {
    if (!data?.itemVendors || typeof data.itemVendors !== 'object') {
      const emptyVendors = {};
      effectiveItems.forEach((item) => {
        const itemId = item.id?.toString() || String(item.id);
        emptyVendors[itemId] = [];
      });
      return emptyVendors;
    }
    const cleanedVendors = {};
    Object.keys(data.itemVendors).forEach((itemId) => {
      const vendors = data.itemVendors[itemId];
      if (Array.isArray(vendors)) {
        const validVendors = vendors.filter((v) => v && v.id && v.name);
        cleanedVendors[itemId] = validVendors.map((v) => ({
          ...v,
          price: typeof v.price === 'number' ? v.price : parseFloat(v.price),
          stock:
            typeof v.availableStock === 'number'
              ? v.availableStock
              : typeof v.stock === 'number'
                ? v.stock
                : parseInt(v.stock || 0, 10)
        }));
      } else {
        cleanedVendors[itemId] = [];
      }
    });
    return sanitizeVendorOffers(cleanedVendors, effectiveItems);
  };

  const autoSelectNearestVendors = (cleanedVendors) => {
    const nextAuto = {};
    if (hasDeliverySiteContext && shouldAutoSelectNearestRef.current) {
      (effectiveItems || []).forEach((item) => {
        const itemId = item.id?.toString() || String(item.id);
        const vendors = cleanedVendors[itemId] || [];
        const nearest = pickRecommendedVendor(vendors, item);
        if (!nearest || !vendorCanFulfill(nearest, item)) return;
        const key = getVendorSelectionId(nearest);
        if (key) nextAuto[itemId] = String(key);
      });
      shouldAutoSelectNearestRef.current = false;
    }

    setSelections((prev) => {
      // Always drop unfulfillable selections; optionally apply nearest auto-picks.
      const merged = { ...(prev || {}) };
      (effectiveItems || []).forEach((item) => {
        const selectionKey = getSelectionKey(item);
        const selectedId = merged[selectionKey];
        if (!selectedId) return;
        const itemId = item.id?.toString() || String(item.id);
        const vendors = cleanedVendors[itemId] || cleanedVendors[item.id] || [];
        const vendor = vendors.find((v) => getVendorSelectionId(v) === String(selectedId));
        if (!vendor || !vendorCanFulfill(vendor, item)) {
          delete merged[selectionKey];
        }
      });
      Object.keys(nextAuto).forEach((itemId) => {
        merged[itemId] = nextAuto[itemId];
      });
      return merged;
    });
  };

  const applyRankResults = (cleanedVendors, cacheKey) => {
    const sanitized = sanitizeVendorOffers(cleanedVendors, effectiveItems);
    setItemVendors(sanitized);
    // Prune OOS selections and auto-select only fulfillable nearest (when allowed).
    autoSelectNearestVendors(sanitized);
    if (cacheKey) {
      setVendorRankCache(cacheKey, sanitized);
    }
  };

  const fetchVendors = async ({ force = false, silent = false, cacheKey: keyOverride } = {}) => {
    if (!effectiveItems || !Array.isArray(effectiveItems) || effectiveItems.length === 0) {
      setLoading(false);
      return;
    }

    const cacheKey = keyOverride || rankCacheKey;
    if (!force && cacheKey) {
      const cached = getVendorRankCache(cacheKey);
      if (cached) {
        applyRankResults(cached, null);
        setVendorsReady(true);
        setLoading(false);
        return;
      }
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('You are not logged in. Please log in again.');
      setVendorsReady(true);
      setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
      setRankNotice('');
    }

    rankFetchAbortRef.current?.abort();
    const abortController = new AbortController();
    rankFetchAbortRef.current = abortController;
    const rankTimeoutMs = 120000;

    try {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      const fullUrl = `${resolveApiPath('/api/vendors/rank')}?_t=${timestamp}&_r=${random}`;
      const effectiveBoqId = resolveRankBoqId({
        boqId,
        effectiveItems,
        boqMeta,
        cartSupplierHandoff
      });

      const res = await authFetch(fullUrl, {
        method: 'POST',
        signal: abortController.signal,
        timeoutMs: rankTimeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          'X-Request-ID': `${timestamp}-${random}`
        },
        body: JSON.stringify({
          items: effectiveItems,
          boqId: effectiveBoqId || undefined,
          project: boqMeta && typeof boqMeta === 'object' ? boqMeta : undefined,
          _timestamp: timestamp,
          _random: random
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = `HTTP error! status: ${res.status}`;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();
      const cleanedVendors = normalizeRankResponse(data);
      applyRankResults(cleanedVendors, cacheKey);
      setRankNotice('');
    } catch (error) {
      console.error('[VendorSelect] Failed to fetch vendors:', error);
      setItemVendors((prev) => ({ ...seedItemVendorShell(effectiveItems), ...prev }));

      if (!silent) {
        if (error?.name === 'AbortError') {
          setRankNotice(
            'Supplier ranking is still loading in the background. Review your items below and tap Refresh to load suppliers.'
          );
        } else if (error.message?.includes('Failed to fetch') || error.name === 'TypeError') {
          setRankNotice(
            'Could not reach the server. Check your connection and tap Refresh to load suppliers.'
          );
        } else {
          setRankNotice(
            error?.message
              ? `${error.message} Tap Refresh to try again.`
              : 'Could not load suppliers. Tap Refresh to try again.'
          );
        }
      }
    } finally {
      if (rankFetchAbortRef.current === abortController) {
        rankFetchAbortRef.current = null;
      }
      setVendorsReady(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loadingItems || !effectiveItems?.length || !rankCacheKey) return;

    const cached = getVendorRankCache(rankCacheKey);
    if (cached) {
      applyRankResults(cached, null);
      setVendorsReady(true);
      return;
    }

    fetchVendors({ cacheKey: rankCacheKey });

    return () => {
      rankFetchAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankCacheKey, loadingItems]);

  const handleRefresh = () => {
    fetchVendors({ force: true, silent: Object.keys(itemVendors).length > 0 });
  };

  const getSelectionKey = (item) => {
    // Keep selection scoped to each BOQ row so choosing one row doesn't
    // auto-select other rows that map to the same normalized product.
    return String(item?.id ?? '');
  };

  const findVendorForItem = (item, vendorId) => {
    const itemId = item?.id?.toString() || String(item?.id || '');
    const vendors = itemVendors[itemId] || itemVendors[item?.id] || [];
    const normalizedVendorId = String(vendorId || '');
    return vendors.find((v) => getVendorSelectionId(v) === normalizedVendorId) || null;
  };

  const handleSelect = (item, vendorId) => {
    const selectionKey = getSelectionKey(item);
    const normalizedVendorId = String(vendorId || '');

    if (!selectionKey) return;

    shouldAutoSelectNearestRef.current = false;

    const currentVendorId = selections[selectionKey];
    // Allow deselecting even if stock later became insufficient.
    if (currentVendorId === normalizedVendorId) {
      setSelections((prev) => {
        const { [selectionKey]: _removed, ...remainingSelections } = prev;
        return remainingSelections;
      });
      return;
    }

    const vendor = findVendorForItem(item, normalizedVendorId);
    if (!vendor || !vendorCanFulfill(vendor, item)) {
      alert(
        vendor
          ? formatInsufficientStockMessage(item, vendor)
          : 'This supplier cannot fulfill the requested product. Please choose another option, request the product, or pick a substitute.'
      );
      return;
    }

    setSelections((prev) => ({ ...prev, [selectionKey]: normalizedVendorId }));
  };

  const requestUnavailableProduct = async (item) => {
    if (!item) return;
    const itemKey = String(item.id ?? item.normalizedName || item.rawName || '');
    if (!itemKey) return;
    if (requestedProductKeys.has(itemKey)) {
      toast.info('You have already made a request for this product.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      toast.error('Please log in again to request a new product.');
      return;
    }

    setRequestingProductKey(itemKey);
    try {
      const res = await fetch(getApiUrl('/api/boq/request-product'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: item.normalizedName || item.rawName,
          category: item.category || 'other',
          unit: item.unit || 'nos',
          description: item.rawName || item.normalizedName || '',
          brand: item.brand || item.normalizedName || item.rawName || '',
          boqId: boqId || item.boqId || null,
          boqItemId: item.id ?? null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || data.alreadyRequested) {
        setRequestedProductKeys((prev) => new Set(prev).add(itemKey));
        toast.info(data.message || 'You have already made a request for this product.');
        return;
      }
      if (res.ok && data.status === 'success') {
        setRequestedProductKeys((prev) => new Set(prev).add(itemKey));
        const productLabel = item.normalizedName || item.rawName || 'this product';
        toast.success('Request sent', {
          description: `Suppliers are being notified that a customer is looking for “${productLabel}”. They can add the product from their supplier portal if they stock it.`,
          duration: 6000
        });
        return;
      }
      toast.error(data.message || 'Failed to submit product request. Please try again.');
    } catch (error) {
      console.error('Failed to submit product request:', error);
      toast.error('Failed to submit product request. Please try again.');
    } finally {
      setRequestingProductKey('');
    }
  };

  const goToSubstitutions = () => {
    onComplete({ ...selections }, [...effectiveItems]);
    clearSupplierSelectScopeSession();
    navigate('/substitution');
  };

  const toggleSpecifications = (item, vendorId) => {
    const itemKey = item?.id?.toString() || String(item?.id || '');
    const vendorKey = String(vendorId || '');
    if (!itemKey || !vendorKey) return;
    const compositeKey = `${itemKey}::${vendorKey}`;
    setExpandedSpecifications((prev) => ({
      ...prev,
      [compositeKey]: !prev[compositeKey]
    }));
  };

  const handleProceed = () => {
    // Check how many items have selections
    const itemsWithSelections = effectiveItems.filter(item => {
      const selectionKey = getSelectionKey(item);
      return selections[selectionKey];
    }).length;

    // If no items have selections, show error
    if (itemsWithSelections === 0) {
      alert('Please select at least one supplier before proceeding.');
      return;
    }

    const insufficientSelections = effectiveItems
      .map((item) => {
        const selectionKey = getSelectionKey(item);
        const selectedVendorId = selections[selectionKey];
        if (!selectedVendorId) return null;
        const vendor = findVendorForItem(item, selectedVendorId);
        if (vendor && vendorCanFulfill(vendor, item)) return null;
        return { item, vendor };
      })
      .filter(Boolean);

    if (insufficientSelections.length > 0) {
      const details = insufficientSelections
        .map(({ item, vendor }) =>
          vendor
            ? formatInsufficientStockMessage(item, vendor)
            : `"${item?.normalizedName || item?.rawName || 'an item'}" cannot be fulfilled by the selected supplier.`
        )
        .join('\n');
      alert(
        `Cannot proceed — selected supplier(s) are out of stock or unavailable:\n\n${details}`
      );
      return;
    }
    
    // Warn if some items don't have suppliers, but allow proceeding
    if (itemsWithSelections < effectiveItems.length) {
      const itemsWithoutSuppliers = effectiveItems.length - itemsWithSelections;
      const proceed = window.confirm(
        `${itemsWithoutSuppliers} item(s) don't have selected suppliers. ` +
        `These items will be skipped when creating the purchase order. ` +
        `Do you want to continue?`
      );
      if (!proceed) {
        return;
      }
    }
    
    onComplete({ ...selections }, [...effectiveItems]);
    clearSupplierSelectScopeSession();
    navigate('/substitution');
  };

  // Show loading or error state if items are not available
  if (loadingItems) {
    return (
      <SpWorkflowPage
        title="Supplier Selection"
        description="Loading your BOQ line items…"
        icon={Users}
        actions={backActions}
      >
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-[#64748b]">
          <RefreshCw className="h-8 w-8 animate-spin text-[#4f46e5]" aria-hidden />
          <p className="text-sm">This should only take a few seconds.</p>
        </div>
      </SpWorkflowPage>
    );
  }

  if (!effectiveItems || !Array.isArray(effectiveItems) || effectiveItems.length === 0) {
    const possibleBoqId =
      boqId ||
      (typeof window !== 'undefined' ? localStorage.getItem('lastBoqId') : null);
    const canTrySavedBoq = !!possibleBoqId && !cartSupplierHandoff;

    return (
      <SpWorkflowPage
        title="Supplier Selection"
        description={
          itemsLoadError
            ? itemsLoadError
            : cartSupplierHandoff
              ? 'Your cart lines did not load on this page (common in production when a new tab opens or browser storage is restricted). Go back to the cart and use Select supplier again.'
              : canTrySavedBoq
                ? 'No line items are on this screen yet. If you expected your last uploaded BOQ, open BOQ Normalize and continue again, or use the cart to pick supplier lines.'
                : 'No line items to show yet. Open your cart and use Select supplier again, or start from a BOQ upload.'
        }
        icon={Users}
        actions={backActions}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <Button type="button" onClick={handleBackToPreviousStep}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {previousStepLabel}
          </Button>
          {!cartSupplierHandoff ? (
            <Button variant="outline" type="button" onClick={() => navigate('/cart')}>
              Go to cart
            </Button>
          ) : (
            <Button variant="outline" type="button" onClick={() => navigate('/boq-normalize')}>
              Upload a BOQ
            </Button>
          )}
        </div>
      </SpWorkflowPage>
    );
  }

  return (
    <SpWorkflowPage
      title="Supplier Selection"
      description="Choose the best vendor for each item"
      icon={Users}
      actions={backActions}
    >
    <div className="page !p-0">
      <VoiceGuidedBanner />
      {cartSupplierHandoff && !hasDeliverySiteContext && (
        <div
          className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          <strong>Delivery address missing.</strong> Suppliers cannot be ranked by distance until you set a
          shipping address on your cart project. Go back to the cart, choose your delivery address, save the
          project, then return here.
        </div>
      )}
      {(deliverySiteLabel || boqMeta?.requiredDate) && (
        <div
          className="mb-4"
          style={{
            padding: '0.65rem 0.85rem',
            background: '#eff6ff',
            borderRadius: '8px',
            border: '1px solid #bfdbfe',
            fontSize: '0.85rem',
            color: '#1e3a5f',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            maxWidth: '640px'
          }}
        >
          <MapPin size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            {deliverySiteLabel && (
              <>
                <strong>{boqMeta?.shippingAddress ? 'Delivery address:' : 'Project site:'}</strong>{' '}
                {deliverySiteLabel}
              </>
            )}
            {boqMeta?.requiredDate && (
              <>
                {deliverySiteLabel ? ' · ' : ''}
                <strong>Expected dispatch date:</strong> {formatDateIST(boqMeta.requiredDate, '—')}
              </>
            )}
            {deliverySiteLabel && (
              <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.78rem', opacity: 0.9 }}>
                Suppliers are ranked by distance to this address when outlet coordinates exist; otherwise city or
                    state on the listing is used. The nearest <em>in-stock</em> supplier is pre-selected and marked{' '}
                    <strong>Nearest · Recommended</strong>. Out-of-stock suppliers cannot be recommended or selected.
              </span>
            )}
          </span>
        </div>
      )}
      <div className="page-header hidden">
        <div>
          <h1>Supplier Selection</h1>
          <p>Choose the best vendor for each item</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            background: loading ? '#9ca3af' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            fontWeight: '500',
            opacity: loading ? 0.7 : 1
          }}
          title="Refresh to get latest supplier information"
        >
          <RefreshCw size={16} className={loading ? 'spinning' : ''} style={{ 
            animation: loading ? 'spin 1s linear infinite' : 'none' 
          }} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {(loading || rankNotice) && effectiveItems.length > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{
            borderColor: loading ? '#bfdbfe' : '#fcd34d',
            background: loading ? '#eff6ff' : '#fffbeb',
            color: loading ? '#1e3a5f' : '#92400e'
          }}
        >
          <span className="flex-1 min-w-[200px]">
            {loading
              ? 'Loading supplier options for your items…'
              : rankNotice}
          </span>
          {!loading && rankNotice ? (
            <button
              type="button"
              className="btn-secondary inline-flex shrink-0 items-center gap-1"
              onClick={handleRefresh}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          ) : null}
        </div>
      )}

      <div className="vendor-list">
        {effectiveItems.map((item) => {
          const itemId = item.id?.toString() || String(item.id);
          const vendors = itemVendors[itemId] || itemVendors[item.id] || [];
          const hasVendors = Array.isArray(vendors) && vendors.length > 0 && vendors.some(v => v.id && v.name);
          const recommendedVendor = hasVendors ? pickRecommendedVendor(vendors, item) : null;
          const recommendedVendorId = recommendedVendor ? getVendorSelectionId(recommendedVendor) : '';
          const hasFulfillableVendors =
            hasVendors && vendors.some((v) => v && v.id && v.name && vendorCanFulfill(v, item));
          
          const selectionKey = getSelectionKey(item);
          const currentSelection = String(selections[selectionKey] || '');
          
          return (
          <div key={item.id} className="vendor-section">
            <h3 className="item-title">{item.normalizedName || item.rawName}</h3>
            <div style={{ marginTop: '-0.4rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: '#334155' }}>
              Requested quantity: <strong>{getItemRequestedQty(item)}</strong>
              {item.unit ? ` ${item.unit}` : ''}
            </div>
            {getProductIdentification(item) && (
              <div style={{ marginTop: '-0.4rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: '#334155' }}>
                <strong>Product Identification:</strong> {getProductIdentification(item)}
              </div>
            )}
            <div className="vendor-options">
              {hasVendors ? (
                <>
                {!hasFulfillableVendors && (
                  <div
                    className="no-vendors"
                    style={{
                      padding: '1.25rem 1.5rem',
                      textAlign: 'left',
                      backgroundColor: '#fff7ed',
                      borderRadius: '8px',
                      border: '1px solid #fdba74',
                      marginBottom: '0.75rem',
                      width: '100%'
                    }}
                  >
                    <p style={{ color: '#9a3412', fontSize: '0.95rem', margin: '0 0 0.75rem', fontWeight: 600 }}>
                      No supplier can fulfill this product right now
                    </p>
                    <p style={{ color: '#c2410c', fontSize: '0.85rem', margin: '0 0 1rem', lineHeight: 1.45 }}>
                      Listed suppliers are out of stock or unavailable, so none can be recommended or selected.
                      Request this product so suppliers can add it, or continue to choose a substitute.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <Button
                        type="button"
                        variant="default"
                        disabled={requestingProductKey === itemId || requestedProductKeys.has(itemId)}
                        onClick={() => requestUnavailableProduct(item)}
                      >
                        {requestedProductKeys.has(itemId)
                          ? 'Request sent'
                          : requestingProductKey === itemId
                            ? 'Submitting…'
                            : 'Request new product'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={goToSubstitutions}
                      >
                        Choose a substitute
                      </Button>
                    </div>
                  </div>
                )}
                {sortVendorsForDisplay(
                  vendors.filter((vendor) => vendor && vendor.id && vendor.name),
                  item
                ).map((vendor, vendorIndex) => {
                    const vendorIdStr = getVendorSelectionId(vendor);
                    const vendorSpecifications = normalizeSpecifications(vendor?.specifications);
                    const specificationEntries = Object.entries(vendorSpecifications);
                    const specsKey = `${itemId}::${vendorIdStr}`;
                    const isSpecsExpanded = !!expandedSpecifications[specsKey];
                    const visibleSpecificationEntries = isSpecsExpanded
                      ? specificationEntries
                      : specificationEntries.slice(0, 6);
                    const hasMoreSpecifications = specificationEntries.length > 6;
                    const availableStock = getVendorAvailableStock(vendor);
                    const requestedQty = getItemRequestedQty(item);
                    const canFulfill = vendorCanFulfill(vendor, item);
                    const hasEnoughStock = vendorHasSufficientStock(vendor, item);
                    const isOutOfStock = vendorIsUnavailable(vendor);
                    // Recommendation badge only for fulfillable auto-pick — never for OOS/unavailable.
                    const isRecommended =
                      canFulfill &&
                      Boolean(recommendedVendorId) &&
                      recommendedVendorId === vendorIdStr;
                    // Only fulfillable offers may appear selected.
                    const isSelected =
                      canFulfill && Boolean(currentSelection) && currentSelection === vendorIdStr;
                    return (
                  <div 
                    key={`${vendorIdStr}-${vendorIndex}`}
                    className={`vendor-card${isSelected ? ' selected' : ''}${!canFulfill ? ' insufficient-stock' : ''}`}
                    aria-pressed={isSelected}
                    aria-disabled={!canFulfill}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelect(item, vendorIdStr);
                    }}
                    onMouseDown={(e) => {
                      // Prevent text selection on click
                      e.preventDefault();
                    }}
                    style={{ 
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      cursor: canFulfill ? 'pointer' : 'not-allowed',
                      position: 'relative',
                      zIndex: 1
                    }}
                    role="button"
                    tabIndex={canFulfill || isSelected ? 0 : -1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(item, vendorIdStr);
                      }
                    }}
                  >
                    {(vendor.productImage || (Array.isArray(vendor.images) && vendor.images[0])) && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <ProductImageCarousel
                          images={[vendor.productImage, ...(Array.isArray(vendor.images) ? vendor.images : [])]}
                          alt={vendor.supplierProductName || item.normalizedName || item.rawName || 'Product'}
                          height={180}
                          rounded={10}
                          stopPropagation
                        />
                      </div>
                    )}
                    <div className="vendor-header">
                      <div>
                        <div className="vendor-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {vendor.name}
                          {vendor.status === 'pending' && (
                            <span style={{ 
                              fontSize: '0.7rem', 
                              padding: '0.15rem 0.4rem', 
                              background: '#fef3c7', 
                              color: '#d97706', 
                              borderRadius: '4px',
                              fontWeight: '600'
                            }}>
                              Pending Approval
                            </span>
                          )}
                        </div>
                        {vendor.company && (
                          <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                            {vendor.company}
                          </div>
                        )}
                        {vendor.location && (
                          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            📍 {vendor.location}
                          </div>
                        )}
                        {typeof vendor.distanceKm === 'number' && vendor.distanceSourceLocation && (
                          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.15rem' }}>
                            Distance based on: {vendor.distanceSourceLocation}
                          </div>
                        )}
                        {typeof vendor.distanceKm === 'number' && !Number.isNaN(vendor.distanceKm) && (
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: '#0369a1',
                              marginTop: '0.2rem',
                              fontWeight: 600
                            }}
                          >
                            ~{Math.round(vendor.distanceKm)} km from your{' '}
                            {boqMeta?.shippingAddress ? 'delivery address' : 'project site'}
                          </div>
                        )}
                      </div>
                      {isRecommended && (
                        <span className="badge">
                          {typeof vendor.distanceKm === 'number' && hasDeliverySiteContext
                            ? 'Nearest · Recommended'
                            : 'Recommended'}
                        </span>
                      )}
                    </div>
                    <div className="vendor-product-info">
                      <div className="product-name">
                        {/* Always show the BOQ item name as the main title */}
                        {item.normalizedName || item.rawName}
                      </div>
                      {/* If supplier's actual product name is different, show it explicitly */}
                      {vendor.supplierProductName && 
                        vendor.supplierProductName !== (item.normalizedName || item.rawName) && (
                          <div className="product-description">
                            Supplier product: {vendor.supplierProductName}
                          </div>
                      )}
                      {getProductIdentification(item, vendor) && (
                        <div className="product-description">
                          ID: {getProductIdentification(item, vendor)}
                        </div>
                      )}
                      <SupplierTsinLine asin={vendor.asin || vendor.parentAsin} variantAsin={vendor.variantAsin} />
                      {specificationEntries.length > 0 && (
                        <div
                          style={{
                            marginTop: '0.45rem',
                            padding: '0.55rem',
                            borderRadius: '8px',
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0'
                          }}
                        >
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                            Specifications
                          </div>
                          <div style={{ display: 'grid', gap: '0.2rem' }}>
                            {visibleSpecificationEntries.map(([key, value]) => (
                              <div key={`${vendorIdStr}-${key}`} style={{ fontSize: '0.74rem', color: '#475569' }}>
                                <strong>{key}:</strong> {value}
                              </div>
                            ))}
                            {hasMoreSpecifications && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleSpecifications(item, vendorIdStr);
                                }}
                                style={{
                                  marginTop: '0.2rem',
                                  textAlign: 'left',
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#2563eb',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: 0
                                }}
                              >
                                {isSpecsExpanded
                                  ? 'Show less'
                                  : `View all specs (+${specificationEntries.length - 6} more)`}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="vendor-details" style={{ pointerEvents: 'none' }}>
                      <div className="detail">
                        <span>
                          {vendor.price > 0
                            ? `${formatRupee(vendor.price)} / ${vendor.unit || 'unit'}`
                            : `Price on request / ${vendor.unit || 'unit'}`}
                        </span>
                      </div>
                      <div className="detail">
                        <Clock size={16} />
                        <span>{vendor.leadTime} days delivery</span>
                      </div>
                      {hasEnoughStock && !isOutOfStock ? (
                        <div className="detail" style={{ color: '#059669' }}>
                          <span>✓ Stock: {availableStock} {vendor.unit || 'units'}</span>
                        </div>
                      ) : isOutOfStock ? (
                        <div className="detail" style={{ color: '#dc2626' }}>
                          <span>✗ Out of stock</span>
                        </div>
                      ) : (
                        <div className="detail" style={{ color: '#dc2626' }}>
                          <span>
                            ✗ Insufficient stock (have {availableStock}, need {requestedQty})
                          </span>
                        </div>
                      )}
                      {vendor.rating > 0 && (
                        <div className="detail">
                          <span>⭐ {vendor.rating.toFixed(1)} rating</span>
                        </div>
                      )}
                      {isOutOfStock && (
                        <div className="detail" style={{ color: '#dc2626', fontWeight: '600' }}>
                          <span>⚠ Not Available</span>
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <div style={{
                        position: 'absolute',
                        top: '0.5rem',
                        right: '0.5rem',
                        background: '#4f46e5',
                        color: 'white',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        pointerEvents: 'none',
                        zIndex: 2
                      }}>
                        ✓
                      </div>
                    )}
                  </div>
                    );
                  })}
                </>
              ) : loading || !vendorsReady ? (
                <div className="no-vendors" style={{
                  padding: '2rem',
                  textAlign: 'center',
                  backgroundColor: '#eff6ff',
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe'
                }}>
                  <p style={{
                    color: '#1e3a5f',
                    fontSize: '1rem',
                    margin: 0,
                    fontWeight: '500'
                  }}>
                    Loading suppliers for this item…
                  </p>
                </div>
              ) : (
                <div className="no-vendors" style={{
                  padding: '1.25rem 1.5rem',
                  textAlign: 'left',
                  backgroundColor: '#fff7ed',
                  borderRadius: '8px',
                  border: '1px solid #fdba74'
                }}>
                  <p style={{
                    color: '#9a3412',
                    fontSize: '0.95rem',
                    margin: '0 0 0.75rem',
                    fontWeight: 600
                  }}>
                    No supplier is available for this requirement
                  </p>
                  <p style={{ color: '#c2410c', fontSize: '0.85rem', margin: '0 0 1rem', lineHeight: 1.45 }}>
                    Request this product so suppliers can add it, or continue to choose a substitute product.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <Button
                      type="button"
                      variant="default"
                      disabled={requestingProductKey === itemId || requestedProductKeys.has(itemId)}
                      onClick={() => requestUnavailableProduct(item)}
                    >
                      {requestedProductKeys.has(itemId)
                        ? 'Request sent'
                        : requestingProductKey === itemId
                          ? 'Submitting…'
                          : 'Request new product'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={goToSubstitutions}
                    >
                      Choose a substitute
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>

      <button
        className="btn-primary btn-large"
        onClick={handleProceed}
        disabled={
          !effectiveItems.some((item) => {
            const selectionKey = getSelectionKey(item);
            const selectedId = selections[selectionKey];
            if (!selectedId) return false;
            const vendor = findVendorForItem(item, selectedId);
            return vendor && vendorCanFulfill(vendor, item);
          })
        }
      >
        Continue to Substitutions
      </button>
    </div>
    </SpWorkflowPage>
  );
};

export default VendorSelect;
