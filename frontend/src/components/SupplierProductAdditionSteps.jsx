import React from 'react';
import { Check } from 'lucide-react';
import { SUPPLIER_CURRENT_STOCK_LABEL, SUPPLIER_MRP_LABEL } from '../utils/supplierStockLabel';
import './SupplierProductAdditionSteps.css';

const STEPS = [
  { n: 1, title: 'Product', sub: 'Name, brand, specs' },
  { n: 2, title: 'Inventory', sub: `${SUPPLIER_MRP_LABEL}, ${SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()}, GST` },
  { n: 3, title: 'ProductCOV', sub: 'Brand quantity pricing' }
];

const VARIANT_STEPS = {
  'add-product': { 1: 'current', 2: 'pending', 3: 'pending' },
  'product-inventory': { 1: 'current', 2: 'current', 3: 'pending' },
  inventory: { 1: 'done', 2: 'current', 3: 'pending' },
  bcov: { 1: 'done', 2: 'done', 3: 'current' },
  'bcov-done': { 1: 'done', 2: 'done', 3: 'done' }
};

function lineState(variant, afterStep) {
  const m = VARIANT_STEPS[variant] || VARIANT_STEPS['add-product'];
  const left = m[afterStep];
  const right = m[afterStep + 1];
  if (left === 'done' && right === 'done') return 'done';
  if (left === 'current' && right === 'current') return 'active';
  if (left === 'done' && right === 'current') return 'active';
  if (left === 'done' && right === 'pending') return 'done';
  if (left === 'current' && right === 'pending') return 'pending';
  return 'pending';
}

export default function SupplierProductAdditionSteps({
  variant = 'add-product',
  hint = '',
  compact = false,
  onStepSelect,
  lockedSteps = []
}) {
  const stepState = VARIANT_STEPS[variant] || VARIANT_STEPS['add-product'];
  const locked = new Set((lockedSteps || []).map((n) => Number(n)));
  const selectable = typeof onStepSelect === 'function';

  return (
    <div
      className={`supplier-addition-steps ${compact ? 'supplier-addition-steps--compact' : ''}`}
      role="group"
      aria-label="Product onboarding: product, inventory, then ProductCOV"
    >
      <div className="supplier-addition-steps__track">
        {STEPS.map((s, i) => {
          const state = stepState[s.n];
          const isLocked = locked.has(s.n);
          const nodeClass = `supplier-addition-steps__node supplier-addition-steps__node--${state}${
            isLocked ? ' supplier-addition-steps__node--locked' : ''
          }${selectable ? ' supplier-addition-steps__node--clickable' : ''}`;
          const content = (
            <>
              <span className="supplier-addition-steps__circle">
                {state === 'done' ? <Check size={14} strokeWidth={3} aria-hidden /> : s.n}
              </span>
              <span className="supplier-addition-steps__meta">
                <span className="supplier-addition-steps__title">{s.title}</span>
                <span className="supplier-addition-steps__sub">{s.sub}</span>
              </span>
            </>
          );
          return (
            <React.Fragment key={s.n}>
              {i > 0 && (
                <div
                  className={`supplier-addition-steps__line supplier-addition-steps__line--${lineState(variant, s.n - 1)}`}
                  aria-hidden
                />
              )}
              {selectable ? (
                <button
                  type="button"
                  className={nodeClass}
                  onClick={() => onStepSelect(s.n, { locked: isLocked })}
                  aria-disabled={isLocked}
                  title={
                    isLocked && s.n === 3
                      ? 'Complete Inventory before Product COV'
                      : s.title
                  }
                >
                  {content}
                </button>
              ) : (
                <div className={nodeClass}>{content}</div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {hint ? <p className="supplier-addition-steps__hint">{hint}</p> : null}
    </div>
  );
}
