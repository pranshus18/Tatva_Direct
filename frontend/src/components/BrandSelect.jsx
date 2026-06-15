import React, { useEffect, useMemo, useState } from 'react';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import { brandKeyForDuplicateCheck } from '../utils/supplierChainEntryValidation';
import './BrandSelect.css';

export const BRAND_SELECT_OTHER_VALUE = '__other__';
const OTHER_VALUE = BRAND_SELECT_OTHER_VALUE;

function collapseRepeatedLetters(value) {
  return String(value || '').replace(/(.)\1+/g, '$1');
}

function findClosestBrandName(typed, brandNames = []) {
  const normalizedTyped = String(typed || '').trim().toLowerCase();
  if (!normalizedTyped) return null;
  const exact = brandNames.find((name) => name.toLowerCase() === normalizedTyped);
  if (exact) return exact;
  const collapsedTyped = collapseRepeatedLetters(normalizedTyped);
  return (
    brandNames.find((name) => collapseRepeatedLetters(name.toLowerCase()) === collapsedTyped) || null
  );
}

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
  excludeBrands = []
}) {
  const { brands, brandNames: rawBrandNames, loading, error: loadError } = useSupplierBrands({ source });

  const brandNames = useMemo(() => {
    const deduped = [];
    const seen = new Set();
    for (const name of rawBrandNames) {
      const key = brandKeyForDuplicateCheck(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(name);
    }
    return deduped;
  }, [rawBrandNames]);

  const normalizedValue = String(value || '').trim();

  const excludedBrandKeys = useMemo(() => {
    const keys = new Set();
    for (const brand of excludeBrands) {
      const key = collapseRepeatedLetters(String(brand || '').trim().toLowerCase());
      if (key) keys.add(key);
    }
    return keys;
  }, [excludeBrands]);

  const visibleBrandNames = useMemo(() => {
    const currentKey = collapseRepeatedLetters(normalizedValue.toLowerCase());
    return brandNames.filter((name) => {
      const key = collapseRepeatedLetters(name.toLowerCase());
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
      onChange?.('');
    } else if (next === OTHER_VALUE) {
      setOtherMode(true);
      onChange?.(normalizedValue && !valueInList ? normalizedValue : '');
    } else {
      setOtherMode(false);
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
          onBlur={(e) => {
            const typed = String(e.target.value || '').trim();
            if (!typed) return;
            const matched = findClosestBrandName(typed, visibleBrandNames);
            if (matched && matched !== typed) onChange?.(matched);
          }}
          disabled={disabled || loading}
          required={required}
          placeholder={loading ? 'Loading brands…' : 'Select brand…'}
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
          <p className="brand-select__hint brand-select__hint--error">{loadError}</p>
        ) : hint ? (
          <p className="brand-select__hint">{hint}</p>
        ) : (
          <p className="brand-select__hint">
            Type a brand name. Matching approved brands appear in suggestions as you type.
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
        <p className="brand-select__hint brand-select__hint--error">{loadError}</p>
      ) : hint ? (
        <p className="brand-select__hint">{hint}</p>
      ) : hideHint ? null : brandNames.length === 0 && !loading ? (
        <p className="brand-select__hint">
          {source === 'catalog' ? (
            <>
              No admin-approved brands in the catalog yet. Select <strong>Other brand</strong> below to request a new
              brand for admin approval.
            </>
          ) : (
            <>
              No approved brands in your profile yet. Add your brand under <strong>Select yourself</strong> (Step 1),
              click <strong>Save brand request</strong>, and wait for admin approval before adding products.
            </>
          )}
        </p>
      ) : (
        <p className="brand-select__hint">
          {source === 'catalog' ? (
            <>
              Choose an admin-approved brand from the list. For a brand not listed, select{' '}
              <strong>Other brand (request admin approval)</strong>, enter the name, then click{' '}
              <strong>Save brand request</strong>.
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
