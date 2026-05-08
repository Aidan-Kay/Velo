import { ipcMain } from "electron";

import type { IpcDeps } from "./types";

export function setupPurchasesIpc({ state, polling }: IpcDeps): void {
  ipcMain.handle("get-my-purchases", () => {
    return { purchases: state.cachedPurchases, pagination: state.cachedPurchasesPagination };
  });

  ipcMain.handle("refresh-my-purchases", async () => polling.refreshPurchases());

  ipcMain.handle("refresh-single-purchase", async (_event, transactionId: number) => {
    return polling.refreshSinglePurchase(transactionId);
  });
}
