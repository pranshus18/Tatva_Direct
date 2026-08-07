import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getApiUrl } from '../config/api';
import ProductImageCarousel from './ProductImageCarousel';
import { collectProductImages } from './UpstreamProductDisplay';
import {
  mergeVariantSpecificationTemplate,
  resolveSupplierOfferDisplaySpecifications,
  specificationEntriesForDetails
} from '../utils/specifications';
import { resolveSupplierPortalDisplayDescription } from '../utils/productDisplay';
import {
  SUPPLIER_CURRENT_STOCK_LABEL,
  SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL,
  SUPPLIER_MRP_LABEL,
  SUPPLIER_MRP_SHORT_NOTE,
  isSupplierInventoryConfigured
} from '../utils/supplierStockLabel';
import { formatRupeePerUnit } from '../utils/formatRupee';

function resolveGtin(product) {
  const specs =
    product?.specifications && typeof product.specifications === 'object' && !Array.isArray(product.specifications)
      ? product.specifications
      : {};
  return String(
    product?.gtin ||
      product?.barcode ||
      specs?.gtin ||
      specs?.GTIN ||
      specs?.upc ||
      specs?.UPC ||
      specs?.ean ||
      specs?.EAN ||
      specs?.barcode ||
      specs?.Barcode ||
      ''
  ).trim();
}

function hasSpecificationTemplateKeys(specifications = {}) {
  return (
    specifications &&
    typeof specifications === 'object' &&
    !Array.isArray(specifications) &&
    Object.keys(specifications).length > 0
  );
}

