import React, { useEffect, useMemo, useState } from 'react';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import { brandKeyForDuplicateCheck, dedupeBrandNames } from '../utils/supplierChainEntryValidation';
import './BrandSelect.css';

export const BRAND_SELECT_OTHER_VALUE = '__other__';
const OTHER_VALUE = BRAND_SELECT_OTHER_VALUE;

/**
 * Brand picker: approved brands from the database. Selecting a brand only sets the brand name.
 */
export default function BrandSelect({
  value = '',
  onChange,
  disabled = false,
  required = false,
  id = 'brand',
  name = 'brand',
  className = '',
  allowOther = true,
  hint,
  searchable = false,
  source = 'profile',
  dropdownOnly = false,
  hideHint = false,
  excludeBrands = [],
  onSelectionModeChange = null,
  /** Optional controlled catalog from parent — skips the internal fetch when provided. */
  brands: brandsProp = null,
  brandNames: brandNamesProp = null,
  loading: loadingProp = null,
  error: errorProp = null,
  onRetry = null
}) {
  const shouldFetch = !Array.isArray(brandsProp) && !Array.isArray(brandNamesProp);
  const {
    brands: fetchedBrands,
    brandNames: fetchedBrandNames,
    loading: fetchedLoading,
    error: fetchedError,
    reload
  } = useSupplierBrands({ source, enabled: shouldFetch });

  const brands = Array.isArray(brandsProp) ? brandsProp : fetchedBrands;
  const rawBrandNames = Array.isArray(brandNamesProp)
    ? brandNamesProp
    : Array.isArray(brandsProp)
      ? brandsProp.map((row) => (typeof row === 'string' ? row : row?.name)).filter(Boolean)
      : fetchedBrandNames;
  const loading = loadingProp != null ? Boolean(loadingProp) : fetchedLoading;
  const loadError = errorProp != null ? String(errorProp || '') : fetchedError;
  const retry = onRetry || (shouldFetch ? reload : null);

  const brandNames = useMemo(() => dedupeBrandNames(rawBrandNames), [rawBrandNames]);

  const normalizedValue = String(value || '').trim();

  const excludedBrandKeys = useMemo(() => {
    const keys = new Set();
    for (const brand of excludeBrands) {
      const key = brandKeyForDuplicateCheck(brand);
      if (key) keys.add(key);
    }
    return keys;
  }, [excludeBrands]);

  const visibleBrandNames = useMemo(() => {
    const currentKey = brandKeyForDuplicateCheck(normalizedValue);
    return brandNames.filter((name) => {
      const key = brandKeyForDuplicateCheck(name);
      if (currentKey && key === currentKey) return true;
      return !excludedBrandKeys.has(key);
    });
  }, [brandNames, excludedBrandKeys, normalizedValue]);

  const valueInList = normalizedValue
    ? visibleBrandNames.some((n) => n.toLowerCase() === normalizedValue.toLowerCase())
    : false;

  const [selectValue, setSelectValue] = useState(() => {
    if (!normalizedValue) return '';
    return valueInList ? normalizedValue : allowOther ? OTHER_VALUE : '';
  });
  const [otherMode, setOtherMode] = useState(() => allowOther && !!normalizedValue && !valueInList);

  const notifySelectionMode = (mode) => {
    onSelectionModeChange?.(mode);
  };

  useEffect(() => {
    if (!normalizedValue) {
      if (otherMode) {
        setSelectValue(OTHER_VALUE);
        return;
      }
      setSelectValue('');
      return;
    }
    const inList = visibleBrandNames.some((n) => n.toLowerCase() === normalizedValue.toLowerCase());
    if (inList) {
      setOtherMode(false);
      const exact = visibleBrandNames.find((n) => n.toLowerCase() === normalizedValue.toLowerCase());
      setSelectValue(exact || normalizedValue);
    } else if (allowOther) {
      setOtherMode(true);
      setSelectValue(OTHER_VALUE);
    } else {
      setOtherMode(false);
      setSelectValue('');
    }
  }, [normalizedValue, visibleBrandNames, allowOther, otherMode]);

  const handleSelectChange = (e) => {
    const next = e.target.value;
    setSelectValue(next);
    if (next === '') {
      setOtherMode(false);
      notifySelectionMode('empty');
      onChange?.('');
    } else if (next === OTHER_VALUE) {
      setOtherMode(true);
      notifySelectionMode('other');
      onChange?.(normalizedValue && !valueInList ? normalizedValue : '');
    } else {
      setOtherMode(false);
      notifySelectionMode('catalog');
      onChange?.(next);
    }
  };

  const showOtherInput = allowOther && selectValue === OTHER_VALUE;
  const dataListId = `${id}-list`;

  if (searchable) {
    return (
      <div className={`brand-select ${className}`.trim()}>
        <input
          type="text"
          id={id}
          name={name}
          className="brand-select__input"
          value={normalizedValue}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled || loading}
          required={required}
          placeholder={loading ? 'Loading brands…' : 'Type full brand name…'}
          autoComplete="off"
          list={dataListId}
          aria-label="Enter brand name"
        />
        <datalist id={dataListId}>
          {visibleBrandNames.map((brandName) => (
            <option key={brandName} value={brandName} />
          ))}
        </datalist>

        {loadError ? (
          <p className="brand-select__hint brand-select__hint--error" role="alert">
            {loadError}
            {retry ? (
              <>
                {' '}
                <button type="button" className="brand-select__retry" onClick={retry}>
                  Retry
                </button>
              </>
            ) : null}
          </p>
        ) : hint ? (
          <p className="brand-select__hint">{hint}</p>
        ) : (
          <p className="brand-select__hint">
            Type the complete brand name. Matching approved brands appear in suggestions — your text is not
            replaced automatically.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`brand-select ${className}`.trim()}>
      <select
        id={showOtherInput ? `${id}-picker` : id}
        name={showOtherInput ? `${name}-picker` : name}
        value={selectValue}
        onChange={handleSelectChange}
        disabled={disabled || loading}
        required={required && !showOtherInput}
        className="brand-select__dropdown"
        aria-label="Select brand"
      >
        <option value="">{loading ? 'Loading brands…' : 'Select brand…'}</option>
        {visibleBrandNames.map((brandName) => (
          <option key={brandName} value={brandName}>
            {brandName}
          </option>
        ))}
        {allowOther ? <option value={OTHER_VALUE}>Other brand (request admin approval)</option> : null}
      </select>

      {showOtherInput && !dropdownOnly ? (
        <input
          type="text"
          id={id}
          name={name}
          className="brand-select__other"
          value={normalizedValue}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          required={required}
          placeholder='e.g. "ACC", "TATA"'
          autoComplete="off"
          aria-label="Enter brand name"
        />
      ) : null}

      {loadError ? (
        <p className="brand-select__hint brand-select__hint--error" role="alert">
          {loadError}
          {retry ? (
            <>
              {' '}
              <button type="button" className="brand-select__retry" onClick={retry}>
                Retry
              </button>
            </>
          ) : null}
        </p>
      ) : hint ? (
        <p className="brand-select__hint">{hint}</p>
      ) : brandNames.length === 0 && !loading ? (
        <p className="brand-select__hint">
          {source === 'catalog' ? (
            <>
              No admin-approved brands loaded yet.
              {retry ? (
                <>
                  {' '}
                  <button type="button" className="brand-select__retry" onClick={retry}>
                    Retry loading
                  </button>
                </>
              ) : null}{' '}
              Or select <strong>Other brand</strong> to request a new brand for admin approval.
            </>
          ) : (
            <>
              No approved brands in your profile yet. Under <strong>Select yourself</strong>, pick an approved brand
              or request a new one, then wait for approval before adding products.
            </>
          )}
        </p>
      ) : hideHint ? null : (
        <p className="brand-select__hint">
          {source === 'catalog' ? (
            <>
              Choose an admin-approved brand from the list. For a brand not listed, select{' '}
              <strong>Other brand (request admin approval)</strong>, enter the name, then click{' '}
              <strong>Save brand</strong>.
            </>
          ) : (
            <>
              Choose an approved brand from your Select yourself profile. Only brands you declared and admin approved
              appear here.
              {allowOther ? ' New brands may need admin approval before the product goes live.' : ''}
            </>
          )}
        </p>
      )}
    </div>
  );
}
