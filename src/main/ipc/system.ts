import { ipcMain, shell } from "electron";

import type { IpcDeps } from "./types";

export function setupSystemIpc(_deps: IpcDeps): void {
  ipcMain.handle("open-external", async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        await shell.openExternal(url);
      }
    } catch {
      // Invalid URL — ignore
    }
  });
}
