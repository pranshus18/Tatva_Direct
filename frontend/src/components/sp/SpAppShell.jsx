import React, { useEffect, useState } from 'react';
import '@/styles/sp-portal-theme.css';
import '@/styles/portal-pill-nav.css';
import '@/pages/Dashboard.css';
import { Outlet, useLocation } from 'react-router-dom';
import {
  getServiceProviderThemePrefs,
  loadServiceProviderThemePrefsFromApi,
  resolveServiceProviderThemeBackground
} from '@/utils/serviceProviderTheme';
import { isVoiceGuidedActive } from '@/voice/voiceCartBridge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import SpSidebar from './SpSidebar';
import SpTopBar from './SpTopBar';
import { rememberSpPathForSupplierSelectBack } from '@/utils/supplierSelectBack';

const routePrefetchers = {
  '/dashboard': () => import('@/pages/ServiceProviderDashboard'),
  '/boq-normalize': () => import('@/pages/BOQNormalize'),
  '/boqs': () => import('@/pages/BoqListing'),
  '/product-discovery': () => import('@/pages/ProductDiscovery'),
  '/voice': () => import('@/pages/VoiceCommerce'),
  '/supplier-select': () => import('@/pages/VendorSelect'),
  '/substitution': () => import('@/pages/Substitution'),
  '/cart': () => import('@/pages/Cart'),
  '/create-po': () => import('@/pages/CreatePO'),
  '/your-orders': () => import('@/pages/YourOrders'),
  '/vault': () => import('@/pages/Wallet'),
  '/wallet': () => import('@/pages/Wallet'),
  '/returns': () => import('@/pages/ServiceProviderReturns'),
  '/transport-suggestion': () => import('@/pages/TransportSuggestion'),
  '/portal-theme': () => import('@/pages/ServiceProviderThemeSettings'),
  '/profile': () => import('@/pages/Profile')
};

const prefetchedRoutes = new Set();

function prefetchRoute(path) {
  const loader = routePrefetchers[path];
  if (!loader || prefetchedRoutes.has(path)) return;
  prefetchedRoutes.add(path);
  loader().catch(() => prefetchedRoutes.delete(path));
}

export default function SpAppShell({ user, onLogout, onPortalChange, children }) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themePrefs, setThemePrefs] = useState(() => getServiceProviderThemePrefs());

  useEffect(() => {
    setThemePrefs(getServiceProviderThemePrefs());
    let cancelled = false;
    loadServiceProviderThemePrefsFromApi()
      .then((remote) => {
        if (!cancelled && remote) setThemePrefs(remote);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => setThemePrefs(getServiceProviderThemePrefs());
    window.addEventListener('storage', refresh);
    window.addEventListener('service-provider-theme-updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('service-provider-theme-updated', refresh);
    };
  }, []);

  useEffect(() => {
    const paths = Object.keys(routePrefetchers).filter((p) => p !== location.pathname);
    paths.forEach((path, idx) => {
      window.setTimeout(() => prefetchRoute(path), idx * 120);
    });
  }, [location.pathname]);

  useEffect(() => {
    rememberSpPathForSupplierSelectBack(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.add('sp-portal-active');
    return () => document.body.classList.remove('sp-portal-active');
  }, []);

  const isCustomWallpaper =
    themePrefs.themeId === 'custom' && Boolean(themePrefs.customImageDataUrl);
  const shellBackgroundStyle =
    themePrefs.themeId === 'default'
      ? undefined
      : {
          backgroundImage: resolveServiceProviderThemeBackground(themePrefs),
          ...(isCustomWallpaper
            ? {
                backgroundAttachment: 'fixed',
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }
            : {})
        };

  return (
    <div
      className={cn(
        'sp-portal flex min-h-screen bg-background',
        isVoiceGuidedActive() && 'layout--voice-guided'
      )}
      style={shellBackgroundStyle}
    >
      <div className="hidden shrink-0 lg:flex">
        <SpSidebar />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="sp-portal portal-mobile-nav-sheet w-auto border-0 bg-transparent p-0 shadow-none">
          <SpSidebar variant="mobile" onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <SpTopBar
          user={user}
          pathname={location.pathname}
          onMenuClick={() => setMobileNavOpen(true)}
          onLogout={onLogout}
          onPortalChange={onPortalChange}
        />
        <main className="portal-shell-content flex-1 overflow-auto">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
