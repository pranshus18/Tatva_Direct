import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TrendingUp, Clock, RefreshCw, MapPin } from 'lucide-react';
import { resolveApiPath, authFetch } from '../config/api';
import { readSpWorkflow } from '../utils/spWorkflow';
import ProductImageCarousel from '../components/ProductImageCarousel';
import SupplierTsinLine from '../components/SupplierTsinLine';
import {
  clearSupplierSelectScopeSession,
  hasFreshCartSupplierSelectSession,
  readSupplierSelectScopeSessionIfFresh,
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
import { Users } from 'lucide-react';
import './VendorSelect.css';

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
  const [effectiveItems, setEffectiveItems] = useState(() =>
    items?.length ? dedupeSupplierSelectItems(items) : workflowSeed.items
  );
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsLoadError, setItemsLoadError] = useState('');
  const [rankNotice, setRankNotice] = useState('');
  const [boqMeta, setBoqMeta] = useState(boqProject || workflowSeed.project || null);
  const navigate = useNavigate();
  const location = useLocation();
  const itemsPropRef = useRef(items);
  const rankFetchAbortRef = useRef(null);
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

  const rankCacheKey = useMemo(() => {
    if (!effectiveItems?.length) return '';
    const effectiveBoqId =
      boqId ||
      effectiveItems[0]?.boqId ||
      (typeof window !== 'undefined' ? localStorage.getItem('lastBoqId') : null);
    return buildVendorRankCacheKey(effectiveItems, effectiveBoqId);
  }, [effectiveItems, boqId]);

  useEffect(() => {
    itemsPropRef.current = items;
  }, [items]);

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
    const proj = location.state?.supplierSelectBoqProject;
    if (proj && typeof proj === 'object') {
      setBoqMeta(proj);
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
    if (boqProject && (boqProject.location || boqProject.requiredDate || boqProject.siteGeo)) {
      setBoqMeta(boqProject);
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
          stock: typeof v.stock === 'number' ? v.stock : parseInt(v.stock || 0, 10)
        }));
      } else {
        cleanedVendors[itemId] = [];
      }
    });
    return cleanedVendors;
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
        setItemVendors(cached);
        setLoading(false);
        return;
      }
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('You are not logged in. Please log in again.');
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
      const effectiveBoqId =
        boqId ||
        effectiveItems[0]?.boqId ||
        (typeof window !== 'undefined' ? localStorage.getItem('lastBoqId') : null);

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
      setItemVendors(cleanedVendors);
      setRankNotice('');
      if (cacheKey) {
        setVendorRankCache(cacheKey, cleanedVendors);
      }
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
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loadingItems || !effectiveItems?.length || !rankCacheKey) return;

    const cached = getVendorRankCache(rankCacheKey);
    if (cached) {
      setItemVendors(cached);
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

  const handleSelect = (item, vendorId) => {
    const selectionKey = getSelectionKey(item);
    const normalizedVendorId = String(vendorId || '');

    if (!selectionKey) return;

    console.log('Selecting vendor:', {
      selectionKey,
      vendorId: normalizedVendorId,
      currentSelections: selections
    });

    setSelections(prev => {
      const currentVendorId = prev[selectionKey];

      // Toggle selection off when user clicks the same card again.
      if (currentVendorId === normalizedVendorId) {
        const { [selectionKey]: _removed, ...remainingSelections } = prev;
        console.log('Removed selection:', remainingSelections);
        return remainingSelections;
      }

      const newSelections = { ...prev, [selectionKey]: normalizedVendorId };
      console.log('Updated selections:', newSelections);
      return newSelections;
    });
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
    
    // If no items have selections, show error
    if (itemsWithSelections === 0) {
      alert('Please select at least one supplier before proceeding.');
      return;
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
      <div className="page">
        <div className="page-header">
          <h1>Supplier Selection</h1>
          <p>
            {itemsLoadError
              ? itemsLoadError
              : cartSupplierHandoff
                ? 'Your cart lines did not load on this page (common in production when a new tab opens or browser storage is restricted). Go back to the cart and use Select supplier again.'
                : canTrySavedBoq
                  ? 'No line items are on this screen yet. If you expected your last uploaded BOQ, open BOQ Normalize and continue again, or use the cart to pick supplier lines.'
                  : 'No line items to show yet. Open your cart and use Select supplier again, or start from a BOQ upload.'}
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button type="button" className="btn-primary" onClick={() => navigate('/cart')}>
            Go to cart
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate('/boq-normalize')}>
            Upload a BOQ
          </button>
        </div>
      </div>
    );
  }

  return (
    <SpWorkflowPage title="Supplier Selection" description="Choose the best vendor for each item" icon={Users}>
    <div className="page !p-0">
      <VoiceGuidedBanner />
      <div className="page-header hidden">
        <div>
          <h1>Supplier Selection</h1>
          <p>Choose the best vendor for each item</p>
          {(boqMeta?.location || boqMeta?.requiredDate) && (
            <div
              style={{
                marginTop: '0.75rem',
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
                {boqMeta.location && (
                  <>
                    <strong>Project site:</strong> {boqMeta.location}
                  </>
                )}
                {boqMeta.requiredDate && (
                  <>
                    {boqMeta.location ? ' · ' : ''}
                    <strong>Required by:</strong>{' '}
                    {new Date(
                      boqMeta.requiredDate.includes('T')
                        ? boqMeta.requiredDate
                        : `${boqMeta.requiredDate}T12:00:00`
                    ).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </>
                )}
                {boqMeta.location && (
                  <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.78rem', opacity: 0.9 }}>
                    Suppliers are ranked nearer to this site when outlet coordinates exist; otherwise city or state on the
                    listing is used.
                  </span>
                )}
              </span>
            </div>
          )}
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
          
          const selectionKey = getSelectionKey(item);
          const currentSelection = String(selections[selectionKey] || '');
          
          return (
          <div key={item.id} className="vendor-section">
            <h3 className="item-title">{item.normalizedName || item.rawName}</h3>
            {getProductIdentification(item) && (
              <div style={{ marginTop: '-0.4rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: '#334155' }}>
                <strong>Product Identification:</strong> {getProductIdentification(item)}
              </div>
            )}
            <div className="vendor-options">
              {hasVendors ? (
                vendors
                  .filter((vendor) => vendor && vendor.id && vendor.name)
                  .map((vendor) => {
                    const vendorIdStr = String(vendor.selectionId || vendor.supplierProductId || vendor.id);
                    const vendorSpecifications = normalizeSpecifications(vendor?.specifications);
                    const specificationEntries = Object.entries(vendorSpecifications);
                    const specsKey = `${itemId}::${vendorIdStr}`;
                    const isSpecsExpanded = !!expandedSpecifications[specsKey];
                    const visibleSpecificationEntries = isSpecsExpanded
                      ? specificationEntries
                      : specificationEntries.slice(0, 6);
                    const hasMoreSpecifications = specificationEntries.length > 6;
                    const isSelected = currentSelection === vendorIdStr;
                    return (
                  <div 
                    key={vendorIdStr}
                    className={`vendor-card ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log(`[VendorSelect] Clicked on vendor: ${vendor.name} (ID: ${vendor.id}) for item: ${itemId}`);
                      handleSelect(item, vendorIdStr);
                    }}
                    onMouseDown={(e) => {
                      // Prevent text selection on click
                      e.preventDefault();
                    }}
                    style={{ 
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      cursor: 'pointer',
                      position: 'relative',
                      zIndex: 1
                    }}
                    role="button"
                    tabIndex={0}
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
                            ~{Math.round(vendor.distanceKm)} km from your project site
                          </div>
                        )}
                      </div>
                      {vendor.rank === 1 && <span className="badge">Recommended</span>}
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
                      {vendor.description && (
                        <div className="product-description">
                          {vendor.description.substring(0, 50)}...
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
                        <TrendingUp size={16} />
                        <span>
                          {vendor.price > 0
                            ? `${vendor.price?.toLocaleString()} / ${vendor.unit || 'unit'}`
                            : `Price on request / ${vendor.unit || 'unit'}`}
                        </span>
                      </div>
                      <div className="detail">
                        <Clock size={16} />
                        <span>{vendor.leadTime} days delivery</span>
                      </div>
                      {vendor.stock > 0 ? (
                        <div className="detail" style={{ color: '#059669' }}>
                          <span>✓ Stock: {vendor.stock} {vendor.unit || 'units'}</span>
                        </div>
                      ) : (
                        <div className="detail" style={{ color: '#dc2626' }}>
                          <span>✗ Out of stock</span>
                        </div>
                      )}
                      {vendor.rating > 0 && (
                        <div className="detail">
                          <span>⭐ {vendor.rating.toFixed(1)} rating</span>
                        </div>
                      )}
                      {vendor.isAvailable === false && (
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
                  })
              ) : (
                <div className="no-vendors" style={{
                  padding: '2rem',
                  textAlign: 'center',
                  backgroundColor: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb'
                }}>
                  <p style={{ 
                    color: '#64748b', 
                    fontSize: '1rem',
                    margin: 0,
                    fontWeight: '500'
                  }}>
                    No supplier is available for this requirement
                  </p>
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
        disabled={!effectiveItems.some(item => !!selections[getSelectionKey(item)])}
      >
        Continue to Substitutions
      </button>
    </div>
    </SpWorkflowPage>
  );
};

export default VendorSelect;
