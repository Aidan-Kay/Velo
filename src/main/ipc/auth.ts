import { ipcMain } from "electron";

import { getDomain } from "../shared/constants";
import * as vintedApi from "../vinted/api";
import type { IpcDeps } from "./types";

export function setupAuthIpc({ getSettings, polling }: IpcDeps): void {
  ipcMain.handle("vinted-login", async () => {
    const domain = getDomain(getSettings().site);
    const result = await vintedApi.login(domain);
    if (result.success) polling.start();
    return result;
  });

  ipcMain.handle("vinted-check-session", async () => {
    const domain = getDomain(getSettings().site);
    const result = await vintedApi.checkSession(domain);
    if (result.loggedIn) polling.start();
    return result;
  });

  ipcMain.handle("vinted-logout", async () => {
    polling.stop();
    const domain = getDomain(getSettings().site);
    return vintedApi.logout(domain);
  });

  ipcMain.handle("vinted-login-status", () => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getLoginStatus(domain);
  });
}
