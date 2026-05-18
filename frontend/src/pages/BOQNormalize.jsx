import React, { useState, useMemo } from 'react';
import { getApiUrl, resolveApiPath } from '../config/api';
import { Upload, CheckCircle, AlertCircle, Users, Package, TrendingUp, Search, PlusCircle, MapPin, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clearSupplierSelectSessionScope } from '../constants/supplierSelectSession';
import './BOQNormalize.css';

// Ask the user to confirm ANY match that is not nearly exact.
// 0.99 means even 81%, 90%, etc. will be confirmed like a "Did you mean" suggestion.
const CONFIRM_MATCH_THRESHOLD = 0.99;

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
  const [suggestionsByItemId, setSuggestionsByItemId] = useState({});
  const [loadingSuggestionsForId, setLoadingSuggestionsForId] = useState(null);
  const [requestingProductForItem, setRequestingProductForItem] = useState(null);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [savedProjectMeta, setSavedProjectMeta] = useState(null);
  const navigate = useNavigate();

  const fillGeoFromBrowser = () => {
    if (!navigator.geolocation) {
      alert('Location is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSiteLat(String(pos.coords.latitude));
        setSiteLng(String(pos.coords.longitude));
      },
      (error) => {
        let message = 'Could not read your location. Enter coordinates manually or rely on the site address.';
        if (error?.code === 1) {
          message = 'Location permission is blocked in your browser. Allow location access for this site and try again.';
        } else if (error?.code === 2) {
          message = 'Your location is currently unavailable. Check network/GPS and try again.';
        } else if (error?.code === 3) {
          message = 'Location request timed out. Please try again.';
        }
        alert(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    const loc = siteLocation.trim();
    const hasGeo = siteLat.trim() && siteLng.trim();
    if ((!loc && !hasGeo) || !requiredDate) {
      alert('Please provide either site location or current coordinates, and select the required date before uploading your BOQ.');
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
        // Get error message from response
        const errorMessage = data.message || data.error || res.statusText || 'Upload failed';
        throw new Error(errorMessage);
      }
      
      if (data.items && data.items.length > 0) {
        setItems(data.items);
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
        alert('No items found in the uploaded file. Please try again.');
        setFile(null);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      // Show the actual error message to the user
      const errorMessage = error.message || 'Failed to process file. Please try again.';
      alert(errorMessage);
      setFile(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch alternative catalog products for a given BOQ item when there are
  // no available suppliers. This uses the global product search endpoint,
  // which looks across all approved & active products from all suppliers.
  const fetchSuggestionsForItem = async (item) => {
    if (!item || !item.id) return;
    // Prevent duplicate fetches
    if (suggestionsByItemId[item.id] && suggestionsByItemId[item.id].length > 0) {
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please log in again to see alternative products.');
      return;
    }

    setLoadingSuggestionsForId(item.id);
    try {
      const query = encodeURIComponent(item.normalizedName || item.rawName || '');
      const res = await fetch(getApiUrl(`/api/supplier/products/search?q=${query}`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSuggestionsByItemId(prev => ({
          ...prev,
          [item.id]: data.suggestions || []
        }));
      } else {
        alert(data.message || 'Failed to fetch alternative products.');
      }
    } catch (error) {
      console.error('Failed to fetch alternative products:', error);
      alert('Failed to fetch alternative products. Please try again.');
    } finally {
      setLoadingSuggestionsForId(null);
    }
  };

  // Submit a product request for an unavailable BOQ item so that
  // admin can approve it and suppliers can later add offers.
  const submitProductRequest = async (item) => {
    if (!item) return;
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please log in again to request a new product.');
      return;
    }

    setRequestSubmitting(true);
    try {
      const body = {
        name: item.normalizedName || item.rawName,
        category: item.category || '',
        unit: item.unit || 'nos',
        description: item.rawName || '',
        boqId: boqId || null
      };

      const res = await fetch(getApiUrl('/api/boq/request-product'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        alert(data.message || 'Product request submitted and is pending admin approval.');
        setRequestingProductForItem(null);
      } else {
        alert(data.message || 'Failed to submit product request. Please try again.');
      }
    } catch (error) {
      console.error('Failed to submit product request:', error);
      alert('Failed to submit product request. Please try again.');
    } finally {
      setRequestSubmitting(false);
    }
  };

  const handleProceed = () => {
    if (items.length === 0) {
      alert('Please upload and process a BOQ file first');
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
    clearSupplierSelectSessionScope();
    navigate('/supplier-select', { replace: false });
  };

  const handleAddToCart = async () => {
    if (items.length === 0) {
      alert('Please upload and process a BOQ file first.');
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
      alert(error.message || 'Failed to save cart');
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
    <div className="page">
      <div className="page-header">
        <h1>BOQ Normalize</h1>
        <p>Upload your Bill of Quantities and map items to normalized catalog</p>
      </div>

      {!file ? (
        <div>
          <div className="boq-site-fields">
            <h3 className="boq-site-fields-title">Project site and timeline</h3>
            <p className="boq-site-fields-hint">
              Suppliers are ranked nearer to this location when they have outlet coordinates on file; otherwise we match by city or state from your address text.
            </p>
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
              </label>
              <label className="boq-site-label">
                <span className="boq-site-label-text">
                  <Calendar size={16} />
                  Required by
                </span>
                <input
                  type="date"
                  className="boq-site-input"
                  value={requiredDate}
                  onChange={(e) => setRequiredDate(e.target.value)}
                />
              </label>
            </div>
            <div className="boq-geo-row">
              <button type="button" className="btn-geo" onClick={fillGeoFromBrowser}>
                Use my current location (optional)
              </button>
              <div className="boq-geo-inputs">
                <input
                  type="text"
                  className="boq-site-input boq-geo-input"
                  placeholder="Latitude"
                  value={siteLat}
                  onChange={(e) => setSiteLat(e.target.value)}
                  inputMode="decimal"
                />
                <input
                  type="text"
                  className="boq-site-input boq-geo-input"
                  placeholder="Longitude"
                  value={siteLng}
                  onChange={(e) => setSiteLng(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
          <div className="upload-zone">
            <Upload size={48} />
            <h3>Upload BOQ File</h3>
            <p>Supported formats: CSV (.csv), Excel (.xlsx, .xls), or PDF (.pdf)</p>
            <label className="btn-primary">
              Choose File
              <input
                type="file"
                onChange={handleFileUpload}
                accept=".csv,.xlsx,.xls,.pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/pdf"
                hidden
              />
            </label>
          </div>
        </div>
      ) : (
        <div className="results">
          {loading ? (
            <div className="loading">Processing...</div>
          ) : (
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
              {/* Main Content Area */}
              <div style={{ flex: 1 }}>
                <div className="items-grid">
                {items.map((item) => {
                  const hasSuppliers = (item.availableSuppliers || 0) > 0;
                  const isAvailable = item.isAvailable ?? hasSuppliers;
                  const suggestions = suggestionsByItemId[item.id] || [];

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
                          {hasSuppliers && isAvailable ? `${item.availableSuppliers || 0} supplier${(item.availableSuppliers || 0) === 1 ? '' : 's'}` : '0 suppliers'}
                        </span>
                      </div>
                    </div>
                    {(item.supplierInfo || item.supplyChainLastSupplier || item.nearestSupplier) && (
                      <div className="item-supplier-info" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
                        {item.supplierInfo && (
                          <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>
                            <strong style={{ color: '#1e293b' }}>Available from:</strong> {item.supplierInfo.supplierName}
                            {item.supplierInfo.supplierLocation && (
                              <span style={{ marginLeft: '0.5rem' }}>📍 {item.supplierInfo.supplierLocation}</span>
                            )}
                          </div>
                        )}
                        {/* Intentionally not rendering supplyChainLastSupplier text per requirements */}
                        {item.nearestSupplier && (
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
                        {item.availableSuppliers > 0 && (
                          <div style={{ fontSize: '0.8rem', color: '#059669', marginTop: '0.25rem' }}>
                            {item.availableSuppliers} supplier{item.availableSuppliers > 1 ? 's' : ''} available
                          </div>
                        )}
                        {!isAvailable && (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '0.25rem' }}>
                            No stock available from current suppliers
                          </div>
                        )}
                      </div>
                    )}
                    {!item.supplierInfo && !item.supplyChainLastSupplier && !item.nearestSupplier && (
                      <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: '0.8rem', color: '#d97706' }}>
                          No matching suppliers found
                        </div>
                      </div>
                    )}

                    {/* When there are no available suppliers, help the user with
                        alternative suggestions and option to request a new product */}
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
                            No suppliers available
                          </div>
                        </div>
                        
                        <div style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '0.25rem',
                          width: '100%',
                          boxSizing: 'border-box'
                        }}>
                          <button
                            type="button"
                            onClick={() => fetchSuggestionsForItem(item)}
                            disabled={loadingSuggestionsForId === item.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.25rem',
                              fontSize: '0.65rem',
                              fontWeight: 500,
                              padding: '0.25rem 0.4rem',
                              backgroundColor: '#f3f4f6',
                              border: '1px solid #d1d5db',
                              borderRadius: '4px',
                              color: '#111827',
                              cursor: loadingSuggestionsForId === item.id ? 'not-allowed' : 'pointer',
                              transition: 'all 0.2s',
                              opacity: loadingSuggestionsForId === item.id ? 0.6 : 1,
                              width: '100%',
                              boxSizing: 'border-box',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                            onMouseEnter={(e) => {
                              if (loadingSuggestionsForId !== item.id) {
                                e.currentTarget.style.backgroundColor = '#e5e7eb';
                                e.currentTarget.style.borderColor = '#9ca3af';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (loadingSuggestionsForId !== item.id) {
                                e.currentTarget.style.backgroundColor = '#f3f4f6';
                                e.currentTarget.style.borderColor = '#d1d5db';
                              }
                            }}
                          >
                            <Search size={10} style={{ flexShrink: 0, color: '#4b5563' }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {loadingSuggestionsForId === item.id ? 'Finding...' : 'Suggest Products'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setRequestingProductForItem(item)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.25rem',
                              fontSize: '0.65rem',
                              fontWeight: 500,
                              padding: '0.25rem 0.4rem',
                              backgroundColor: '#4f46e5',
                              border: '1px solid #4f46e5',
                              borderRadius: '4px',
                              color: '#ffffff',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              width: '100%',
                              boxSizing: 'border-box',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#4338ca';
                              e.currentTarget.style.borderColor = '#4338ca';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#4f46e5';
                              e.currentTarget.style.borderColor = '#4f46e5';
                            }}
                          >
                            <PlusCircle size={10} style={{ flexShrink: 0, color: '#ffffff' }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              Request New Product
                            </span>
                          </button>
                        </div>

                        {suggestions.length > 0 && (
                          <div style={{ 
                            marginTop: '0.5rem', 
                            paddingTop: '0.5rem',
                            borderTop: '1px solid #fecaca',
                            width: '100%',
                            boxSizing: 'border-box'
                          }}>
                            <div style={{ 
                              fontSize: '0.7rem', 
                              fontWeight: 600, 
                              color: '#1f2937', 
                              marginBottom: '0.25rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}>
                              <Package size={11} style={{ flexShrink: 0 }} />
                              <span>Suggestions</span>
                            </div>
                            <div style={{ 
                              backgroundColor: '#ffffff',
                              borderRadius: '4px',
                              padding: '0.375rem',
                              border: '1px solid #e5e7eb',
                              width: '100%',
                              boxSizing: 'border-box',
                              maxHeight: '100px',
                              overflowY: 'auto'
                            }}>
                              <ul style={{ 
                                listStyle: 'none', 
                                padding: 0, 
                                margin: 0, 
                                fontSize: '0.65rem',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.25rem',
                                width: '100%'
                              }}>
                                {suggestions.map((sugg, idx) => (
                                  <li 
                                    key={`${item.id}-sugg-${idx}`} 
                                    style={{ 
                                      padding: '0.25rem',
                                      backgroundColor: '#f9fafb',
                                      borderRadius: '3px',
                                      borderLeft: '2px solid #3b82f6',
                                      width: '100%',
                                      boxSizing: 'border-box',
                                      wordWrap: 'break-word'
                                    }}
                                  >
                                    <div style={{ fontWeight: 600, color: '#1e293b', wordBreak: 'break-word', fontSize: '0.65rem', lineHeight: '1.2' }}>
                                      {sugg.name}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', fontSize: '0.6rem', color: '#6b7280', marginTop: '0.125rem' }}>
                                      {sugg.category && (
                                        <span style={{ 
                                          backgroundColor: '#e0e7ff',
                                          color: '#4338ca',
                                          padding: '0.05rem 0.25rem',
                                          borderRadius: '2px',
                                          fontWeight: 500,
                                          whiteSpace: 'nowrap'
                                        }}>
                                          {sugg.category}
                                        </span>
                                      )}
                                      {sugg.unit && (
                                        <span style={{ 
                                          backgroundColor: '#f3f4f6',
                                          color: '#4b5563',
                                          padding: '0.05rem 0.25rem',
                                          borderRadius: '2px',
                                          whiteSpace: 'nowrap'
                                        }}>
                                          {sugg.unit}
                                        </span>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
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
                <div style={{
                  width: '280px',
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  position: 'sticky',
                  top: '2rem',
                  height: 'fit-content'
                }}>
                  <h3 style={{
                    fontSize: '1.125rem',
                    fontWeight: '600',
                    color: '#1e293b',
                    marginBottom: '1.5rem',
                    paddingBottom: '1rem',
                    borderBottom: '1px solid #e5e7eb'
                  }}>
                    Summary
                  </h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      background: '#f8fafc',
                      borderRadius: '8px'
                    }}>
                      <div style={{
                        padding: '0.5rem',
                        background: '#e0e7ff',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Package size={20} color="#4f46e5" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>
                          Total Items
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1e293b' }}>
                          {summaryStats.totalItems}
                        </div>
                      </div>
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      background: '#f0fdf4',
                      borderRadius: '8px'
                    }}>
                      <div style={{
                        padding: '0.5rem',
                        background: '#d1fae5',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Users size={20} color="#059669" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>
                          Total Suppliers
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#059669' }}>
                          {summaryStats.totalSuppliers}
                        </div>
                      </div>
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      background: '#fef3c7',
                      borderRadius: '8px'
                    }}>
                      <div style={{
                        padding: '0.5rem',
                        background: '#fde68a',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <TrendingUp size={20} color="#d97706" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>
                          Items with Suppliers
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#d97706' }}>
                          {summaryStats.itemsWithSuppliers} / {summaryStats.totalItems}
                        </div>
                      </div>
                    </div>

                    {summaryStats.itemsWithoutSuppliers > 0 && (
                      <div style={{
                        padding: '0.75rem',
                        background: '#fef2f2',
                        borderRadius: '8px',
                        border: '1px solid #fecaca'
                      }}>
                        <div style={{ fontSize: '0.75rem', color: '#dc2626', marginBottom: '0.25rem', fontWeight: '500' }}>
                          Items without Suppliers
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: '#dc2626' }}>
                          {summaryStats.itemsWithoutSuppliers}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
      {/* Simple inline modal for product request confirmation */}
      {requestingProductForItem && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 40
        }}>
          <div className="modal-content" style={{
            background: 'white',
            borderRadius: '12px',
            padding: '1.5rem',
            maxWidth: '480px',
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>
              Request New Product
            </h3>
            <p style={{ fontSize: '0.9rem', color: '#4b5563', marginBottom: '0.75rem' }}>
              You are requesting a new catalog product based on this BOQ item. Admin will review and approve it,
              then all suppliers will be notified so they can add their offers.
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
                onClick={() => setRequestingProductForItem(null)}
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
      )}
    </>
  );
};

export default BOQNormalize;
