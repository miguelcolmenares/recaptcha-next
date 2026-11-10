import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

interface UseLazyVisibilityOptions {
  anchorRef: RefObject<HTMLElement | null>;
  siteKey?: string;
  lazy: boolean;
  rootMargin: string;
}

/** Activates once near the viewport, on explicit activation, or when eager loading is requested. */
export function useLazyVisibility({
  anchorRef,
  siteKey,
  lazy,
  rootMargin,
}: UseLazyVisibilityOptions) {
  const [visible, setVisible] = useState(!lazy);
  // Once eager loading is requested, later lazy changes must not stop the lifecycle.
  if (!lazy && !visible) setVisible(true);
  const activate = useCallback(() => setVisible(true), []);

  useEffect(() => {
    // No site key means no rendered anchor yet. Wait until it exists.
    if (!lazy || visible || !siteKey) return;
    const anchor = anchorRef.current;
    const target = anchor?.closest("form") ?? anchor?.parentElement ?? anchor;
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [lazy, visible, rootMargin, siteKey, anchorRef]);

  return { visible, activate };
}
