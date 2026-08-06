import React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react';
import './SupplierOrderScopeNav.css';

const ORDER_SCOPES = [
  {
    id: 'downstream',
    label: 'Downstream orders',
    shortLabel: 'Downstream',
    description: 'Orders you sell to buyers',
    icon: ArrowDownLeft
  },
  {
    id: 'upstream',
    label: 'Upstream orders',
    shortLabel: 'Upstream',
    description: 'Orders you buy from suppliers',
    icon: ArrowUpRight
  }
];

const ORDERS_PATH = '/supplier-orders';

export default function SupplierOrderScopeNav({ showReturnsLink = true, className = '' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const onOrdersPage = location.pathname === ORDERS_PATH;
  const direction = searchParams.get('direction') === 'upstream' ? 'upstream' : 'downstream';

  const setDirection = (next) => {
    if (onOrdersPage) {
      const nextParams = new URLSearchParams(searchParams);
      if (next === 'upstream') nextParams.set('direction', 'upstream');
      else nextParams.delete('direction');
      nextParams.delete('order');
      setSearchParams(nextParams, { replace: true });
      return;
    }
    navigate(next === 'upstream' ? `${ORDERS_PATH}?direction=upstream` : ORDERS_PATH);
  };

  return (
    <div className={`supplier-order-scope-nav ${className}`.trim()} role="navigation" aria-label="Order direction">
      <div className="supplier-order-scope-nav__tabs" role="tablist">
        {ORDER_SCOPES.map((scope) => {
          const Icon = scope.icon;
          const isActive = onOrdersPage ? direction === scope.id : false;
          return (
            <button
              key={scope.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`supplier-order-scope-nav__tab ${isActive ? 'supplier-order-scope-nav__tab--active' : ''}`}
              onClick={() => setDirection(scope.id)}
            >
              <Icon size={16} aria-hidden />
              <span className="supplier-order-scope-nav__tab-label">{scope.label}</span>
              <span className="supplier-order-scope-nav__tab-hint">{scope.description}</span>
            </button>
          );
        })}
      </div>
      {showReturnsLink ? (
        <button
          type="button"
          className="supplier-order-scope-nav__returns"
          onClick={() =>
            navigate(
              direction === 'upstream'
                ? '/supplier-returns?tab=outgoing'
                : '/supplier-returns?tab=incoming'
            )
          }
        >
          <RefreshCw size={15} aria-hidden />
          {direction === 'upstream' ? 'Upstream returns' : 'Downstream returns'}
        </button>
      ) : null}
    </div>
  );
}
