import * as crypto from "crypto";
import type { BrowserWindow } from "electron";
import { Notification } from "electron";
import type { AppNotification, AppSettings } from "../shared/types";

const MAX_NOTIFICATIONS = 100;

interface NotificationDeps {
  getNotifications: () => AppNotification[];
  getSettings: () => AppSettings;
  getWindow: () => BrowserWindow | null;
  saveNotifications: (notifications: AppNotification[]) => void;
}

function pushToRenderer(deps: NotificationDeps, notifications: AppNotification[]): void {
  const win = deps.getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("notifications-updated", notifications);
  }
}

export function createNotification(
  deps: NotificationDeps,
  notifications: AppNotification[],
  type: AppNotification["type"],
  title: string,
  message: string,
  referenceId: number,
  navigateTo: AppNotification["navigateTo"],
): AppNotification[] {
  // Deduplication: skip if notification with same type + referenceId already exists
  if (notifications.some((n) => n.type === type && n.referenceId === referenceId)) {
    return notifications;
  }

  const notification: AppNotification = {
    id: crypto.randomUUID(),
    type,
    title,
    message,
    timestamp: new Date().toISOString(),
    read: false,
    referenceId,
    navigateTo,
  };

  let updated = [...notifications, notification];
  if (updated.length > MAX_NOTIFICATIONS) {
    updated = updated.slice(-MAX_NOTIFICATIONS);
  }

  deps.saveNotifications(updated);
  pushToRenderer(deps, updated);

  // Show native Windows notification if enabled
  const settings = deps.getSettings();
  if (settings.enableNativeNotifications && Notification.isSupported()) {
    const nativeNotification = new Notification({ title, body: message });
    nativeNotification.on("click", () => {
      const win = deps.getWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send("notification-navigate", navigateTo, referenceId);
      }
    });
    nativeNotification.show();
  }

  return updated;
}

export function markRead(deps: NotificationDeps, notifications: AppNotification[], id: string): AppNotification[] {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx < 0) return notifications;

  const updated = [...notifications];
  updated[idx] = { ...updated[idx], read: true };
  deps.saveNotifications(updated);
  pushToRenderer(deps, updated);
  return updated;
}

export function markAllRead(deps: NotificationDeps, notifications: AppNotification[]): AppNotification[] {
  const updated = notifications.map((n) => (n.read ? n : { ...n, read: true }));
  deps.saveNotifications(updated);
  pushToRenderer(deps, updated);
  return updated;
}

export function clearAll(deps: NotificationDeps): AppNotification[] {
  const updated: AppNotification[] = [];
  deps.saveNotifications(updated);
  pushToRenderer(deps, updated);
  return updated;
}
