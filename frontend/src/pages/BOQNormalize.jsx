import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { getApiUrl, resolveApiPath } from '../config/api';
import { clearSupplierSelectScopeSession } from '../constants/supplierSelectSession';
import {
  formatResolvedAddressLine,
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import { Upload, CheckCircle, AlertCircle, Users, Package, PlusCircle, MapPin, Calendar, FileText, XCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getTodayDateInputValue, isDateBeforeToday } from '../utils/dateTime';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
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
  const [boqId, setBoqId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingCart, setSavingCart] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [submittedProductRequestKeys, setSubmittedProductRequestKeys] = useState(() => new Set());
  const [savedProjectMeta, setSavedProjectMeta] = useState(null);
  const [locatingSite, setLocatingSite] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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
        if (data.boqId) {
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
      setLoading(false);
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

  const handleProceed = () => {
    if (items.length === 0) {
      toast.error('Please upload and process a BOQ file first');
      return;
    }

    // Find items where the automatic match is not very strong
    const ambiguousItems = items.filter(item => 
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
    
    console.log('Proceeding to vendor selection with items:', items);
    onComplete(
      items,
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
    navigate('/supplier-select', {
      replace: false,
      state: {
        supplierSelectItems: items,
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
    if (items.length === 0) {
      toast.error('Please upload and process a BOQ file first.');
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

      const prefixedItems = items.map((it, idx) => ({
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

      onComplete(items, boqId, projectMeta);
      navigate('/cart');
    } catch (error) {
      toast.error(error.message || 'Failed to save cart');
    } finally {
      setSavingCart(false);
    }
  };

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const totalItems = items.length;
    const availableSupplierCountForItem = (item) => {
      const suppliers = Number(item.availableSuppliers || 0);
      const inStock = item.isAvailable ?? suppliers > 0;
      return inStock ? suppliers : 0;
    };
    const totalSuppliers = items.reduce((sum, item) => sum + availableSupplierCountForItem(item), 0);
    const itemsWithSuppliers = items.filter((item) => availableSupplierCountForItem(item) > 0).length;
    const itemsWithoutSuppliers = items.filter((item) => availableSupplierCountForItem(item) === 0).length;
    const totalQuantity = items.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
    
    return {
      totalItems,
      totalSuppliers,
      itemsWithSuppliers,
      itemsWithoutSuppliers,
      totalQuantity
    };
  }, [items]);

  return (
    <>
    <SpWorkflowPage
      title="BOQ Normalize"
      description=""
      icon={FileText}
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
              Processing BOQ… matching products in bulk. Large files may take a minute.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
              {/* Main Content Area */}
              <div style={{ flex: 1 }}>
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

                  return (
                  <div key={item.id} className="item-card">
                    <div className="item-header">
                      <span className="item-raw">{item.rawName}</span>
                      {item.confidence >= 0.8 ? (
                        <CheckCircle size={20} className="icon-success" />
                      ) : (
                        <AlertCircle size={20} className="icon-warning" />
                      )}
                    </div>
                    <div className="item-normalized">
                      <strong>{item.normalizedName}</strong>
                    </div>
                    <div className="item-meta">
                      <span>Qty: {item.quantity}</span>
                      <div className="item-badges">
                        {hasSuppliers && isAvailable && (
                          <span className={`confidence ${item.confidence >= 0.8 ? 'high' : 'medium'}`}>
                            {Math.round((item.confidence || 0) * 100)}% match
                          </span>
                        )}
                        <span className={`confidence ${hasSuppliers && isAvailable ? 'high' : 'low'}`}>
                          {hasSuppliers && isAvailable
                            ? `${item.availableSuppliers || 0} supplier${(item.availableSuppliers || 0) === 1 ? '' : 's'}`
                            : isListedOutOfStock
                              ? 'Out of stock'
                              : '0 suppliers'}
                        </span>
                      </div>
                    </div>
                    {hasListedSupplier && (
                      <div className="item-supplier-info" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
                        {item.supplierInfo && (
                          <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>
                            <strong style={{ color: '#1e293b' }}>
                              {isAvailable ? 'Available from:' : 'Listed by:'}
                            </strong>{' '}
                            {item.supplierInfo.supplierName}
                            {item.supplierInfo.supplierLocation && (
                              <span style={{ marginLeft: '0.5rem' }}>📍 {item.supplierInfo.supplierLocation}</span>
                            )}
                          </div>
                        )}
                        {/* Intentionally not rendering supplyChainLastSupplier text per requirements */}
                        {item.nearestSupplier && isAvailable && (
                          <div style={{ fontSize: '0.8rem', color: '#1d4ed8', marginTop: '0.15rem' }}>
                            <strong>Nearest to site:</strong>{' '}
                            {item.nearestSupplier.supplierName}{' '}
                            {item.nearestSupplier.roleLabel && (
                              <span>({item.nearestSupplier.roleLabel})</span>
                            )}
                            {typeof item.nearestSupplier.distanceKm === 'number' && (
                              <span> · {item.nearestSupplier.distanceKm} km</span>
                            )}
                          </div>
                        )}
                        {item.nearestSupplier && !isAvailable && !item.supplierInfo && (
                          <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>
                            <strong style={{ color: '#1e293b' }}>Listed by:</strong>{' '}
                            {item.nearestSupplier.supplierName}
                            {typeof item.nearestSupplier.distanceKm === 'number' && (
                              <span style={{ marginLeft: '0.5rem' }}>
                                · {item.nearestSupplier.distanceKm} km from site
                              </span>
                            )}
                          </div>
                        )}
                        {item.availableSuppliers > 0 && isAvailable && (
                          <div style={{ fontSize: '0.8rem', color: '#059669', marginTop: '0.25rem' }}>
                            {item.availableSuppliers} supplier{item.availableSuppliers > 1 ? 's' : ''} available
                          </div>
                        )}
                        {!isAvailable && (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '0.25rem', fontWeight: 600 }}>
                            Currently out of stock
                          </div>
                        )}
                      </div>
                    )}
                    {!hasListedSupplier && (
                      <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: '0.8rem', color: '#d97706' }}>
                          No matching suppliers found
                        </div>
                      </div>
                    )}

                    {/* When there are no available suppliers, allow requesting a new product */}
                    {(!hasSuppliers || !isAvailable) && (
                      <div style={{ 
                        marginTop: '0.5rem', 
                        padding: '0.5rem', 
                        backgroundColor: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '6px',
                        width: '280px',
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                        marginLeft: 'auto'
                      }}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '0.25rem',
                          marginBottom: '0.375rem'
                        }}>
                          <AlertCircle size={12} style={{ color: '#dc2626', flexShrink: 0 }} />
                          <div style={{ 
                            fontSize: '0.7rem', 
                            color: '#dc2626', 
                            fontWeight: 600,
                            wordWrap: 'break-word',
                            lineHeight: '1.2'
                          }}>
                            {isListedOutOfStock ? 'Currently out of stock' : 'No suppliers available'}
                          </div>
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => openRequestProductModal(item)}
                          disabled={alreadyRequestedProduct}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.25rem',
                            fontSize: '0.65rem',
                            fontWeight: 500,
                            padding: '0.25rem 0.4rem',
                            backgroundColor: alreadyRequestedProduct ? '#9ca3af' : '#4f46e5',
                            border: `1px solid ${alreadyRequestedProduct ? '#9ca3af' : '#4f46e5'}`,
                            borderRadius: '4px',
                            color: '#ffffff',
                            cursor: alreadyRequestedProduct ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s',
                            width: '100%',
                            boxSizing: 'border-box',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            opacity: alreadyRequestedProduct ? 0.85 : 1
                          }}
                          onMouseEnter={(e) => {
                            if (alreadyRequestedProduct) return;
                            e.currentTarget.style.backgroundColor = '#4338ca';
                            e.currentTarget.style.borderColor = '#4338ca';
                          }}
                          onMouseLeave={(e) => {
                            if (alreadyRequestedProduct) return;
                            e.currentTarget.style.backgroundColor = '#4f46e5';
                            e.currentTarget.style.borderColor = '#4f46e5';
                          }}
                        >
                          <PlusCircle size={10} style={{ flexShrink: 0, color: '#ffffff' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {alreadyRequestedProduct ? 'Request sent' : 'Request New Product'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                );})}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
                  <button
                    className="btn-primary btn-large"
                    onClick={handleProceed}
                    disabled={items.length === 0 || savingCart}
                    style={{ flex: 1 }}
                  >
                    Proceed to Vendor Selection
                  </button>
                  <button
                    className="btn-secondary btn-large"
                    onClick={handleAddToCart}
                    disabled={items.length === 0 || savingCart || loading}
                    style={{ flex: 1 }}
                  >
                    {savingCart ? 'Saving Cart...' : 'Add to Cart'}
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
                        <div className="boq-summary-stat-label">Total items</div>
                        <div className="boq-summary-stat-value">{summaryStats.totalItems}</div>
                      </div>
                    </div>
                    <div className="boq-summary-stat boq-summary-stat--muted">
                      <div className="boq-summary-stat-label">Total quantity</div>
                      <div className="boq-summary-stat-value boq-summary-stat-value--sm">
                        {summaryStats.totalQuantity}
                      </div>
                    </div>
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
