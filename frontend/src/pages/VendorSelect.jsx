import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, RefreshCw, MapPin, Users } from 'lucide-react';
import { toast } from 'sonner';
import { resolveApiPath, authFetch, getApiUrl } from '../config/api';
import { readSpWorkflow } from '../utils/spWorkflow';
import {
  persistSupplierSelectBackOrigin,
  readLastSpPathBeforeSupplierSelect,
  readPersistedSupplierSelectBackOrigin,
  resolveSupplierSelectBack
} from '../utils/supplierSelectBack';
import ProductImageCarousel from '../components/ProductImageCarousel';
import SupplierTsinLine from '../components/SupplierTsinLine';
import {
  clearSupplierSelectScopeSession,
  hasFreshCartSupplierSelectSession,
  readSupplierSelectScopeSessionIfFresh,
  readSupplierSelectBoqProjectSessionIfFresh,
  dedupeSupplierSelectItems
} from '../constants/supplierSelectSession';
import { excludeCancelledBoqItems } from '../utils/boqCancelledItems';
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
import { specificationEntriesForCustomerDisplay } from '../utils/specifications';
import {
  getItemRequestedQty,
  getVendorAvailableStock,
  pickRecommendedVendor,
  sanitizeVendorOffers,
  sortVendorsForDisplay,
  vendorCanFulfill,
  vendorHasSufficientStock,
  vendorIsUnavailable
} from '../utils/vendorFulfillment';
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

function getVendorSelectionId(vendor) {
  return String(vendor?.selectionId || vendor?.supplierProductId || vendor?.id || '');
}

