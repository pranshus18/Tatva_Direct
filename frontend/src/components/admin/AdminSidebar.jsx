import React from 'react';
import { ADMIN_NAV_GROUPS } from '@/utils/adminNavConfig';
import PillSidebar from '@/components/shared/PillSidebar';

export default function AdminSidebar({ className, onNavigate, variant = 'desktop', onPrefetch }) {
  return (
    <PillSidebar
      navGroups={ADMIN_NAV_GROUPS}
      className={className}
      variant={variant}
      onNavigate={onNavigate}
      onPrefetch={onPrefetch}
      ariaLabel="Admin navigation"
    />
  );
}
