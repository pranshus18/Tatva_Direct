import React, { useEffect, useState } from 'react';
import '@/styles/admin-portal-theme.css';
import '@/styles/portal-pill-nav.css';
import '@/pages/Dashboard.css';
import { Outlet, useLocation } from 'react-router-dom';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import AdminSidebar from './AdminSidebar';
import AdminTopBar from './AdminTopBar';

const routePrefetchers = {
  '/admin-dashboard': () => import('@/pages/AdminDashboardOverview'),
  '/admin-users': () => import('@/pages/AdminUsers'),
  '/admin-transactions': () => import('@/pages/AdminTransactions'),
  '/admin-suppliers': () => import('@/pages/AdminSuppliers'),
  '/admin-service-providers': () => import('@/pages/AdminServiceProviders'),
  '/admin-product-status': () => import('@/pages/AdminProductStatus'),
  '/admin-brand-approvals': () => import('@/pages/AdminBrandApprovals'),
  '/admin-profile-chain-approvals': () => import('@/pages/AdminProfileChainApprovals'),
  '/admin-analytics': () => import('@/pages/AdminAnalytics'),
  '/admin-wallet': () => import('@/pages/AdminWallet'),
  '/admin-finance': () => import('@/pages/AdminFinance'),
  '/admin-supply-chain': () => import('@/pages/AdminSupplyChain'),
  '/profile': () => import('@/pages/Profile')
};

const prefetchedRoutes = new Set();

function prefetchRoute(path) {
  const loader = routePrefetchers[path];
  if (!loader || prefetchedRoutes.has(path)) return;
  prefetchedRoutes.add(path);
  loader().catch(() => prefetchedRoutes.delete(path));
}

export default function AdminAppShell({ user, onLogout, children }) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const paths = Object.keys(routePrefetchers).filter((p) => p !== location.pathname);
    paths.forEach((path, idx) => {
      window.setTimeout(() => prefetchRoute(path), idx * 120);
    });
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.add('admin-portal-active');
    return () => document.body.classList.remove('admin-portal-active');
  }, []);

  return (
    <div className="admin-portal flex min-h-screen bg-background">
      <div className="hidden shrink-0 lg:flex">
        <AdminSidebar onPrefetch={prefetchRoute} />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="admin-portal portal-mobile-nav-sheet w-auto border-0 bg-transparent p-0 shadow-none"
        >
          <AdminSidebar
            variant="mobile"
            onNavigate={() => setMobileNavOpen(false)}
            onPrefetch={prefetchRoute}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopBar
          user={user}
          pathname={location.pathname}
          onMenuClick={() => setMobileNavOpen(true)}
          onLogout={onLogout}
        />
        <main className="portal-shell-content flex-1 overflow-auto">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
