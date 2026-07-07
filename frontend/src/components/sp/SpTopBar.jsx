import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Menu, Search, ShoppingCart, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import UserAvatar from '@/components/UserAvatar';
import { getSpBreadcrumb } from '@/utils/spNavConfig';
import { useServiceProviderCartCount } from '@/hooks/useServiceProviderCartCount';
import SpNotificationsBell from './SpNotificationsBell';

export default function SpTopBar({ user, pathname, onMenuClick, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isDiscoveryPage = location.pathname === '/product-discovery';
  const discoveryQuery = isDiscoveryPage ? (searchParams.get('q') || '') : '';
  const [search, setSearch] = useState('');
  const searchDebounceRef = useRef(null);
  const cartCount = useServiceProviderCartCount();
  const crumbs = getSpBreadcrumb(pathname);

  useEffect(() => {
    if (isDiscoveryPage) {
      setSearch(discoveryQuery);
    }
  }, [discoveryQuery, isDiscoveryPage]);

  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    },
    []
  );

  const buildDiscoveryPath = (rawValue) => {
    const q = String(rawValue || '').trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const category = isDiscoveryPage ? searchParams.get('category') : null;
    if (category) params.set('category', category);
    const queryString = params.toString();
    return queryString ? `/product-discovery?${queryString}` : '/product-discovery';
  };

  const runDiscoverySearch = (rawValue) => {
    const trimmed = String(rawValue || '').trim();
    if (isDiscoveryPage) {
      if (trimmed === discoveryQuery) return;
      navigate(buildDiscoveryPath(rawValue), { replace: true });
      return;
    }
    if (trimmed) {
      navigate(buildDiscoveryPath(rawValue));
    }
  };

  const queueDiscoverySearch = (rawValue, { immediate = false } = {}) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (immediate) {
      runDiscoverySearch(rawValue);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      runDiscoverySearch(rawValue);
    }, 300);
  };

  const handleSearchChange = (event) => {
    const value = event.target.value;
    setSearch(value);
    queueDiscoverySearch(value);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    queueDiscoverySearch(search, { immediate: true });
  };

  return (
    <header className="sp-topbar portal-shell-topbar sticky top-3 z-40">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>

        <Breadcrumb className="hidden min-w-0 flex-1 md:block">
          <BreadcrumbList>
            {crumbs.map((crumb, i) => (
              <React.Fragment key={`${crumb.label}-${i}`}>
                {i > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {crumb.current ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.href || '/dashboard'}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <form onSubmit={handleSearch} className="mx-auto hidden max-w-md flex-1 lg:flex">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder="Search products..."
              className="pl-9"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="lg:hidden" asChild>
            <Link to="/product-discovery" aria-label="Search">
              <Search className="h-5 w-5" />
            </Link>
          </Button>

          <SpNotificationsBell />

          <Button variant="ghost" size="icon" className="relative" asChild>
            <Link to="/cart" aria-label="Cart">
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 ? (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              ) : null}
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <UserAvatar
                  user={user}
                  className="h-8 w-8"
                  fallbackClassName="bg-primary/10 text-xs text-primary"
                />
                <span className="hidden max-w-[120px] truncate text-sm font-medium sm:inline">{user?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium">{user?.name}</div>
                <Badge variant="secondary" className="mt-1 font-normal">
                  Service Provider
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile" className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
