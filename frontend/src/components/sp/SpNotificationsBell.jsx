import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { authFetch, getApiUrl } from '@/config/api';
import { formatDateIST } from '@/utils/dateTime';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

function formatNotificationDate(dateString) {
  return formatDateIST(dateString, 'Just now');
}

export default function SpNotificationsBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef(null);
  const isDashboard = location.pathname === '/dashboard';
  const [showDropdown, setShowDropdown] = useState(false);
  const [dashboardPanelOpen, setDashboardPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const panelOpen = isDashboard ? dashboardPanelOpen : showDropdown;

  const fetchNotifications = async () => {
    try {
      const res = await authFetch('/api/supplier/notifications');
      const data = await res.json();
      if (data.status === 'success') {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount ?? 0);
      } else {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (panelOpen) fetchNotifications();
  }, [panelOpen]);

  useEffect(() => {
    if (isDashboard) {
      setShowDropdown(false);
    } else {
      setDashboardPanelOpen(false);
      window.dispatchEvent(
        new CustomEvent('sp-notifications-panel-toggle', { detail: { visible: false } })
      );
    }
  }, [isDashboard]);

  useEffect(() => {
    const onPanelToggle = (event) => {
      if (typeof event.detail?.visible === 'boolean') {
        setDashboardPanelOpen(event.detail.visible);
      }
    };
    window.addEventListener('sp-notifications-panel-toggle', onPanelToggle);
    return () => window.removeEventListener('sp-notifications-panel-toggle', onPanelToggle);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      const inBell = containerRef.current?.contains(event.target);
      const inSidebarPanel = event.target.closest('[data-sp-notification-container]');
      if (isDashboard) {
        if (dashboardPanelOpen && !inBell && !inSidebarPanel) {
          setDashboardPanelOpen(false);
          window.dispatchEvent(
            new CustomEvent('sp-notifications-panel-toggle', { detail: { visible: false } })
          );
        }
        return;
      }
      if (showDropdown && !inBell) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDashboard, showDropdown, dashboardPanelOpen]);

  const toggleNotifications = () => {
    if (isDashboard) {
      const next = !dashboardPanelOpen;
      setDashboardPanelOpen(next);
      window.dispatchEvent(
        new CustomEvent('sp-notifications-panel-toggle', { detail: { visible: next } })
      );
      return;
    }
    setShowDropdown((prev) => !prev);
  };

  const markNotificationAsRead = async (notificationId) => {
    try {
      await fetch(getApiUrl(`/api/supplier/notifications/${notificationId}/read`), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });
      fetchNotifications();
    } catch (e) {
      console.error('[SP Notifications] Failed to mark as read:', e);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (unreadCount < 1 || markingAllRead) return;
    setMarkingAllRead(true);
    try {
      await fetch(getApiUrl('/api/supplier/notifications/read-all'), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      await fetchNotifications();
    } catch (e) {
      console.error('[SP Notifications] Failed to mark all as read:', e);
    } finally {
      setMarkingAllRead(false);
    }
  };

  const getOrderRef = (notification) =>
    notification?.related_order?.order_number ||
    notification?.relatedOrder?.orderNumber ||
    null;

  const handleNotificationClick = (notification) => {
    const notificationId = notification.id || notification._id;
    const isRead = notification.is_read || notification.isRead;
    if (!isRead && notificationId) markNotificationAsRead(notificationId);

    const orderRef = getOrderRef(notification);
    if (orderRef) {
      setShowDropdown(false);
      setDashboardPanelOpen(false);
      window.dispatchEvent(
        new CustomEvent('sp-notifications-panel-toggle', { detail: { visible: false } })
      );
      if (location.pathname === '/dashboard') {
        window.dispatchEvent(
          new CustomEvent('sp-open-order', { detail: { orderRef } })
        );
      } else {
        sessionStorage.setItem('pendingSpOrderView', orderRef);
        navigate('/dashboard');
      }
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative"
        onClick={toggleNotifications}
        aria-label={panelOpen ? 'Hide notifications' : 'Show notifications'}
        aria-expanded={panelOpen}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </Button>

      {!isDashboard && showDropdown ? (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  {unreadCount} new
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={unreadCount < 1 || markingAllRead}
                onClick={markAllNotificationsAsRead}
              >
                {markingAllRead ? 'Marking…' : 'Mark all read'}
              </Button>
            </div>
          </div>
          <ScrollArea className="max-h-[min(70vh,400px)]">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              notifications.map((notification) => {
                const notificationId = notification.id || notification._id;
                const isRead = notification.is_read || notification.isRead;
                const meta =
                  notification?.metadata && typeof notification.metadata === 'object'
                    ? notification.metadata
                    : {};
                const receiptPdfUrl = meta.receiptPdfUrl || null;
                const invoicePdfUrl = meta.invoicePdfUrl || null;

                return (
                  <button
                    key={notificationId}
                    type="button"
                    className={cn(
                      'block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/50',
                      isRead ? 'bg-background' : 'bg-primary/5'
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="text-sm font-medium text-foreground">{notification.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{notification.message}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground/80">
                      {formatNotificationDate(notification.created_at || notification.createdAt)}
                    </div>
                    {(receiptPdfUrl || invoicePdfUrl) && (
                      <div className="mt-2 flex gap-2 text-xs text-primary">
                        {receiptPdfUrl ? (
                          <a
                            href={receiptPdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Receipt
                          </a>
                        ) : null}
                        {invoicePdfUrl ? (
                          <a
                            href={invoicePdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Invoice
                          </a>
                        ) : null}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
