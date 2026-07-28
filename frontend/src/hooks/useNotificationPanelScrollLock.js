import { useEffect } from 'react';

/**
 * Keep page scroll fixed while a notification panel is open, and prevent
 * wheel/touch scroll chaining from the panel list into background scrollers
 * (body / portal main).
 *
 * @param {boolean} enabled
 * @param {React.RefObject<HTMLElement|null>} [scrollContainerRef] - list element that should scroll
 */
export function useNotificationPanelScrollLock(enabled, scrollContainerRef) {
  useEffect(() => {
    if (!enabled) return undefined;

    const body = document.body;
    const html = document.documentElement;
    const portalMain = document.querySelector('.portal-shell-content');

    const previous = {
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      mainOverflow: portalMain instanceof HTMLElement ? portalMain.style.overflow : '',
      mainOverscroll: portalMain instanceof HTMLElement ? portalMain.style.overscrollBehavior : ''
    };

    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    html.style.overflow = 'hidden';
    if (portalMain instanceof HTMLElement) {
      portalMain.style.overflow = 'hidden';
      portalMain.style.overscrollBehavior = 'none';
    }

    let touchStartY = 0;

    const getScrollEl = () => {
      const explicit = scrollContainerRef?.current;
      return explicit instanceof HTMLElement ? explicit : null;
    };

    const shouldBlockScroll = (target, deltaY) => {
      const scrollEl = getScrollEl();
      if (!scrollEl) return true;
      if (!(target instanceof Node) || !scrollEl.contains(target)) return true;

      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);
      if (maxScroll <= 0) return true;

      const atTop = scrollTop <= 0;
      const atBottom = scrollTop >= maxScroll - 1;
      if (deltaY < 0 && atTop) return true;
      if (deltaY > 0 && atBottom) return true;
      return false;
    };

    const onWheel = (event) => {
      if (shouldBlockScroll(event.target, event.deltaY)) {
        event.preventDefault();
      }
    };

    const onTouchStart = (event) => {
      if (event.touches?.length) {
        touchStartY = event.touches[0].clientY;
      }
    };

    const onTouchMove = (event) => {
      if (!event.touches?.length) return;
      const deltaY = touchStartY - event.touches[0].clientY;
      if (shouldBlockScroll(event.target, deltaY)) {
        event.preventDefault();
      }
    };

    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });

    return () => {
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      html.style.overflow = previous.htmlOverflow;
      if (portalMain instanceof HTMLElement) {
        portalMain.style.overflow = previous.mainOverflow;
        portalMain.style.overscrollBehavior = previous.mainOverscroll;
      }
      document.removeEventListener('wheel', onWheel, { capture: true });
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
    };
  }, [enabled, scrollContainerRef]);
}
