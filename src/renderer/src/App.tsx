import { TooltipProvider } from "@shared/components/ui/tooltip";
import React, { useCallback, useEffect, useState } from "react";
import NotificationBell from "./components/NotificationBell";
import Sidebar from "./components/Sidebar";
import { ItemsSyncProvider } from "./context/ItemsSyncContext";
import { ListingSyncProvider } from "./context/ListingSyncContext";
import { NotificationSyncProvider } from "./context/NotificationSyncContext";
import { OffersSyncProvider } from "./context/OffersSyncContext";
import { OrdersSyncProvider } from "./context/OrdersSyncContext";
import { PurchasesSyncProvider } from "./context/PurchasesSyncContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import ActivityLog from "./pages/ActivityLog";
import Automations from "./pages/Automations";
import Dashboard from "./pages/Dashboard";
import Inbox from "./pages/Inbox";
import Items from "./pages/Items";
import Listings from "./pages/Listings";
import Offers from "./pages/Offers";
import Orders from "./pages/Orders";
import Purchases from "./pages/Purchases";
import Settings from "./pages/Settings";

type Page = "dashboard" | "listings" | "items" | "orders" | "purchases" | "offers" | "automations" | "inbox" | "settings" | "activity";

const PAGE_LABELS: Record<Page, string> = {
  dashboard: "Dashboard",
  listings: "Listings",
  items: "Items",
  orders: "Orders",
  purchases: "Purchases",
  offers: "Offers",
  automations: "Automations",
  inbox: "Inbox",
  settings: "Settings",
  activity: "Activity Log",
};

const AppContent: React.FC = () => {
  const [page, setPage] = useState<Page>("dashboard");
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
      setPage("dashboard");
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
      n: "inbox",
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
        window.dispatchEvent(new CustomEvent("app:focus-search", { detail: { page } }));
        return;
      }

      if (editable) return;

      const key = e.key.toLowerCase();
      if (key in PAGE_KEYS) {
        e.preventDefault();
        setPage(PAGE_KEYS[key]);
        return;
      }
      if (key === "r") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("app:refresh", { detail: { page } }));
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page]);

  return (
    <TooltipProvider delay={200}>
      <NotificationSyncProvider onNavigate={(p) => setPage(p as Page)}>
        <div className="flex flex-col h-screen overflow-hidden">
          {/* Custom titlebar drag region — page title on left, controls on right */}
          <div className="titlebar flex items-center justify-between border-b border-border/50 pl-4 pr-[140px]">
            <span className="text-sm font-semibold text-foreground select-none">{PAGE_LABELS[page]}</span>
            <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              <NotificationBell />
            </div>
          </div>

          <div className="flex flex-1 min-h-0">
            <Sidebar
              currentPage={page}
              onNavigate={setPage}
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
                        {/* All pages stay mounted and laid-out so navigation is instant.
                          Inactive pages use content-visibility:auto + visibility:hidden
                          so the browser skips layout/paint entirely for off-screen content. */}
                        <div className={page === "dashboard" ? "page-container" : "page-container page-hidden"}>
                          <Dashboard loggedIn={loggedIn} />
                        </div>
                        <div className={page === "listings" ? "page-container" : "page-container page-hidden"}>
                          <Listings loggedIn={loggedIn} />
                        </div>
                        <div className={page === "items" ? "page-container" : "page-container page-hidden"}>
                          <Items loggedIn={loggedIn} />
                        </div>
                        <div className={page === "orders" ? "page-container" : "page-container page-hidden"}>
                          <Orders loggedIn={loggedIn} isActive={page === "orders"} />
                        </div>
                        <div className={page === "purchases" ? "page-container" : "page-container page-hidden"}>
                          <Purchases loggedIn={loggedIn} />
                        </div>
                        <div className={page === "offers" ? "page-container" : "page-container page-hidden"}>
                          <Offers loggedIn={loggedIn} isActive={page === "offers"} />
                        </div>
                        <div className={page === "automations" ? "page-container" : "page-container page-hidden"}>
                          <Automations />
                        </div>
                        <div className={page === "inbox" ? "page-container" : "page-container page-hidden"}>
                          <Inbox loggedIn={loggedIn} />
                        </div>
                        <div className={page === "settings" ? "page-container" : "page-container page-hidden"}>
                          <Settings />
                        </div>
                        <div className={page === "activity" ? "page-container" : "page-container page-hidden"}>
                          <ActivityLog />
                        </div>
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
