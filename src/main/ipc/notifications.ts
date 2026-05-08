import { ipcMain } from "electron";

import * as notificationManager from "../notifications";
import type { IpcDeps } from "./types";

export function setupNotificationsIpc({ state, notifDeps }: IpcDeps): void {
  ipcMain.handle("get-notifications", () => state.notifications);

  ipcMain.handle("mark-notification-read", (_event, id: string) => {
    state.notifications = notificationManager.markRead(notifDeps, state.notifications, id);
  });

  ipcMain.handle("mark-all-notifications-read", () => {
    state.notifications = notificationManager.markAllRead(notifDeps, state.notifications);
  });

  ipcMain.handle("clear-notifications", () => {
    state.notifications = notificationManager.clearAll(notifDeps);
  });
}
