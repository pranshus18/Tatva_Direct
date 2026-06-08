import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, User, LogOut, Expand, Shrink } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { getSupplierBreadcrumb } from '@/utils/supplierNavConfig';

export default function SupplierTopBar({ user, pathname, onMenuClick, onLogout, densityMode, onToggleDensity }) {
  const crumbs = getSupplierBreadcrumb(pathname);
  return (
    <header className="supplier-topbar sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
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
                      <Link to={crumb.href || '/supplier-dashboard'}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="hidden gap-1.5 text-xs lg:inline-flex"
            onClick={onToggleDensity}
            title={`Switch to ${densityMode === 'compact' ? 'comfortable' : 'compact'} density`}
          >
            {densityMode === 'compact' ? <Expand className="h-3.5 w-3.5" /> : <Shrink className="h-3.5 w-3.5" />}
            {densityMode === 'compact' ? 'Compact' : 'Comfortable'}
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
                  Supplier
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
