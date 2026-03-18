import React, { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Toast, { ToastData } from "./components/Toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { ListingSyncProvider } from "./context/ListingSyncContext";
import Items from "./pages/Items";
import Listings from "./pages/Listings";
import Orders from "./pages/Orders";
import Settings from "./pages/Settings";

type Page = "listings" | "items" | "orders" | "settings";

let toastIdCounter = 0;

const App: React.FC = () => {
  const [page, setPage] = useState<Page>("listings");
  const [loggedIn, setLoggedIn] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  // ─── Toast helpers ──────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: "success" | "error" | "info" = "info", duration = 4000) => {
    const id = ++toastIdCounter;
    const toast: ToastData = { id, message, type };
    setToasts((prev) => [...prev, toast]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

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
      setPage("listings");
    } catch {
      addToast("Logout failed", "error");
    }
  }, [addToast]);

  // ─── Check session on mount ─────────────────────────────────────────────
  useEffect(() => {
    window.api.checkSession().then((result) => {
      setLoggedIn(result.loggedIn);
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
    window.api.onSessionStatus((status) => {
      setLoggedIn(status.loggedIn);
      if (!status.loggedIn) {
        addToast("Session expired — please log in again", "error");
      }
    });

    window.api.onItemRestocked((data) => {
      addToast(`Restocked: ${data.item.title}`, "success");
    });

    // Listings/orders polling events are handled by individual page components
    // (they listen via onListingsUpdated / onOrdersUpdated)
  }, [addToast]);

  // ─── Render page ───────────────────────────────────────────────────────
  const renderPage = () => {
    switch (page) {
      case "listings":
        return <Listings loggedIn={loggedIn} addToast={addToast} />;
      case "items":
        return <Items loggedIn={loggedIn} addToast={addToast} />;
      case "orders":
        return <Orders loggedIn={loggedIn} addToast={addToast} />;
      case "settings":
        return <Settings addToast={addToast} />;
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Custom titlebar drag region */}
        <div className="titlebar" />

        <div className="flex flex-1 min-h-0">
          <Sidebar
            currentPage={page}
            onNavigate={setPage}
            loggedIn={loggedIn}
            loggingIn={loggingIn}
            onLogin={handleLogin}
            onLogout={handleLogout}
          />

          <main className="flex-1 overflow-y-auto p-6">
            <ListingSyncProvider loggedIn={loggedIn}>{renderPage()}</ListingSyncProvider>
          </main>
        </div>
      </div>

      {/* Toast stack — z-[100] keeps toasts above any modal overlays (z-50) */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </TooltipProvider>
  );
};

export default App;
