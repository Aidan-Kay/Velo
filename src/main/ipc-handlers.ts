import { setupAiIpc } from "./ipc/ai";
import { setupAuthIpc } from "./ipc/auth";
import { setupCatalogIpc } from "./ipc/catalog";
import { setupInboxIpc } from "./ipc/inbox";
import { setupItemsIpc } from "./ipc/items";
import { setupListingsIpc } from "./ipc/listings";
import { setupLogsIpc } from "./ipc/logs";
import { setupNotificationsIpc } from "./ipc/notifications";
import { setupOffersIpc } from "./ipc/offers";
import { setupOrdersIpc } from "./ipc/orders";
import { setupPriceRulesIpc } from "./ipc/price-rules";
import { setupPurchasesIpc } from "./ipc/purchases";
import { setupSettingsIpc } from "./ipc/settings";
import { setupSystemIpc } from "./ipc/system";
import type { IpcDeps } from "./ipc/types";

export type { IpcDeps } from "./ipc/types";

/**
 * Register all ipcMain handlers. Each domain module owns a focused subset
 * of channels (auth, listings, orders, etc.) and exposes a single setup()
 * function, keeping this orchestrator small and easy to navigate.
 */
export function setupIpc(deps: IpcDeps): void {
  setupAuthIpc(deps);
  setupListingsIpc(deps);
  setupOrdersIpc(deps);
  setupPurchasesIpc(deps);
  setupOffersIpc(deps);
  setupInboxIpc(deps);
  setupItemsIpc(deps);
  setupCatalogIpc(deps);
  setupSettingsIpc(deps);
  setupNotificationsIpc(deps);
  setupSystemIpc(deps);
  setupLogsIpc(deps);
  setupPriceRulesIpc(deps);
  setupAiIpc(deps);
}
