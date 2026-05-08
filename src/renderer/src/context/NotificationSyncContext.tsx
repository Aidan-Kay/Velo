import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppNotification } from "../../../shared/types";

// ─── Context types ────────────────────────────────────────────────────────────

export interface HighlightRef {
  page: "orders" | "offers";
  referenceId: number;
}

interface NotificationSyncState {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  highlightRef: HighlightRef | null;
  setHighlight: (ref: HighlightRef) => void;
  consumeHighlight: () => HighlightRef | null;
}

const NotificationSyncContext = createContext<NotificationSyncState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface NotificationSyncProviderProps {
  onNavigate: (page: string) => void;
  children: React.ReactNode;
}

export const NotificationSyncProvider: React.FC<NotificationSyncProviderProps> = ({ onNavigate, children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const highlightRefState = useRef<HighlightRef | null>(null);
  const [, forceUpdate] = useState(0);

  // Load on mount
  useEffect(() => {
    window.api.getNotifications().then(setNotifications);
  }, []);

  // Listen for push updates from main process
  useEffect(() => {
    const cleanup = window.api.onNotificationsUpdated((updated: AppNotification[]) => {
      setNotifications(updated);
    });
    return cleanup;
  }, []);

  // Listen for native notification click navigation
  useEffect(() => {
    const cleanup = window.api.onNotificationNavigate((page: string, referenceId: number) => {
      highlightRefState.current = { page: page as "orders" | "offers", referenceId };
      forceUpdate((n) => n + 1);
      onNavigate(page);
    });
    return cleanup;
  }, [onNavigate]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await window.api.markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await window.api.markAllNotificationsRead();
  }, []);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    await window.api.clearNotifications();
  }, []);

  const setHighlight = useCallback(
    (ref: HighlightRef) => {
      highlightRefState.current = ref;
      forceUpdate((n) => n + 1);
      onNavigate(ref.page);
    },
    [onNavigate],
  );

  const consumeHighlight = useCallback((): HighlightRef | null => {
    const current = highlightRefState.current;
    highlightRefState.current = null;
    return current;
  }, []);

  const value = useMemo<NotificationSyncState>(
    () => ({
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      clearAll,
      highlightRef: highlightRefState.current,
      setHighlight,
      consumeHighlight,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notifications, unreadCount, markRead, markAllRead, clearAll, setHighlight, consumeHighlight],
  );

  return <NotificationSyncContext.Provider value={value}>{children}</NotificationSyncContext.Provider>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotificationSync(): NotificationSyncState {
  const ctx = useContext(NotificationSyncContext);
  if (!ctx) throw new Error("useNotificationSync must be used within a NotificationSyncProvider");
  return ctx;
}
