import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getApiUrl } from '../config/api';
import { 
  Package, 
  Plus, 
  Edit, 
  Search, 
  Eye,
  Save,
  X,
  Trash2,
  CheckCircle,
  Ban,
  Sparkles,
  Upload,
  Image as ImageIcon,
  Loader,
  Wallet,
  Layers,
  MapPin,
  RefreshCw,
  AlertTriangle,
  ImageOff
} from 'lucide-react';
import './Dashboard.css';
import './ProductDiscovery.css';
import './ProductManagement.css';
import SupplierProductAdditionSteps from '../components/SupplierProductAdditionSteps';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { getProductImageList, getSupplierOfferImagesForForm } from '../utils/productImages';
import {
  mergeSpecificationObjects,
  mergeVariantSpecificationTemplate,
  mergeCatalogAndOfferSpecificationsForDisplay,
  resolveSupplierOfferDisplaySpecifications,
  parseSpecInputToValue,
  specValueToInput,
  specificationEntriesForDetails,
  supplierSpecificationValuesLocked
} from '../utils/specifications';
import {
  applyExtractResultToSpecs,
  buildSpecExtractionSourceKey,
  extractSpecificationsFromDescription
} from '../utils/extractSpecificationsApi';
import {
  SUPPLIER_CURRENT_STOCK_LABEL,
  SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL,
  SUPPLIER_MRP_FIELD_LABEL,
  SUPPLIER_MRP_LABEL,
  SUPPLIER_MRP_LOCKED_MESSAGE,
  formatSupplierStockAvailability,
  isSupplierInventoryConfigured,
  isSupplierMrpLocked,
  parseSupplierOfferPrice
} from '../utils/supplierStockLabel';
import { formatRupee, formatRupeePerUnit } from '../utils/formatRupee';
import RupeeInput from '../components/RupeeInput';
import BrandSelect from '../components/BrandSelect';
import {
  getSupplierOfferRowId,
  findSupplierOfferRow,
  matchSupplierOfferRow,
  normalizeSupplierProductsFromApi
} from '../utils/supplierProductRow';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import {
  formatMissingProductPhotosMessage,
  formatSupplierProductValidationMessage,
  countSupplierProductPhotos,
  getSupplierCatalogMandatoryMissingFields,
  getSupplierInventoryUpdateMissingFields,
  getSupplierProductCreateErrorMessage,
  getSupplierProductUpdateErrorMessage,
  getSupplierSpecificationTemplateMissingFields,
  isMeaningfullyFilledSpecValue,
  MIN_SUPPLIER_PRODUCT_PHOTOS
} from '../utils/supplierProductValidation';
import {
  getPreferredUnitsForProduct,
  validateProductUnitCompatibility
} from '../utils/productUnitCompatibility';
import {
  getBrandApprovalWarning,
  isBrandApprovedForProductSubmit
} from '../utils/brandApprovalStatus';
import {
  applyIgstToTaxFields,
  CGST_SGST_OPTIONS,
  IGST_OPTIONS
} from '../utils/gstRates';

import { useLocation, useNavigate } from 'react-router-dom';

const LOW_STOCK_THRESHOLD = 10;

const STATUS_CONFIG = {
  pending: {
    label: 'Pending Approval',
    statusClass: 'pm-status--pending',
    notice: 'Pending admin approval. This product stays in your list until it is approved or rejected.'
  },
  approved: {
    label: 'Approved / Active',
    statusClass: 'pm-status--approved',
    notice: 'Approved by admin and active in your catalog.'
  },
  rejected: {
    label: 'Rejected',
    statusClass: 'pm-status--rejected',
    notice: 'This product was rejected and is not orderable. Review the reason below and update if needed.'
  }
};

function getSupplierApprovalStatus(product) {
  const raw = String(product?.status || 'pending').trim().toLowerCase();
  if (raw === 'rejected') return 'rejected';
  if (raw === 'approved' || raw === 'active') return 'approved';
  // Pending / unknown never become "Approved / Active" just because is_active is true.
  return 'pending';
}

/** ProductCOV / pricing setup is only for offers that are not rejected. */
function isSupplierProductEligibleForProductCov(product) {
  return getSupplierApprovalStatus(product) !== 'rejected';
}

function getSupplierRejectionReason(product) {
  return String(
    product?.rejectionReason ||
      product?.rejection_reason ||
      ''
  ).trim();
}

