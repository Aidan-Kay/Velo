import { ipcMain } from "electron";

import type { AppSettings } from "../../shared/types";
import { saveSettings } from "../persistence";
import type { IpcDeps } from "./types";

export function setupSettingsIpc({ state, getSettings, setSettings, relisting }: IpcDeps): void {
  ipcMain.handle("get-settings", () => getSettings());

  ipcMain.handle("save-settings", (_event, newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    return { success: true };
  });

  // ─── Relisting queue ─────────────────────────────────────────────────────

  ipcMain.handle("get-relist-queue", () => relisting.getQueue());

  ipcMain.handle("queue-for-relist", (_event, itemId: string, soldAt: string) => {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) throw new Error("Item not found");
    relisting.queueForRelist(item, soldAt);
    return { success: true };
  });

  ipcMain.handle("remove-from-relist-queue", (_event, itemId: string) => {
    relisting.removeFromQueue(itemId);
    return { success: true };
  });
}