function getStoredBuyerUserId() {
  if (typeof window === 'undefined') return '';
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return String(user?.id || '').trim();
  } catch {
    return '';
  }
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
  const navigate = useNavigate();
  const location = useLocation();

  const boqDetailHandoff = useMemo(() => {
    const state = location?.state;
    if (!state?.fromBoqDetail) return null;
    const handoffBoqId = String(state.supplierSelectBoqId || '').trim();
    if (!handoffBoqId) return null;
    return {
      boqId: handoffBoqId,
      items: Array.isArray(state.supplierSelectItems) ? state.supplierSelectItems : [],
      project:
        state.supplierSelectBoqProject && typeof state.supplierSelectBoqProject === 'object'
          ? state.supplierSelectBoqProject
          : null
    };
  }, [location?.state]);

  const workflowSeed = useMemo(() => hydrateItemsFromWorkflow(), []);
  const [itemVendors, setItemVendors] = useState({});
  const [selections, setSelections] = useState({});
  const [expandedSpecifications, setExpandedSpecifications] = useState({});
  const [loading, setLoading] = useState(false);
  const [vendorsReady, setVendorsReady] = useState(false);
  const [effectiveItems, setEffectiveItems] = useState(() => {
    if (boqDetailHandoff?.items?.length) {
      return dedupeSupplierSelectItems(boqDetailHandoff.items);
    }
    return items?.length ? dedupeSupplierSelectItems(items) : workflowSeed.items;
  });
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsLoadError, setItemsLoadError] = useState('');
  const [rankNotice, setRankNotice] = useState('');
  const [boqMeta, setBoqMeta] = useState(() =>
    enrichBoqProjectMeta(
      boqDetailHandoff?.project || boqProject || workflowSeed.project || null
    )
  );
  const [requestingProductKey, setRequestingProductKey] = useState('');
  const [requestedProductKeys, setRequestedProductKeys] = useState(() => new Set());
  const itemsPropRef = useRef(items);
  const rankFetchAbortRef = useRef(null);
  const shouldAutoSelectNearestRef = useRef(true);
  /** When set, parent `items` is ignored until it matches these line ids (avoids stale full cart overwriting one-line selection). */
  const lockedLineIdsRef = useRef(null);
  const activeBoqHandoffIdRef = useRef(boqDetailHandoff?.boqId || null);

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

  const previousStep = useMemo(
    () =>
      resolveSupplierSelectBack({
        cartSupplierHandoff,
        location,
        lastPath: readLastSpPathBeforeSupplierSelect(),
        persistedOrigin: readPersistedSupplierSelectBackOrigin()
      }),
    [cartSupplierHandoff, location]
  );
  const previousStepPath = previousStep.path;
  const previousStepLabel = previousStep.label;

  useEffect(() => {
    persistSupplierSelectBackOrigin(previousStep.origin);
  }, [previousStep.origin]);

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
      boqId: boqDetailHandoff?.boqId || activeBoqHandoffIdRef.current || boqId,
      effectiveItems,
      boqMeta,
      cartSupplierHandoff
    });
    return buildVendorRankCacheKey(effectiveItems, effectiveBoqId, boqMeta);
  }, [effectiveItems, boqId, boqMeta, cartSupplierHandoff, boqDetailHandoff?.boqId]);

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

    const scopedBoqId =
      location?.state?.supplierSelectBoqId ||
      location?.state?.supplierSelectBoqProject?.boqId ||
      boqId;
    const deduped = excludeCancelledBoqItems(dedupeSupplierSelectItems(scoped), scopedBoqId);
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
  useEffect(() => {
    if (
      boqProject &&
      (boqProject.location ||
        boqProject.requiredDate ||
        boqProject.siteGeo ||
        boqProject.shippingAddress)
    ) {
      // Ignore stale parent project while a different BOQ handoff is active.
      if (
        activeBoqHandoffIdRef.current &&
        boqId &&
        String(boqId) !== String(activeBoqHandoffIdRef.current)
      ) {
        return;
      }
      setBoqMeta(enrichBoqProjectMeta(boqProject));
    }
  }, [boqProject, boqId]);

  // Apply BOQ detail → supplier-select handoff so a newly opened BOQ replaces any prior BOQ.
  useEffect(() => {
    if (!boqDetailHandoff) return;
    activeBoqHandoffIdRef.current = boqDetailHandoff.boqId;
    shouldAutoSelectNearestRef.current = true;
    setSelections({});
    setRequestedProductKeys(new Set());
    setItemVendors(seedItemVendorShell(boqDetailHandoff.items));
    setEffectiveItems(dedupeSupplierSelectItems(boqDetailHandoff.items));
    setBoqMeta(enrichBoqProjectMeta(boqDetailHandoff.project));
    setLoadingItems(false);
    setItemsLoadError('');
    setVendorsReady(false);
  }, [boqDetailHandoff]);

  // Keep local working copy of items so we can restore after refresh/navigation
  useEffect(() => {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    const handoffBoqId = activeBoqHandoffIdRef.current;
    if (handoffBoqId) {
      const incomingBoqId = String(boqId || items[0]?.boqId || '').trim();
      // Parent still holding a previous BOQ — do not overwrite the newly selected one.
      if (incomingBoqId && incomingBoqId !== String(handoffBoqId)) {
        return;
      }
      // Parent caught up to the handoff BOQ.
      if (incomingBoqId && incomingBoqId === String(handoffBoqId)) {
        activeBoqHandoffIdRef.current = null;
      }
    }
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
  }, [items, boqId]);

  // If items are missing (sidebar revisit), use saved workflow first, then BOQ API — not when coming from cart.
  useEffect(() => {
    let cancelled = false;

    const loadItems = async () => {
      setItemsLoadError('');

      if (effectiveItems?.length > 0 || itemsPropRef.current?.length > 0) {
        // If parent props are from a previous BOQ while handoff targets a new one, keep loading path open.
        const handoffBoqId = activeBoqHandoffIdRef.current || boqDetailHandoff?.boqId;
        if (handoffBoqId && itemsPropRef.current?.length > 0) {
          const propBoqId = String(
            boqId || itemsPropRef.current[0]?.boqId || ''
          ).trim();
          if (propBoqId && propBoqId !== String(handoffBoqId) && !(effectiveItems?.length > 0)) {
            // continue to fetch the handoff BOQ
          } else {
            setLoadingItems(false);
            return;
          }
        } else {
          setLoadingItems(false);
          return;
        }
      }

      if (cartSupplierHandoff) {
        setLoadingItems(false);
        return;
      }

      if (boqDetailHandoff?.items?.length) {
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

      const id =
        boqDetailHandoff?.boqId ||
        activeBoqHandoffIdRef.current ||
        boqId ||
        localStorage.getItem('lastBoqId');
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
          const withBoq = excludeCancelledBoqItems(
            data.items.map((it) => ({
              ...it,
              boqId: data.boqId || id
            })),
            data.boqId || id
          );
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
  }, [boqId, effectiveItems.length, cartSupplierHandoff, boqDetailHandoff?.boqId]);

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
    return sanitizeVendorOffers(cleanedVendors, effectiveItems, getStoredBuyerUserId());
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
    const sanitized = sanitizeVendorOffers(cleanedVendors, effectiveItems, getStoredBuyerUserId());
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

  useEffect(() => {
    setSelections((prev) => {
      let changed = false;
      const next = { ...(prev || {}) };
      (effectiveItems || []).forEach((item) => {
        const selectionKey = getSelectionKey(item);
        const selectedId = next[selectionKey];
        if (!selectedId) return;
        const vendor = findVendorForItem(item, selectedId);
        if (!vendor || !vendorCanFulfill(vendor, item)) {
          delete next[selectionKey];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    // findVendorForItem closes over itemVendors; re-run when offers or lines change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemVendors, effectiveItems]);

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
      const itemKey = String(item.id ?? item.normalizedName ?? item.rawName ?? '');
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

  const handleGoToSubstitutions = (allowEmptySelection = false) => {
    if (!allowEmptySelection) {
      handleProceed();
      return;
    }
    onComplete({ ...selections }, [...effectiveItems]);
    clearSupplierSelectScopeSession();
    navigate('/substitution');
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

    const buyerId = getStoredBuyerUserId();
    const selfPurchaseItems = buyerId
      ? effectiveItems.filter((item) => {
          const selectionKey = getSelectionKey(item);
          const selectedVendorId = selections[selectionKey];
          if (!selectedVendorId) return false;
          const vendor = findVendorForItem(item, selectedVendorId);
          return String(vendor?.id || '') === buyerId;
        })
      : [];
    if (selfPurchaseItems.length > 0) {
      alert(
        'You cannot buy this product from your own supplier listing. Choose another supplier of the same product or variant.'
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
                <strong>{boqMeta?.shippingAddress ? 'Delivery address:' : 'Dispatch location:'}</strong>{' '}
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
                Suppliers are ranked by distance to this dispatch location when outlet coordinates exist; otherwise
                city or state on the listing is used. The nearest <em>in-stock</em> supplier is pre-selected and
                marked <strong>Nearest · Recommended</strong>. Out-of-stock suppliers cannot be recommended or
                selected.
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
            {String(item?.variantLabel || item?.variantAsin || item?.variantKey || '').trim() ? (
              <div style={{ marginTop: '-0.4rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: '#64748b' }}>
                Variant:{' '}
                <strong>
                  {String(item?.variantLabel || item?.variantAsin || item?.variantKey || '').trim()}
                </strong>
              </div>
            ) : null}
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
                      Request this product so suppliers can add it, or choose a substitute.
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
                        onClick={() => handleGoToSubstitutions(true)}
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
                    const specificationEntries = specificationEntriesForCustomerDisplay(vendor?.specifications);
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
                      !isOutOfStock &&
                      hasEnoughStock &&
                      Boolean(recommendedVendorId) &&
                      recommendedVendorId === vendorIdStr;
                    const isSelected =
                      canFulfill &&
                      !isOutOfStock &&
                      hasEnoughStock &&
                      Boolean(currentSelection) &&
                      currentSelection === vendorIdStr;
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
                      <div className="vendor-card-image">
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
                            {boqMeta?.shippingAddress ? 'delivery address' : 'dispatch location'}
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
                        <div className="vendor-specifications">
                          <div className="vendor-specifications-title">
                            Specifications
                          </div>
                          <div
                            className={`vendor-specifications-entries${isSpecsExpanded ? ' is-expanded' : ''}`}
                          >
                            {visibleSpecificationEntries.map((entry) => (
                              <div
                                key={`${vendorIdStr}-${entry.key}`}
                                className="vendor-specifications-entry"
                              >
                                <strong>{entry.label}:</strong> {entry.displayValue}
                              </div>
                            ))}
                          </div>
                          {hasMoreSpecifications && (
                            <button
                              type="button"
                              className="vendor-specifications-toggle"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleSpecifications(item, vendorIdStr);
                              }}
                            >
                              {isSpecsExpanded
                                ? 'Show less'
                                : `View all specs (+${specificationEntries.length - 6} more)`}
                            </button>
                          )}
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
                    Your own supplier listing is not shown here. You must buy from another supplier of the same product or variant, request this product so other suppliers can add it, or choose a substitute.
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
                      onClick={() => handleGoToSubstitutions(true)}
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
