import React from 'react';
import { RUPEE_SYMBOL } from '../utils/formatRupee';

/**
 * Numeric price input with a fixed ₹ prefix (value stays a plain number for APIs).
 */
export function RupeeInput({ className = '', inputClassName = '', ...inputProps }) {
  return (
    <div className={`rupee-input-field ${className}`.trim()}>
      <span className="rupee-input-field__symbol" aria-hidden="true">
        {RUPEE_SYMBOL}
      </span>
      <input className={`rupee-input-field__control ${inputClassName}`.trim()} {...inputProps} />
    </div>
  );
}

export default RupeeInput;
