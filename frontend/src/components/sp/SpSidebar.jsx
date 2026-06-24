import React, { useEffect, useState } from 'react';
import { SP_NAV_GROUPS } from '@/utils/spNavConfig';
import { getCartItemCount } from '@/utils/spWorkflow';
import { getVoiceGuidedPath, isVoiceGuidedActive } from '@/voice/voiceCartBridge';
import PillSidebar from '@/components/shared/PillSidebar';

function resolveSpActive(path, location) {
  const guidedPath = isVoiceGuidedActive() ? getVoiceGuidedPath() : '';
  const guidedBase = guidedPath ? guidedPath.split('?')[0] : '';
  if (guidedBase && location.pathname === guidedBase) {
    return path === guidedBase;
  }
  return location.pathname === path;
}

export default function SpSidebar({ className, onNavigate, variant = 'desktop' }) {
  const [cartCount, setCartCount] = useState(() => getCartItemCount());

  useEffect(() => {
    const refresh = () => setCartCount(getCartItemCount());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('sp-workflow-updated', refresh);
    window.addEventListener('voice-guided-updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('sp-workflow-updated', refresh);
      window.removeEventListener('voice-guided-updated', refresh);
    };
  }, []);

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
