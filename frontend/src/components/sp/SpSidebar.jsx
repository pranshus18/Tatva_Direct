import React from 'react';
import { SP_NAV_GROUPS } from '@/utils/spNavConfig';
import { useServiceProviderCartCount } from '@/hooks/useServiceProviderCartCount';
import { getVoiceGuidedPath, isVoiceGuidedActive } from '@/voice/voiceCartBridge';
import PillSidebar from '@/components/shared/PillSidebar';
import { useLocation } from 'react-router-dom';

function resolveSpActive(path, location) {
  const guidedPath = isVoiceGuidedActive() ? getVoiceGuidedPath() : '';
  const guidedBase = guidedPath ? guidedPath.split('?')[0] : '';
  if (guidedBase && location.pathname === guidedBase) {
    return path === guidedBase;
  }
  return location.pathname === path;
}

export default function SpSidebar({ className, onNavigate, variant = 'desktop' }) {
  const location = useLocation();
  const cartCount = useServiceProviderCartCount();

  return (
    <PillSidebar
      navGroups={SP_NAV_GROUPS}
      className={className}
      variant={variant}
      onNavigate={onNavigate}
      ariaLabel="Service provider navigation"
      badges={{ cart: cartCount }}
      isItemActive={resolveSpActive}
    />
  );
}
