import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import tatvaLogo from '../../images/tatva_d.png';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { SP_NAV_GROUPS } from '@/utils/spNavConfig';
import { getCartItemCount } from '@/utils/spWorkflow';
import { getVoiceGuidedPath, isVoiceGuidedActive } from '@/voice/voiceCartBridge';

function NavGroup({ group, cartCount, location, voiceNavTick, onNavigate }) {
  const [open, setOpen] = useState(true);
  const hasActive = group.items.some((item) => location.pathname === item.path);

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {group.label}
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open ? (
        <ul className="space-y-0.5 px-2 pb-2">
          {group.items.map(({ path, label, icon: Icon, badgeKey }) => {
            void voiceNavTick;
            const guidedPath = isVoiceGuidedActive() ? getVoiceGuidedPath() : '';
            const guidedBase = guidedPath ? guidedPath.split('?')[0] : '';
            const isActive =
              guidedBase && location.pathname === guidedBase
                ? path === guidedBase
                : location.pathname === path;
            const badge = badgeKey === 'cart' && cartCount > 0 ? cartCount : null;

            return (
              <li key={path}>
                <NavLink
                  to={path}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive ? 'sp-nav-active' : 'sp-nav-link text-muted-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  {badge != null ? (
                    <Badge
                      variant={isActive ? 'secondary' : 'default'}
                      className="h-5 min-w-5 justify-center px-1.5 text-[10px]"
                    >
                      {badge > 99 ? '99+' : badge}
                    </Badge>
                  ) : null}
                </NavLink>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default function SpSidebar({ className, onNavigate }) {
  const location = useLocation();
  const [cartCount, setCartCount] = useState(() => getCartItemCount());
  const [voiceNavTick, setVoiceNavTick] = useState(0);

  useEffect(() => {
    const refresh = () => setCartCount(getCartItemCount());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('sp-workflow-updated', refresh);
    const onVoiceNav = () => setVoiceNavTick((n) => n + 1);
    window.addEventListener('voice-guided-updated', onVoiceNav);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('sp-workflow-updated', refresh);
      window.removeEventListener('voice-guided-updated', onVoiceNav);
    };
  }, [location.pathname]);

  return (
    <aside className={cn('flex h-full w-[260px] shrink-0 flex-col border-r bg-card', className)}>
      <div className="border-b px-5 py-5">
        <img src={tatvaLogo} alt="Tatva Direct" className="h-8 w-auto object-contain" />
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {SP_NAV_GROUPS.map((group) => (
          <NavGroup
            key={group.id}
            group={group}
            cartCount={cartCount}
            location={location}
            voiceNavTick={voiceNavTick}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </aside>
  );
}
