import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import tatvaLogo from '../../images/tatva_d.png';
import { cn } from '@/lib/utils';

function NavItem({
  path,
  label,
  shortLabel,
  icon: Icon,
  badgeKey,
  badges,
  isItemActive,
  onNavigate,
  onPrefetch
}) {
  const location = useLocation();
  const isActive = isItemActive(path, location);
  const badge = badgeKey && badges?.[badgeKey] > 0 ? badges[badgeKey] : null;
  const displayLabel = shortLabel || label;

  return (
    <li>
      <NavLink
        to={path}
        onClick={onNavigate}
        onMouseEnter={() => onPrefetch?.(path)}
        onFocus={() => onPrefetch?.(path)}
        title={label}
        className={cn('portal-pill-nav__item', isActive && 'portal-pill-nav__item--active')}
      >
        <span className="portal-pill-nav__icon-wrap">
          <Icon className="portal-pill-nav__icon" strokeWidth={isActive ? 2.25 : 1.65} />
          {badge != null ? (
            <span className="portal-pill-nav__badge">{badge > 99 ? '99+' : badge}</span>
          ) : null}
        </span>
        <span className="portal-pill-nav__label">{displayLabel}</span>
      </NavLink>
    </li>
  );
}

export default function PillSidebar({
  navGroups,
  className,
  variant = 'desktop',
  onNavigate,
  ariaLabel = 'Portal navigation',
  badges = {},
  isItemActive,
  onPrefetch
}) {
  const defaultIsActive = (path, location) => location.pathname === path;
  const resolveActive = isItemActive || defaultIsActive;

  return (
    <aside
      className={cn(
        'portal-pill-nav',
        variant === 'mobile' && 'portal-pill-nav--mobile',
        className
      )}
    >
      <div className="portal-pill-nav__pill">
        <div className="portal-pill-nav__brand">
          <img src={tatvaLogo} alt="Tatva Direct" className="portal-pill-nav__logo" />
        </div>

        <nav className="portal-pill-nav__scroll" aria-label={ariaLabel}>
          <ul className="portal-pill-nav__list">
            {navGroups.map((group, groupIndex) => (
              <React.Fragment key={group.id}>
                {groupIndex > 0 ? <li className="portal-pill-nav__divider" aria-hidden="true" /> : null}
                {group.items.map((item) => (
                  <NavItem
                    key={item.path}
                    {...item}
                    badges={badges}
                    isItemActive={resolveActive}
                    onNavigate={onNavigate}
                    onPrefetch={onPrefetch}
                  />
                ))}
              </React.Fragment>
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