export default function SupplierProductDetailsModal({ product, onClose }) {
  const mergedDisplaySpecs = useMemo(
    () => resolveSupplierOfferDisplaySpecifications(product),
    [product]
  );
  const [displaySpecifications, setDisplaySpecifications] = useState(mergedDisplaySpecs);

  useEffect(() => {
    setDisplaySpecifications(mergedDisplaySpecs);
  }, [mergedDisplaySpecs]);

  useEffect(() => {
    const category = String(product?.category || '').trim().toLowerCase();
    const model = String(product?.name || '').trim();
    const brand = String(product?.brand || product?.brandModel || model || '').trim();
    if (!category) return;
    if (hasSpecificationTemplateKeys(product?.catalogSpecifications)) return;

    let cancelled = false;
    const loadAdminSpecifications = async () => {
      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams();
        if (model) params.set('model', model);
        if (brand) params.set('brand', brand);
        const query = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(
          getApiUrl(`/api/supplier/categories/${encodeURIComponent(category)}/specifications${query}`),
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-cache' }
        );
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (data?.status !== 'success' || cancelled) return;
        const adminTemplate =
          data?.specifications && typeof data.specifications === 'object' ? data.specifications : {};
        if (!Object.keys(adminTemplate).length) return;
        setDisplaySpecifications(
          mergeVariantSpecificationTemplate(adminTemplate, mergedDisplaySpecs)
        );
      } catch {
        // Keep offer merge when template fetch fails.
      }
    };

    loadAdminSpecifications();
    return () => {
      cancelled = true;
    };
  }, [
    product?.id,
    product?.category,
    product?.name,
    product?.brand,
    product?.brandModel,
    product?.catalogSpecifications,
    mergedDisplaySpecs
  ]);

  if (!product) return null;

  const images = collectProductImages(product);
  const gtinValue = resolveGtin(product);
  const specEntries = specificationEntriesForDetails(displaySpecifications);
  const description = resolveSupplierPortalDisplayDescription(product);
  const brandLabel = product.brandModel || product.brand || '—';
  const statusLabel = String(product.status || 'pending').replace(/_/g, ' ');

  const modalNode = (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal us-details-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="us-product-details-title"
      >
        <div className="modal-header">
          <h2 id="us-product-details-title">{product.name || 'Product details'}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-form us-details-modal__body">
          {images.length > 0 ? (
            <div className="us-details-modal__hero">
              <ProductImageCarousel images={images} alt={product.name || 'Product'} height={240} rounded={10} />
            </div>
          ) : null}

          <div className="us-details-grid">
            <div className="us-details-field">
              <span className="us-details-field__label">Brand / model</span>
              <span className="us-details-field__value">{brandLabel}</span>
            </div>
            <div className="us-details-field">
              <span className="us-details-field__label">Category</span>
              <span className="us-details-field__value">{product.category || '—'}</span>
            </div>
            <div className="us-details-field">
              <span className="us-details-field__label">Status</span>
              <span className="us-details-field__value">{statusLabel}</span>
            </div>
            <div className="us-details-field">
              <span className="us-details-field__label">{SUPPLIER_MRP_LABEL}</span>
              <span className="us-details-field__value">
                {isSupplierInventoryConfigured(product) && Number(product.price) > 0
                  ? formatRupeePerUnit(product.price, product.unit)
                  : SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL}
              </span>
              {isSupplierInventoryConfigured(product) && Number(product.price) > 0 ? (
                <span className="us-details-field__hint" style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  {SUPPLIER_MRP_SHORT_NOTE}
                </span>
              ) : null}
            </div>
            <div className="us-details-field">
              <span className="us-details-field__label">{SUPPLIER_CURRENT_STOCK_LABEL}</span>
              <span className="us-details-field__value">
                {isSupplierInventoryConfigured(product)
                  ? `${product.stock ?? 0} ${product.unit || ''}`.trim()
                  : SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL}
              </span>
            </div>
            <div className="us-details-field">
              <span className="us-details-field__label">Min order</span>
              <span className="us-details-field__value">
                {product.min_order_quantity ?? 1}
                {product.unit ? ` ${product.unit}` : ''}
              </span>
            </div>
            {product.unit ? (
              <div className="us-details-field">
                <span className="us-details-field__label">Unit</span>
                <span className="us-details-field__value">{product.unit}</span>
              </div>
            ) : null}
            {gtinValue ? (
              <div className="us-details-field">
                <span className="us-details-field__label">GTIN / UPC / EAN</span>
                <span className="us-details-field__value">{gtinValue}</span>
              </div>
            ) : null}
            {product.hsnCode || product.hsn_code ? (
              <div className="us-details-field">
                <span className="us-details-field__label">HSN</span>
                <span className="us-details-field__value">{product.hsnCode || product.hsn_code}</span>
              </div>
            ) : null}
            {product.lsa ? (
              <div className="us-details-field">
                <span className="us-details-field__label">LSA</span>
                <span className="us-details-field__value">{product.lsa}</span>
              </div>
            ) : null}
            {product.location ? (
              <div className="us-details-field">
                <span className="us-details-field__label">Location</span>
                <span className="us-details-field__value">{product.location}</span>
              </div>
            ) : null}
            {product.asin ? (
              <div className="us-details-field">
                <span className="us-details-field__label">TSIN</span>
                <span className="us-details-field__value">{product.asin}</span>
              </div>
            ) : null}
            {(product.variantAsin || product.variant_asin) ? (
              <div className="us-details-field">
                <span className="us-details-field__label">Variant TSIN</span>
                <span className="us-details-field__value">{product.variantAsin || product.variant_asin}</span>
              </div>
            ) : null}
          </div>

          {description ? (
            <section className="us-details-section">
              <h3>Description</h3>
              <p className="us-details-description">{description}</p>
            </section>
          ) : null}

          {specEntries.length > 0 ? (
            <section className="us-details-section">
              <h3>Specifications</h3>
              <div className="us-details-spec-grid">
                {specEntries.map((entry) => (
                  <div key={entry.key} className="us-details-spec-card">
                    <span className="us-details-spec-card__label">{entry.label}</span>
                    <span
                      className={`us-details-spec-card__value ${
                        entry.hasValue ? '' : 'us-details-spec-card__value--empty'
                      }`}
                    >
                      {entry.displayValue}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modalNode;
  }

  return createPortal(modalNode, document.body);
}
