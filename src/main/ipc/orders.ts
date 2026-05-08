import { ipcMain, shell } from "electron";

import { titleKey } from "../../shared/lib/match";
import { getPaperSizesForPrinter, listPrinters, printShippingLabel } from "../label-printer";
import { saveItems } from "../persistence";
import { getDomain } from "../shared/constants";
import * as vintedApi from "../vinted/api";
import type { IpcDeps } from "./types";

export function setupOrdersIpc({ state, getSettings, polling }: IpcDeps): void {
  ipcMain.handle("get-my-orders", () => {
    return { orders: state.cachedOrders, pagination: state.cachedOrdersPagination };
  });

  ipcMain.handle("refresh-my-orders", async () => polling.refreshOrders());

  ipcMain.handle("refresh-single-order", async (_event, transactionId: number) => {
    return polling.refreshSingleOrder(transactionId);
  });

  ipcMain.handle("replenish-order-stock", (_event, transactionId: number) => {
    const order = state.cachedOrders.find((o) => o.transactionId === transactionId);
    if (!order) throw new Error("Order not found");

    const titlesToReplenish: string[] = [];
    if (order.isBundle && order.bundleItems.length > 0) {
      titlesToReplenish.push(...order.bundleItems.map((b) => b.title));
    } else {
      titlesToReplenish.push(order.itemTitle);
    }

    let replenished = 0;
    for (const title of titlesToReplenish) {
      const key = titleKey(title);
      const item = state.items.find((i) => titleKey(i.title) === key);
      if (item) {
        item.stock += 1;
        replenished++;
      }
    }

    if (replenished > 0) saveItems(state.items);

    polling.applyOrderPatch(transactionId, { stockReplenished: true });
    return { success: true };
  });

  ipcMain.handle("set-order-packed", (_event, transactionId: number, packed: boolean) => {
    const updated = polling.applyOrderPatch(transactionId, { packed });
    if (!updated) throw new Error("Order not found");
    return { success: true };
  });

  ipcMain.handle("get-transaction-detail", async (_event, transactionId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getTransactionDetail(transactionId, domain);
  });

  ipcMain.handle("get-shipping-label-url", async (_event, shipmentId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getShippingLabelUrl(shipmentId, domain);
  });

  ipcMain.handle("get-journey-summary", async (_event, transactionId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getJourneySummary(transactionId, domain);
  });

  // ─── Labels / Printing ────────────────────────────────────────────────────

  ipcMain.handle("get-printers", async () => listPrinters());

  ipcMain.handle("get-paper-sizes", async (_event, printerName: string) => {
    return getPaperSizesForPrinter(printerName);
  });

  ipcMain.handle("print-shipping-label", async (_event, shipmentId: number, courier: string) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    const result = await vintedApi.getShippingLabelUrl(shipmentId, domain);
    if (!result.label_url) throw new Error("No label URL available");

    return printShippingLabel(
      result.label_url,
      courier,
      settings.labelPrinter?.printerName || undefined,
      settings.labelPrinter?.paperSize || undefined,
    );
  });

  ipcMain.handle("open-raw-shipping-label", async (_event, shipmentId: number) => {
    const domain = getDomain(getSettings().site);
    const result = await vintedApi.getShippingLabelUrl(shipmentId, domain);
    if (!result.label_url) throw new Error("No label URL available");
    await shell.openExternal(result.label_url);
    return { success: true };
  });

  ipcMain.handle("order-shipping-label", async (event, transactionId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);

    const sendProgress = (step: string): void => {
      event.sender.send("label-generation-progress", { transactionId, step });
    };

    sendProgress("Fetching shipping address");

    const addressResult = await vintedApi.getDefaultShippingAddress(domain);
    const sellerAddressId = addressResult.user_address?.id;
    if (!sellerAddressId) throw new Error("No default shipping address configured");

    const order = state.cachedOrders.find((o) => o.transactionId === transactionId);
    let labelType = settings.preferredLabelType || "printable";

    if (order?.shipmentId) {
      try {
        sendProgress("Obtaining label options for courier");
        const labelOpts = await vintedApi.getShipmentLabelOptions(order.shipmentId, domain);
        if (labelOpts.label_types.length > 0 && !labelOpts.label_types.includes(labelType)) {
          labelType = labelOpts.label_types[0] as "printable" | "digital";
          console.log(`[label] Preferred label type not available, using "${labelType}" instead`);
        }
      } catch (err) {
        console.warn(`[label] Failed to fetch label options, using preferred type "${labelType}":`, (err as Error).message);
      }
    }

    sendProgress("Ordering a printable label");
    await vintedApi.orderShippingLabel(transactionId, sellerAddressId, labelType, domain);
    sendProgress("Label generated");
    return { success: true };
  });
}
