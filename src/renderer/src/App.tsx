import { TooltipProvider } from "@shared/components/ui/tooltip";
import React, { Suspense, lazy, useCallback, useEffect, useTransition, useState } from "react";
import NotificationBell from "./components/NotificationBell";
import Sidebar from "./components/Sidebar";
import { ItemsSyncProvider } from "./context/ItemsSyncContext";
import { ListingSyncProvider } from "./context/ListingSyncContext";
import { NotificationSyncProvider } from "./context/NotificationSyncContext";
import { OffersSyncProvider } from "./context/OffersSyncContext";
import { OrdersSyncProvider } from "./context/OrdersSyncContext";
import { PurchasesSyncProvider } from "./context/PurchasesSyncContext";
import { ToastProvider, useToast } from "./context/ToastContext";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Listings = lazy(() => import("./pages/Listings"));
const Items = lazy(() => import("./pages/Items"));
const Orders = lazy(() => import("./pages/Orders"));
const Purchases = lazy(() => import("./pages/Purchases"));
const Offers = lazy(() => import("./pages/Offers"));
const Settings = lazy(() => import("./pages/Settings"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));

const PageLoadingSpinner: React.FC = () => (
  <div className="flex items-center justify-center py-16">
    <svg className="animate-spin h-6 w-6 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  </div>
);

type Page = "dashboard" | "listings" | "items" | "orders" | "purchases" | "offers" | "settings" | "activity";

const PAGE_LABELS: Record<Page, string> = {
  dashboard: "Dashboard",
  listings: "Listings",
  items: "Items",
  orders: "Orders",
  purchases: "Purchases",
  offers: "Offers",
  settings: "Settings",
  activity: "Activity Log",
};

const AppContent: React.FC = () => {
  const [displayPage, setDisplayPage] = useState<Page>("dashboard");
  const [page, setPage] = useState<Page>("dashboard");
  const [isPending, startTransition] = useTransition();

  const navigatePage = useCallback((next: Page) => {
    setDisplayPage(next);
  }, []);

  // Defer page content rendering so sidebar paints its active state first
  useEffect(() => {
    if (displayPage === page) return;
    startTransition(() => {
      setPage(displayPage);
    });
  }, [displayPage, page]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const { addToast } = useToast();

  // ─── Login / logout ────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    if (loggingIn) return;
    setLoggingIn(true);
    try {
      const result = await window.api.login();
      if (result.success) {
        setLoggedIn(true);
        addToast("Logged in successfully", "success");
      } else {
        addToast(result.error ?? "Login failed", "error");
      }
    } catch {
      addToast("Login failed", "error");
    } finally {
      setLoggingIn(false);
    }
  }, [loggingIn, addToast]);

  const handleLogout = useCallback(async () => {
    try {
      await window.api.logout();
      setLoggedIn(false);
      addToast("Logged out", "info");
      navigatePage("dashboard");
    } catch {
      addToast("Logout failed", "error");
    }
  }, [addToast]);

  // ─── Check session on mount ─────────────────────────────────────────────
  useEffect(() => {
    window.api
      .checkSession()
      .then((result) => {
        setLoggedIn(result.loggedIn);
        setCheckingSession(false);
      })
      .catch(() => {
        setCheckingSession(false);
      });
  }, []);

  // ─── Apply persisted dark mode on mount ────────────────────────────────
  useEffect(() => {
    window.api.getSettings().then((s) => {
      document.body.classList.toggle("dark", s.darkMode !== false);
    });
  }, []);

  // ─── Listen for push events from main process ──────────────────────────
  useEffect(() => {
    const cleanupSession = window.api.onSessionStatus((status) => {
      setLoggedIn(status.loggedIn);
      if (!status.loggedIn) {
        addToast("Session expired — please log in again", "error");
      }
    });

    const cleanupRelist = window.api.onItemRelisted((data) => {
      addToast(`Relisted: ${data.item.title}`, "success");
    });

    // Listings/orders polling events are handled by individual page components
    // (they listen via onListingsUpdated / onOrdersUpdated)

    return () => {
      cleanupSession();
      cleanupRelist();
    };
  }, [addToast]);

  // ─── Global keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const PAGE_KEYS: Record<string, Page> = {
      d: "dashboard",
      l: "listings",
      i: "items",
      o: "orders",
      p: "purchases",
      f: "offers",
      s: "settings",
      a: "activity",
    };

    const isEditableTarget = (el: Element | null): boolean => {
      if (!el) return false;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLElement && el.isContentEditable) return true;
      return false;
    };

    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const editable = isEditableTarget(document.activeElement);

      // "/" always focuses search and prevents the literal "/" being typed,
      // even when an input is focused (lets the user jump between search bars).
      if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("app:focus-search", { detail: { page: displayPage } }));
        return;
      }

      if (editable) return;

      const key = e.key.toLowerCase();
      if (key in PAGE_KEYS) {
        e.preventDefault();
        setDisplayPage(PAGE_KEYS[key]);
        return;
      }
      if (key === "r") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("app:refresh", { detail: { page: displayPage } }));
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [displayPage]);

  return (
    <TooltipProvider delay={200}>
      <NotificationSyncProvider onNavigate={(p) => navigatePage(p as Page)}>
        <div className="flex flex-col h-screen overflow-hidden">
          {/* Custom titlebar drag region — page title centred, controls on right */}
          <div className="titlebar flex items-center justify-end border-b border-border/50 pr-[140px] relative">
            <span className="text-sm font-semibold text-foreground select-none absolute left-1/2 -translate-x-1/2">{PAGE_LABELS[displayPage]}</span>
            <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              <NotificationBell />
            </div>
          </div>

          <div className="flex flex-1 min-h-0">
            <Sidebar
              currentPage={displayPage}
              onNavigate={navigatePage}
              loggedIn={loggedIn}
              checkingSession={checkingSession}
              loggingIn={loggingIn}
              onLogin={handleLogin}
              onLogout={handleLogout}
            />

            <main className="relative flex-1 overflow-hidden">
              <ListingSyncProvider loggedIn={loggedIn}>
                <OrdersSyncProvider loggedIn={loggedIn}>
                  <PurchasesSyncProvider loggedIn={loggedIn}>
                    <OffersSyncProvider loggedIn={loggedIn}>
                      <ItemsSyncProvider>
                        <Suspense
                          fallback={
                            <div className="page-container flex items-center justify-center">
                              <PageLoadingSpinner />
                            </div>
                          }
                        >
                          <div className="page-container relative">
                            {isPending && (
                              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                                <PageLoadingSpinner />
                              </div>
                            )}
                            {page === "dashboard" && <Dashboard loggedIn={loggedIn} />}
                            {page === "listings" && <Listings loggedIn={loggedIn} />}
                            {page === "items" && <Items loggedIn={loggedIn} />}
                            {page === "orders" && <Orders loggedIn={loggedIn} isActive />}
                            {page === "purchases" && <Purchases loggedIn={loggedIn} />}
                            {page === "offers" && <Offers loggedIn={loggedIn} isActive />}
                            {page === "settings" && <Settings />}
                            {page === "activity" && <ActivityLog />}
                          </div>
                        </Suspense>
                      </ItemsSyncProvider>
                    </OffersSyncProvider>
                  </PurchasesSyncProvider>
                </OrdersSyncProvider>
              </ListingSyncProvider>
            </main>
          </div>
        </div>
      </NotificationSyncProvider>
    </TooltipProvider>
  );
};

const App: React.FC = () => (
  <ToastProvider>
    <AppContent />
  </ToastProvider>
);

export default App;
