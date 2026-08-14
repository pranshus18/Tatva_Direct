import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SUPPLIER_NAV_GROUPS } from '@/utils/supplierNavConfig';
import { getApiUrl } from '@/config/api';
import { countSupplierUpstreamCartDraft } from '@/utils/cartBadge';
import { subscribeSupplierCartUpdated } from '@/utils/supplierUpstreamCartSession';
import PillSidebar from '@/components/shared/PillSidebar';

export default function SupplierSidebar({ className, onNavigate, variant = 'desktop' }) {
  const location = useLocation();
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          if (active) setCartCount(0);
          return;
        }
        const response = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-cache'
        });
        const data = await response.json();
        if (!active || !response.ok || data?.status !== 'success') return;
        const draft = data?.cart?.draft && typeof data.cart.draft === 'object' ? data.cart.draft : {};
        setCartCount(countSupplierUpstreamCartDraft(draft));
      } catch (_) {
        if (active) setCartCount(0);
      }
    };

    refresh();
    const unsubscribe = subscribeSupplierCartUpdated(refresh, { includeFocus: true });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [location.pathname]);

  return (
    <PillSidebar
      navGroups={SUPPLIER_NAV_GROUPS}
      className={className}
      variant={variant}
      onNavigate={onNavigate}
      ariaLabel="Supplier navigation"
      badges={{ cart: cartCount }}
    />
  );
}
