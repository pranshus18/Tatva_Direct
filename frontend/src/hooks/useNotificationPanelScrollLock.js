import { useEffect } from 'react';

/**
 * Isolate overscroll inside the notification list so wheel/touch does not
 * chain awkwardly — without locking page scroll or blocking clicks.
 *
 * @param {boolean} enabled
 * @param {React.RefObject<HTMLElement|null>} [scrollContainerRef]
 */
export function useNotificationPanelScrollLock(enabled, scrollContainerRef) {
  useEffect(() => {
    if (!enabled) return undefined;

    const scrollEl = scrollContainerRef?.current;
    if (!(scrollEl instanceof HTMLElement)) return undefined;

    const previousOverscroll = scrollEl.style.overscrollBehavior;
    scrollEl.style.overscrollBehavior = 'contain';

    return () => {
      scrollEl.style.overscrollBehavior = previousOverscroll;
    };
  }, [enabled, scrollContainerRef]);
}
