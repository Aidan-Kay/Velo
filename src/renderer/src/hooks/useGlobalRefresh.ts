import { useEffect } from "react";

/**
 * Listen for the global "app:refresh" CustomEvent dispatched by the keyboard
 * shortcut handler in App.tsx and invoke the supplied handler when the event's
 * `detail.page` matches this page. All pages stay mounted, so the page filter
 * prevents every mounted page from refreshing simultaneously.
 */
export function useGlobalRefresh(page: string, handler: () => void): void {
  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ page?: string }>).detail;
      if (detail?.page === page) handler();
    };
    window.addEventListener("app:refresh", listener);
    return () => window.removeEventListener("app:refresh", listener);
  }, [page, handler]);
}
