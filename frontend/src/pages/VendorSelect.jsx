import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TrendingUp, Clock, RefreshCw, MapPin } from 'lucide-react';
import { getApiUrl } from '../config/api';
import ProductImageCarousel from '../components/ProductImageCarousel';
import './VendorSelect.css';

const SESSION_SCOPE_KEY = 'tatvaSupplierSelectScope';
const SESSION_SCOPE_TS_KEY = 'tatvaSupplierSelectScopeTs';
const SCOPE_TTL_MS = 120000;

const VendorSelect = ({ items = [], boqId = null, boqProject = null, onComplete }) => {
  const [itemVendors, setItemVendors] = useState({});
  const [selections, setSelections] = useState({});
  const [expandedSpecifications, setExpandedSpecifications] = useState({});
  const [loading, setLoading] = useState(false);
  const [effectiveItems, setEffectiveItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [boqMeta, setBoqMeta] = useState(boqProject || null);
  const navigate = useNavigate();
  const location = useLocation();
  const itemsPropRef = useRef(items);
  /** When set, parent `items` is ignored until it matches these line ids (avoids stale full cart overwriting one-line selection). */
  const lockedLineIdsRef = useRef(null);

  useEffect(() => {
    itemsPropRef.current = items;
  }, [items]);

  // Cart passes router state + session backup; BOQ flow must not read stale session.
  useLayoutEffect(() => {
    const fromCart = location?.state?.fromCartSupplierSelect === true;
    if (!fromCart) {
      try {
        sessionStorage.removeItem(SESSION_SCOPE_KEY);
        sessionStorage.removeItem(SESSION_SCOPE_TS_KEY);
      } catch {
        /* ignore */
      }
    }

    let scoped = location?.state?.supplierSelectItems;
    if (fromCart && (!Array.isArray(scoped) || scoped.length === 0)) {
      try {
        const ts = Number(sessionStorage.getItem(SESSION_SCOPE_TS_KEY) || 0);
        if (ts && Date.now() - ts < SCOPE_TTL_MS) {
          const raw = sessionStorage.getItem(SESSION_SCOPE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) scoped = parsed;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!Array.isArray(scoped) || scoped.length === 0) return;

    const ids = new Set(scoped.map((it) => String(it?.id ?? '').trim()).filter(Boolean));
    lockedLineIdsRef.current = ids.size > 0 ? ids : null;

    setEffectiveItems(scoped);
    const proj = location.state?.supplierSelectBoqProject;
    if (proj && typeof proj === 'object') {
      setBoqMeta(proj);
    }
  }, [location.pathname, location.search, location.state]);
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
    setEffectiveItems(items);
  }, [items]);

  // If items are missing (e.g., user returns later), load them from the saved BOQ
  useEffect(() => {
    let cancelled = false;
    const loadItems = async () => {
      if (effectiveItems && effectiveItems.length > 0) return;

      const token = localStorage.getItem('token');
      if (!token) return;

      const id = boqId || localStorage.getItem('lastBoqId');
      if (!id) return;

      setLoadingItems(true);
      try {
        const res = await fetch(getApiUrl(`/api/boq/${encodeURIComponent(id)}/items`), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (cancelled) return;
        // Parent may have supplied a focused list while this request was in flight; do not overwrite.
        if (itemsPropRef.current && itemsPropRef.current.length > 0) {
          return;
        }
        if (res.ok && data.status === 'success' && Array.isArray(data.items)) {
          const withBoq = data.items.map((it) => ({
            ...it,
            boqId: data.boqId || id
          }));
          setEffectiveItems(withBoq);
          if (data.project && (data.project.location || data.project.requiredDate)) {
            setBoqMeta(data.project);
          }
        }
      } catch (e) {
        // ignore - UI will prompt to upload again
      } finally {
        if (!cancelled) {
          setLoadingItems(false);
        }
      }
    };

    loadItems();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqId, effectiveItems.length]);

  const fetchVendors = async () => {
    // Validate items before fetching
    if (!effectiveItems || !Array.isArray(effectiveItems) || effectiveItems.length === 0) {
      console.error('Cannot fetch vendors: items is empty or invalid');
      setLoading(false);
      return;
    }
    
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('No authentication token found');
      alert('You are not logged in. Please log in again.');
      setLoading(false);
      return;
    }
    
    setLoading(true);
    
    try {
      // Generate a unique timestamp and random number to prevent any caching
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      
      // Try using proxy first (relative URL), fallback to full URL
      const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';
      let apiUrl;
      if (isDevelopment) {
        // Use proxy in development (relative URL)
        apiUrl = `/api/vendors/rank`;
      } else {
        // Use full URL in production
        apiUrl = getApiUrl('/api/vendors/rank');
      }
      
      const fullUrl = `${apiUrl}?_t=${timestamp}&_r=${random}`;
      console.log(`[VendorSelect] Fetching vendors at ${new Date().toISOString()}`);
      console.log(`[VendorSelect] Is Development: ${isDevelopment}`);
      console.log(`[VendorSelect] API URL: ${apiUrl}`);
      console.log(`[VendorSelect] Full URL: ${fullUrl}`);
      console.log(`[VendorSelect] Items being sent:`, effectiveItems);
      console.log(`[VendorSelect] Items count: ${effectiveItems.length}`);
      console.log(`[VendorSelect] Sample item structure:`, effectiveItems[0] ? {
        id: effectiveItems[0].id,
        normalizedName: effectiveItems[0].normalizedName,
        rawName: effectiveItems[0].rawName,
        productId: effectiveItems[0].productId,
        availableSuppliers: effectiveItems[0].availableSuppliers
      } : 'No items');
      console.log(`[VendorSelect] Token present: ${!!token}`);
      
      // Add timestamp and random to prevent caching and ensure fresh data
      const effectiveBoqId =
        boqId ||
        effectiveItems[0]?.boqId ||
        (typeof window !== 'undefined' ? localStorage.getItem('lastBoqId') : null);

      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'X-Request-ID': `${timestamp}-${random}`,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          items: effectiveItems,
          boqId: effectiveBoqId || undefined,
          _timestamp: timestamp,
          _random: random
        })
      });
      
      console.log(`[VendorSelect] Response status: ${res.status} ${res.statusText}`);
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[VendorSelect] API Error Response:`, errorText);
        let errorMessage = `HTTP error! status: ${res.status}`;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          // If not JSON, use the text
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await res.json();
      console.log('[VendorSelect] API Response:', data);
      console.log('[VendorSelect] ItemVendors:', data.itemVendors);
      console.log('[VendorSelect] ItemVendors type:', typeof data.itemVendors);
      console.log('[VendorSelect] ItemVendors keys:', data.itemVendors ? Object.keys(data.itemVendors) : 'null');
      
      if (data.itemVendors && typeof data.itemVendors === 'object') {
        // Ensure all item vendors are arrays and filter out invalid entries
        const cleanedVendors = {};
        Object.keys(data.itemVendors).forEach(itemId => {
          const vendors = data.itemVendors[itemId];
          console.log(`[VendorSelect] Processing vendors for item ${itemId}:`, vendors);
          console.log(`[VendorSelect] Item ${itemId} vendors type:`, typeof vendors, 'isArray:', Array.isArray(vendors));
          if (Array.isArray(vendors)) {
            // Show every ranked supplier listing (id + name); stock/price may be zero — card shows status.
            const validVendors = vendors.filter((v) => v && v.id && v.name);
            console.log(`[VendorSelect] Item ${itemId}: ${validVendors.length} vendors (from ${vendors.length} raw)`);
            // Normalize types so downstream UI doesn't depend on backend returning `price` as a JS number
            cleanedVendors[itemId] = validVendors.map((v) => ({
              ...v,
              price: typeof v.price === 'number' ? v.price : parseFloat(v.price),
              stock: typeof v.stock === 'number' ? v.stock : parseInt(v.stock || 0)
            }));
          } else {
            console.log(`[VendorSelect] Item ${itemId}: vendors is not an array:`, typeof vendors, vendors);
            cleanedVendors[itemId] = [];
          }
        });
        console.log('[VendorSelect] Final cleaned vendors:', cleanedVendors);
        console.log('[VendorSelect] Setting itemVendors state with:', Object.keys(cleanedVendors).length, 'items');
        setItemVendors(cleanedVendors);
      } else {
        console.log('[VendorSelect] No itemVendors in response or invalid format');
        // If no itemVendors in response, initialize with empty arrays
        const emptyVendors = {};
        effectiveItems.forEach(item => {
          const itemId = item.id?.toString() || String(item.id);
          emptyVendors[itemId] = [];
        });
        setItemVendors(emptyVendors);
      }
    } catch (error) {
      console.error('[VendorSelect] Failed to fetch vendors:', error);
      console.error('[VendorSelect] Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      
      // Show user-friendly error message
      if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
        const apiUrl = getApiUrl('/api/vendors/rank');
        const errorMsg = `Unable to connect to the server.\n\nPlease check:\n1. Backend server is running on ${apiUrl.replace('/api/vendors/rank', '')}\n2. Your internet connection\n3. CORS is properly configured\n\nCheck browser console (F12) for more details.`;
        console.error('[VendorSelect] Connection Error Details:', {
          apiUrl,
          error: error.message,
          name: error.name,
          stack: error.stack
        });
        alert(errorMsg);
      } else {
        alert(`Error fetching suppliers: ${error.message}\n\nCheck browser console for details.`);
      }
      
      // Initialize with empty arrays on error
      const emptyVendors = {};
      effectiveItems.forEach(item => {
        const itemId = item.id?.toString() || String(item.id);
        emptyVendors[itemId] = [];
      });
      setItemVendors(emptyVendors);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check if items is valid and has length
    if (effectiveItems && Array.isArray(effectiveItems) && effectiveItems.length > 0) {
      // Use a ref to prevent duplicate calls in React StrictMode
      let isMounted = true;
      let timeoutId;
      
      // Debounce to prevent duplicate calls
      timeoutId = setTimeout(() => {
        if (isMounted) {
          console.log('[VendorSelect] useEffect: Fetching vendors for items:', effectiveItems.length);
          fetchVendors();
        }
      }, 100);
      
      return () => {
        isMounted = false;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };
    } else {
      // Cart / discovery often has no boqId — never auto-send users to BOQ normalize (they lose context).
      // Empty state UI below offers manual links when nothing can be loaded.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveItems, loadingItems]);
  
  // Also fetch vendors when component becomes visible (user switches tabs/windows)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && effectiveItems && Array.isArray(effectiveItems) && effectiveItems.length > 0) {
        console.log('Page became visible, refreshing vendor data...');
        fetchVendors();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [effectiveItems]);

  // Add refresh functionality to get latest supplier data
  const handleRefresh = () => {
    fetchVendors();
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
    try {
      sessionStorage.removeItem(SESSION_SCOPE_KEY);
      sessionStorage.removeItem(SESSION_SCOPE_TS_KEY);
    } catch {
      /* ignore */
    }
    navigate('/substitution');
  };

  // Show loading or error state if items are not available
  if (loadingItems) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Supplier Selection</h1>
          <p>Loading saved BOQ items...</p>
        </div>
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!effectiveItems || !Array.isArray(effectiveItems) || effectiveItems.length === 0) {
    const possibleBoqId =
      boqId ||
      (typeof window !== 'undefined' ? localStorage.getItem('lastBoqId') : null);
    const canLoadFromSavedBoq = !!possibleBoqId;

    return (
      <div className="page">
        <div className="page-header">
          <h1>Supplier Selection</h1>
          <p>
            {canLoadFromSavedBoq
              ? 'Loading saved BOQ items...'
              : 'No line items to show yet. Open your cart and use Select supplier again, or start from a BOQ upload.'}
          </p>
        </div>
        {!canLoadFromSavedBoq && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button 
            className="btn-primary" 
            onClick={() => navigate('/cart')}
          >
            Go to cart
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => navigate('/boq-normalize')}
          >
            Upload a BOQ
          </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

      {loading && effectiveItems.length > 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          Loading suppliers...
        </div>
      )}

      <div className="vendor-list">
        {effectiveItems.map((item) => {
          const itemId = item.id?.toString() || String(item.id);
          const vendors = itemVendors[itemId] || itemVendors[item.id] || [];
          const hasVendors = Array.isArray(vendors) && vendors.length > 0 && vendors.some(v => v.id && v.name);
          
          const selectionKey = getSelectionKey(item);
          const currentSelection = String(selections[selectionKey] || '');
          
          console.log(`[VendorSelect] Item ${itemId}:`, {
            vendorsCount: vendors.length,
            currentSelection,
            selections
          });
          
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
  );
};

export default VendorSelect;
