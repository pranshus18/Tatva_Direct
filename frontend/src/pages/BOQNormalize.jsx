import React, { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { getApiUrl, resolveApiPath } from '../config/api';
import { clearSupplierSelectScopeSession } from '../constants/supplierSelectSession';
import { persistSupplierSelectBackOrigin } from '../utils/supplierSelectBack';
import {
  formatResolvedAddressLine,
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import { Upload, CheckCircle, AlertCircle, Users, Package, PlusCircle, MapPin, Calendar, FileText, XCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getTodayDateInputValue, isDateBeforeToday } from '../utils/dateTime';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
import { Button } from '@/components/ui/button';
import {
  clearCancelledBoqItemIds,
  readCancelledBoqItemIds,
  writeCancelledBoqItemIds
} from '../utils/boqCancelledItems';
import './BOQNormalize.css';

// Ask the user to confirm ANY match that is not nearly exact.
// 0.99 means even 81%, 90%, etc. will be confirmed like a "Did you mean" suggestion.
const CONFIRM_MATCH_THRESHOLD = 0.99;
const REQUEST_PRODUCT_PARAM = 'requestProduct';
const todayDateMin = getTodayDateInputValue();

function normalizeProductRequestName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildProductRequestKey(item, currentBoqId) {
  const boqPart = currentBoqId ? String(currentBoqId).trim() : 'draft';
  const itemPart =
    item?.id != null && String(item.id).trim() !== ''
      ? `item:${String(item.id).trim()}`
      : `name:${normalizeProductRequestName(item?.normalizedName || item?.rawName)}`;
  return `${boqPart}:${itemPart}`;
}

const BOQNormalize = ({ onComplete }) => {
  const [siteLocation, setSiteLocation] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [siteLat, setSiteLat] = useState('');
  const [siteLng, setSiteLng] = useState('');
  const [file, setFile] = useState(null);
  const [items, setItems] = useState([]);
  const [cancelledItemIds, setCancelledItemIds] = useState(() => new Set());
  const [boqId, setBoqId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingCart, setSavingCart] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [submittedProductRequestKeys, setSubmittedProductRequestKeys] = useState(() => new Set());
  const [savedProjectMeta, setSavedProjectMeta] = useState(null);
  const [locatingSite, setLocatingSite] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const uploadGenerationRef = useRef(0);

  const requestingProductForItem = useMemo(() => {
    const itemId = searchParams.get(REQUEST_PRODUCT_PARAM);
    if (!itemId) return null;
    return items.find((item) => String(item.id) === String(itemId)) || null;
  }, [items, searchParams]);

  const openRequestProductModal = useCallback((item) => {
    if (!item?.id) return;
    const requestKey = buildProductRequestKey(item, boqId);
    if (submittedProductRequestKeys.has(requestKey)) {
      toast.info('You have already made a request for this product.');
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(REQUEST_PRODUCT_PARAM, String(item.id));
        return next;
      },
      { replace: false }
    );
  }, [boqId, setSearchParams, submittedProductRequestKeys]);

  const closeRequestProductModal = useCallback(() => {
    if (!searchParams.get(REQUEST_PRODUCT_PARAM)) return;
    navigate(-1);
  }, [navigate, searchParams]);

  /** Return to the upload step so the user can replace a wrong BOQ file in-app. */
  const handleReplaceBoq = useCallback(() => {
    if (savingCart || requestSubmitting) return;

    const hasResults = Boolean(file) || items.length > 0 || loading;
    if (hasResults) {
      const confirmed = window.confirm(
        loading
          ? 'Cancel this upload and replace the BOQ file?\n\nYour site location and expected dispatch date will be kept.'
          : 'Replace this BOQ file?\n\nCurrent normalized items will be cleared. Your site location and expected dispatch date will be kept so you can upload a different file.'
      );
      if (!confirmed) return;
    }

    uploadGenerationRef.current += 1;

    if (searchParams.get(REQUEST_PRODUCT_PARAM)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(REQUEST_PRODUCT_PARAM);
          return next;
        },
        { replace: true }
      );
    }

    setFile(null);
    setItems([]);
    setCancelledItemIds(new Set());
    if (boqId) clearCancelledBoqItemIds(boqId);
    setBoqId(null);
    setSubmittedProductRequestKeys(new Set());
    setSavedProjectMeta(null);
    setLoading(false);
    clearSupplierSelectScopeSession();
    try {
      localStorage.removeItem('lastBoqId');
    } catch {
      /* ignore */
    }
    toast.info('Upload a different BOQ file when ready.');
  }, [
    savingCart,
    requestSubmitting,
    file,
    items.length,
    loading,
    boqId,
    searchParams,
    setSearchParams
  ]);

  const fillGeoFromBrowser = async () => {
    setLocatingSite(true);
    try {
      const resolved = await resolveAddressFromCurrentLocation();
      const addressLine = formatResolvedAddressLine(resolved);
      if (addressLine) {
        setSiteLocation(addressLine);
      }
      if (typeof resolved.latitude === 'number' && typeof resolved.longitude === 'number') {
        setSiteLat(String(resolved.latitude));
        setSiteLng(String(resolved.longitude));
      }
    } catch (error) {
      toast.error(getGeolocationErrorMessage(error));
    } finally {
      setLocatingSite(false);
    }
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    const loc = siteLocation.trim();
    const hasGeo = siteLat.trim() && siteLng.trim();
    if ((!loc && !hasGeo) || !requiredDate) {
      toast.error('Please provide the project site location and select the expected dispatch date before uploading your BOQ.');
      e.target.value = '';
      return;
    }
    if (isDateBeforeToday(requiredDate)) {
      toast.error('Expected dispatch date cannot be in the past.');
      e.target.value = '';
      return;
    }

    setFile(uploadedFile);
    setLoading(true);
    setCancelledItemIds(new Set());
    const uploadGeneration = ++uploadGenerationRef.current;

    const formData = new FormData();
    formData.append('file', uploadedFile);
    if (loc) {
      formData.append('siteLocation', loc);
    }
    formData.append('requiredDate', requiredDate);
    if (siteLat.trim() && siteLng.trim()) {
      formData.append('siteLatitude', siteLat.trim());
      formData.append('siteLongitude', siteLng.trim());
    }

    // Get auth token
    const token = localStorage.getItem('token');

    try {
      // Add cache-busting parameters to ensure fresh data
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      
      console.log(`BOQ Normalize - Uploading file at ${new Date().toISOString()} with timestamp: ${timestamp}`);
      
      const res = await fetch(resolveApiPath(`/api/boq/normalize?_t=${timestamp}&_r=${random}`), {
        method: 'POST',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'X-Request-ID': `${timestamp}-${random}`,
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: formData
      });
      
      const data = await res.json();
      if (uploadGeneration !== uploadGenerationRef.current) return;
      
      if (!res.ok) {
        const errorMessage =
          data.message ||
          data.error ||
          (typeof data.details === 'string' ? data.details : null) ||
          res.statusText ||
          'Upload failed';
        throw new Error(errorMessage);
      }
      
      if (data.items && data.items.length > 0) {
        setItems(data.items);
        setSubmittedProductRequestKeys(new Set());
        setCancelledItemIds(new Set());
        if (data.boqId) {
          clearCancelledBoqItemIds(data.boqId);
          setBoqId(data.boqId);
          try {
            localStorage.setItem('lastBoqId', data.boqId);
          } catch (e) {
            // ignore storage errors
          }
        }
        const proj =
          data.project ||
          (siteLocation.trim() && requiredDate
            ? {
                location: siteLocation.trim(),
                requiredDate,
                siteGeo:
                  siteLat.trim() && siteLng.trim()
                    ? { lat: parseFloat(siteLat), lng: parseFloat(siteLng) }
                    : null
              }
            : null);
        setSavedProjectMeta(proj);
      } else {
        toast.error('No items found in the uploaded file. Please try again.');
        setFile(null);
      }
    } catch (error) {
      if (uploadGeneration !== uploadGenerationRef.current) return;
      console.error('Upload failed:', error);
      const errorMessage =
        error?.message ||
        (typeof error === 'string' ? error : null) ||
        'Failed to process file. Please check site location, expected dispatch date, and file format (CSV or Excel).';
      toast.error(errorMessage);
      setFile(null);
      setItems([]);
      setSubmittedProductRequestKeys(new Set());
    } finally {
      if (uploadGeneration === uploadGenerationRef.current) {
        setLoading(false);
      }
    }
  };

  // Notify terminal suppliers that a customer is looking for an unavailable BOQ item.
  const submitProductRequest = async (item) => {
    if (!item) return;
    const requestKey = buildProductRequestKey(item, boqId);
    if (submittedProductRequestKeys.has(requestKey)) {
      toast.info('You have already made a request for this product.');
      closeRequestProductModal();
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      toast.error('Please log in again to request a new product.');
      return;
    }

    setRequestSubmitting(true);
    try {
      const body = {
        name: item.normalizedName || item.rawName,
        category: item.category || 'other',
        unit: item.unit || 'nos',
        description: item.rawName || '',
        brand: item.brand || item.normalizedName || item.rawName || '',
        boqId: boqId || null,
        boqItemId: item.id ?? null
      };

      const res = await fetch(getApiUrl('/api/boq/request-product'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || data.alreadyRequested) {
        setSubmittedProductRequestKeys((prev) => new Set(prev).add(requestKey));
        closeRequestProductModal();
        toast.info(data.message || 'You have already made a request for this product.');
        return;
      }
      if (res.ok && data.status === 'success') {
        setSubmittedProductRequestKeys((prev) => new Set(prev).add(requestKey));
        const productLabel = item.normalizedName || item.rawName || 'this product';
        closeRequestProductModal();
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
      setRequestSubmitting(false);
    }
  };

  const itemIdentity = (item) =>
    item?.id != null && String(item.id).trim() !== '' ? String(item.id).trim() : '';

  const activeItems = useMemo(
    () => items.filter((item) => !cancelledItemIds.has(itemIdentity(item))),
    [items, cancelledItemIds]
  );

  const persistCancelledIds = useCallback(
    (nextIds) => {
      writeCancelledBoqItemIds(boqId, nextIds);
    },
    [boqId]
  );

  const handleCancelItem = (item) => {
    const key = itemIdentity(item);
    if (!key || cancelledItemIds.has(key)) return;
    const label = item.normalizedName || item.rawName || 'this product';
    const remaining = items.length - cancelledItemIds.size - 1;
    const confirmed = window.confirm(
      `Remove "${label}" from this order?\n\nYou can still order the remaining ${Math.max(remaining, 0)} BOQ item${remaining === 1 ? '' : 's'}. You can restore this product if you change your mind.`
    );
    if (!confirmed) return;
    const next = new Set(cancelledItemIds);
    next.add(key);
    setCancelledItemIds(next);
    persistCancelledIds(next);
    toast.success(`Removed "${label}" from this order.`);
  };

  const handleRestoreItem = (item) => {
    const key = itemIdentity(item);
    if (!key || !cancelledItemIds.has(key)) return;
    const next = new Set(cancelledItemIds);
    next.delete(key);
    setCancelledItemIds(next);
    persistCancelledIds(next);
    toast.success(`Restored "${item.normalizedName || item.rawName || 'product'}" to this order.`);
  };

  const handleProceed = () => {
    if (activeItems.length === 0) {
      toast.error(
        items.length > 0
          ? 'All BOQ products were cancelled. Restore at least one product, or upload a different BOQ.'
          : 'Please upload and process a BOQ file first'
      );
      return;
    }

    // Find items where the automatic match is not very strong
    const ambiguousItems = activeItems.filter(item => 
      typeof item.confidence === 'number' && 
      item.productId && 
      item.confidence < CONFIRM_MATCH_THRESHOLD
    );

    if (ambiguousItems.length > 0) {
      // Build a confirmation message showing how we matched them
      const previewLines = ambiguousItems.slice(0, 10).map(item => {
        const percent = Math.round(item.confidence * 100);
        return `• For "${item.rawName}" did you mean "${item.normalizedName}"? (${percent}% match)`;
      });
      let message = 
        'Some BOQ item names do not exactly match your catalog products.\n\n' +
        'Based on spelling / local name / case / alphanumeric differences, we matched them like Google "Did you mean":\n\n' +
        previewLines.join('\n') +
        (ambiguousItems.length > 10 ? `\n...and ${ambiguousItems.length - 10} more.\n` : '\n') +
        '\nIf this looks correct, click OK to continue to Supplier Selection.\n' +
        'If not, click Cancel and adjust your BOQ or product catalog.';

      const confirmed = window.confirm(message);
      if (!confirmed) {
        // User wants to review the matches before proceeding
        return;
      }
    }
    
    console.log('Proceeding to vendor selection with items:', activeItems);
    onComplete(
      activeItems,
      boqId,
      savedProjectMeta ||
        (siteLocation.trim() && requiredDate
          ? {
              location: siteLocation.trim(),
              requiredDate,
              siteGeo:
                siteLat.trim() && siteLng.trim()
                  ? { lat: parseFloat(siteLat), lng: parseFloat(siteLng) }
                  : null
            }
          : null)
    );
    if (boqId) {
      try {
        localStorage.setItem('lastBoqId', boqId);
      } catch (e) {
        // ignore storage errors
      }
    }
    clearSupplierSelectScopeSession();
    persistSupplierSelectBackOrigin('boq');
    navigate('/supplier-select', {
      replace: false,
      state: {
        supplierSelectOrigin: 'boq',
        supplierSelectReturnTo: '/boq-normalize',
        supplierSelectItems: activeItems,
        supplierSelectBoqProject:
          savedProjectMeta ||
          (siteLocation.trim() && requiredDate
            ? {
                location: siteLocation.trim(),
                requiredDate,
                siteGeo:
                  siteLat.trim() && siteLng.trim()
                    ? { lat: parseFloat(siteLat), lng: parseFloat(siteLng) }
                    : null
              }
            : null)
      }
    });
  };

  const handleAddToCart = async () => {
    if (activeItems.length === 0) {
      toast.error(
        items.length > 0
          ? 'All BOQ products were cancelled. Restore at least one product, or upload a different BOQ.'
          : 'Please upload and process a BOQ file first.'
      );
      return;
    }

    const inStockItems = activeItems.filter((item) => {
      const hasSuppliers = (item.availableSuppliers || 0) > 0;
      const isAvailable = item.isAvailable ?? hasSuppliers;
      return Boolean(isAvailable);
    });
    const outOfStockCount = activeItems.length - inStockItems.length;

    if (inStockItems.length === 0) {
      toast.error('Product is out of stock');
      return;
    }

    setSavingCart(true);
    try {
      const token = localStorage.getItem('token');
      const projectMeta =
        savedProjectMeta ||
        (siteLocation.trim() && requiredDate
          ? {
              location: siteLocation.trim(),
              requiredDate,
              siteGeo:
                siteLat.trim() && siteLng.trim()
                  ? { lat: parseFloat(siteLat), lng: parseFloat(siteLng) }
                  : null
            }
          : null);

      const getRes = await fetch(getApiUrl('/api/po/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const getData = await getRes.json();
      if (!getRes.ok || getData.status !== 'success') {
        throw new Error(getData.message || 'Failed to load existing cart');
      }

      const prevDraft = getData.cart?.draft || {};
      let existingGroups = [];
      if (Array.isArray(prevDraft.boqGroups) && prevDraft.boqGroups.length > 0) {
        existingGroups = prevDraft.boqGroups.map((g) => ({
          ...g,
          items: Array.isArray(g.items) ? g.items.map((it) => ({ ...it })) : []
        }));
      } else if (Array.isArray(prevDraft.items) && prevDraft.items.length > 0) {
        existingGroups = [
          {
            groupId: `legacy-${prevDraft.boqId || 'single'}`,
            boqId: prevDraft.boqId || null,
            boqName: null,
            boqProject: prevDraft.boqProject || null,
            items: prevDraft.items.map((it) => ({ ...it })),
            selectedVendors: { ...(prevDraft.selectedVendors || {}) },
            substitutions: Array.isArray(prevDraft.substitutions) ? [...prevDraft.substitutions] : []
          }
        ];
      }

      const groupId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `g-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      const prefixedItems = inStockItems.map((it, idx) => ({
        ...it,
        id:
          it.id !== undefined && it.id !== null
            ? `${groupId}:${String(it.id)}`
            : `${groupId}:line-${idx}`
      }));

      let nextGroups = existingGroups;
      if (boqId) {
        nextGroups = existingGroups.filter((g) => String(g.boqId || '') !== String(boqId));
      }
      nextGroups = [
        ...nextGroups,
        {
          groupId,
          boqId: boqId || null,
          boqName: null,
          boqProject: projectMeta,
          items: prefixedItems,
          selectedVendors: {},
          substitutions: []
        }
      ];

      const flatItems = nextGroups.flatMap((g) => g.items || []);
      const mergedSelected = { ...(prevDraft.selectedVendors || {}) };
      nextGroups.forEach((g) => {
        if (g.selectedVendors && typeof g.selectedVendors === 'object') {
          Object.assign(mergedSelected, g.selectedVendors);
        }
      });

      const res = await fetch(getApiUrl('/api/po/cart'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          selectedVendors: mergedSelected,
          substitutions: [],
          items: flatItems,
          boqGroups: nextGroups,
          boqId: nextGroups[0]?.boqId ?? null,
          boqProject: nextGroups[0]?.boqProject ?? null
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to save cart');
      }

      if (outOfStockCount > 0) {
        toast.success(
          `Added ${inStockItems.length} in-stock item${inStockItems.length === 1 ? '' : 's'} to cart. Skipped ${outOfStockCount} out of stock.`
        );
      }

      onComplete(inStockItems, boqId, projectMeta);
      navigate('/cart');
    } catch (error) {
      toast.error(error.message || 'Failed to save cart');
    } finally {
      setSavingCart(false);
    }
  };

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const availableSupplierCountForItem = (item) => {
      const suppliers = Number(item.availableSuppliers || 0);
      const inStock = item.isAvailable ?? suppliers > 0;
      return inStock ? suppliers : 0;
    };
    const totalItems = activeItems.length;
    const totalSuppliers = activeItems.reduce((sum, item) => sum + availableSupplierCountForItem(item), 0);
    const itemsWithSuppliers = activeItems.filter((item) => availableSupplierCountForItem(item) > 0).length;
    const itemsWithoutSuppliers = activeItems.filter((item) => availableSupplierCountForItem(item) === 0).length;
    const totalQuantity = activeItems.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
    
    return {
      totalItems,
      cancelledItems: cancelledItemIds.size,
      totalSuppliers,
      itemsWithSuppliers,
      itemsWithoutSuppliers,
      totalQuantity
    };
  }, [activeItems, cancelledItemIds]);

  return (
    <>
    <SpWorkflowPage
      title="BOQ Normalize"
      description={
        file
          ? 'Review matched items. Cancel any product you do not want to order, or replace the BOQ file if this upload is incorrect.'
          : 'Set the dispatch location and date, then upload your BOQ file.'
      }
      icon={FileText}
      actions={
        file ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleReplaceBoq}
            disabled={savingCart || requestSubmitting}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Replace BOQ
          </Button>
        ) : null
      }
    >
    <div className="page !p-0">

      {!file ? (
        <div>
          <div className="boq-site-fields">
            <h3 className="boq-site-fields-title">Project site and timeline</h3>
            <div className="boq-site-field-grid">
              <label className="boq-site-label">
                <span className="boq-site-label-text">
                  <MapPin size={16} />
                  Site location
                </span>
                <input
                  type="text"
                  className="boq-site-input"
                  placeholder="e.g. Whitefield, Bengaluru, Karnataka"
                  value={siteLocation}
                  onChange={(e) => setSiteLocation(e.target.value)}
                  autoComplete="street-address"
                />
                <button
                  type="button"
                  className="btn-geo boq-site-location-btn"
                  onClick={fillGeoFromBrowser}
                  disabled={locatingSite}
                >
                  <MapPin size={14} aria-hidden />
                  {locatingSite ? 'Detecting location…' : 'Use my current location (optional)'}
                </button>
              </label>
              <label className="boq-site-label">
                <span className="boq-site-label-text">
                  <Calendar size={16} />
                  Expected dispatch date
                </span>
                <input
                  type="date"
                  className="boq-site-input"
                  min={todayDateMin}
                  value={requiredDate}
                  onChange={(e) => {
                    setRequiredDate(e.target.value);
                  }}
                />
              </label>
            </div>
          </div>
          <div className="upload-zone">
            <Upload size={48} />
            <h3>Upload BOQ File</h3>
            <p>Supported formats: CSV (.csv), Excel (.xlsx, .xls), or PDF (.pdf)</p>
            {(() => {
              const loc = String(siteLocation || '').trim();
              const hasGeo = String(siteLat || '').trim() && String(siteLng || '').trim();
              const canUpload =
                Boolean(requiredDate) &&
                !isDateBeforeToday(requiredDate) &&
                (Boolean(loc) || Boolean(hasGeo));

              return (
                <label
                  className="btn-primary"
                  style={{ opacity: canUpload ? 1 : 0.6, cursor: canUpload ? 'pointer' : 'not-allowed' }}
                  aria-disabled={!canUpload}
                  onClick={(e) => {
                    if (canUpload) return;
                    e.preventDefault();
                    toast.error(
                      'Please provide the project site location and select the expected dispatch date before uploading your BOQ.'
                    );
                  }}
                >
              Choose File
              <input
                type="file"
                onChange={handleFileUpload}
                accept=".csv,.xlsx,.xls,.pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/pdf"
                hidden
                disabled={!canUpload}
              />
                </label>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="results">
          {loading ? (
            <div className="loading">
              <p>Processing BOQ… matching products in bulk. Large files may take a minute.</p>
              <div style={{ marginTop: '1rem' }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReplaceBoq}
                  disabled={savingCart || requestSubmitting}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Cancel and replace BOQ
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
              {/* Main Content Area */}
              <div style={{ flex: 1 }}>
                <div className="boq-replace-banner">
                  <div className="boq-replace-banner__copy">
                    <strong>Wrong file?</strong>
                    <span>
                      {file?.name
                        ? ` Current upload: ${file.name}. `
                        : ' '}
                      You can replace this BOQ and upload a different file without using the browser back button.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleReplaceBoq}
                    disabled={savingCart || requestSubmitting}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Replace BOQ file
                  </Button>
                </div>
                <div className="items-grid">
                {items.map((item) => {
                  const hasSuppliers = (item.availableSuppliers || 0) > 0;
                  const isAvailable = item.isAvailable ?? hasSuppliers;
                  const hasListedSupplier = Boolean(
                    item.supplierInfo || item.supplyChainLastSupplier || item.nearestSupplier
                  );
                  // Matched listing exists, but cannot fulfill right now (no stock / not available).
                  const isListedOutOfStock = hasListedSupplier && !isAvailable;
                  const productRequestKey = buildProductRequestKey(item, boqId);
                  const alreadyRequestedProduct = submittedProductRequestKeys.has(productRequestKey);
                  const itemKey = itemIdentity(item);
                  const isCancelled = cancelledItemIds.has(itemKey);

                  return (
                  <div key={item.id} className={`item-card${isCancelled ? ' item-card--cancelled' : ''}`}>
                    <div className="item-card__body">
                      <div className="item-card__content">
                        <div className="item-header">
                          <span className="item-raw">{item.rawName}</span>
                          {isCancelled ? (
                            <XCircle size={18} className="icon-cancelled" aria-hidden />
                          ) : item.confidence >= 0.8 ? (
                            <CheckCircle size={18} className="icon-success" aria-hidden />
                          ) : (
                            <AlertCircle size={18} className="icon-warning" aria-hidden />
                          )}
                        </div>

                        <div className="item-normalized">
                          <strong>{item.normalizedName}</strong>
                        </div>

                        {isCancelled ? (
                          <div className="item-cancelled-banner">
                            Removed from this order. Restore it to include it again.
                          </div>
                        ) : null}

                        <div className="item-meta">
                          <span className="item-qty">
                            Qty: <strong>{item.quantity}</strong>
                            {item.unit ? ` ${item.unit}` : ''}
                          </span>
                          {!isCancelled && hasSuppliers && isAvailable ? (
                            <div className="item-badges">
                              <span className={`confidence ${item.confidence >= 0.8 ? 'high' : 'medium'}`}>
                                {Math.round((item.confidence || 0) * 100)}% match
                              </span>
                              <span className="confidence high">
                                {`${item.availableSuppliers || 0} supplier${(item.availableSuppliers || 0) === 1 ? '' : 's'}`}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        {hasListedSupplier && !isCancelled ? (
                          <div className="item-supplier-info">
                            {item.supplierInfo ? (
                              <div className="item-supplier-line">
                                <strong>
                                  {isAvailable ? 'Available from:' : 'Listed by:'}
                                </strong>{' '}
                                <span>{item.supplierInfo.supplierName}</span>
                                {item.supplierInfo.supplierLocation ? (
                                  <span className="item-supplier-location">
                                    <MapPin size={12} aria-hidden />
                                    {item.supplierInfo.supplierLocation}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}

                            {item.nearestSupplier && isAvailable ? (
                              <div className="item-supplier-line item-supplier-line--nearest">
                                <strong>Nearest to site:</strong>{' '}
                                {item.nearestSupplier.supplierName}
                                {item.nearestSupplier.roleLabel ? (
                                  <span> ({item.nearestSupplier.roleLabel})</span>
                                ) : null}
                                {typeof item.nearestSupplier.distanceKm === 'number' ? (
                                  <span> · {item.nearestSupplier.distanceKm} km</span>
                                ) : null}
                              </div>
                            ) : null}

                            {item.nearestSupplier && !isAvailable && !item.supplierInfo ? (
                              <div className="item-supplier-line">
                                <strong>Listed by:</strong>{' '}
                                {item.nearestSupplier.supplierName}
                                {typeof item.nearestSupplier.distanceKm === 'number' ? (
                                  <span className="item-supplier-location">
                                    · {item.nearestSupplier.distanceKm} km from site
                                  </span>
                                ) : null}
                              </div>
                            ) : null}

                            {item.availableSuppliers > 0 && isAvailable ? (
                              <div className="item-supplier-status item-supplier-status--ok">
                                {item.availableSuppliers} supplier
                                {item.availableSuppliers > 1 ? 's' : ''} available
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="item-card__actions">
                        {isCancelled ? (
                          <div className="item-action-panel item-action-panel--restore">
                            <div className="item-action-status item-action-status--muted">
                              <XCircle size={14} aria-hidden />
                              <span>Not included in this order</span>
                            </div>
                            <button
                              type="button"
                              className="item-action-btn item-action-btn--restore"
                              onClick={() => handleRestoreItem(item)}
                              disabled={savingCart || requestSubmitting}
                            >
                              <RotateCcw size={14} aria-hidden />
                              <span>Restore product</span>
                            </button>
                          </div>
                        ) : (
                          <>
                            {(!hasSuppliers || !isAvailable) ? (
                              <div className="item-action-panel">
                                <div className="item-action-status">
                                  <AlertCircle size={14} aria-hidden />
                                  <span>
                                    {isListedOutOfStock
                                      ? 'Currently out of stock'
                                      : 'No matching suppliers available'}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="item-action-btn"
                                  onClick={() => openRequestProductModal(item)}
                                  disabled={alreadyRequestedProduct}
                                >
                                  <PlusCircle size={14} aria-hidden />
                                  <span>
                                    {alreadyRequestedProduct ? 'Request sent' : 'Request New Product'}
                                  </span>
                                </button>
                              </div>
                            ) : null}
                            <button
                              type="button"
                              className="item-cancel-btn"
                              onClick={() => handleCancelItem(item)}
                              disabled={savingCart || requestSubmitting}
                            >
                              <XCircle size={14} aria-hidden />
                              <span>Cancel product</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
                  <button
                    className="btn-primary btn-large"
                    onClick={handleProceed}
                    disabled={activeItems.length === 0 || savingCart}
                    style={{ flex: 1 }}
                  >
                    Proceed to Vendor Selection
                  </button>
                  <button
                    className="btn-secondary btn-large"
                    onClick={handleAddToCart}
                    disabled={
                      activeItems.length === 0 ||
                      savingCart ||
                      loading ||
                      summaryStats.itemsWithSuppliers === 0
                    }
                    title={
                      summaryStats.itemsWithSuppliers === 0
                        ? 'Product is out of stock'
                        : undefined
                    }
                    style={{ flex: 1 }}
                  >
                    {savingCart
                      ? 'Saving Cart...'
                      : summaryStats.itemsWithSuppliers === 0
                        ? 'Product is out of stock'
                        : 'Add to Cart'}
                  </button>
                </div>
              </div>

              {/* Summary Sidebar */}
              {items.length > 0 && (
                <aside className="boq-summary-panel" aria-label="BOQ summary">
                  <h3 className="boq-summary-title">Summary</h3>

                  <div className="boq-summary-section">
                    <p className="boq-summary-section-label">BOQ lines</p>
                    <div className="boq-summary-stat">
                      <div className="boq-summary-stat-icon boq-summary-stat-icon--items">
                        <Package size={18} aria-hidden />
                      </div>
                      <div>
                        <div className="boq-summary-stat-label">Items to order</div>
                        <div className="boq-summary-stat-value">{summaryStats.totalItems}</div>
                      </div>
                    </div>
                    <div className="boq-summary-stat boq-summary-stat--muted">
                      <div className="boq-summary-stat-label">Total quantity</div>
                      <div className="boq-summary-stat-value boq-summary-stat-value--sm">
                        {summaryStats.totalQuantity}
                      </div>
                    </div>
                    {summaryStats.cancelledItems > 0 ? (
                      <div className="boq-summary-stat boq-summary-stat--muted">
                        <div className="boq-summary-stat-label">Cancelled</div>
                        <div className="boq-summary-stat-value boq-summary-stat-value--sm">
                          {summaryStats.cancelledItems}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="boq-summary-section">
                    <p className="boq-summary-section-label">Item coverage</p>
                    <p className="boq-summary-section-hint">
                      How many line items already have at least one matching supplier.
                    </p>
                    <div
                      className="boq-coverage-bar"
                      role="img"
                      aria-label={`${summaryStats.itemsWithSuppliers} of ${summaryStats.totalItems} items have suppliers`}
                    >
                      <div
                        className="boq-coverage-bar__fill"
                        style={{
                          width:
                            summaryStats.totalItems > 0
                              ? `${(summaryStats.itemsWithSuppliers / summaryStats.totalItems) * 100}%`
                              : '0%'
                        }}
                      />
                    </div>
                    <div className="boq-coverage-split">
                      <div className="boq-coverage-chip boq-coverage-chip--ok">
                        <CheckCircle size={16} aria-hidden />
                        <div>
                          <div className="boq-coverage-chip__label">With suppliers</div>
                          <div className="boq-coverage-chip__value">
                            {summaryStats.itemsWithSuppliers}
                            <span className="boq-coverage-chip__unit"> items</span>
                          </div>
                        </div>
                      </div>
                      <div
                        className={`boq-coverage-chip ${
                          summaryStats.itemsWithoutSuppliers > 0
                            ? 'boq-coverage-chip--warn'
                            : 'boq-coverage-chip--idle'
                        }`}
                      >
                        <XCircle size={16} aria-hidden />
                        <div>
                          <div className="boq-coverage-chip__label">Without suppliers</div>
                          <div className="boq-coverage-chip__value">
                            {summaryStats.itemsWithoutSuppliers}
                            <span className="boq-coverage-chip__unit"> items</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="boq-summary-section boq-summary-section--last">
                    <p className="boq-summary-section-label">Supplier matches</p>
                    <p className="boq-summary-section-hint">
                      Total matching supplier options across all line items (not a unique supplier count).
                    </p>
                    <div className="boq-summary-stat boq-summary-stat--suppliers">
                      <div className="boq-summary-stat-icon boq-summary-stat-icon--suppliers">
                        <Users size={18} aria-hidden />
                      </div>
                      <div>
                        <div className="boq-summary-stat-label">Matching options</div>
                        <div className="boq-summary-stat-value boq-summary-stat-value--suppliers">
                          {summaryStats.totalSuppliers}
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              )}
            </div>
          )}
        </div>
      )}
    </div>
      {/* Simple inline modal for product request confirmation */}
      {requestingProductForItem
        ? createPortal(
            <div className="modal-overlay" onClick={closeRequestProductModal}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Request New Product</h3>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={closeRequestProductModal}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body">
                  <p style={{ fontSize: '0.9rem', color: '#4b5563', marginBottom: '0.75rem' }}>
                    We will notify suppliers in the last supply-chain role for this brand that a customer is
                    looking for this product. If no supply chain is configured, all suppliers on the platform
                    will be notified. They can add the product from their supplier portal if they stock it.
                  </p>
                  <div style={{ fontSize: '0.85rem', color: '#374151', marginBottom: '0.75rem' }}>
                    <div><strong>BOQ Item:</strong> {requestingProductForItem.rawName}</div>
                    <div><strong>Normalized Name:</strong> {requestingProductForItem.normalizedName}</div>
                    {requestingProductForItem.category && (
                      <div><strong>Category:</strong> {requestingProductForItem.category}</div>
                    )}
                    <div><strong>Unit:</strong> {requestingProductForItem.unit || 'nos'}</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={closeRequestProductModal}
                      disabled={requestSubmitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => submitProductRequest(requestingProductForItem)}
                      disabled={requestSubmitting}
                    >
                      {requestSubmitting ? 'Submitting...' : 'Submit Request'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </SpWorkflowPage>
    </>
  );
};

export default BOQNormalize;
