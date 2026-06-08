import React, { useEffect, useState } from 'react';
import '@/styles/supplier-portal-theme.css';
import '@/pages/Dashboard.css';
import { Outlet, useLocation } from 'react-router-dom';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import SupplierSidebar from './SupplierSidebar';
import SupplierTopBar from './SupplierTopBar';
import {
  getSupplierPortalThemePrefs,
  loadSupplierPortalThemePrefsFromApi,
  resolveSupplierPortalThemeBackground
} from '@/utils/supplierPortalTheme';

const routePrefetchers = {
  '/supplier-dashboard': () => import('@/pages/SupplierDashboard'),
  '/product-management': () => import('@/pages/ProductManagement'),
  '/manage-inventory': () => import('@/pages/ProductManagement'),
  '/supplier-bcov': () => import('@/pages/SupplierBCOV'),
  '/supplier-upstream': () => import('@/pages/SupplierUpstream'),
  '/supplier-upstream-orders': () => import('@/pages/SupplierUpstreamOrders'),
  '/supplier-cart': () => import('@/pages/SupplierUpstreamCart'),
  '/supplier-pos': () => import('@/pages/SupplierPOS'),
  '/supplier-returns': () => import('@/pages/SupplierReturns'),
  '/supplier-select-yourself': () => import('@/pages/SupplierSelectYourself'),
  '/supplier-discount-insights': () => import('@/pages/SupplierDiscountInsights'),
  '/supplier-buyer-purchases': () => import('@/pages/SupplierBuyerPurchases'),
  '/supplier-credit-accounts': () => import('@/pages/SupplierCreditAccounts'),
  '/supplier-total-purchase-platform-cov': () => import('@/pages/SupplierTotalPurchasePlatformCov'),
  '/supplier-purchase-total': () => import('@/pages/SupplierPurchaseTotal'),
  '/profile': () => import('@/pages/Profile'),
  '/supplier-portal-theme': () => import('@/pages/SupplierPortalThemeSettings')
};

const prefetchedRoutes = new Set();
function prefetchRoute(path) {
  const loader = routePrefetchers[path];
  if (!loader || prefetchedRoutes.has(path)) return;
  prefetchedRoutes.add(path);
  loader().catch(() => prefetchedRoutes.delete(path));
}

export default function SupplierAppShell({ user, onLogout, children }) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themePrefs, setThemePrefs] = useState(() => getSupplierPortalThemePrefs());
  const [densityMode, setDensityMode] = useState(() => {
    if (typeof window === 'undefined') return 'compact';
    const saved = localStorage.getItem('supplier-density-mode');
    return saved === 'comfortable' ? 'comfortable' : 'compact';
  });

  useEffect(() => {
    setThemePrefs(getSupplierPortalThemePrefs());
    let cancelled = false;
    loadSupplierPortalThemePrefsFromApi()
      .then((remote) => {
        if (!cancelled && remote) setThemePrefs(remote);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => setThemePrefs(getSupplierPortalThemePrefs());
    window.addEventListener('storage', refresh);
    window.addEventListener('supplier-portal-theme-updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('supplier-portal-theme-updated', refresh);
    };
  }, []);

  useEffect(() => {
    const paths = Object.keys(routePrefetchers).filter((p) => p !== location.pathname);
    paths.forEach((path, idx) => {
      window.setTimeout(() => prefetchRoute(path), idx * 120);
    });
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.add('supplier-portal-active');
    return () => document.body.classList.remove('supplier-portal-active');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('supplier-density-mode', densityMode);
  }, [densityMode]);

  const handleToggleDensity = () => {
    setDensityMode((prev) => (prev === 'compact' ? 'comfortable' : 'compact'));
  };

  const isCustomWallpaper =
    themePrefs.themeId === 'custom' && Boolean(themePrefs.customImageDataUrl);
  const shellBackgroundStyle =
    themePrefs.themeId === 'default'
      ? undefined
      : {
          backgroundImage: resolveSupplierPortalThemeBackground(themePrefs),
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
        'supplier-portal flex min-h-screen bg-background',
        `supplier-density-${densityMode}`,
        themePrefs.themeId !== 'default' && 'supplier-portal--themed'
      )}
      style={shellBackgroundStyle}
    >
      <div className="hidden lg:flex">
        <SupplierSidebar />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="supplier-portal w-[280px] p-0">
          <SupplierSidebar onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <SupplierTopBar
          user={user}
          pathname={location.pathname}
          onMenuClick={() => setMobileNavOpen(true)}
          onLogout={onLogout}
          densityMode={densityMode}
          onToggleDensity={handleToggleDensity}
        />
        <main className="sp-content-panel flex-1 overflow-auto">{children || <Outlet />}</main>
      </div>
    </div>
  );
}
