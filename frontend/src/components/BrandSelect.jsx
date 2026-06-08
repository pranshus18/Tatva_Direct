import React, { useEffect, useMemo, useState } from 'react';
import { useSupplierBrands } from '../hooks/useSupplierBrands';
import './BrandSelect.css';

const OTHER_VALUE = '__other__';

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
  searchable = false
}) {
  const { brandNames, loading, error: loadError } = useSupplierBrands();

  const normalizedValue = String(value || '').trim();

  const valueInList = normalizedValue
    ? brandNames.some((n) => n.toLowerCase() === normalizedValue.toLowerCase())
    : false;

  const [selectValue, setSelectValue] = useState(() => {
    if (!normalizedValue) return '';
    return valueInList ? normalizedValue : allowOther ? OTHER_VALUE : '';
  });

  useEffect(() => {
    if (!normalizedValue) {
      setSelectValue('');
      return;
    }
    const inList = brandNames.some((n) => n.toLowerCase() === normalizedValue.toLowerCase());
    if (inList) {
      const exact = brandNames.find((n) => n.toLowerCase() === normalizedValue.toLowerCase());
      setSelectValue(exact || normalizedValue);
    } else if (allowOther) {
      setSelectValue(OTHER_VALUE);
    } else {
      setSelectValue('');
    }
  }, [normalizedValue, brandNames, allowOther]);

  const handleSelectChange = (e) => {
    const next = e.target.value;
    setSelectValue(next);
    if (next === '') {
      onChange?.('');
    } else if (next === OTHER_VALUE) {
      onChange?.(normalizedValue && !valueInList ? normalizedValue : '');
    } else {
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
            const exact = brandNames.find((n) => n.toLowerCase() === typed.toLowerCase());
            if (exact && exact !== typed) onChange?.(exact);
          }}
          disabled={disabled || loading}
          required={required}
          placeholder={loading ? 'Loading brands…' : 'Select brand…'}
          autoComplete="off"
          list={dataListId}
          aria-label="Enter brand name"
        />
        <datalist id={dataListId}>
          {brandNames.map((brandName) => (
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
        {brandNames.map((brandName) => (
          <option key={brandName} value={brandName}>
            {brandName}
          </option>
        ))}
        {allowOther ? <option value={OTHER_VALUE}>Other brand (not in list)</option> : null}
      </select>

      {showOtherInput ? (
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
      ) : (
        <p className="brand-select__hint">
          Choose an approved brand from the list. Only the brand name is filled — not full product details.
          {allowOther ? ' New brands may need admin approval before the product goes live.' : ''}
        </p>
      )}
    </div>
  );
}