function getStockHealth(stock) {
  const quantity = parseSupplierStockQuantity(stock);
  if (quantity === null || quantity === 0) return 'out';
  if (quantity <= LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

const ProductManagement = ({ user }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isInventoryView = location.pathname === '/manage-inventory';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [categories, setCategories] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const [catalogStats, setCatalogStats] = useState(null);
  const [catalogViewEpoch, setCatalogViewEpoch] = useState(0);
  const searchInputRef = useRef(null);

  const resetCatalogViewToDefault = () => {
    setSearchTerm('');
    setFilterCategory('all');
    setFilterStatus('all');
    setShowAddModal(false);
    setEditingItem(null);
    setViewingItem(null);
    setCatalogViewEpoch((epoch) => epoch + 1);
    // Browsers can keep a stale value on type=search inputs; clear the DOM node too.
    if (searchInputRef.current) {
      searchInputRef.current.value = '';
    }
  };

  useEffect(() => {
    // Full remount / route change / browser refresh: always start from the default catalog view.
    resetCatalogViewToDefault();

    let cancelled = false;
    (async () => {
      await fetchProducts();
      if (cancelled) return;
      const newlyAdded = location.state?.newlyAddedProduct;
      if (!newlyAdded) return;
      const normalized =
        normalizeSupplierProductsFromApi([newlyAdded])[0] || newlyAdded;
      setProducts((prev) => {
        const offerId = normalized?.supplier_product_id || normalized?.supplierProductId;
        if (offerId && prev.some((p) => matchSupplierOfferRow(p, offerId))) {
          return prev.map((p) =>
            matchSupplierOfferRow(p, offerId) ? { ...p, ...normalized } : p
          );
        }
        return [normalized, ...prev];
      });
      navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
    })();
    fetchNotifications();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  // Guard against browser restoring the search field after a hard refresh.
  useEffect(() => {
    resetCatalogViewToDefault();
  }, []);

  useEffect(() => {
    const refreshCatalog = () => {
      fetchProducts({ silent: true });
      fetchNotifications();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshCatalog();
    };
    const intervalMs = isInventoryView ? 15000 : 20000;
    const intervalId = window.setInterval(refreshCatalog, intervalMs);
    window.addEventListener('focus', refreshCatalog);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshCatalog);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isInventoryView]);

  useEffect(() => {
    const hasApprovalUpdate = (notifications || []).some((n) => {
      const type = String(n?.type || '').toLowerCase();
      const status = String(n?.metadata?.status || '').toLowerCase();
      const title = String(n?.title || '').toLowerCase();
      return (
        type === 'product_approval' &&
        (status === 'approved' || title.includes('approved')) &&
        !(n?.is_read ?? n?.isRead)
      );
    });
    if (!hasApprovalUpdate) return undefined;
    const timer = window.setTimeout(() => {
      fetchProducts({ silent: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [notifications]);

  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/notifications'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('token');
      // Fetch categories from the Category collection
      const response = await fetch(getApiUrl('/api/supplier/categories'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      let categoryList = [];
      
      if (data.status === 'success') {
        categoryList = data.categories || [];
      }
      
      // Also get unique categories from existing products
      const uniqueProductCategories = [...new Set(products
        .map(p => p.category)
        .filter(cat => cat && cat.trim() !== '')
        .map(cat => cat.toLowerCase().trim())
      )];
      
      // Merge categories from Category collection with product categories
      const categoryMap = new Map();
      
      // Add categories from Category collection first (they have displayName)
      categoryList.forEach(cat => {
        const key = cat.name.toLowerCase().trim();
        categoryMap.set(key, {
          name: cat.name,
          displayName: cat.displayName || cat.name
        });
      });
      
      // Add product categories that aren't in the Category collection
      uniqueProductCategories.forEach(catName => {
        if (!categoryMap.has(catName)) {
          categoryMap.set(catName, {
            name: catName,
            displayName: catName.charAt(0).toUpperCase() + catName.slice(1)
          });
        }
      });
      
      // Convert map to array and sort
      const allCategories = Array.from(categoryMap.values()).sort((a, b) => 
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
      );
      
      setCategories(allCategories);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchProducts = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/products'), {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        cache: 'no-cache' // Prevent caching
      });
      const data = await response.json();
      if (data.status === 'success') {
        const productsWithStatus = normalizeSupplierProductsFromApi(data.products || []).map(
          (product) => {
            const approval = getSupplierApprovalStatus(product);
            return {
              ...product,
              status: approval,
              // Keep is_active aligned with the status badge so counters stay consistent.
              is_active: approval === 'approved'
            };
          }
        );
        setProducts(productsWithStatus);
        setViewingItem((prev) => {
          if (!prev) return prev;
          const offerId = getSupplierOfferRowId(prev);
          if (!offerId) return prev;
          return findSupplierOfferRow(productsWithStatus, offerId) || prev;
        });
        if (data.stats && typeof data.stats === 'object') {
          setCatalogStats({
            total: Number(data.stats.total) || productsWithStatus.length,
            active: Number(data.stats.active) || 0,
            pending: Number(data.stats.pending) || 0,
            rejected: Number(data.stats.rejected) || 0
          });
        } else {
          setCatalogStats(null);
        }
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    // Match browser refresh: reset filters/search first, then reload catalog data.
    resetCatalogViewToDefault();
    try {
      await Promise.all([
        fetchProducts({ silent: true }),
        fetchNotifications(),
        fetchCategories()
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const mergeNewlyAddedProduct = (addedProduct) => {
    if (!addedProduct) return;
    const normalized =
      normalizeSupplierProductsFromApi([addedProduct])[0] || addedProduct;
    setProducts((prev) => {
      const offerId = normalized?.supplier_product_id || normalized?.supplierProductId;
      if (offerId && prev.some((p) => matchSupplierOfferRow(p, offerId))) {
        return prev.map((p) => (matchSupplierOfferRow(p, offerId) ? { ...p, ...normalized } : p));
      }
      const catalogId = normalized?.id || normalized?._id;
      if (
        !offerId &&
        catalogId &&
        prev.some((p) => String(p.id || p._id || '') === String(catalogId))
      ) {
        return prev;
      }
      return [normalized, ...prev];
    });
  };

  const handleAddProduct = async (productData) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/products'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(productData)
      });
      const data = await response.json();
      if (data.status === 'success') {
        const addedProduct = {
          ...(normalizeSupplierProductsFromApi([data.product])[0] || data.product),
          // Keep only images submitted for this create — never catalog history.
          images: Array.isArray(productData.images)
            ? productData.images
            : Array.isArray(data.product?.images)
              ? data.product.images
              : []
        };
        setShowAddModal(false);
        // Prefer server list so status/offer id match DB; merge create response if fetch lags.
        await fetchProducts({ silent: true });
        mergeNewlyAddedProduct(addedProduct);
        const nextBrand = String(data?.nextStep?.brand || data?.product?.brand || productData?.brand || '').trim();
        const nextProductName = String(data?.nextStep?.productName || data?.product?.name || productData?.name || '').trim();
        const params = new URLSearchParams();
        if (nextBrand) params.set('brand', nextBrand);
        if (nextProductName) params.set('productName', nextProductName);
        params.set('from', 'product-management');
        alert(
          `${data.message || 'Product added successfully!'} Next: complete inventory details (step 2), then ProductCOV (step 3).`
        );
        navigate(`/manage-inventory?${params.toString()}`, {
          state: { newlyAddedProduct: addedProduct }
        });
      } else {
        const allowed = Array.isArray(data.allowedBrands) && data.allowedBrands.length > 0
          ? `\n\nAllowed brands in your profile: ${data.allowedBrands.join(', ')}`
          : '';
        alert((getSupplierProductCreateErrorMessage(data) || 'Failed to add product') + allowed);
      }
    } catch (error) {
      console.error('Failed to add product:', error);
      alert('Failed to add product. Please try again.');
    }
  };

  const buildInventoryUpdatePayload = (item, data) => {
    const missing = getSupplierInventoryUpdateMissingFields(data);
    if (missing.length > 0) {
      return {
        error: formatSupplierProductValidationMessage(missing),
        missingFields: missing
      };
    }

    const stock = parseSupplierStockQuantity(data.stock);
    const price = isSupplierMrpLocked(item)
      ? parseSupplierOfferPrice(item.price)
      : parseFloat(data.price);
    const payload = {
      stock,
      price,
      location: data.location,
      unit: data.unit,
      igst_rate: data.igst_rate,
      cgst_rate: data.cgst_rate,
      sgst_rate: data.sgst_rate,
      hsnCode: data.hsnCode || data.hsn_code
    };
    // Persist product photos uploaded in the inventory edit modal.
    if (Array.isArray(data.images)) {
      payload.images = data.images;
    }
    // Only send brand fields when we have a real value. Sending "" triggers
    // "Brand is required because you have selected brands in your profile."
    const brandValue = String(
      data.brand ||
        item?.brand ||
        item?.brandModel ||
        item?.attributes?.brand ||
        item?.attributes?.brandModel ||
        ''
    ).trim();
    if (brandValue) {
      payload.brand = brandValue;
      payload.brandModel = brandValue;
    }
    const mpn = String(data.mpn || item?.mpn || '').trim();
    if (mpn) payload.mpn = mpn;
    const gtin = String(data.gtin || item?.gtin || '').trim();
    if (gtin) payload.gtin = gtin;
    return { payload };
  };

  const handleUpdateProduct = async (productId, productData, options = {}) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/supplier/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(productData)
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        const savedStock =
          options.expectedStock ??
          parseSupplierStockQuantity(productData.stock) ??
          parseSupplierStockQuantity(data.product?.stock);
        const savedImages = Array.isArray(productData.images)
          ? productData.images
          : Array.isArray(data.product?.images)
            ? data.product.images
            : [];
        const savedUnit = String(productData.unit || data.product?.unit || '').trim();
        const updatedProduct = {
          ...data.product,
          specifications: data.product.specifications || {},
          // Prefer images the supplier just saved so catalog extras never reappear in the list.
          images: savedImages,
          // Keep attributes.images in sync so thumbnails/forms do not revive deleted photos.
          attributes: {
            ...(data.product?.attributes && typeof data.product.attributes === 'object'
              ? data.product.attributes
              : {}),
            ...(Array.isArray(productData.images) ? { images: savedImages } : {}),
            ...(savedUnit ? { unit: savedUnit } : {})
          },
          ...(savedUnit ? { unit: savedUnit } : {}),
          ...(savedStock != null ? { stock: savedStock } : {})
        };

        setProducts((prev) =>
          prev.map((p) =>
            matchSupplierOfferRow(p, productId)
              ? {
                  ...p,
                  ...updatedProduct,
                  supplier_product_id:
                    getSupplierOfferRowId(p) ||
                    getSupplierOfferRowId(updatedProduct) ||
                    productId,
                  // Keep configured inventory values if a catalog-only save omits them.
                  stock:
                    savedStock != null
                      ? savedStock
                      : updatedProduct.stock != null
                        ? updatedProduct.stock
                        : p.stock,
                  price: (() => {
                    const nextPrice = Number(updatedProduct.price);
                    if (Number.isFinite(nextPrice) && nextPrice > 0) return nextPrice;
                    const prevPrice = Number(p.price);
                    return Number.isFinite(prevPrice) && prevPrice > 0 ? prevPrice : nextPrice || 0;
                  })(),
                  location:
                    String(updatedProduct.location || '').trim() ||
                    String(p.location || '').trim() ||
                    ''
                }
              : p
          )
        );
        setViewingItem((prev) =>
          prev && matchSupplierOfferRow(prev, productId) ? { ...prev, ...updatedProduct } : prev
        );

        // Confirm save before closing the modal / navigating away.
        if (data.message === 'No changes detected') {
          alert(data.message);
          setEditingItem(null);
          return;
        }

        const successMessage =
          data.message && /pending admin approval/i.test(String(data.message))
            ? data.message
            : 'Product updated successfully! Your changes have been saved.';
        alert(successMessage);
        setEditingItem(null);

        // After inventory (step 2), continue to ProductCOV only when the offer is eligible.
        if (isInventoryView && isSupplierProductEligibleForProductCov(updatedProduct)) {
          const nextBrand = String(
            data?.nextStep?.brand ||
              updatedProduct?.brandModel ||
              updatedProduct?.brand ||
              updatedProduct?.specifications?.brandModel ||
              updatedProduct?.specifications?.brand ||
              ''
          ).trim();
          const nextProductName = String(
            data?.nextStep?.productName || updatedProduct?.name || ''
          ).trim();
          const params = new URLSearchParams();
          if (data?.nextStep?.variantAsin) params.set('variantAsin', data.nextStep.variantAsin);
          if (data?.nextStep?.variantKey) params.set('variantKey', data.nextStep.variantKey);
          if (data?.nextStep?.supplierProductId) params.set('supplierProductId', data.nextStep.supplierProductId);
          if (nextProductName) params.set('variantName', nextProductName);
          if (nextBrand) params.set('brand', nextBrand);
          if (nextProductName) params.set('productName', nextProductName);
          params.set('from', 'manage-inventory');
          navigate(`/supplier-bcov?${params.toString()}`);
        }

        // Don't call fetchProducts() here as it might load stale data
        // The local state update above is sufficient
      } else {
        // Show specific error message from backend (including validation details)
        alert(getSupplierProductUpdateErrorMessage(data));
      }
    } catch (error) {
      console.error('Failed to update product:', error);
      alert('Failed to update product. Please try again.');
    }
  };

  const handleDeleteProduct = async (supplierProductId, options = {}) => {
    const product = products.find((p) => matchSupplierOfferRow(p, supplierProductId));
    const productName = product?.name || 'this product';
    const isRejectedCatalogRemove =
      options.fromRejectedCatalog === true ||
      (!isInventoryView && getSupplierApprovalStatus(product) === 'rejected');

    const confirmMessage = isRejectedCatalogRemove
      ? `Remove "${productName}" from your catalog?\n\nThis rejected product will be permanently deleted from your catalog. This cannot be undone.`
      : `Are you sure you want to delete "${productName}"? This action cannot be undone.`;

    if (!window.confirm(confirmMessage)) {
      return false;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/supplier/products/${supplierProductId}`), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await response.json();
      if (data.status === 'success') {
        setProducts((prev) => prev.filter((p) => !matchSupplierOfferRow(p, supplierProductId)));
        alert(
          isRejectedCatalogRemove
            ? 'Rejected product removed from your catalog.'
            : 'Product deleted successfully'
        );
        return true;
      }
      alert(data.message || 'Failed to delete product');
      return false;
    } catch (error) {
      console.error('Failed to delete product:', error);
      alert('Failed to delete product. Please try again.');
      return false;
    }
  };

  const filteredProducts = products.filter((product) => {
    const name = String(product?.name || '').toLowerCase();
    const matchesSearch = name.includes(String(searchTerm || '').toLowerCase());
    const productCategory = (product.category || '').toLowerCase();
    const filterCategoryLower = filterCategory === 'all' ? 'all' : filterCategory.toLowerCase();
    const matchesCategory = filterCategoryLower === 'all' || productCategory === filterCategoryLower;
    const matchesStatus =
      filterStatus === 'all' || getSupplierApprovalStatus(product) === filterStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const pageStats = useMemo(() => {
    const derivedTotal = products.length;
    const derivedPending = products.filter((p) => getSupplierApprovalStatus(p) === 'pending').length;
    const derivedActive = products.filter((p) => getSupplierApprovalStatus(p) === 'approved').length;
    const derivedRejected = products.filter((p) => getSupplierApprovalStatus(p) === 'rejected').length;
    const lowStock = products.filter((p) => {
      if (!isSupplierInventoryConfigured(p)) return false;
      const health = getStockHealth(p.stock);
      return health === 'out' || health === 'low';
    }).length;

    // Prefer server stats when present, but never under-count local list after a refresh.
    const total = Math.max(derivedTotal, Number(catalogStats?.total) || 0);
    const active = Math.max(derivedActive, Number(catalogStats?.active) || 0);
    const pending = catalogStats ? Number(catalogStats.pending) || derivedPending : derivedPending;
    const rejected = catalogStats ? Number(catalogStats.rejected) || derivedRejected : derivedRejected;

    return {
      total,
      active,
      approved: active,
      pending,
      rejected,
      lowStock
    };
  }, [products, catalogStats]);

  if (loading) {
    return (
      <div className="pm-page pm-loading">
        <div className="spinner" />
        <p>Loading your catalog…</p>
      </div>
    );
  }

  return (
    <div className="pm-page">
      <header className="pm-page-header">
        <div className="pm-page-header__main">
          <span className="pm-page-header__step">
            {isInventoryView ? 'Step 2 of 3 — Inventory' : 'Step 1 of 3 — Catalog'}
          </span>
          <h1>{isInventoryView ? 'Manage Inventory' : 'Manage Products'}</h1>
          <p className="pm-page-header__lead">
            {isInventoryView
              ? `Update ${SUPPLIER_MRP_LABEL}, ${SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()}, and location for each variant.`
              : 'Add and maintain product catalog entries — specifications, images, and brand details.'}
          </p>
        </div>
        <div className="pm-page-header__actions">
          <button
            type="button"
            className="pm-btn pm-btn--secondary"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh list"
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : undefined} />
            Refresh
          </button>
          {!isInventoryView && (
            <button type="button" className="pm-btn pm-btn--primary" onClick={() => setShowAddModal(true)}>
              <Plus size={16} />
              Add product
            </button>
          )}
        </div>
      </header>

      <div className="pm-workflow">
        <nav className="pm-tabs" aria-label="Product workflow">
          <button
            type="button"
            className={`pm-tab ${!isInventoryView ? 'pm-tab--active' : ''}`}
            onClick={() => navigate('/product-management')}
          >
            <Package size={15} />
            Manage Products
          </button>
          <button
            type="button"
            className={`pm-tab ${isInventoryView ? 'pm-tab--active' : ''}`}
            onClick={() => navigate('/manage-inventory')}
          >
            <Layers size={15} />
            Manage Inventory
          </button>
        </nav>

        <SupplierProductAdditionSteps
          compact
          variant={isInventoryView ? 'inventory' : 'add-product'}
          hint={
            isInventoryView
              ? `Complete ${SUPPLIER_MRP_LABEL} and stock, then configure ProductCOV.`
              : 'After catalog setup, continue to inventory and ProductCOV.'
          }
        />
      </div>

      <div className="pm-kpis">
        <div className="pm-kpi">
          <div className="pm-kpi__value">{pageStats.total}</div>
          <div className="pm-kpi__label">Total Variants</div>
        </div>
        <div className="pm-kpi">
          <div className="pm-kpi__value">{pageStats.active}</div>
          <div className="pm-kpi__label">Active</div>
        </div>
        <div className="pm-kpi">
          <div className="pm-kpi__value">{pageStats.pending}</div>
          <div className="pm-kpi__label">Pending Approval</div>
        </div>
        <div className="pm-kpi">
          <div className="pm-kpi__value">
            {isInventoryView ? pageStats.lowStock : pageStats.rejected}
          </div>
          <div className="pm-kpi__label">{isInventoryView ? 'Low / zero stock' : 'Rejected'}</div>
        </div>
      </div>

      {isInventoryView && pageStats.lowStock > 0 ? (
        <div className="pm-notice">
          <AlertTriangle size={16} />
          <span>
            <strong>{pageStats.lowStock}</strong> variant{pageStats.lowStock > 1 ? 's need' : ' needs'} a stock update.
          </span>
        </div>
      ) : null}

      {!viewingItem ? (
        <section className="pm-panel">
        <div className="pm-toolbar">
          <div>
            <h2 className="pm-toolbar__title">
              {isInventoryView ? 'Your inventory' : 'Your catalog'}
            </h2>
            <p className="pm-toolbar__meta">
              Showing {filteredProducts.length} of {products.length} variant{products.length !== 1 ? 's' : ''}
              {searchTerm ? ` matching “${searchTerm}”` : ''}
            </p>
          </div>
          <div className="pm-toolbar__controls" key={`pm-filters-${catalogViewEpoch}`}>
            <label className="pm-search">
              <Search size={16} />
              <input
                ref={searchInputRef}
                type="text"
                name="pm-product-search"
                placeholder="Search by product name…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Search products"
              />
            </label>
            <select
              className="pm-filter-select"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat.name} value={cat.name}>
                  {cat.displayName || cat.name}
                </option>
              ))}
            </select>
            <select
              className="pm-filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending Approval</option>
              <option value="approved">Approved / Active</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        <div className="pm-grid grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredProducts.length > 0 ? (
            filteredProducts.map((product, productIndex) => {
              const rowKey = String(
                product.supplier_product_id ||
                  product.supplierProductId ||
                  product.id ||
                  product._id ||
                  `row-${productIndex}`
              );
              const productStatus = getSupplierApprovalStatus(product);
              const status = STATUS_CONFIG[productStatus] || STATUS_CONFIG.pending;
              const rejectionReason = getSupplierRejectionReason(product);
              const inventoryConfigured = isSupplierInventoryConfigured(product);
              const stockHealth = inventoryConfigured ? getStockHealth(product.stock) : null;
              const displayBrand = String(product.brand || product.brandModel || '').trim();
              const imgs = getProductImageList(product);
              const inStock = inventoryConfigured && Number(product.stock) > 0;
              const moq = Number(product.min_order_quantity);
              const variantCode = product.variantAsin || product.variant_asin;

              return (
                <article
                  key={rowKey}
                  className={`pm-card pd-card flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    productStatus === 'pending'
                      ? 'pm-card--pending'
                      : productStatus === 'rejected'
                        ? 'pm-card--rejected'
                        : ''
                  }`}
                >
                  <button
                    type="button"
                    className="pm-card__image-btn"
                    onClick={() => setViewingItem(product)}
                    aria-label={`View ${product.name || 'product'}`}
                  >
                    <div className="pd-card__image">
                      {imgs.length > 0 ? (
                        <ProductImageCarousel
                          images={imgs}
                          alt={product.name}
                          height={160}
                          rounded={0}
                          stopPropagation
                        />
                      ) : (
                        <div className="pd-card__no-image" style={{ height: 160 }}>
                          <ImageOff size={32} />
                          <span>No image</span>
                        </div>
                      )}
                      {product.category || status.label ? (
                        <div className="pm-card__image-badges">
                          {product.category ? (
                            <span className="pd-card__category-badge" title={product.category}>
                              {product.category}
                            </span>
                          ) : null}
                          <span className={`pm-card__status-badge pm-status ${status.statusClass}`}>
                            {status.label}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </button>

                  <div className="pd-card__body">
                    <button
                      type="button"
                      className="pm-card__body-btn"
                      onClick={() => setViewingItem(product)}
                    >
                      <div className="pd-card__header">
                        <h3 className="pd-card__name">{product.name || 'Unnamed product'}</h3>
                        {displayBrand ? <span className="pd-card__brand">{displayBrand}</span> : null}
                      </div>

                      {productStatus === 'rejected' ? (
                        <div className="pm-card__rejection" role="status">
                          <strong className="pm-card__rejection-title">Rejected</strong>
                          <p className="pm-card__rejection-reason">
                            {rejectionReason || status.notice}
                          </p>
                          <p className="pm-card__rejection-hint">
                            Correct the product and resubmit for approval. Inventory and pricing apply after approval.
                          </p>
                        </div>
                      ) : null}

                      {productStatus === 'pending' ? (
                        <p className="pm-card__notice">{status.notice}</p>
                      ) : null}
                      {productStatus === 'approved' && status.notice ? (
                        <p className="pm-card__notice pm-card__notice--success">{status.notice}</p>
                      ) : null}
                      {productStatus !== 'rejected'
                        ? (() => {
                            const brandWarning = getBrandApprovalWarning(
                              product.brandApprovalStatus,
                              product.brand || product.brandModel,
                              product.brandApprovalMessage
                            );
                            if (!brandWarning) return null;
                            return (
                              <p
                                className={`pm-card__notice ${
                                  brandWarning.tone === 'danger'
                                    ? 'pm-card__notice--danger'
                                    : 'pm-card__notice--warning'
                                }`}
                              >
                                {brandWarning.title}: {brandWarning.message}
                              </p>
                            );
                          })()
                        : null}
                      {product.catalogMissing && productStatus !== 'rejected' ? (
                        <p className="pm-card__notice">
                          Catalog record unavailable. Your offer is still listed with status{' '}
                          {status.label}.
                        </p>
                      ) : null}

                      {productStatus === 'rejected' ? (
                        product.asin || variantCode ? (
                          <div className="pm-card__codes pm-card__codes--muted">
                            {product.asin ? <span>TSIN {product.asin}</span> : null}
                            {variantCode ? <span>Variant {variantCode}</span> : null}
                          </div>
                        ) : null
                      ) : (
                        <div className="pd-card__details">
                          {inventoryConfigured && Number(product.price) > 0 ? (
                            <span className="pd-card__price">
                              {formatRupeePerUnit(product.price, product.unit)}
                            </span>
                          ) : !inventoryConfigured ? (
                            <span className="pd-card__price pd-card__price--pending">
                              {SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL}
                            </span>
                          ) : (
                            <span className="pd-card__price pd-card__price--na">MRP not set</span>
                          )}

                          <div className="pd-card__meta-row">
                            {product.unit ? (
                              <span className="pd-card__meta-item">Unit: {product.unit}</span>
                            ) : null}
                            {moq > 1 ? <span className="pd-card__meta-item">MOQ: {moq}</span> : null}
                            {inventoryConfigured ? (
                              <>
                                <span
                                  className={`pd-card__stock ${
                                    inStock ? 'pd-card__stock--in' : 'pd-card__stock--out'
                                  }`}
                                >
                                  {formatSupplierStockAvailability(product.stock)}
                                </span>
                                {stockHealth === 'low' ? (
                                  <span className="pd-card__meta-item pm-card__meta-warn">Low stock</span>
                                ) : null}
                              </>
                            ) : null}
                          </div>

                          {product.location ? (
                            <div className="pd-card__location">
                              <MapPin size={13} />
                              <span>{product.location}</span>
                            </div>
                          ) : null}

                          {product.asin || variantCode ? (
                            <div className="pm-card__codes">
                              {product.asin ? <span>TSIN {product.asin}</span> : null}
                              {variantCode ? <span>Variant {variantCode}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </button>
                  </div>

                  <div className="pm-card__footer pd-card__footer">
                    <span className="pm-card__footer-label">
                      {isInventoryView ? 'Inventory' : 'Catalog'}
                    </span>
                    <div className="pm-card__actions">
                      {product.variantKey ? (
                        isSupplierProductEligibleForProductCov(product) ? (
                          <button
                            type="button"
                            className="pm-card__action-btn"
                            onClick={() => {
                              const params = new URLSearchParams();
                              params.set('variantKey', product.variantKey);
                              if (variantCode) params.set('variantAsin', variantCode);
                              if (product.name) params.set('variantName', product.name);
                              if (product.brand) params.set('brand', product.brand);
                              navigate(`/supplier-bcov?${params.toString()}`);
                            }}
                            title="ProductCOV"
                          >
                            <Wallet size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="pm-card__action-btn pm-card__action-btn--disabled"
                            disabled
                            title="ProductCOV unavailable while rejected. Correct the product and get approval first."
                            aria-label="ProductCOV unavailable while rejected"
                          >
                            <Wallet size={15} />
                          </button>
                        )
                      ) : null}
                      {isInventoryView ? (
                        <>
                          <button
                            type="button"
                            className="pm-card__action-btn"
                            onClick={() => setEditingItem(product)}
                            title="Edit inventory"
                          >
                            <Edit size={15} />
                          </button>
                          <button
                            type="button"
                            className="pm-card__action-btn pm-card__action-btn--danger"
                            onClick={() =>
                              handleDeleteProduct(
                                getSupplierOfferRowId(product) || product.id || product._id
                              )
                            }
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="pm-card__action-btn"
                            onClick={() => setEditingItem(product)}
                            title="Edit product & images"
                          >
                            <Edit size={15} />
                          </button>
                          <button
                            type="button"
                            className="pm-card__action-btn"
                            onClick={() => setViewingItem(product)}
                            title="View"
                          >
                            <Eye size={15} />
                          </button>
                          {productStatus === 'rejected' ? (
                            <button
                              type="button"
                              className="pm-card__action-btn pm-card__action-btn--danger"
                              onClick={() =>
                                handleDeleteProduct(
                                  getSupplierOfferRowId(product) || product.id || product._id,
                                  { fromRejectedCatalog: true }
                                )
                              }
                              title="Remove rejected product from catalog"
                              aria-label={`Remove ${product.name || 'rejected product'} from catalog`}
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="pm-empty">
              <div className="pm-empty__icon">
                {isInventoryView ? <Layers size={22} /> : <Package size={22} />}
              </div>
              <h3>{searchTerm || filterCategory !== 'all' || filterStatus !== 'all' ? 'No results' : 'No products'}</h3>
              <p>
                {searchTerm || filterCategory !== 'all' || filterStatus !== 'all'
                  ? 'Adjust search or filters and try again.'
                  : isInventoryView
                    ? 'Add catalog items first, then set inventory here.'
                    : 'Add a product to start building your catalog.'}
              </p>
              {!isInventoryView && !searchTerm && filterCategory === 'all' && filterStatus === 'all' ? (
                <button type="button" className="pm-btn pm-btn--primary" onClick={() => setShowAddModal(true)}>
                  <Plus size={16} />
                  Add product
                </button>
              ) : null}
              {isInventoryView && products.length === 0 ? (
                <button type="button" className="pm-btn pm-btn--primary" onClick={() => navigate('/product-management')}>
                  <Package size={16} />
                  Manage Products
                </button>
              ) : null}
            </div>
          )}
        </div>
        </section>
      ) : null}

      {/* Add Product Modal - only from Manage Products.
          We collect product identity fields here (product name, brand/model,
          location code, serial number). Price/stock are managed separately in
          the Manage Inventory view. */}
      {showAddModal && (
        <ProductModal
          showInventoryFields={false}
          showAdditionSteps
          onClose={() => setShowAddModal(false)}
          onSave={handleAddProduct}
        />
      )}

      {/* Edit Product Modal — inventory OR catalog (images / specs) */}
      {editingItem && (
        <ProductModal
          product={editingItem}
          showInventoryFields={isInventoryView}
          onClose={() => setEditingItem(null)}
          onSave={async (data) => {
            const productId = getSupplierOfferRowId(editingItem);
            if (!productId) {
              alert(
                isInventoryView
                  ? 'Cannot save inventory: missing variant offer id. Refresh Manage Inventory and try again.'
                  : 'Cannot save product: missing variant offer id. Refresh Manage Products and try again.'
              );
              return;
            }
            if (isInventoryView) {
              const result = buildInventoryUpdatePayload(editingItem, data);
              if (result.error) {
                alert(result.error);
                return;
              }
              await handleUpdateProduct(productId, result.payload, {
                expectedStock: result.payload.stock
              });
              return;
            }
            // Catalog edit: identity + images/specs. Brand is mandatory.
            const brandValue = String(
              data.brand ||
                editingItem?.brand ||
                editingItem?.brandModel ||
                editingItem?.attributes?.brand ||
                ''
            ).trim();
            const catalogPayload = {
              name: data.name,
              description: data.description,
              category: data.category,
              brand: brandValue,
              unit: data.unit,
              gtin: data.gtin,
              images: Array.isArray(data.images) ? data.images : []
            };
            const isApprovedSpecFill =
              String(editingItem?.status || '').toLowerCase() === 'approved' &&
              !supplierSpecificationValuesLocked({
                offerSpecifications:
                  editingItem?.supplierOfferSpecifications ||
                  editingItem?.attributes?.specifications,
                supplierSpecValuesLocked: editingItem?.supplierSpecValuesLocked
              }) &&
              (Array.isArray(editingItem?.catalogSpecificationKeys)
                ? editingItem.catalogSpecificationKeys.length > 0
                : Object.keys(editingItem?.specifications || {}).length > 0);
            const isPendingCategorySpecFill =
              String(editingItem?.status || '').toLowerCase() === 'pending' &&
              data.specifications &&
              typeof data.specifications === 'object' &&
              Object.keys(data.specifications).length > 0;
            if (isApprovedSpecFill || isPendingCategorySpecFill) {
              catalogPayload.specifications = data.specifications;
            }
            const catalogMissing = getSupplierCatalogMandatoryMissingFields(catalogPayload, {
              isCreate: false,
              requireUnit: true
            });
            if (catalogMissing.length > 0) {
              alert(formatSupplierProductValidationMessage(catalogMissing));
              return;
            }
            if (isApprovedSpecFill) {
              const specMissing = getSupplierSpecificationTemplateMissingFields(
                editingItem.catalogSpecificationKeys ||
                  Object.keys(editingItem.specifications || {}),
                data.specifications
              );
              if (specMissing.length > 0) {
                alert(formatSupplierProductValidationMessage(specMissing));
                return;
              }
            }
            if (isPendingCategorySpecFill) {
              const specMissing = getSupplierSpecificationTemplateMissingFields(
                Object.keys(data.specifications || {}),
                data.specifications
              );
              if (specMissing.length > 0) {
                alert(formatSupplierProductValidationMessage(specMissing));
                return;
              }
            }
            await handleUpdateProduct(productId, catalogPayload);
          }}
        />
      )}

      {viewingItem && (
        <ProductDetailsModal
          key={getSupplierOfferRowId(viewingItem) || viewingItem.id}
          product={viewingItem}
          canEditInventory={isInventoryView}
          specificationsReadOnly={
            supplierSpecificationValuesLocked({
              offerSpecifications:
                viewingItem?.supplierOfferSpecifications ||
                viewingItem?.attributes?.specifications,
              supplierSpecValuesLocked: viewingItem?.supplierSpecValuesLocked
            })
          }
          onClose={() => setViewingItem(null)}
          onEdit={
            isInventoryView
              ? (item) => {
                  setViewingItem(null);
                  setEditingItem(item);
                }
              : undefined
          }
          onRemoveRejected={
            !isInventoryView && getSupplierApprovalStatus(viewingItem) === 'rejected'
              ? async (item) => {
                  const offerId = getSupplierOfferRowId(item) || item.id || item._id;
                  if (!offerId) return;
                  const removed = await handleDeleteProduct(offerId, { fromRejectedCatalog: true });
                  if (removed) setViewingItem(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
};

const ProductDetailsModal = ({
  product,
  canEditInventory = false,
  specificationsReadOnly = false,
  onClose,
  onEdit,
  onRemoveRejected,
  onSaveSpecifications
}) => {
  const detailsNavigate = useNavigate();
  const [displaySpecifications, setDisplaySpecifications] = useState(() =>
    resolveSupplierOfferDisplaySpecifications(product)
  );
  const [isEditingSpecs, setIsEditingSpecs] = useState(false);
  const [draftSpecs, setDraftSpecs] = useState({});
  const [savingSpecs, setSavingSpecs] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(product?.description || '');
  const [extractingSpecs, setExtractingSpecs] = useState(false);
  const [lastSuccessfulExtractionSourceKey, setLastSuccessfulExtractionSourceKey] = useState(null);
  const specsObject =
    product?.specifications && typeof product.specifications === 'object' && !Array.isArray(product.specifications)
      ? product.specifications
      : {};
  const gtinValue =
    String(
      product?.gtin ||
        product?.barcode ||
        specsObject?.gtin ||
        specsObject?.GTIN ||
        specsObject?.upc ||
        specsObject?.UPC ||
        specsObject?.ean ||
        specsObject?.EAN ||
        specsObject?.barcode ||
        specsObject?.Barcode ||
        ''
    ).trim();

  useEffect(() => {
    setDisplaySpecifications(resolveSupplierOfferDisplaySpecifications(product));
    setIsEditingSpecs(false);
    setDraftSpecs({});
    setDescriptionDraft(product?.description || '');
  }, [
    product?.supplier_product_id,
    product?.specifications,
    product?.catalogSpecifications,
    product?.supplierOfferSpecifications,
    product?.attributes?.specifications,
    product?.description
  ]);

  const specEntries = specificationEntriesForDetails(displaySpecifications);

  const beginSpecificationEdit = () => {
    const draft = {};
    specEntries.forEach((entry) => {
      draft[entry.key] = specValueToInput(displaySpecifications[entry.key]);
    });
    setDraftSpecs(draft);
    setIsEditingSpecs(true);
  };

  const cancelSpecificationEdit = () => {
    setIsEditingSpecs(false);
    setDraftSpecs({});
  };

  const saveSpecificationEdits = async () => {
    if (!onSaveSpecifications) return;
    const nextSpecs = {};
    specEntries.forEach((entry) => {
      const original = displaySpecifications[entry.key];
      nextSpecs[entry.key] = parseSpecInputToValue(draftSpecs[entry.key], original);
    });

    setSavingSpecs(true);
    const result = await onSaveSpecifications(product, nextSpecs);
    setSavingSpecs(false);

    if (result?.ok) {
      const merged = mergeCatalogAndOfferSpecificationsForDisplay(
        product?.catalogSpecifications || {},
        result.product?.supplierOfferSpecifications ||
          result.product?.specifications ||
          nextSpecs
      );
      setDisplaySpecifications(merged);
      setIsEditingSpecs(false);
      setDraftSpecs({});
    }
  };

  const handleExtractSpecificationsInDetails = async () => {
    const category = String(product?.category || '').trim();
    if (!descriptionDraft.trim()) {
      alert('Please enter a product description with specification details first.');
      return;
    }
    if (!category) {
      alert('Product category is required for AI extraction.');
      return;
    }

    const sourceKey = buildSpecExtractionSourceKey({
      name: product?.name,
      category,
      brand: product?.brand || product?.brandModel,
      description: descriptionDraft
    });
    if (lastSuccessfulExtractionSourceKey && lastSuccessfulExtractionSourceKey === sourceKey) {
      return;
    }

    setExtractingSpecs(true);
    try {
      const { response, data } = await extractSpecificationsFromDescription({
        description: descriptionDraft,
        category,
        productName: product?.name || '',
        existingSpecifications: displaySpecifications
      });

      if (!response.ok && data?.status !== 'success' && data?.status !== 'warning') {
        throw new Error(data?.message || `HTTP error! status: ${response.status}`);
      }

      const result = applyExtractResultToSpecs(displaySpecifications, data);
      if (!result.ok) {
        alert(`⚠️ ${result.warning || result.error}`);
        return;
      }
      if (result.categoryMismatchWarning) {
        alert(`⚠️ ${result.categoryMismatchWarning}`);
      }

      setDisplaySpecifications(result.merged);
      const nextDraft = {};
      Object.keys(result.merged).forEach((key) => {
        nextDraft[key] = specValueToInput(result.merged[key]);
      });
      setDraftSpecs(nextDraft);

      if (result.filledCount > 0) {
        setLastSuccessfulExtractionSourceKey(sourceKey);
        alert(
          `Specifications extracted successfully. ${result.filledCount} field${
            result.filledCount > 1 ? 's were' : ' was'
          } filled. Review and click Save.`
        );
      } else {
        alert('No values found in description. Use lines like "Finish: Matt" or "Sheen: Low".');
      }
    } catch (error) {
      alert('Failed to extract specifications. Please try again.');
    } finally {
      setExtractingSpecs(false);
    }
  };

  const detailsExtractionSourceKey = buildSpecExtractionSourceKey({
    name: product?.name,
    category: product?.category,
    brand: product?.brand || product?.brandModel,
    description: descriptionDraft
  });
  const detailsSpecsAlreadyExtracted =
    Boolean(lastSuccessfulExtractionSourceKey) &&
    lastSuccessfulExtractionSourceKey === detailsExtractionSourceKey;

  const modalNode = (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal pm-details-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{product.name || 'Product details'}</h2>
          <div className="modal-actions">
            {product?.variantKey ? (
              isSupplierProductEligibleForProductCov(product) ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set('variantKey', product.variantKey);
                    if (product.variantAsin || product.variant_asin) {
                      params.set('variantAsin', product.variantAsin || product.variant_asin);
                    }
                    if (product.name) params.set('variantName', product.name);
                    if (product.brand) params.set('brand', product.brand);
                    detailsNavigate(`/supplier-bcov?${params.toString()}`);
                  }}
                  style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }}
                >
                  ProductCOV
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled
                  title="ProductCOV unavailable while rejected. Correct the product and get approval first."
                >
                  ProductCOV unavailable
                </button>
              )
            ) : null}
            {canEditInventory ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onEdit(product)}
              >
                <Edit size={16} />
                Edit Inventory
              </button>
            ) : null}
            {onRemoveRejected ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onRemoveRejected(product)}
                style={{ color: '#b91c1c', borderColor: '#fecaca' }}
              >
                <Trash2 size={16} />
                Remove from catalog
              </button>
            ) : null}
            <button type="button" className="btn-icon" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="modal-form">
          {getProductImageList(product).length > 0 ? (
            <div className="pm-details-hero">
              <ProductImageCarousel
                images={getProductImageList(product)}
                alt={product.name || 'Product'}
                height={220}
                rounded={12}
              />
            </div>
          ) : null}

          <div className="pm-details-grid">
            <div className="pm-details-field">
              <span className="pm-details-field__label">Category</span>
              <span className="pm-details-field__value">{product.category || '—'}</span>
            </div>
            <div className="pm-details-field">
              <span className="pm-details-field__label">Status</span>
              <span className="pm-details-field__value">
                {(STATUS_CONFIG[getSupplierApprovalStatus(product)] || STATUS_CONFIG.pending).label}
              </span>
            </div>
            {getSupplierApprovalStatus(product) === 'rejected' ? (
              <div className="pm-details-field" style={{ gridColumn: '1 / -1' }}>
                <span className="pm-details-field__label">Rejection reason</span>
                <span className="pm-details-field__value">
                  {getSupplierRejectionReason(product) || 'No reason provided'}
                </span>
              </div>
            ) : null}
            {getSupplierApprovalStatus(product) === 'pending' ? (
              <div className="pm-details-field" style={{ gridColumn: '1 / -1' }}>
                <span className="pm-details-field__label">Approval</span>
                <span className="pm-details-field__value">
                  Pending admin approval. This product remains visible in your list until reviewed.
                </span>
              </div>
            ) : null}
            <div className="pm-details-field">
              <span className="pm-details-field__label">{SUPPLIER_MRP_LABEL}</span>
              <span className="pm-details-field__value">
                {isSupplierInventoryConfigured(product) && Number(product.price) > 0
                  ? formatRupeePerUnit(product.price, product.unit)
                  : SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL}
              </span>
            </div>
            <div className="pm-details-field">
              <span className="pm-details-field__label">{SUPPLIER_CURRENT_STOCK_LABEL}</span>
              <span className="pm-details-field__value">
                {isSupplierInventoryConfigured(product)
                  ? formatSupplierStockAvailability(product.stock)
                  : SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL}
              </span>
            </div>
            {gtinValue ? (
              <div className="pm-details-field">
                <span className="pm-details-field__label">GTIN / UPC / EAN</span>
                <span className="pm-details-field__value">{gtinValue}</span>
              </div>
            ) : null}
            {product.brand ? (
              <div className="pm-details-field">
                <span className="pm-details-field__label">Brand</span>
                <span className="pm-details-field__value">{product.brand}</span>
              </div>
            ) : null}
            {product.lsa ? (
              <div className="pm-details-field">
                <span className="pm-details-field__label">LSA</span>
                <span className="pm-details-field__value">{product.lsa}</span>
              </div>
            ) : null}
            {product.location ? (
              <div className="pm-details-field">
                <span className="pm-details-field__label">Location</span>
                <span className="pm-details-field__value">{product.location}</span>
              </div>
            ) : null}
            {product.asin ? (
              <div className="pm-details-field">
                <span className="pm-details-field__label">TSIN</span>
                <span className="pm-details-field__value">{product.asin}</span>
              </div>
            ) : null}
            {(product.variantAsin || product.variant_asin) ? (
              <div className="pm-details-field">
                <span className="pm-details-field__label">Variant TSIN</span>
                <span className="pm-details-field__value">{product.variantAsin || product.variant_asin}</span>
              </div>
            ) : null}
          </div>

          {(product.description || product.supplierDescription) ? (
            <div className="pm-details-section">
              <h4>Your submitted description</h4>
              <p style={{ margin: 0, color: '#475569', lineHeight: 1.55 }}>
                {product.supplierDescription || product.description}
              </p>
              {product.publishedDescription &&
              String(product.publishedDescription).trim() &&
              product.publishedDescription !== (product.supplierDescription || product.description) ? (
                <p className="pm-description-hint" style={{ marginTop: '0.5rem' }}>
                  Published for buyers: {product.publishedDescription}
                </p>
              ) : product.status === 'approved' && !product.publishedDescription ? (
                <p className="pm-description-hint" style={{ marginTop: '0.5rem' }}>
                  A polished buyer-facing description will appear here after admin review.
                </p>
              ) : null}
            </div>
          ) : null}

          {specEntries.length > 0 ? (
            <div className="pm-details-section">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '0.5rem',
                  flexWrap: 'wrap'
                }}
              >
                <h4 style={{ margin: 0 }}>Specifications</h4>
                {!isEditingSpecs && onSaveSpecifications && !specificationsReadOnly ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={beginSpecificationEdit}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <Edit size={16} />
                    Edit values
                  </button>
                ) : null}
                {isEditingSpecs ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={cancelSpecificationEdit}
                      disabled={savingSpecs}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={saveSpecificationEdits}
                      disabled={savingSpecs}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Save size={16} />
                      {savingSpecs ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                ) : null}
              </div>
              {specificationsReadOnly || !onSaveSpecifications ? (
                <p className="pm-details-spec-readonly-hint">
                  Specifications cannot be changed after the product is saved.
                </p>
              ) : null}
              {isEditingSpecs ? (
                <div
                  style={{
                    marginBottom: '0.75rem',
                    padding: '0.75rem',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px'
                  }}
                >
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Description (for AI fill)
                  </label>
                  <textarea
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    rows={3}
                    placeholder='e.g. Finish: Matt, Volume: 20L, Sheen: Low, Coverage: 140 sq ft/L'
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.65rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      resize: 'vertical'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    {detailsSpecsAlreadyExtracted ? (
                      <span style={{ fontSize: '0.75rem', color: '#047857', fontStyle: 'italic' }}>
                        Specifications extracted for the current description. Edit the description to extract again.
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleExtractSpecificationsInDetails}
                        disabled={extractingSpecs || !descriptionDraft.trim()}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: extractingSpecs ? '#9ca3af' : '#10b981',
                          color: '#fff',
                          border: 'none'
                        }}
                      >
                        <Sparkles size={14} />
                        {extractingSpecs ? 'Extracting…' : 'Extract from description'}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="pm-spec-grid">
                {specEntries.map((entry) => (
                  <div key={entry.key} className="pm-spec-card">
                    <div className="pm-spec-card__label">{entry.label}</div>
                    {isEditingSpecs ? (
                      <input
                        type="text"
                        value={draftSpecs[entry.key] ?? ''}
                        onChange={(e) =>
                          setDraftSpecs((prev) => ({ ...prev, [entry.key]: e.target.value }))
                        }
                        placeholder={`Enter ${entry.label.toLowerCase()}`}
                        style={{
                          width: '100%',
                          padding: '0.45rem 0.6rem',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '0.9rem',
                          color: '#0f172a',
                          background: '#fff'
                        }}
                      />
                    ) : (
                      <div
                        className={`pm-spec-card__value ${entry.hasValue ? '' : 'pm-spec-card__value--empty'}`}
                      >
                        {entry.displayValue}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modalNode;
  }

  return createPortal(modalNode, document.body);
};

const ProductModal = ({ product, onClose, onSave, showInventoryFields = true, showAdditionSteps = false }) => {
  const mrpLocked = Boolean(product && isSupplierMrpLocked(product));
  const [formData, setFormData] = useState({
    catalogProductId: product?.catalogProductId || product?.id || '',
    name: product?.name || '',
    brand: product?.brand || '',
    gtin: product?.gtin || '',
    hsnCode: product?.hsnCode || product?.hsn_code || '',
    lsa: product?.lsa || '',
    category: product?.category || '',
    price: product?.price || '',
    unit: product?.unit || '',
    stock: product?.stock != null && product?.stock !== '' ? String(product.stock) : '',
    igst_rate: product?.igst_rate != null ? String(product.igst_rate) : '',
    cgst_rate: product?.cgst_rate != null ? String(product.cgst_rate) : '',
    sgst_rate: product?.sgst_rate != null ? String(product.sgst_rate) : '',
    location: product?.location || '',
    description: product?.description || '',
    images: getSupplierOfferImagesForForm(product)
  });
  const [recommendedPrice, setRecommendedPrice] = useState(null);
  const [recommendedPriceStats, setRecommendedPriceStats] = useState(null);
  const [priceTouched, setPriceTouched] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [hoveredSuggestionId, setHoveredSuggestionId] = useState(null);
  const suggestionsRef = useRef(null);
  const inputRef = useRef(null);
  
  // Product type selection state
  const [productType, setProductType] = useState(product ? null : 'existing_category');
  
  // Category and Unit states
  const [categories, setCategories] = useState([]);
  const [categorySuggestions, setCategorySuggestions] = useState([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const categoryInputRef = useRef(null);
  const categorySuggestionsRef = useRef(null);
  
  const [units, setUnits] = useState([]);
  const [unitSuggestions, setUnitSuggestions] = useState([]);
  const [showUnitSuggestions, setShowUnitSuggestions] = useState(false);
  const unitInputRef = useRef(null);
  const unitSuggestionsRef = useRef(null);
  
  // Locations from supplier profile branches
  const [locations, setLocations] = useState([]);
  
  // Track previous category to detect actual changes
  const previousCategoryRef = useRef(null);
  const preserveSpecsOnNextCategoryLoadRef = useRef(false);
  const selectedSuggestionSpecsRef = useRef(null);
  const loadCategorySpecsRequestRef = useRef(0);
  
  // Extract Specifications state
  const [extracting, setExtracting] = useState(false); // For extracting specs from description
  const [lastSuccessfulExtractionSourceKey, setLastSuccessfulExtractionSourceKey] = useState(null);
  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const [hasAdminSpecTemplate, setHasAdminSpecTemplate] = useState(false);
  const [adminSpecTemplateKeys, setAdminSpecTemplateKeys] = useState([]);
  const [aiProvider, setAiProvider] = useState('gemini'); // product photo analyze always uses Gemini on server
  const [aiAnalysisMeta, setAiAnalysisMeta] = useState(null);
  // Initialize specifications: for existing products, use their specs; for new products, start empty
  const [specifications, setSpecifications] = useState(() => {
    if (product && product.specifications) {
      return product.specifications;
    }
    return {}; // Start with empty object for new products
  });
  const supplierSpecValuesLocked = useMemo(
    () =>
      supplierSpecificationValuesLocked({
        offerSpecifications:
          product?.supplierOfferSpecifications ||
          product?.attributes?.specifications,
        supplierSpecValuesLocked: product?.supplierSpecValuesLocked
      }),
    [
      product?.supplierOfferSpecifications,
      product?.attributes?.specifications,
      product?.supplierSpecValuesLocked
    ]
  );
  const approvedNeedsSpecFill = useMemo(() => {
    if (!product) return false;
    if (String(product.status || '').toLowerCase() !== 'approved') return false;
    if (supplierSpecValuesLocked) return false;
    const keys = Array.isArray(product.catalogSpecificationKeys)
      ? product.catalogSpecificationKeys.filter(Boolean)
      : Object.keys(product.specifications || {}).filter(Boolean);
    return keys.length > 0;
  }, [product, supplierSpecValuesLocked]);
  const productStatus = product ? String(product.status || 'pending').toLowerCase() : 'pending';
  const categorySpecFillRequired = useMemo(
    () =>
      hasAdminSpecTemplate &&
      adminSpecTemplateKeys.length > 0 &&
      (!product || productStatus === 'pending'),
    [hasAdminSpecTemplate, adminSpecTemplateKeys, product, productStatus]
  );
  const canEditSpecificationValues = useMemo(() => {
    if (showInventoryFields) return false;
    if (supplierSpecValuesLocked) return false;
    if (productStatus === 'rejected') return false;
    // Existing category with admin template keys: fill while adding or editing a pending product.
    if (categorySpecFillRequired) return true;
    // New category / no category template: fill catalog keys once after admin approval.
    if (productStatus === 'approved' && approvedNeedsSpecFill) return true;
    return false;
  }, [
    showInventoryFields,
    supplierSpecValuesLocked,
    productStatus,
    categorySpecFillRequired,
    approvedNeedsSpecFill
  ]);
  const canEditSpecificationKeys = false;

  // After admin approval, load catalog spec keys when the category had no template at submit time.
  useEffect(() => {
    if (!product) {
      return;
    }
    const status = String(product.status || 'pending').toLowerCase();
    if (status !== 'approved' || supplierSpecValuesLocked || hasAdminSpecTemplate) {
      return;
    }

    const keys = Array.isArray(product.catalogSpecificationKeys)
      ? product.catalogSpecificationKeys.filter(Boolean)
      : Object.keys(product.specifications || {}).filter(Boolean);
    setAdminSpecTemplateKeys(keys);
    setHasAdminSpecTemplate(false);
    if (keys.length > 0) {
      const offerSpecs =
        product.supplierOfferSpecifications ||
        product.attributes?.specifications ||
        {};
      const template = Object.fromEntries(keys.map((key) => [key, '']));
      setSpecifications(mergeVariantSpecificationTemplate(template, offerSpecs));
    }
  }, [
    product?.id,
    product?.status,
    product?.catalogSpecificationKeys,
    product?.specifications,
    product?.supplierOfferSpecifications,
    product?.attributes?.specifications,
    product,
    supplierSpecValuesLocked,
    hasAdminSpecTemplate
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [formValidationError, setFormValidationError] = useState('');
  const [showMissingHints, setShowMissingHints] = useState(false);
  const [brandApprovalState, setBrandApprovalState] = useState({
    loading: false,
    status: '',
    message: '',
    brandName: ''
  });
  const formRef = useRef(null);
  const formScrollRef = useRef(null);
  const productPhotosSectionRef = useRef(null);
  const brandFieldRef = useRef(null);
  const specificationsSectionRef = useRef(null);

  const MIN_AI_PRODUCT_IMAGES = MIN_SUPPLIER_PRODUCT_PHOTOS;
  const MAX_AI_PRODUCT_IMAGES = 8;

  // Multiple product photos for AI (minimum 3 required before analysis runs)
  const [productAiImages, setProductAiImages] = useState([]);
  const [photosAttachedForProduct, setPhotosAttachedForProduct] = useState(false);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [aiDetectionReview, setAiDetectionReview] = useState(null);
  const [aiSuggestionPopup, setAiSuggestionPopup] = useState({
    open: false,
    providerName: 'AI',
    items: [],
    selected: {}
  });
  const productAiImagesRef = useRef([]);

  useEffect(() => {
    productAiImagesRef.current = productAiImages;
  }, [productAiImages]);

  // Keep page behind the full-screen modal from scrolling so wheel/trackpad stays on the form.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow
    };
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    html.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      html.style.overflow = previous.htmlOverflow;
    };
  }, []);

  useEffect(() => {
    if (showInventoryFields) {
      setBrandApprovalState({ loading: false, status: 'approved', message: '', brandName: '' });
      return undefined;
    }

    const brandName = String(formData.brand || '').trim();
    if (!brandName) {
      setBrandApprovalState({ loading: false, status: 'missing', message: '', brandName: '' });
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBrandApprovalState((prev) => ({
        ...prev,
        loading: true,
        brandName
      }));
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(
          getApiUrl(`/api/supplier/brands/status?name=${encodeURIComponent(brandName)}`),
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-cache'
          }
        );
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || data.status !== 'success') {
          setBrandApprovalState({
            loading: false,
            status: 'unknown',
            message: data.message || 'Could not verify brand approval status.',
            brandName
          });
          return;
        }
        setBrandApprovalState({
          loading: false,
          status: data.brandStatus || 'unknown',
          message: data.message || '',
          brandName: data.brand?.name || brandName
        });
      } catch (_err) {
        if (cancelled) return;
        setBrandApprovalState({
          loading: false,
          status: 'unknown',
          message: 'Could not verify brand approval status.',
          brandName
        });
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [formData.brand, showInventoryFields]);

  useEffect(() => {
    return () => {
      productAiImagesRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  // Update specifications when product prop changes (e.g., when modal reopens after update)
  // This ensures specifications are loaded when editing an existing product
  useEffect(() => {
    if (product) {
      const productSpecs = product.specifications;
      
      // Only update if product has specifications and they're different from current state
      if (productSpecs && typeof productSpecs === 'object' && !Array.isArray(productSpecs)) {
        const productSpecKeys = Object.keys(productSpecs);
        const currentSpecKeys = Object.keys(specifications);
        
        // Update if:
        // 1. Product has specs and current state is empty (initial load)
        // 2. Product has different/more keys than current state (product was updated)
        if (productSpecKeys.length > 0) {
          const specsChanged = JSON.stringify(productSpecs) !== JSON.stringify(specifications);
          if (currentSpecKeys.length === 0 || specsChanged) {
            setSpecifications({ ...productSpecs });
          }
        }
      } else if (!productSpecs && Object.keys(specifications).length === 0) {
        // Product has no specs and we have none - ensure we start with empty object
        setSpecifications({});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.specifications]);

  const addSpecificationKey = () => {
    setSpecifications((prev) => {
      const next = { ...(prev || {}) };
      let idx = 1;
      let candidate = 'new_spec';
      while (Object.prototype.hasOwnProperty.call(next, candidate)) {
        idx += 1;
        candidate = `new_spec_${idx}`;
      }
      next[candidate] = '';
      return next;
    });
  };

  const renameSpecificationKey = (oldKey, nextKeyRaw) => {
    const nextKey = String(nextKeyRaw || '').trim();
    if (!nextKey || nextKey === oldKey) return;
    setSpecifications((prev) => {
      const current = { ...(prev || {}) };
      if (!Object.prototype.hasOwnProperty.call(current, oldKey)) return prev;
      const oldValue = current[oldKey];
      delete current[oldKey];
      if (Object.prototype.hasOwnProperty.call(current, nextKey)) {
        const existingValue = current[nextKey];
        current[nextKey] = existingValue === '' || existingValue == null ? oldValue : existingValue;
      } else {
        current[nextKey] = oldValue;
      }
      return current;
    });
  };

  const removeSpecificationKey = (keyToRemove) => {
    setSpecifications((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, keyToRemove)) return prev;
      const next = { ...prev };
      delete next[keyToRemove];
      return next;
    });
  };

  const updateSpecificationValue = (specKey, nextValueRaw) => {
    setSpecifications((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, specKey)) return prev;
      return {
        ...prev,
        [specKey]: parseSpecInputToValue(nextValueRaw, prev[specKey])
      };
    });
  };

  const fetchSuggestions = async (query) => {
    if (!query || query.trim().length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        q: query,
        brandScoped: '1'
      });
      const response = await fetch(getApiUrl(`/api/supplier/products/search?${params.toString()}`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSuggestions(data.suggestions || []);
        setShowSuggestions(data.suggestions && data.suggestions.length > 0);
      }
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setFormData({ ...formData, name: value, catalogProductId: '' });
    
    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Debounce the search - wait 300ms after user stops typing
    const timeout = setTimeout(() => {
      if (value.trim().length > 0) {
        fetchSuggestions(value);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);
    
    setSearchTimeout(timeout);
  };

  const handleSuggestionClick = (suggestion) => {
    const nextSpecs =
      suggestion?.specifications &&
      typeof suggestion.specifications === 'object' &&
      !Array.isArray(suggestion.specifications)
        ? suggestion.specifications
        : null;

    setFormData({
      ...formData,
      catalogProductId: suggestion.id || '',
      name: suggestion.name,
      brand: formData.brand || suggestion.brand || '',
      gtin: suggestion.gtin || formData.gtin,
      hsnCode: suggestion.hsnCode || suggestion.hsn_code || formData.hsnCode,
      description: suggestion.description || formData.description,
      category: suggestion.category || formData.category,
      // Auto-fill unit from suggestion if available
      unit: suggestion.unit || formData.unit
    });
    if (nextSpecs) {
      preserveSpecsOnNextCategoryLoadRef.current = true;
      selectedSuggestionSpecsRef.current = { ...nextSpecs };
      setSpecifications(nextSpecs);
    }
    setSuggestions([]);
    setShowSuggestions(false);
    setHoveredSuggestionId(null);
    // Focus back on input after selection
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Auto-fill unit when name + category match an existing product (even if user didn't click suggestion)
  useEffect(() => {
    const name = (formData.name || '').trim();
    const category = (formData.category || '').trim();
    const brand = (formData.brand || '').trim();

    if (!name || !category) return;

    const timeout = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const lookupParams = new URLSearchParams({
          name,
          category
        });
        if (brand) lookupParams.set('brand', brand);
        const res = await fetch(
          getApiUrl(`/api/supplier/products/lookup?${lookupParams.toString()}`),
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const data = await res.json();
        if (data.status === 'success' && data.found && data.unit) {
          // Never overwrite a unit the supplier already entered.
          setFormData((prev) =>
            String(prev.unit || '').trim() ? prev : { ...prev, unit: data.unit }
          );
        }
        if (
          data.status === 'success' &&
          data.specifications &&
          typeof data.specifications === 'object' &&
          !Array.isArray(data.specifications) &&
          Object.keys(data.specifications).length > 0
        ) {
          preserveSpecsOnNextCategoryLoadRef.current = true;
          selectedSuggestionSpecsRef.current = { ...data.specifications };
          setSpecifications(data.specifications);
        }
        if (data.status === 'success' && data.found) {
          setRecommendedPrice(
            typeof data.recommendedPrice === 'number' ? data.recommendedPrice : null
          );
          setRecommendedPriceStats(data.priceStats || null);
          if (!product && !priceTouched && (formData.price === '' || formData.price === null || formData.price === undefined)) {
            // Prefill price only when ADDING a product and supplier hasn't typed a price yet
            if (typeof data.recommendedPrice === 'number' && Number.isFinite(data.recommendedPrice)) {
              setFormData(prev => ({ ...prev, price: String(Number(data.recommendedPrice).toFixed(2)) }));
            }
          }
        } else {
          setRecommendedPrice(null);
          setRecommendedPriceStats(null);
        }
      } catch (e) {
        // Silent fail: unit will remain user-selected
      }
    }, 350);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.name, formData.category, formData.brand]);

  // Keep category specification template aligned while typing (create + pending edit only).
  useEffect(() => {
    const category = String(formData.category || '').trim();
    const modelHint = String(formData.name || '').trim();
    if (!category) return;
    if (product && String(product.status || 'pending').toLowerCase() !== 'pending') return;

    const timeout = setTimeout(async () => {
      await loadCategorySpecifications(category, modelHint, {
        preserveExistingValues: true,
        brand: formData.brand
      });
    }, 350);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.name, formData.category, formData.brand, product?.status]);

  const getMissingMandatoryFields = () => {
    if (showInventoryFields) {
      return getSupplierInventoryUpdateMissingFields(formData);
    }

    // Only count successfully uploaded http(s) URLs — local previews must not unlock submit.
    const imageCount = countSupplierProductPhotos(formData.images);

    // Catalog create and catalog edit both require identity fields.
    return getSupplierCatalogMandatoryMissingFields(formData, {
      isCreate: !product,
      requireUnit: true,
      requirePhotos: !product,
      minPhotos: MIN_AI_PRODUCT_IMAGES,
      photoCount: imageCount
    });
  };

  const missingMandatoryFields = useMemo(
    () => getMissingMandatoryFields(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      showInventoryFields,
      product,
      formData.name,
      formData.brand,
      formData.category,
      formData.unit,
      formData.price,
      formData.stock,
      formData.sgst_rate,
      formData.cgst_rate,
      formData.igst_rate,
      formData.images,
      productAiImages
    ]
  );

  const uploadedPhotoCount = countSupplierProductPhotos(formData.images);
  const stagedPhotoCount = productAiImages.filter((item) => item.uploadedUrl).length;
  const photosRequirementMet = product
    ? true
    : uploadedPhotoCount >= MIN_AI_PRODUCT_IMAGES;
  const photosMissingFromMandatory = missingMandatoryFields.some((field) =>
    /product photos/i.test(String(field || ''))
  );

  const brandApprovalWarning =
    !showInventoryFields && formData.brand
      ? getBrandApprovalWarning(
          brandApprovalState.status,
          brandApprovalState.brandName || formData.brand,
          brandApprovalState.message
        )
      : null;
  const brandApprovalBlocksSubmit =
    !showInventoryFields &&
    !product &&
    Boolean(String(formData.brand || '').trim()) &&
    (brandApprovalState.loading ||
      !isBrandApprovedForProductSubmit(brandApprovalState.status));

  const unitCompatibility = useMemo(
    () =>
      validateProductUnitCompatibility({
        unit: formData.unit,
        productName: formData.name,
        category: formData.category
      }),
    [formData.unit, formData.name, formData.category]
  );
  const unitCompatibilityBlocksSubmit =
    !showInventoryFields && unitCompatibility.severity === 'error';

  const isAddOrInventorySubmitBlocked =
    missingMandatoryFields.length > 0 ||
    brandApprovalBlocksSubmit ||
    unitCompatibilityBlocksSubmit;

  useEffect(() => {
    if (!isAddOrInventorySubmitBlocked) {
      setFormValidationError('');
      setShowMissingHints(false);
    }
  }, [isAddOrInventorySubmitBlocked]);

  const getStagedProductPhotoUrls = () =>
    productAiImagesRef.current.map((item) => item.uploadedUrl).filter(Boolean);

  const syncPhotosAttachedState = (urls = []) => {
    setPhotosAttachedForProduct(countSupplierProductPhotos(urls) >= MIN_AI_PRODUCT_IMAGES);
  };

  const attachStagedPhotosAsProductImages = ({ showAlertOnFailure = true } = {}) => {
    const urls = getStagedProductPhotoUrls();
    if (urls.length < MIN_AI_PRODUCT_IMAGES) {
      if (showAlertOnFailure) {
        alert(formatMissingProductPhotosMessage(urls.length, MIN_AI_PRODUCT_IMAGES));
      }
      return false;
    }
    setFormData((prev) => ({
      ...prev,
      images: urls
    }));
    syncPhotosAttachedState(urls);
    setFormValidationError('');
    setShowMissingHints(false);
    return true;
  };

  const handleUsePhotosAsProductIdentification = () => {
    if (attachStagedPhotosAsProductImages()) {
      productPhotosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const analyzeImagesFromFiles = async (files) => {
    if (!files || files.length < MIN_AI_PRODUCT_IMAGES) {
      alert(
        `Please add at least ${MIN_AI_PRODUCT_IMAGES} product photos (e.g. front, side, label) so AI can identify the product reliably.`
      );
      return;
    }

    if (!attachStagedPhotosAsProductImages({ showAlertOnFailure: false })) {
      alert(formatMissingProductPhotosMessage(getStagedProductPhotoUrls().length, MIN_AI_PRODUCT_IMAGES));
      return;
    }

    setAnalyzingImage(true);
    try {
      const images = await Promise.all(files.map((f) => fileToImagePart(f)));
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/products/analyze-image'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          images,
          provider: 'gemini'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'success') {
        const review = data.review || null;
        const highConfidence = review?.accepted || {};
        const lowConfidence = review?.suggestions || {};
        const mergedSuggestions = { ...lowConfidence };
        for (const [key, value] of Object.entries(highConfidence)) {
          const trimmed = String(value || '').trim();
          if (trimmed) mergedSuggestions[key] = trimmed;
        }
        const reviewForUi = review
          ? {
              ...review,
              suggestions: mergedSuggestions,
              accepted: {}
            }
          : null;
        setAiDetectionReview(reviewForUi);
        setAiAnalysisMeta(data.analysisMeta || null);
        openAiSuggestionPopupFromReview(reviewForUi, data.provider || 'gemini');
      } else {
        setAiDetectionReview(null);
        setAiAnalysisMeta(null);
        setAiSuggestionPopup((prev) => ({ ...prev, open: false, items: [], selected: {} }));
        alert(data.message || 'Failed to analyze images. Please try again.');
      }
    } catch (error) {
      console.error('Image analysis error:', error);
      setAiDetectionReview(null);
      setAiAnalysisMeta(null);
      setAiSuggestionPopup((prev) => ({ ...prev, open: false, items: [], selected: {} }));
      alert('Failed to analyze images. Please try again.');
    } finally {
      setAnalyzingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setSuggestions([]);
    setShowSuggestions(false);

    const missing = getMissingMandatoryFields();
    if (missing.length > 0) {
      setShowMissingHints(true);
      const photosMissing = missing.some((field) => /product photos/i.test(String(field || '')));
      const specsMissing = missing.some((field) => /^Specification:/i.test(String(field || '')));
      setFormValidationError(
        photosMissing && missing.length === 1
          ? formatMissingProductPhotosMessage(uploadedPhotoCount, MIN_AI_PRODUCT_IMAGES)
          : formatSupplierProductValidationMessage(missing)
      );
      const formEl = formRef.current;
      const scrollEl = formScrollRef.current;
      if (photosMissing && productPhotosSectionRef.current) {
        productPhotosSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (specsMissing && specificationsSectionRef.current) {
        specificationsSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (formEl) {
        const firstInvalid = formEl.querySelector(':invalid');
        if (firstInvalid && typeof firstInvalid.reportValidity === 'function') {
          firstInvalid.reportValidity();
          firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          (scrollEl || formEl).scrollTo?.({ top: 0, behavior: 'smooth' });
        }
      }
      return;
    }

    if (brandApprovalBlocksSubmit) {
      setShowMissingHints(true);
      const warning =
        brandApprovalWarning ||
        getBrandApprovalWarning(
          brandApprovalState.status || 'unregistered',
          formData.brand,
          brandApprovalState.message
        );
      setFormValidationError(
        warning
          ? `${warning.title}. ${warning.message}`
          : 'Brand approval is required before submitting this product.'
      );
      brandFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (unitCompatibilityBlocksSubmit) {
      setShowMissingHints(true);
      setFormValidationError(unitCompatibility.message);
      unitInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      unitInputRef.current?.focus?.();
      return;
    }

    if (approvedNeedsSpecFill || categorySpecFillRequired) {
      const templateKeys = categorySpecFillRequired
        ? adminSpecTemplateKeys
        : product?.catalogSpecificationKeys ||
          adminSpecTemplateKeys ||
          Object.keys(product?.specifications || {});
      const specMissing = getSupplierSpecificationTemplateMissingFields(
        templateKeys,
        specifications
      );
      if (specMissing.length > 0) {
        setShowMissingHints(true);
        setFormValidationError(formatSupplierProductValidationMessage(specMissing));
        specificationsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    // Final guard: never submit create with fewer than the required uploaded photos.
    if (!product) {
      const resolvedImages =
        countSupplierProductPhotos(formData.images) >= MIN_AI_PRODUCT_IMAGES
          ? formData.images
          : getStagedProductPhotoUrls();
      const finalPhotoCount = countSupplierProductPhotos(resolvedImages);
      if (finalPhotoCount < MIN_AI_PRODUCT_IMAGES) {
        setShowMissingHints(true);
        setFormValidationError(
          formatMissingProductPhotosMessage(finalPhotoCount, MIN_AI_PRODUCT_IMAGES)
        );
        productPhotosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    setFormValidationError('');
    setShowMissingHints(false);

    // Include ALL specifications in the product data (both predefined and dynamic from AI)
    // IMPORTANT: Keep ALL keys even if values are null/empty - admin needs to see all AI-generated keys
    const allSpecifications = { ...specifications };
    
    // Keep ALL specification keys, even if they have null/empty values
    // This allows admin to see what keys were generated by AI and fill them in
    // Only remove keys that are completely undefined
    Object.keys(allSpecifications).forEach(key => {
      const value = allSpecifications[key];
      // Only remove if completely undefined
      if (value === undefined) {
        delete allSpecifications[key];
      }
      // Keep null, empty string, and empty arrays - they show keys that need values
    });
    
    const resolvedCreateImages = !product
      ? countSupplierProductPhotos(formData.images) >= MIN_AI_PRODUCT_IMAGES
        ? formData.images
        : getStagedProductPhotoUrls()
      : Array.isArray(formData.images)
        ? formData.images
        : [];

    const productData = {
      ...formData,
      // Add flow: photos attached for listing, or staged uploads if supplier skipped the attach button.
      // Edit flow: only images currently in the form (offer photos, not catalog history).
      images: !product ? resolvedCreateImages : Array.isArray(formData.images) ? formData.images : [],
      specifications: allSpecifications
    };

    // When adding a new product (Manage Products), include all fields including inventory
    // When editing in Manage Inventory, include inventory fields
    // Inventory edit: stock, price, tax, location only — never specifications
    if (showInventoryFields && product) {
      delete productData.specifications;
      if (mrpLocked) {
        productData.price = parseSupplierOfferPrice(product.price);
      }
    }

    // Catalog view (Manage Products): never persist inventory fields here.
    // Stock/MRP/location are completed in Manage Inventory (step 2).
    if (!showInventoryFields) {
      delete productData.price;
      delete productData.stock;
      delete productData.location;
      delete productData.igst_rate;
      delete productData.cgst_rate;
      delete productData.sgst_rate;
      delete productData.lsa;
      if (!approvedNeedsSpecFill && !categorySpecFillRequired) {
        delete productData.specifications;
      }
      // Keep unit on create and edit so incompatible units (e.g. bags for a mouse) can be corrected.
    }

    setIsSaving(true);
    try {
      await Promise.resolve(onSave(productData));
    } finally {
      setIsSaving(false);
    }
  };

  // Fetch categories, units, and locations on mount
  useEffect(() => {
    fetchCategories();
    fetchUnits();
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/locations'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setLocations(data.locations || []);
        // If editing and location exists, try to match it to a profile location
        if (product?.location && data.locations.length > 0) {
          const matchedLocation = data.locations.find(loc => 
            loc.fullText === product.location || 
            loc.displayText === product.location ||
            loc.address === product.location
          );
          if (matchedLocation) {
            setFormData(prev => ({
              ...prev,
              location: matchedLocation.fullText || matchedLocation.displayText
            }));
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch locations:', error);
    }
  };

  // Initialize category and unit suggestions when data is loaded
  useEffect(() => {
    if (categories.length > 0 && formData.category) {
      const filtered = categories.filter(cat => 
        cat.name.toLowerCase() === formData.category.toLowerCase() ||
        (cat.displayName || cat.name).toLowerCase().includes(formData.category.toLowerCase())
      );
      setCategorySuggestions(filtered.length > 0 ? filtered : categories);
    } else if (categories.length > 0) {
      setCategorySuggestions(categories);
    }
  }, [categories, formData.category]);

  // Auto-load category specification keys when category changes (new products + pending edits).
  useEffect(() => {
    if (product && String(product.status || 'pending').toLowerCase() !== 'pending') {
      previousCategoryRef.current = formData.category;
      return;
    }

    // Get current category.
    const currentCategory = formData.category ? formData.category.trim().toLowerCase() : '';
    const previousCategory = previousCategoryRef.current
      ? previousCategoryRef.current.trim().toLowerCase()
      : null;

    // On initial modal open for an existing (pending) product, keep its current specs.
    // We only want to clear/reload specs after a real user category change.
    if (product && previousCategory === null) {
      previousCategoryRef.current = formData.category;
      return;
    }

    if (!currentCategory) {
      previousCategoryRef.current = formData.category;
      setSpecifications({});
      setHasAdminSpecTemplate(false);
      setAdminSpecTemplateKeys([]);
      return;
    }

    // Wait for the categories list so we can resolve the canonical category name.
    // Do not advance previousCategoryRef yet — otherwise specs never load when the
    // category was set (e.g. by AI) before categories finished fetching.
    if (categories.length === 0) {
      return;
    }

    // Only proceed if category actually changed
    if (currentCategory === previousCategory) {
      return;
    }

    previousCategoryRef.current = formData.category;

    const matchedCategory = categories.find(
      (cat) =>
        cat.name.toLowerCase() === currentCategory ||
        (cat.displayName || cat.name).toLowerCase() === currentCategory
    );

    if (matchedCategory) {
      const modelHint = String(formData?.name || '').trim();
      const preserveExistingValues = preserveSpecsOnNextCategoryLoadRef.current;
      preserveSpecsOnNextCategoryLoadRef.current = false;
      loadCategorySpecifications(matchedCategory.name, modelHint, { preserveExistingValues });
    } else {
      setSpecifications({});
      setHasAdminSpecTemplate(false);
      setAdminSpecTemplateKeys([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.category, categories, product]);

  useEffect(() => {
    if (units.length > 0 && formData.unit) {
      const filtered = units.filter(unit => 
        unit.name.toLowerCase() === formData.unit.toLowerCase() ||
        (unit.displayName || unit.name).toLowerCase().includes(formData.unit.toLowerCase())
      );
      setUnitSuggestions(filtered.length > 0 ? filtered : units);
    } else if (units.length > 0) {
      setUnitSuggestions(units);
    }
  }, [units, formData.unit]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTimeout]);

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/categories'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchUnits = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/units'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setUnits(data.units || []);
      }
    } catch (error) {
      console.error('Failed to fetch units:', error);
    }
  };

  // Load specifications by category + optional model.
  // If model profile exists in Supabase, it is returned; otherwise category defaults are returned.
  const loadCategorySpecifications = async (categoryName, modelValue = '', options = {}) => {
    const preserveExistingValues = options.preserveExistingValues !== false;
    const brandValue = String(options.brand ?? formData?.brand ?? '').trim();
    const status = product ? String(product.status || 'pending').toLowerCase() : 'pending';
    // Category templates apply on create and pending edit — not after approval.
    if (product && status !== 'pending') {
      return;
    }

    // Snapshot existing specs before clear (only when preserving values).
    const existingSpecsSnapshot = (() => {
      if (!preserveExistingValues) return {};
      if (
        selectedSuggestionSpecsRef.current &&
        typeof selectedSuggestionSpecsRef.current === 'object' &&
        !Array.isArray(selectedSuggestionSpecsRef.current)
      ) {
        return { ...selectedSuggestionSpecsRef.current };
      }
      if (specifications && typeof specifications === 'object' && !Array.isArray(specifications)) {
        return { ...specifications };
      }
      return {};
    })();

    if (!categoryName || !categoryName.trim()) {
      setSpecifications({});
      setHasAdminSpecTemplate(false);
      setAdminSpecTemplateKeys([]);
      return;
    }

    const normalizedCategoryName = categoryName.trim().toLowerCase();
    const normalizedModel = String(modelValue || '').trim();
    const requestId = `${normalizedCategoryName}::${normalizedModel}::${brandValue}::${Date.now()}`;
    loadCategorySpecsRequestRef.current = requestId;

    setLoadingSpecs(true);

    try {
      const token = localStorage.getItem('token');
      const queryParams = new URLSearchParams();
      queryParams.set('keysOnly', '1');
      if (normalizedModel) queryParams.set('model', normalizedModel);
      if (brandValue) queryParams.set('brand', brandValue);
      const modelQuery = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const apiUrl = getApiUrl(
        `/api/supplier/categories/${encodeURIComponent(normalizedCategoryName)}/specifications${modelQuery}`
      );

      const resp = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: 'no-cache'
      });

      // Ignore stale responses from overlapping category/name loads.
      if (loadCategorySpecsRequestRef.current !== requestId) {
        return;
      }

      if (resp.ok) {
        const data = await resp.json();

        if (data.status === 'success') {
          const specsObj = data.specifications || {};
          const specKeys = Object.keys(specsObj);

          if (specKeys.length > 0) {
            setHasAdminSpecTemplate(true);
            setAdminSpecTemplateKeys(specKeys);
            const newSpecs = {};
            specKeys.forEach((k) => {
              if (preserveExistingValues && Object.prototype.hasOwnProperty.call(existingSpecsSnapshot, k)) {
                const existingValue = existingSpecsSnapshot[k];
                const existingFilled =
                  existingValue !== null &&
                  existingValue !== undefined &&
                  String(existingValue).trim() !== '';
                newSpecs[k] = existingFilled ? existingValue : '';
              } else {
                newSpecs[k] = '';
              }
            });
            // Keep any supplier-added keys that are not in the template.
            if (preserveExistingValues) {
              Object.keys(existingSpecsSnapshot).forEach((k) => {
                if (!Object.prototype.hasOwnProperty.call(newSpecs, k)) {
                  newSpecs[k] = existingSpecsSnapshot[k];
                }
              });
            }
            setSpecifications(newSpecs);
          } else if (!preserveExistingValues) {
            setSpecifications({});
            setHasAdminSpecTemplate(false);
            setAdminSpecTemplateKeys([]);
          }
          selectedSuggestionSpecsRef.current = null;
        } else if (!preserveExistingValues) {
          setSpecifications({});
          setHasAdminSpecTemplate(false);
          setAdminSpecTemplateKeys([]);
          selectedSuggestionSpecsRef.current = null;
        }
      } else if (resp.status === 404) {
        if (!preserveExistingValues) {
          setSpecifications({});
          setHasAdminSpecTemplate(false);
          setAdminSpecTemplateKeys([]);
          selectedSuggestionSpecsRef.current = null;
        }
      } else {
        console.error('Failed to load specifications:', resp.status, resp.statusText);
        if (!preserveExistingValues) {
          setSpecifications({});
        }
      }
    } catch (err) {
      console.error('Failed to load specifications:', normalizedCategoryName, normalizedModel, err);
      if (!preserveExistingValues) {
        setSpecifications({});
        selectedSuggestionSpecsRef.current = null;
      }
    } finally {
      if (loadCategorySpecsRequestRef.current === requestId) {
        setLoadingSpecs(false);
      }
    }
  };

  const CATEGORY_OTHER_VALUE = '__other_category__';

  const resolveMatchedCategory = (rawValue = formData.category) => {
    const value = String(rawValue || '').trim().toLowerCase();
    if (!value) return null;
    return (
      categories.find(
        (cat) =>
          cat.name.toLowerCase() === value ||
          String(cat.displayName || cat.name)
            .toLowerCase()
            .trim() === value
      ) || null
    );
  };

  const matchedCategoryOption = resolveMatchedCategory();
  const categorySelectValue = matchedCategoryOption
    ? matchedCategoryOption.name
    : productType === 'new_category' || String(formData.category || '').trim()
      ? CATEGORY_OTHER_VALUE
      : '';
  const showNewCategoryInput = categorySelectValue === CATEGORY_OTHER_VALUE;

  const handleCategoryDropdownChange = async (e) => {
    const value = e.target.value;

    if (value === '') {
      setProductType('existing_category');
      previousCategoryRef.current = null;
      setFormData((prev) => ({ ...prev, category: '' }));
      setSpecifications({});
      setHasAdminSpecTemplate(false);
      setAdminSpecTemplateKeys([]);
      return;
    }

    if (value === CATEGORY_OTHER_VALUE) {
      setProductType('new_category');
      previousCategoryRef.current = null;
      setFormData((prev) => ({ ...prev, category: '' }));
      setSpecifications({});
      setHasAdminSpecTemplate(false);
      setAdminSpecTemplateKeys([]);
      return;
    }

    setProductType('existing_category');
    const matched =
      categories.find((cat) => cat.name === value) ||
      resolveMatchedCategory(value) ||
      { name: value };
    await handleCategorySelect(matched);
  };

  const handleCategoryChange = async (e) => {
    const value = e.target.value;
    setFormData({ ...formData, category: value });

    // Filter categories based on input (legacy typeahead helpers / unit parity)
    if (value.trim().length > 0) {
      const filtered = categories.filter((cat) =>
        (cat.displayName || cat.name).toLowerCase().includes(value.toLowerCase())
      );
      setCategorySuggestions(filtered);
      setShowCategorySuggestions(true);
    } else {
      setCategorySuggestions(categories);
      setShowCategorySuggestions(true);
    }

    // If user manually types a category name that matches an existing category,
    // load specs for that category and current product/model hint.
    if (value.trim().length > 0 && (!product || (product && (product.status || 'pending') === 'pending'))) {
      const matchedCategory = resolveMatchedCategory(value);

      if (matchedCategory) {
        const modelHint = String(formData?.name || '').trim();
        await loadCategorySpecifications(matchedCategory.name, modelHint, {
          preserveExistingValues: false
        });
      } else {
        setSpecifications({});
      }
    } else if (!value.trim() && (!product || (product && (product.status || 'pending') === 'pending'))) {
      setSpecifications({});
    }
  };

  const handleCategorySelect = async (category) => {
    // Use the actual category name (lowercase) from the database, not displayName.
    const updatedCategory = category.name || category.displayName || category;
    
    // Reset previous category ref to ensure useEffect detects the change
    previousCategoryRef.current = null;
    
    // Update form data first - this will trigger the useEffect
    // Store the actual category name (lowercase) in formData.
    setFormData({...formData, category: updatedCategory});
    setShowCategorySuggestions(false);

    // ALWAYS load admin-defined specs for selected category + current model hint.
    const modelHint = String(formData?.name || '').trim();
    await loadCategorySpecifications(updatedCategory, modelHint, { preserveExistingValues: false });
  };

  const handleCategoryCreate = async () => {
    const categoryName = formData.category.trim();
    if (!categoryName) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/categories'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: categoryName })
      });
      const data = await response.json();
      if (data.status === 'success') {
        await fetchCategories();
        const createdCategoryName = data.category.name;
        setFormData({...formData, category: createdCategoryName});
        setShowCategorySuggestions(false);
        
        // Load admin-defined specs for this category (if any exist), with model hint.
        const modelHint = String(formData?.name || '').trim();
        await loadCategorySpecifications(createdCategoryName, modelHint, { preserveExistingValues: false });
      }
    } catch (error) {
      console.error('Failed to create category:', error);
    }
  };

  const handleUnitChange = (e) => {
    const value = e.target.value;
    setFormData({...formData, unit: value});

    const preferredNames = getPreferredUnitsForProduct({
      productName: formData.name,
      category: formData.category
    }).map((name) => name.toLowerCase());

    const rankUnit = (unit) => {
      const key = String(unit.name || '').toLowerCase();
      const display = String(unit.displayName || unit.name || '').toLowerCase();
      const preferredIndex = preferredNames.findIndex(
        (name) => key === name || display.includes(name)
      );
      return preferredIndex === -1 ? 100 : preferredIndex;
    };

    if (value.trim().length > 0) {
      const filtered = units
        .filter((unit) =>
          (unit.displayName || unit.name).toLowerCase().includes(value.toLowerCase())
        )
        .sort((a, b) => rankUnit(a) - rankUnit(b));
      setUnitSuggestions(filtered);
      setShowUnitSuggestions(true);
    } else {
      setUnitSuggestions([...units].sort((a, b) => rankUnit(a) - rankUnit(b)));
      setShowUnitSuggestions(true);
    }
  };

  const handleUnitSelect = async (unit) => {
    setFormData({...formData, unit: unit.name});
    setShowUnitSuggestions(false);
  };

  const handleUnitCreate = async () => {
    const unitName = formData.unit.trim();
    if (!unitName) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/units'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: unitName })
      });
      const data = await response.json();
      if (data.status === 'success') {
        await fetchUnits();
        setFormData({...formData, unit: data.unit.name});
        setShowUnitSuggestions(false);
      }
    } catch (error) {
      console.error('Failed to create unit:', error);
    }
  };


  // Extract specifications from description
  const fileToImagePart = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const str = String(reader.result);
        const match = str.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          resolve({
            data: match[2],
            mimeType: match[1] || file.type || 'image/jpeg'
          });
        } else {
          reject(new Error('Could not read image'));
        }
      };
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });

  const AI_FIELD_META = [
    { key: 'productName', label: 'Product Name' },
    { key: 'unit', label: 'Unit' },
    { key: 'brand', label: 'Brand' },
    { key: 'gtin', label: 'GTIN / UPC / EAN' },
    { key: 'category', label: 'Category' }
  ];

  const getManualFormValueForAiField = (data, fieldKey) => {
    if (fieldKey === 'productName') return String(data?.name || '').trim();
    return String(data?.[fieldKey] || '').trim();
  };

  const confirmReplaceManualAiField = (fieldKey, currentValue, candidateValue) => {
    const label = AI_FIELD_META.find((field) => field.key === fieldKey)?.label || fieldKey;
    return window.confirm(
      `Replace your ${label} "${currentValue}" with the AI suggestion "${candidateValue}"?`
    );
  };

  const openAiSuggestionPopupFromReview = (review, providerName) => {
    const suggestions = review?.suggestions || {};
    const fieldStatus = review?.fieldStatus || {};
    const confidence = review?.confidence || {};
    const threshold = Number(review?.confidenceThreshold ?? 0.8);
    // Include every AI candidate — high and low confidence. Nothing is written to the
    // form until the supplier explicitly applies a selection.
    const items = AI_FIELD_META
      .map((field) => {
        const value = String(suggestions[field.key] || '').trim();
        if (!value) return null;
        const status = fieldStatus?.[field.key] || {};
        const score = Number(confidence?.[field.key]);
        const confidenceValue = Number.isFinite(score) ? score : null;
        const currentValue = getManualFormValueForAiField(formData, field.key);
        const wouldReplace =
          Boolean(currentValue) &&
          currentValue.toLowerCase() !== value.toLowerCase();
        return {
          key: field.key,
          label: field.label,
          value,
          currentValue,
          wouldReplace,
          reason: String(status?.reason || '').trim() || '',
          confidence: confidenceValue,
          threshold
        };
      })
      .filter(Boolean);

    if (items.length === 0) return;

    // Never pre-select fields that would overwrite supplier-entered values.
    const selected = items.reduce((acc, item) => {
      acc[item.key] = !item.wouldReplace;
      return acc;
    }, {});

    setAiSuggestionPopup({
      open: true,
      providerName: providerName || 'AI',
      items,
      selected
    });
  };

  const applyAiSuggestionSelection = async () => {
    const selectedKeys = Object.entries(aiSuggestionPopup.selected || {})
      .filter(([, checked]) => checked)
      .map(([key]) => key);

    if (selectedKeys.length === 0) {
      setAiSuggestionPopup((prev) => ({ ...prev, open: false }));
      return;
    }

    const selectedItems = aiSuggestionPopup.items.filter((item) => selectedKeys.includes(item.key));
    const replacingItems = selectedItems.filter((item) => {
      const currentValue = getManualFormValueForAiField(formData, item.key);
      return (
        Boolean(currentValue) &&
        currentValue.toLowerCase() !== String(item.value || '').trim().toLowerCase()
      );
    });

    if (replacingItems.length > 0) {
      const summary = replacingItems
        .map((item) => {
          const currentValue = getManualFormValueForAiField(formData, item.key);
          return `• ${item.label}: "${currentValue}" → "${item.value}"`;
        })
        .join('\n');
      const confirmed = window.confirm(
        `AI will replace values you already entered:\n\n${summary}\n\nContinue?`
      );
      if (!confirmed) return;
    }

    const selectedMap = selectedItems.reduce((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});

    setFormData((prev) => ({
      ...prev,
      name: selectedMap.productName || prev.name,
      unit: selectedMap.unit || prev.unit,
      brand: selectedMap.brand || prev.brand,
      gtin: selectedMap.gtin || prev.gtin,
      category: selectedMap.category || prev.category
    }));

    setAiDetectionReview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        accepted: {
          ...(prev.accepted || {}),
          ...selectedMap
        }
      };
    });

    if (selectedMap.category) {
      setTimeout(async () => {
        await loadCategorySpecifications(
          selectedMap.category,
          selectedMap.productName || formData.name || '',
          { preserveExistingValues: true }
        );
      }, 100);
    }

    setAiSuggestionPopup((prev) => ({ ...prev, open: false }));
  };

  const getAiCandidateValueForField = (fieldKey) => {
    const suggested = String(aiDetectionReview?.suggestions?.[fieldKey] || '').trim();
    if (suggested) return suggested;
    const raw = String(aiDetectionReview?.raw?.[fieldKey] || '').trim();
    if (raw) return raw;
    return null;
  };

  const applySingleAiField = async (fieldKey) => {
    const candidate = getAiCandidateValueForField(fieldKey);
    if (!candidate) return;

    const currentValue = getManualFormValueForAiField(formData, fieldKey);
    if (
      currentValue &&
      currentValue.toLowerCase() !== candidate.toLowerCase() &&
      !confirmReplaceManualAiField(fieldKey, currentValue, candidate)
    ) {
      return;
    }

    const mappedKey =
      fieldKey === 'productName'
        ? 'name'
        : fieldKey;

    setFormData((prev) => ({
      ...prev,
      [mappedKey]: candidate
    }));

    if (fieldKey === 'category') {
      setTimeout(async () => {
        await loadCategorySpecifications(
          candidate,
          formData.name || '',
          { preserveExistingValues: true }
        );
      }, 100);
    }

    setAiDetectionReview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        accepted: {
          ...(prev.accepted || {}),
          [fieldKey]: candidate
        }
      };
    });
  };

  const handleImageUpload = async (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    const remainingSlots = MAX_AI_PRODUCT_IMAGES - productAiImagesRef.current.length;
    if (remainingSlots <= 0) {
      alert(`You can add at most ${MAX_AI_PRODUCT_IMAGES} images.`);
      return;
    }

    const filesToAdd = selectedFiles.slice(0, remainingSlots);
    if (selectedFiles.length > remainingSlots) {
      alert(
        `Only ${remainingSlots} more photo(s) allowed (max ${MAX_AI_PRODUCT_IMAGES}). Extra file(s) were skipped.`
      );
    }

    const validFiles = [];
    for (const file of filesToAdd) {
      if (!file.type.startsWith('image/')) {
        alert(`Skipped "${file.name}": not a valid image file.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`Skipped "${file.name}": must be less than 10MB.`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    setUploadingProductImage(true);
    try {
      const settled = await Promise.allSettled(
        validFiles.map(async (file) => {
          const uploadedUrl = await uploadProductImageToStorage(file);
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            previewUrl: URL.createObjectURL(file),
            uploadedUrl
          };
        })
      );

      const uploadResults = settled
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      const failedCount = settled.length - uploadResults.length;

      if (failedCount > 0) {
        alert(
          failedCount === settled.length
            ? 'Failed to upload images. Please try again.'
            : `${failedCount} image(s) failed to upload. The rest were added.`
        );
      }

      if (uploadResults.length === 0) return;

      // Stage uploads locally — attach to the product via the action buttons below.
      setProductAiImages((prev) => {
        const room = MAX_AI_PRODUCT_IMAGES - prev.length;
        const additions = uploadResults.slice(0, room);
        return [...prev, ...additions];
      });
      setPhotosAttachedForProduct(false);
    } catch (error) {
      alert(error.message || 'Failed to upload images');
    } finally {
      setUploadingProductImage(false);
    }
  };

  const uploadProductImageToStorage = async (file) => {
    const token = localStorage.getItem('token');
    const payload = new FormData();
    payload.append('image', file);
    if (product?.supplier_product_id || product?.id || product?._id) {
      payload.append('supplierProductId', product.supplier_product_id || product.id || product._id);
    }
    const response = await fetch(getApiUrl('/api/supplier/products/upload-image'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: payload
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'success' || !data.url) {
      throw new Error(data.message || 'Failed to upload image');
    }
    return data.url;
  };

  const handleProductImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image size should be less than 10MB');
      return;
    }

    setUploadingProductImage(true);
    try {
      const url = await uploadProductImageToStorage(file);
      setFormData((prev) => ({
        ...prev,
        images: Array.from(new Set([...(Array.isArray(prev.images) ? prev.images : []), url]))
      }));
    } catch (error) {
      alert(error.message || 'Failed to upload image');
    } finally {
      setUploadingProductImage(false);
    }
  };

  const removeProductImage = (url) => {
    setFormData((prev) => ({
      ...prev,
      images: (Array.isArray(prev.images) ? prev.images : []).filter((x) => x !== url)
    }));
  };

  const handleRemoveAiImage = (id) => {
    const target = productAiImagesRef.current.find((x) => x.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setProductAiImages((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (next.length === 0) {
        setAiDetectionReview(null);
        setAiSuggestionPopup((popup) => ({ ...popup, open: false, items: [], selected: {} }));
      }
      return next;
    });
    setFormData((prevForm) => {
      const nextImages = (Array.isArray(prevForm.images) ? prevForm.images : []).filter(
        (url) => url !== target?.uploadedUrl
      );
      syncPhotosAttachedState(nextImages);
      return { ...prevForm, images: nextImages };
    });
  };

  const handleClearAiImages = () => {
    setProductAiImages((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setAiDetectionReview(null);
    setAiSuggestionPopup((popup) => ({ ...popup, open: false, items: [], selected: {} }));
    setFormData((prev) => ({ ...prev, images: [] }));
    setPhotosAttachedForProduct(false);
  };

  const handleExtractSpecifications = async () => {
    if (!formData.description || !formData.description.trim()) {
      alert('Please enter a description with specification details first');
      return;
    }

    if (!formData.category || !formData.category.trim()) {
      alert('Please select a category first. Category is required to extract specifications.');
      return;
    }

    const sourceKey = buildSpecExtractionSourceKey({
      name: formData.name,
      category: formData.category,
      brand: formData.brand,
      description: formData.description
    });
    if (lastSuccessfulExtractionSourceKey && lastSuccessfulExtractionSourceKey === sourceKey) {
      return;
    }

    setExtracting(true);
    try {
      const { response, data } = await extractSpecificationsFromDescription({
        description: formData.description,
        category: formData.category,
        productName: formData.name,
        provider: aiProvider,
        existingSpecifications: specifications || {}
      });

      if (!response.ok && data?.status !== 'success' && data?.status !== 'warning') {
        throw new Error(data?.message || `HTTP error! status: ${response.status}`);
      }

      const result = applyExtractResultToSpecs(specifications || {}, data);
      if (!result.ok) {
        alert(`⚠️ ${result.warning || result.error}`);
        return;
      }

      if (result.categoryMismatchWarning) {
        alert(`⚠️ ${result.categoryMismatchWarning}`);
      }

      setSpecifications(result.merged);

      if (result.filledCount > 0) {
        setLastSuccessfulExtractionSourceKey(sourceKey);
        alert(
          result.filledCount === 1
            ? 'Specifications extracted successfully. 1 value was filled from the description.'
            : `Specifications extracted successfully. ${result.filledCount} values were filled from the description.`
        );
      } else {
        alert(
          'No specification values were found in the description. Try lines like "Finish: Matt" or "Volume: 20L".'
        );
      }
    } catch (error) {
      console.error('Extract specifications error:', error);
      alert('Failed to extract specifications. Please try again.');
    } finally {
      setExtracting(false);
    }
  };

  const currentSpecExtractionSourceKey = buildSpecExtractionSourceKey({
    name: formData.name,
    category: formData.category,
    brand: formData.brand,
    description: formData.description
  });
  const specsAlreadyExtractedForCurrentSource =
    Boolean(lastSuccessfulExtractionSourceKey) &&
    lastSuccessfulExtractionSourceKey === currentSpecExtractionSourceKey;

  const modalNode = (
    <div className="modal-overlay pm-product-modal-overlay">
      <div className="modal pm-product-modal">
        <div className="modal-header">
          <h3>{product ? 'Edit Product' : 'Add New Product'}</h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {showAdditionSteps && (
          <div className="pm-product-modal__steps">
            <SupplierProductAdditionSteps
              variant="add-product"
              compact
              hint="Step 1 of 3: catalog details only. Inventory and ProductCOV come next."
            />
          </div>
        )}
        
        <form ref={formRef} onSubmit={handleSubmit} className="modal-form pm-product-modal__form" noValidate>
          <div ref={formScrollRef} className="pm-product-modal__scroll">
          <div className="form-grid">
            {product && (
            <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: '1rem', order: !product ? 100 : 1 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <ImageIcon size={16} />
                Product images (stored in Supabase)
              </label>
              <div
                style={{
                  border: '2px dashed #d1d5db',
                  borderRadius: '8px',
                  padding: '1rem',
                  backgroundColor: '#f9fafb'
                }}
              >
                {(Array.isArray(formData.images) ? formData.images : []).length > 0 && (
                  <div style={{ marginBottom: '0.85rem' }}>
                    <ProductImageCarousel
                      images={Array.isArray(formData.images) ? formData.images : []}
                      alt={formData.name || 'Product'}
                      height={220}
                      rounded={10}
                    />
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  {(Array.isArray(formData.images) ? formData.images : []).map((url) => (
                    <div
                      key={url}
                      style={{
                        position: 'relative',
                        width: '100px',
                        height: '100px',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: '1px solid #e5e7eb',
                        background: '#fff'
                      }}
                    >
                      <img
                        src={url}
                        alt="Product"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8fafc' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeProductImage(url)}
                        style={{
                          position: 'absolute',
                          top: '4px',
                          right: '4px',
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '50%',
                          width: '22px',
                          height: '22px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <input
                    type="file"
                    accept="image/*"
                    id="product-persistent-image-upload"
                    onChange={handleProductImageUpload}
                    disabled={uploadingProductImage}
                    style={{ display: 'none' }}
                  />
                  <label
                    htmlFor="product-persistent-image-upload"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100px',
                      height: '100px',
                      border: '2px dashed #93c5fd',
                      borderRadius: '8px',
                      background: uploadingProductImage ? '#e5e7eb' : '#eff6ff',
                      color: uploadingProductImage ? '#6b7280' : '#2563eb',
                      cursor: uploadingProductImage ? 'not-allowed' : 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      textAlign: 'center',
                      padding: '0.5rem'
                    }}
                  >
                    {uploadingProductImage ? <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} /> : <>Add image</>}
                  </label>
                </div>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280' }}>
                  These images are saved in Supabase Storage and shown to buyers for easier product identification.
                </p>
              </div>
            </div>
            )}
            {/* Image Upload Section */}
            {!product && (
              <div
                className="form-group"
                ref={productPhotosSectionRef}
                style={{ gridColumn: '1 / -1', marginBottom: '1rem', order: -10 }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <ImageIcon size={16} />
                  Product photos (minimum {MIN_AI_PRODUCT_IMAGES} required)
                  <span style={{ color: '#dc2626', fontWeight: 700 }}>*</span>
                </label>
                <div
                  className={
                    !photosRequirementMet && (showMissingHints || photosMissingFromMandatory)
                      ? 'pm-photos-upload pm-photos-upload--error'
                      : 'pm-photos-upload'
                  }
                  style={{
                    border: `2px dashed ${
                      !photosRequirementMet && (showMissingHints || photosMissingFromMandatory)
                        ? '#f87171'
                        : photosRequirementMet
                          ? '#6ee7b7'
                          : '#d1d5db'
                    }`,
                    borderRadius: '8px',
                    padding: '1rem',
                    backgroundColor:
                      !photosRequirementMet && (showMissingHints || photosMissingFromMandatory)
                        ? '#fef2f2'
                        : '#f9fafb',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      alignItems: 'flex-start',
                      marginBottom: '0.75rem'
                    }}
                  >
                    {productAiImages.map((img) => (
                      <div
                        key={img.id}
                        style={{
                          position: 'relative',
                          width: '100px',
                          height: '100px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid #e5e7eb',
                          background: '#fff'
                        }}
                      >
                        <img
                          src={img.previewUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8fafc' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveAiImage(img.id)}
                          disabled={analyzingImage}
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '22px',
                            height: '22px',
                            cursor: analyzingImage ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {productAiImages.length < MAX_AI_PRODUCT_IMAGES && (
                      <>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageUpload}
                          disabled={analyzingImage || uploadingProductImage}
                          style={{ display: 'none' }}
                          id="product-image-upload"
                        />
                        <label
                          htmlFor="product-image-upload"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '100px',
                            height: '100px',
                            border: '2px dashed #93c5fd',
                            borderRadius: '8px',
                            background: analyzingImage || uploadingProductImage ? '#e5e7eb' : '#eff6ff',
                            color: analyzingImage || uploadingProductImage ? '#6b7280' : '#2563eb',
                            cursor: analyzingImage || uploadingProductImage ? 'not-allowed' : 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            textAlign: 'center',
                            padding: '0.5rem',
                            boxSizing: 'border-box'
                          }}
                        >
                          {analyzingImage || uploadingProductImage ? (
                            <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} />
                          ) : (
                            <>
                              <Upload size={20} style={{ marginBottom: '0.25rem' }} />
                              Add photos
                            </>
                          )}
                        </label>
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '0.5rem',
                      justifyContent: 'space-between'
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280', flex: '1 1 200px' }}>
                      Upload <strong>at least {MIN_AI_PRODUCT_IMAGES} photos</strong>, then either save them as
                      product identification photos or run optional AI analysis to pre-fill product details.
                    </p>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: photosRequirementMet ? '#059669' : '#b45309',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {uploadedPhotoCount} / {MIN_AI_PRODUCT_IMAGES} attached
                      {stagedPhotoCount > uploadedPhotoCount
                        ? ` · ${stagedPhotoCount} uploaded`
                        : ''}
                    </span>
                  </div>
                  {!photosRequirementMet ? (
                    <p
                      className={
                        showMissingHints || photosMissingFromMandatory
                          ? 'pm-photos-validation'
                          : 'pm-photos-validation-hint'
                      }
                      role={showMissingHints || photosMissingFromMandatory ? 'alert' : 'status'}
                      style={{
                        margin: '0.65rem 0 0',
                        fontSize: '0.8rem',
                        fontWeight: showMissingHints || photosMissingFromMandatory ? 600 : 500,
                        color:
                          showMissingHints || photosMissingFromMandatory ? '#991b1b' : '#92400e'
                      }}
                    >
                      {stagedPhotoCount >= MIN_AI_PRODUCT_IMAGES && uploadedPhotoCount < MIN_AI_PRODUCT_IMAGES
                        ? `${stagedPhotoCount} photo${stagedPhotoCount === 1 ? '' : 's'} uploaded. Click "Use as product identification photos" below, or analyze with AI first.`
                        : formatMissingProductPhotosMessage(
                            Math.max(uploadedPhotoCount, stagedPhotoCount),
                            MIN_AI_PRODUCT_IMAGES
                          )}
                    </p>
                  ) : photosAttachedForProduct && !aiDetectionReview ? (
                    <p
                      role="status"
                      style={{
                        margin: '0.65rem 0 0',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#047857'
                      }}
                    >
                      Product identification photos attached. You can submit the product or optionally run AI analysis
                      to pre-fill details.
                    </p>
                  ) : null}
                  {aiDetectionReview && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        border: '1px solid #d1fae5',
                        background: '#ecfdf5',
                        borderRadius: '8px',
                        padding: '0.65rem 0.75rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.5rem' }}>
                        <Sparkles size={14} color="#065f46" />
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#065f46' }}>
                          AI suggestions ready — nothing is filled in until you apply a value
                        </span>
                        {aiAnalysisMeta?.cacheHit ? (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              color: '#047857',
                              marginLeft: 'auto'
                            }}
                          >
                            Matched prior analysis for these photos
                          </span>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                        {[
                          { key: 'productName', label: 'Product Name' },
                          { key: 'unit', label: 'Unit' },
                          { key: 'brand', label: 'Brand' },
                          { key: 'gtin', label: 'GTIN / UPC / EAN' },
                          { key: 'category', label: 'Category' }
                        ].map((field) => {
                          const accepted = aiDetectionReview?.accepted?.[field.key];
                          const raw = aiDetectionReview?.raw?.[field.key];
                          const status = aiDetectionReview?.fieldStatus?.[field.key] || {};
                          const isAccepted = Boolean(accepted);
                          const candidateValue = getAiCandidateValueForField(field.key);
                          const currentValue = getManualFormValueForAiField(formData, field.key);
                          const wouldReplace =
                            Boolean(currentValue) &&
                            Boolean(candidateValue) &&
                            currentValue.toLowerCase() !== String(candidateValue).toLowerCase();
                          const canApply = !isAccepted && Boolean(candidateValue);
                          const score = Number(aiDetectionReview?.confidence?.[field.key]);
                          const confidenceValue = Number.isFinite(score) ? score : null;
                          const reason = String(status.reason || '').trim();
                          if (canApply) {
                            return (
                              <button
                                key={field.key}
                                type="button"
                                onClick={() => applySingleAiField(field.key)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.3rem',
                                  padding: '0.35rem 0.5rem',
                                  borderRadius: '999px',
                                  border: wouldReplace ? '1px solid #dc2626' : '1px solid #f59e0b',
                                  background: wouldReplace ? '#fef2f2' : '#fef3c7',
                                  color: wouldReplace ? '#991b1b' : '#92400e',
                                  fontSize: '0.73rem',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                                title={
                                  wouldReplace
                                    ? `You already entered "${currentValue}". Click to confirm replacing it with "${candidateValue}".`
                                    : `${reason || 'AI suggestion'} Click to apply this value to the form.`
                                }
                              >
                                <Ban size={12} />
                                {wouldReplace
                                  ? `${field.label}: keep "${currentValue}" or replace with "${candidateValue}"`
                                  : `${field.label}: ${candidateValue}${confidenceValue !== null ? ` ${Math.round(confidenceValue * 100)}%` : ''} — click to apply`}
                              </button>
                            );
                          }

                          return (
                            <span
                              key={field.key}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                                padding: '0.35rem 0.5rem',
                                borderRadius: '999px',
                                background: isAccepted ? '#dcfce7' : '#fef3c7',
                                color: isAccepted ? '#166534' : '#92400e',
                                fontSize: '0.73rem',
                                fontWeight: 600
                              }}
                              title={
                                reason ||
                                (isAccepted
                                  ? `Accepted (confidence ${confidenceValue !== null ? `${Math.round(confidenceValue * 100)}%` : 'n/a'})`
                                  : 'Below confidence threshold')
                              }
                            >
                              {isAccepted ? <CheckCircle size={12} /> : <Ban size={12} />}
                              {isAccepted
                                ? `${field.label}: applied — ${accepted}${confidenceValue !== null ? ` (${Math.round(confidenceValue * 100)}%)` : ''}`
                                : `${field.label}: no suggestion${raw ? ` (${raw})` : ''}${reason ? ` - ${reason}` : ''}`}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        analyzingImage ||
                        uploadingProductImage ||
                        productAiImages.length < MIN_AI_PRODUCT_IMAGES ||
                        (photosAttachedForProduct && uploadedPhotoCount >= MIN_AI_PRODUCT_IMAGES)
                      }
                      onClick={handleUsePhotosAsProductIdentification}
                    >
                      {photosAttachedForProduct && uploadedPhotoCount >= MIN_AI_PRODUCT_IMAGES
                        ? 'Product photos attached'
                        : 'Use as product identification photos'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={analyzingImage || uploadingProductImage || productAiImages.length < MIN_AI_PRODUCT_IMAGES}
                      onClick={() => analyzeImagesFromFiles(productAiImages.map((x) => x.file))}
                    >
                      {analyzingImage
                        ? 'Analyzing…'
                        : aiDetectionReview
                          ? 'Re-analyze photos with AI'
                          : 'Analyze photos with AI'}
                    </button>
                    {productAiImages.length > 0 && (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={analyzingImage || uploadingProductImage}
                        onClick={handleClearAiImages}
                      >
                        Clear all photos
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!showInventoryFields && (
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label>Product Name</label>
                <div className={`pm-suggest-anchor${showSuggestions ? ' is-open' : ''}`}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={formData.name}
                    onChange={handleNameChange}
                    placeholder='e.g. "Cement OPC", "TMT Steel Bar", "Red Clay Brick"'
                    onFocus={() => {
                      if (formData.name.trim().length > 0 && suggestions.length > 0) {
                        setShowSuggestions(true);
                      } else if (!product) {
                        // Show dropdown with options even when no suggestions or when field is empty
                        setShowSuggestions(true);
                      }
                    }}
                    onBlur={(e) => {
                      // Check if the blur is due to clicking on a suggestion
                      if (suggestionsRef.current && suggestionsRef.current.contains(e.relatedTarget)) {
                        return;
                      }
                      // Delay hiding suggestions to allow click on suggestion
                      setTimeout(() => {
                        if (!suggestionsRef.current || !suggestionsRef.current.contains(document.activeElement)) {
                          setShowSuggestions(false);
                        }
                      }, 200);
                    }}
                    required
                    autoComplete="off"
                    style={{ width: '100%' }}
                  />

                {showSuggestions && !product && (
                <div
                  ref={suggestionsRef}
                  className="pm-suggest-menu"
                  style={{ maxHeight: '400px' }}
                  onMouseDown={(e) => {
                    // Prevent input blur when clicking on dropdown
                    e.preventDefault();
                  }}
                >
                  {suggestions.map((suggestion, index) => (
                    <div
                      key={suggestion.id || index}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSuggestionClick(suggestion);
                      }}
                      style={{
                        padding: '0.875rem 1rem',
                        cursor: 'pointer',
                        borderBottom: '1px solid #f3f4f6',
                        transition: 'background-color 0.15s ease',
                        display: 'flex',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '0.75rem',
                        minHeight: 'auto',
                        width: '100%',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        wordBreak: 'break-word',
                        overflow: 'visible',
                        overflowWrap: 'break-word'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                        setHoveredSuggestionId(suggestion.id || `idx-${index}`);
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white';
                        setHoveredSuggestionId(null);
                      }}
                    >
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ 
                          fontWeight: '500', 
                          color: '#1e293b',
                          fontSize: '0.9375rem',
                          overflow: 'visible',
                          textOverflow: 'clip',
                          whiteSpace: 'normal',
                          wordWrap: 'break-word',
                          wordBreak: 'break-word',
                          overflowWrap: 'break-word',
                          lineHeight: '1.5',
                          width: '100%',
                          maxWidth: 'none',
                          paddingRight: '0.5rem',
                          display: 'block',
                          boxSizing: 'border-box'
                        }}>
                          {suggestion.name}
                        </div>
                        <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#64748b' }}>
                          {(suggestion.brand || '-')} • {(suggestion.unit || '-')}
                        </div>
                        {hoveredSuggestionId === (suggestion.id || `idx-${index}`) && (
                          <div
                            style={{
                              marginTop: '0.5rem',
                              padding: '0.625rem',
                              borderRadius: '8px',
                              border: '1px solid #e2e8f0',
                              background: '#f8fafc',
                              fontSize: '0.75rem',
                              color: '#334155',
                              display: 'grid',
                              gap: '0.25rem'
                            }}
                          >
                            <div><strong>Brand:</strong> {suggestion.brand || '-'}</div>
                            <div><strong>Category:</strong> {suggestion.category || '-'}</div>
                            <div><strong>Unit:</strong> {suggestion.unit || '-'}</div>
                            <div><strong>GTIN:</strong> {suggestion.gtin || '-'}</div>
                            <div><strong>Barcode:</strong> {suggestion.barcode || '-'}</div>
                            <div><strong>Description:</strong> {suggestion.description || '-'}</div>
                          </div>
                        )}
                      </div>
                      {suggestion.category && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: '#475569',
                          background: '#f1f5f9',
                          padding: '0.375rem 0.625rem',
                          borderRadius: '6px',
                          textTransform: 'capitalize',
                          fontWeight: '500',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          alignSelf: 'flex-start',
                          marginTop: '0.125rem'
                        }}>
                          {suggestion.category}
                        </span>
                      )}
                    </div>
                  ))}
                  {!product && (
                    <>
                      {suggestions.length > 0 && (
                        <div style={{
                          height: '1px',
                          background: '#e5e7eb',
                          margin: '0.5rem 0'
                        }} />
                      )}
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setProductType('existing_category');
                          setShowSuggestions(false);
                        }}
                        style={{
                          padding: '0.875rem 1rem',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f3f4f6',
                          background: productType === 'existing_category' ? '#f0f9ff' : 'white',
                          color: productType === 'existing_category' ? '#0369a1' : '#1e293b',
                          fontWeight: productType === 'existing_category' ? '600' : '500',
                          transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (productType !== 'existing_category') {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (productType !== 'existing_category') {
                            e.currentTarget.style.backgroundColor = productType === 'existing_category' ? '#f0f9ff' : 'white';
                          }
                        }}
                      >
                        Add new product in existing category
                      </div>
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setProductType('new_category');
                          setShowSuggestions(false);
                        }}
                        style={{
                          padding: '0.875rem 1rem',
                          cursor: 'pointer',
                          background: productType === 'new_category' ? '#f0f9ff' : 'white',
                          color: productType === 'new_category' ? '#0369a1' : '#1e293b',
                          fontWeight: productType === 'new_category' ? '600' : '500',
                          transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (productType !== 'new_category') {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (productType !== 'new_category') {
                            e.currentTarget.style.backgroundColor = productType === 'new_category' ? '#f0f9ff' : 'white';
                          }
                        }}
                      >
                        Add new product and new category
                      </div>
                    </>
                  )}
                </div>
                )}

                {showSuggestions && product && suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="pm-suggest-menu"
                  style={{ maxHeight: '400px' }}
                  onMouseDown={(e) => {
                    // Prevent input blur when clicking on dropdown
                    e.preventDefault();
                  }}
                >
                  {suggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSuggestionClick(suggestion);
                      }}
                      style={{
                        padding: '0.875rem 1rem',
                        cursor: 'pointer',
                        borderBottom: index < suggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                        transition: 'background-color 0.15s ease',
                        display: 'flex',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '0.75rem',
                        minHeight: 'auto',
                        width: '100%',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        wordBreak: 'break-word',
                        overflow: 'visible',
                        overflowWrap: 'break-word'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white';
                      }}
                    >
                      <div style={{ 
                        fontWeight: '500', 
                        color: '#1e293b',
                        fontSize: '0.9375rem',
                        flex: '1 1 auto',
                        overflow: 'visible',
                        textOverflow: 'clip',
                        whiteSpace: 'normal',
                        wordWrap: 'break-word',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                        lineHeight: '1.5',
                        minWidth: 0,
                        width: '100%',
                        maxWidth: 'none',
                        paddingRight: '0.5rem',
                        display: 'block',
                        boxSizing: 'border-box'
                      }}>
                        {suggestion.name}
                      </div>
                      {suggestion.category && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: '#475569',
                          background: '#f1f5f9',
                          padding: '0.375rem 0.625rem',
                          borderRadius: '6px',
                          textTransform: 'capitalize',
                          fontWeight: '500',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          alignSelf: 'flex-start',
                          marginTop: '0.125rem'
                        }}>
                          {suggestion.category}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                )}
                </div>

                <div style={{ marginTop: '0.9rem' }} ref={brandFieldRef}>
                  <label style={{ display: 'block', marginBottom: '0.35rem' }}>
                    Brand
                  </label>
                  <BrandSelect
                    value={formData.brand}
                    onChange={(brand) => setFormData((prev) => ({ ...prev, brand }))}
                    disabled={!!product && Boolean(String(formData.brand || '').trim())}
                    required
                    searchable
                    allowOther={false}
                  />
                  {brandApprovalState.loading && String(formData.brand || '').trim() ? (
                    <p className="pm-brand-approval-warning" role="status" style={{ borderColor: '#cbd5e1', background: '#f8fafc', color: '#475569' }}>
                      Checking brand approval status…
                    </p>
                  ) : null}
                  {!brandApprovalState.loading && brandApprovalWarning ? (
                    <div
                      className={`pm-brand-approval-warning${
                        brandApprovalWarning.tone === 'danger' ? ' pm-brand-approval-warning--danger' : ''
                      }`}
                      role="alert"
                    >
                      <span className="pm-brand-approval-warning__title">
                        {brandApprovalWarning.title}
                      </span>
                      {brandApprovalWarning.message}
                      <div style={{ marginTop: '0.35rem' }}>
                        Open <strong>Select yourself</strong> to request or track brand approval before submitting products.
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ marginTop: '0.9rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.35rem' }}>
                    GTIN / UPC / EAN
                  </label>
                  <input
                    type="text"
                    value={formData.gtin}
                    onChange={(e) => setFormData({ ...formData, gtin: e.target.value.replace(/\s+/g, '') })}
                    placeholder='8/12/13/14 digit code'
                    inputMode="numeric"
                    autoComplete="off"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}

            {!showInventoryFields && (
              <div className="form-group" style={{ 
                opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                transition: 'opacity 0.2s ease',
                zIndex: showCategorySuggestions ? 1 : (showUnitSuggestions ? 1000 : 'auto')
              }}>
                <label>Unit</label>
                <div className={`pm-suggest-anchor${showUnitSuggestions ? ' is-open' : ''}`}>
                  <input
                    ref={unitInputRef}
                    type="text"
                    value={formData.unit}
                    onChange={handleUnitChange}
                    onFocus={() => {
                      if (units.length > 0) {
                        const preferredNames = getPreferredUnitsForProduct({
                          productName: formData.name,
                          category: formData.category
                        }).map((name) => name.toLowerCase());
                        const ranked = [...units].sort((a, b) => {
                          const score = (unit) => {
                            const key = String(unit.name || '').toLowerCase();
                            const display = String(unit.displayName || unit.name || '').toLowerCase();
                            const idx = preferredNames.findIndex(
                              (name) => key === name || display.includes(name)
                            );
                            return idx === -1 ? 100 : idx;
                          };
                          return score(a) - score(b);
                        });
                        setUnitSuggestions(ranked);
                        setShowUnitSuggestions(true);
                      }
                    }}
                    onBlur={(e) => {
                      if (unitSuggestionsRef.current && unitSuggestionsRef.current.contains(e.relatedTarget)) {
                        return;
                      }
                      setTimeout(() => {
                        if (!unitSuggestionsRef.current || !unitSuggestionsRef.current.contains(document.activeElement)) {
                          setShowUnitSuggestions(false);
                        }
                      }, 200);
                    }}
                    placeholder="e.g. Piece, Unit, Nos"
                    required
                    autoComplete="off"
                    aria-invalid={unitCompatibility.severity === 'error'}
                    style={{
                      width: '100%',
                      borderColor:
                        unitCompatibility.severity === 'error'
                          ? '#dc2626'
                          : unitCompatibility.severity === 'warning'
                            ? '#d97706'
                            : undefined
                    }}
                  />
                  {showUnitSuggestions && (
                    <div
                      ref={unitSuggestionsRef}
                      className="pm-suggest-menu"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {unitSuggestions.length > 0 ? (
                        unitSuggestions.map((unit, index) => (
                          <div
                            key={index}
                            className="pm-suggest-menu__item"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleUnitSelect(unit);
                            }}
                          >
                            {unit.displayName || unit.name}
                          </div>
                        ))
                      ) : (
                        <div className="pm-suggest-menu__empty">
                          No matching units
                        </div>
                      )}
                      {formData.unit.trim() && !unitSuggestions.some(unit => unit.name.toLowerCase() === formData.unit.trim().toLowerCase()) && (
                        <div
                          className="pm-suggest-menu__create"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleUnitCreate();
                          }}
                        >
                          <Plus size={16} />
                          Create "{formData.unit.trim()}"
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {unitCompatibility.severity !== 'none' ? (
                  <p
                    role={unitCompatibility.severity === 'error' ? 'alert' : 'status'}
                    style={{
                      margin: '0.4rem 0 0',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: unitCompatibility.severity === 'error' ? '#b91c1c' : '#b45309'
                    }}
                  >
                    {unitCompatibility.message}
                    {Array.isArray(unitCompatibility.suggestedUnits) &&
                    unitCompatibility.suggestedUnits.length > 0 ? (
                      <span style={{ display: 'block', marginTop: '0.25rem', fontWeight: 500 }}>
                        Quick pick:{' '}
                        {unitCompatibility.suggestedUnits.slice(0, 3).map((suggested, index) => (
                          <button
                            key={suggested}
                            type="button"
                            onClick={() => setFormData((prev) => ({ ...prev, unit: suggested }))}
                            style={{
                              marginLeft: index === 0 ? 0 : '0.35rem',
                              border: '1px solid currentColor',
                              background: 'transparent',
                              borderRadius: '999px',
                              padding: '0.1rem 0.45rem',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: 'inherit'
                            }}
                          >
                            {suggested}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                    Choose a sell unit that matches the product (for electronics use Piece / Unit / Nos, not bags).
                  </p>
                )}
              </div>
            )}
            
            {!showInventoryFields && (
              <div
                className="form-group"
                style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease',
                  zIndex: 1
                }}
              >
                <label htmlFor="pm-category-select">Category *</label>
                <select
                  id="pm-category-select"
                  className="pm-category-select"
                  value={categorySelectValue}
                  onChange={handleCategoryDropdownChange}
                  required={!showNewCategoryInput}
                  aria-label="Select category"
                >
                  <option value="">Select category…</option>
                  {categories.map((cat) => (
                    <option key={cat.name || cat.displayName} value={cat.name}>
                      {cat.displayName || cat.name}
                    </option>
                  ))}
                  <option value={CATEGORY_OTHER_VALUE}>Other / create new category…</option>
                </select>
                {showNewCategoryInput ? (
                  <div className="pm-category-other">
                    <input
                      type="text"
                      value={formData.category}
                      onChange={handleCategoryChange}
                      placeholder="Enter new category name"
                      required
                      autoComplete="off"
                      aria-label="New category name"
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCategoryCreate}
                      disabled={!String(formData.category || '').trim()}
                    >
                      <Plus size={16} />
                      Create category
                    </button>
                  </div>
                ) : null}
                <p className="pm-category-hint">
                  Open the list to scroll through all available categories.
                </p>
              </div>
            )}
            
            {showInventoryFields && (
              <>
                <div className="form-group" style={{ 
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease',
                  position: 'relative',
                  zIndex: showCategorySuggestions ? 1 : 'auto'
                }}>
                  <label>{SUPPLIER_MRP_FIELD_LABEL}</label>
                  <RupeeInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => {
                      if (mrpLocked) return;
                      setPriceTouched(true);
                      setFormData({...formData, price: e.target.value});
                    }}
                    disabled={mrpLocked}
                    required
                  />
                  {mrpLocked ? (
                    <p className="pm-category-hint" style={{ marginTop: '0.35rem', color: '#64748b' }}>
                      {SUPPLIER_MRP_LOCKED_MESSAGE}
                    </p>
                  ) : null}
                  {!mrpLocked && typeof recommendedPrice === 'number' && Number.isFinite(recommendedPrice) && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: '#0369a1' }}>
                      Recommended avg {SUPPLIER_MRP_LABEL}: <strong>{formatRupee(recommendedPrice, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                      {recommendedPriceStats?.supplierCountOthers > 0 && (
                        <span style={{ color: '#64748b' }}>
                          {' '}({recommendedPriceStats.supplierCountOthers} other supplier{recommendedPriceStats.supplierCountOthers > 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="form-group" style={{ 
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>{SUPPLIER_CURRENT_STOCK_LABEL}</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={formData.stock}
                    onChange={(e) => setFormData({...formData, stock: e.target.value})}
                    required
                  />
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>HSN Code (for exact GST)</label>
                  <input
                    type="text"
                    value={formData.hsnCode}
                    onChange={(e) => setFormData({ ...formData, hsnCode: e.target.value })}
                    placeholder="e.g. 7214, 2523, 2505"
                  />
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>SGST</label>
                  <select
                    value={formData.sgst_rate}
                    onChange={(e) => setFormData({ ...formData, sgst_rate: e.target.value })}
                    required
                  >
                    <option value="">Select SGST rate</option>
                    {CGST_SGST_OPTIONS.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>CGST</label>
                  <select
                    value={formData.cgst_rate}
                    onChange={(e) => setFormData({ ...formData, cgst_rate: e.target.value })}
                    required
                  >
                    <option value="">Select CGST rate</option>
                    {CGST_SGST_OPTIONS.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>IGST</label>
                  <select
                    value={formData.igst_rate}
                    onChange={(e) =>
                      setFormData((prev) => applyIgstToTaxFields(prev, e.target.value))
                    }
                    required
                  >
                    <option value="">Select IGST rate</option>
                    {IGST_OPTIONS.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>
                
              </>
            )}

            {showInventoryFields && (
              <div className="form-group span-2">
                <label>LSA</label>
                <input
                  type="text"
                  value={formData.lsa}
                  onChange={(e) => setFormData({ ...formData, lsa: e.target.value })}
                  placeholder="Enter LSA"
                  autoComplete="off"
                  style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '8px' }}
                />
              </div>
            )}
            
            {!showInventoryFields && (
              <>
                <div className="form-group span-2" style={{ 
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>
                    <span>Product description</span>
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    rows="3"
                    placeholder="Describe the product in your own words (grammar does not need to be perfect). An admin will review and publish a polished version for buyers. You can include specs inline, e.g. Grade: OPC 53, Compressive Strength: 53 MPa."
                  />
                  <p className="pm-description-hint">
                    Your description is sent to admin for review. Buyers see the admin-published version after approval.
                  </p>
                  {/* Extract Specifications Button */}
                  {formData.description && formData.description.trim() && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {specsAlreadyExtractedForCurrentSource ? (
                        <span style={{ fontSize: '0.75rem', color: '#047857', fontStyle: 'italic' }}>
                          Specifications extracted for the current product details. Edit name, brand, category, or description to extract again.
                        </span>
                      ) : (!formData.category || !formData.category.trim()) ? (
                        <span style={{ fontSize: '0.75rem', color: '#dc2626', fontStyle: 'italic' }}>
                          ⚠️ Category required for extraction
                        </span>
                      ) : null}
                      {!specsAlreadyExtractedForCurrentSource ? (
                        <button
                          type="button"
                          onClick={handleExtractSpecifications}
                          disabled={
                            extracting ||
                            !formData.description ||
                            !formData.description.trim() ||
                            !formData.category ||
                            !formData.category.trim()
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.375rem 0.75rem',
                            background: extracting ? '#9ca3af' : (!formData.category || !formData.category.trim()) ? '#9ca3af' : '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            cursor: extracting || !formData.description || !formData.description.trim() || !formData.category || !formData.category.trim() ? 'not-allowed' : 'pointer',
                            opacity: extracting || !formData.description || !formData.description.trim() || !formData.category || !formData.category.trim() ? 0.6 : 1,
                            transition: 'all 0.2s ease',
                            whiteSpace: 'nowrap'
                          }}
                          title={(!formData.category || !formData.category.trim())
                            ? "Please select a category first to extract specifications"
                            : "Extract specification key-value pairs from the description above using AI. Category and description must match."}
                        >
                          <Sparkles size={14} />
                          <span>{extracting ? 'Extracting...' : 'Extract Specifications'}</span>
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
                
                {/* Show message when category is selected but no admin specs found */}
                {formData.category && formData.category.trim() &&
                 !formData.catalogProductId &&
                 loadingSpecs &&
                 (!product || (product && (product.status || 'pending') === 'pending')) && (
                  <div className="form-group span-2" style={{
                    marginTop: '1rem',
                    padding: '0.85rem 1rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    color: '#475569',
                    fontSize: '0.875rem'
                  }}>
                    Loading specification fields for "{formData.category}"…
                  </div>
                )}
                {formData.category && formData.category.trim() &&
                 !formData.catalogProductId &&
                 !loadingSpecs &&
                 !hasAdminSpecTemplate &&
                 (!specifications || Object.keys(specifications).length === 0) && 
                 (!product || (product && (product.status || 'pending') === 'pending')) && (
                  <div className="form-group span-2" style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    background: '#eff6ff',
                    borderRadius: '8px',
                    border: '1px solid #93c5fd'
                  }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      color: '#1e40af',
                      fontSize: '0.875rem'
                    }}>
                      <span>ℹ️</span>
                      <span>
                        <strong>No category specification template yet.</strong> Submit this product for admin review.
                        Admin will polish the description, set GST, generate specification keys, and approve —
                        then you can fill specification values here.
                      </span>
                    </div>
                  </div>
                )}
                {formData.category && formData.category.trim() &&
                 !formData.catalogProductId &&
                 !loadingSpecs &&
                 (!specifications || Object.keys(specifications).length === 0) && 
                 product &&
                 String(product.status || '').toLowerCase() === 'approved' &&
                 !approvedNeedsSpecFill &&
                 !supplierSpecValuesLocked && (
                  <div className="form-group span-2" style={{
                    marginTop: '1rem',
                    padding: '0.85rem 1rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    color: '#475569',
                    fontSize: '0.875rem'
                  }}>
                    Admin has not assigned specification keys for this product yet.
                  </div>
                )}
                
                {/* Specifications Display Section - Show keys with input fields for manual entry */}
                {(canEditSpecificationValues || supplierSpecValuesLocked || (specifications && Object.keys(specifications).length > 0)) && (() => {
                  // Get all specification keys (we only want the keys, not values)
                  // Remove duplicates (case-insensitive) and filter out empty keys
                  const specKeys = [];
                  const seenKeys = new Set();
                  
                  Object.keys(specifications || {}).forEach(key => {
                    const keyLower = key.toLowerCase().trim();
                    // Skip if already seen (case-insensitive) or if key is empty
                    if (!seenKeys.has(keyLower) && key.trim() !== '') {
                      seenKeys.add(keyLower);
                      specKeys.push(key);
                    }
                  });
                  
                  return (
                    <div
                      ref={specificationsSectionRef}
                      className="form-group span-2"
                      style={{
                      marginTop: '1rem',
                      padding: '1rem',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label style={{ marginBottom: 0, fontWeight: '600', color: '#1e293b', fontSize: '0.875rem' }}>
                          {canEditSpecificationValues
                            ? hasAdminSpecTemplate || approvedNeedsSpecFill
                              ? 'Specifications * — enter values for admin-defined keys'
                              : 'Specifications — enter keys and values'
                            : supplierSpecValuesLocked
                              ? 'Specifications — locked after first save'
                              : 'Specifications'}
                        </label>
                        <div style={{ display: 'flex', gap: '0.45rem' }}>
                          {canEditSpecificationKeys ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={addSpecificationKey}
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                          >
                            + Add key
                          </button>
                          ) : null}
                        </div>
                      </div>
                      {hasAdminSpecTemplate && canEditSpecificationValues ? (
                        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: '#475569' }}>
                          This category already has admin-defined specification keys. Fill in every value below before submitting.
                        </p>
                      ) : null}
                      {!hasAdminSpecTemplate && approvedNeedsSpecFill && canEditSpecificationValues ? (
                        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: '#475569' }}>
                          Admin assigned specification keys after approval. Fill in every value below once — they cannot be changed after save.
                        </p>
                      ) : null}
                      {supplierSpecValuesLocked ? (
                        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: '#64748b' }}>
                          Values were saved and can no longer be edited. Contact admin if a correction is needed.
                        </p>
                      ) : null}
                      <div className="pm-product-modal__specs-list">
                        {specKeys.length === 0 && (
                          <div style={{ fontSize: '0.85rem', color: '#64748b', padding: '0.5rem' }}>
                            {hasAdminSpecTemplate
                              ? 'Waiting for admin specification keys for this category.'
                              : (
                                <>
                                  No keys yet. Click <strong>Add key</strong> to create specifications.
                                </>
                              )}
                          </div>
                        )}
                        {specKeys.map((key, index) => {
                          const validationKeys = categorySpecFillRequired
                            ? adminSpecTemplateKeys
                            : approvedNeedsSpecFill
                              ? product?.catalogSpecificationKeys || adminSpecTemplateKeys
                              : [];
                          const specValueMissing =
                            showMissingHints &&
                            validationKeys.some(
                              (templateKey) =>
                                String(templateKey || '').trim().toLowerCase() ===
                                String(key || '').trim().toLowerCase()
                            ) &&
                            !isMeaningfullyFilledSpecValue(specifications[key]);

                          return (
                          <div key={key} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            padding: '0.75rem',
                            background: index % 2 === 0 ? '#ffffff' : '#f9fafb',
                            borderRadius: '6px',
                            borderLeft: specValueMissing ? '3px solid #dc2626' : '3px solid #4f46e5'
                          }}>
                            {canEditSpecificationKeys ? (
                            <input
                              type="text"
                              defaultValue={key}
                              onBlur={(e) => renameSpecificationKey(key, e.target.value)}
                              placeholder="Specification key"
                              style={{
                                fontSize: '0.875rem',
                                color: '#1e293b',
                                fontWeight: '600',
                                minWidth: '180px',
                                maxWidth: '260px',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                padding: '0.45rem 0.6rem',
                                background: 'white'
                              }}
                            />
                            ) : (
                              <label
                                style={{
                                  fontSize: '0.875rem',
                                  color: '#1e293b',
                                  fontWeight: '600',
                                  minWidth: '180px',
                                  maxWidth: '260px',
                                  textTransform: 'uppercase'
                                }}
                              >
                                {key}:
                              </label>
                            )}
                            {canEditSpecificationValues ? (
                              <input
                                type="text"
                                value={specValueToInput(specifications[key])}
                                onChange={(e) => updateSpecificationValue(key, e.target.value)}
                                placeholder="Specification value"
                                required={hasAdminSpecTemplate || approvedNeedsSpecFill}
                                aria-invalid={specValueMissing}
                                style={{
                                  flex: '1',
                                  padding: '0.5rem 0.75rem',
                                  border: specValueMissing ? '1px solid #dc2626' : '1px solid #d1d5db',
                                  borderRadius: '6px',
                                  fontSize: '0.875rem',
                                  color: '#1e293b',
                                  background: '#ffffff',
                                  minHeight: '36px'
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  flex: '1',
                                  padding: '0.5rem 0.75rem',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '6px',
                                  fontSize: '0.875rem',
                                  color: '#1e293b',
                                  background: '#f8fafc',
                                  minHeight: '36px',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                                title={String(specifications[key] || '')}
                              >
                                {String(specifications[key] || '').trim() || '—'}
                              </div>
                            )}
                            {canEditSpecificationKeys ? (
                            <button
                              type="button"
                              onClick={() => removeSpecificationKey(key)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', color: '#b91c1c' }}
                            >
                              Remove
                            </button>
                            ) : null}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {aiSuggestionPopup.open && (
            <div
              style={{
                border: '1px solid #fed7aa',
                background: '#fff7ed',
                borderRadius: '10px',
                padding: '0.9rem',
                marginTop: '0.8rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Sparkles size={16} color="#9a3412" />
                <strong style={{ color: '#9a3412' }}>
                  AI found these product details — apply only what you want
                </strong>
              </div>
              <p style={{ margin: '0 0 0.55rem 0', fontSize: '0.82rem', color: '#7c2d12' }}>
                Fields you already filled stay unchecked. Tick a suggestion only if you want to replace
                your value — nothing is written until you apply.
                {aiAnalysisMeta?.cacheHit ? (
                  <span style={{ display: 'block', marginTop: '0.35rem', fontWeight: 600 }}>
                    These details were reused from a prior analysis of the same photos.
                  </span>
                ) : null}
              </p>
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                {aiSuggestionPopup.items.map((item) => (
                  <label
                    key={item.key}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      padding: '0.45rem 0.5rem',
                      border: item.wouldReplace ? '1px solid #f87171' : '1px solid #fdba74',
                      borderRadius: '8px',
                      background: item.wouldReplace ? '#fef2f2' : '#ffedd5',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!aiSuggestionPopup.selected[item.key]}
                      onChange={(e) =>
                        setAiSuggestionPopup((prev) => ({
                          ...prev,
                          selected: {
                            ...(prev.selected || {}),
                            [item.key]: e.target.checked
                          }
                        }))
                      }
                    />
                    <span style={{ fontSize: '0.82rem', color: '#7c2d12' }}>
                      <strong>{item.label}:</strong> {item.value}
                      {item.wouldReplace ? (
                        <span style={{ display: 'block', marginTop: '0.15rem', fontWeight: 600, color: '#991b1b' }}>
                          Your current value: &quot;{item.currentValue}&quot; (kept unless you tick this)
                        </span>
                      ) : item.currentValue ? (
                        <span style={{ display: 'block', marginTop: '0.15rem' }}>
                          Matches your current value.
                        </span>
                      ) : null}
                      {typeof item.confidence === 'number' ? (
                        <span style={{ display: 'block', marginTop: '0.15rem' }}>
                          Confidence: {Math.round(item.confidence * 100)}%
                        </span>
                      ) : null}
                      {item.reason ? <span style={{ display: 'block', marginTop: '0.15rem' }}>Reason: {item.reason}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary" onClick={applyAiSuggestionSelection}>
                  Apply selected suggestions
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAiSuggestionPopup((prev) => ({ ...prev, open: false }))}
                >
                  Skip suggestions
                </button>
              </div>
            </div>
          )}
          </div>

          <div className="pm-product-modal__footer">
          {isAddOrInventorySubmitBlocked ? (
            <div
              className={
                formValidationError || showMissingHints
                  ? 'pm-form-validation'
                  : 'pm-form-validation-hint'
              }
              role={formValidationError || showMissingHints ? 'alert' : 'status'}
            >
              {formValidationError ||
                (unitCompatibilityBlocksSubmit
                  ? unitCompatibility.message
                  : brandApprovalBlocksSubmit && brandApprovalWarning
                  ? `${brandApprovalWarning.title}. ${brandApprovalWarning.message}`
                  : photosMissingFromMandatory && missingMandatoryFields.length === 1
                  ? formatMissingProductPhotosMessage(uploadedPhotoCount, MIN_AI_PRODUCT_IMAGES)
                  : `Complete required fields to enable ${product ? 'Update Product' : 'Add Product'}: ${[
                      ...missingMandatoryFields,
                      ...(brandApprovalBlocksSubmit ? ['Brand approval'] : []),
                      ...(unitCompatibilityBlocksSubmit ? ['Compatible unit'] : [])
                    ].join(', ')}.`)}
            </div>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSaving || isAddOrInventorySubmitBlocked}
              aria-disabled={isSaving || isAddOrInventorySubmitBlocked}
              title={
                isAddOrInventorySubmitBlocked
                  ? `Required: ${missingMandatoryFields.join(', ')}`
                  : undefined
              }
            >
              <Save size={16} />
              {isSaving ? 'Saving…' : product ? 'Update Product' : 'Add Product'}
            </button>
          </div>
          </div>
        </form>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modalNode;
  }

  return createPortal(modalNode, document.body);
};

export default ProductManagement;
