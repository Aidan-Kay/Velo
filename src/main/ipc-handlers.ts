import * as crypto from "crypto";
import { BrowserWindow, ipcMain, shell } from "electron";
import type { AppSettings, LocalItem, Order, Pagination, VintedListing } from "../shared/types";
import { getPaperSizesForPrinter, listPrinters, printShippingLabel } from "./label-printer";
import { saveCachedOrders, saveItems, saveSettings } from "./persistence";
import { deleteItemPhotos, downloadItemPhotos } from "./photo-downloader";
import { PollingManager } from "./polling";
import type { RelistingManager } from "./relisting";
import { getDomain } from "./shared/constants";
import * as vintedApi from "./vinted/api";

interface AppState {
  items: LocalItem[];
  cachedListings: VintedListing[];
  cachedListingsPagination: Pagination;
  cachedOrders: Order[];
  cachedOrdersPagination: Pagination;
}

export function setupIpc(
  state: AppState,
  getSettings: () => AppSettings,
  setSettings: (s: AppSettings) => void,
  getWindow: () => BrowserWindow | null,
  polling: PollingManager,
  relisting: RelistingManager,
): void {
  // ─── Authentication ─────────────────────────────────────────────────────────

  ipcMain.handle("vinted-login", async () => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    const result = await vintedApi.login(domain);
    if (result.success) {
      polling.start();
    }
    return result;
  });

  ipcMain.handle("vinted-check-session", async () => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    const result = await vintedApi.checkSession(domain);
    if (result.loggedIn) {
      polling.start(); // Ensure polling runs even if auto-session check in main.ts failed
    }
    return result;
  });

  ipcMain.handle("vinted-logout", async () => {
    polling.stop();
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.logout(domain);
  });

  ipcMain.handle("vinted-login-status", () => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getLoginStatus(domain);
  });

  // ─── Listings (cached) ───────────────────────────────────────────────────

  ipcMain.handle("get-my-listings", () => {
    return { items: state.cachedListings, pagination: state.cachedListingsPagination };
  });

  ipcMain.handle("refresh-my-listings", async () => {
    return polling.refreshListings();
  });

  ipcMain.handle("get-listing-details", async (_event, listingId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getListingDetails(listingId, domain);
  });

  ipcMain.handle("get-item-upload-detail", async (_event, itemId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getItemUploadDetail(itemId, domain);
  });

  // ─── Orders (cached) ───────────────────────────────────────────────────

  ipcMain.handle("get-my-orders", () => {
    return { orders: state.cachedOrders, pagination: state.cachedOrdersPagination };
  });

  ipcMain.handle("refresh-my-orders", async () => {
    return polling.refreshOrders();
  });

  ipcMain.handle("refresh-single-order", async (_event, transactionId: number) => {
    return polling.refreshSingleOrder(transactionId);
  });

  ipcMain.handle("replenish-order-stock", (_event, transactionId: number) => {
    const order = state.cachedOrders.find((o) => o.transactionId === transactionId);
    if (!order) throw new Error("Order not found");

    // Find matching local items by title and increase stock
    const titlesToReplenish: string[] = [];
    if (order.isBundle && order.bundleItems.length > 0) {
      titlesToReplenish.push(...order.bundleItems.map((b) => b.title));
    } else {
      titlesToReplenish.push(order.itemTitle);
    }

    let replenished = 0;
    for (const title of titlesToReplenish) {
      const titleKey = title.toLowerCase().trim();
      const item = state.items.find((i) => i.title.toLowerCase().trim() === titleKey);
      if (item) {
        item.stock += 1;
        replenished++;
      }
    }

    if (replenished > 0) {
      saveItems(state.items);
    }

    // Mark order as stock-replenished
    order.stockReplenished = true;
    saveCachedOrders({
      orders: state.cachedOrders,
      pagination: state.cachedOrdersPagination,
      fetchedAt: new Date().toISOString(),
    });

    // Push updated orders to renderer
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("orders-updated", {
        orders: state.cachedOrders,
        pagination: state.cachedOrdersPagination,
      });
    }

    return { success: true };
  });

  ipcMain.handle("refresh-single-listing", async (_event, listingId: number) => {
    return polling.refreshSingleListing(listingId);
  });

  ipcMain.handle("get-transaction-detail", async (_event, transactionId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getTransactionDetail(transactionId, domain);
  });

  ipcMain.handle("get-shipping-label-url", async (_event, shipmentId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getShippingLabelUrl(shipmentId, domain);
  });

  ipcMain.handle("get-journey-summary", async (_event, transactionId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getJourneySummary(transactionId, domain);
  });

  // ─── Item Creation / Publishing ─────────────────────────────────────────────

  ipcMain.handle("create-listing", async (event, itemData: Partial<LocalItem>, options: { asDraft?: boolean } = {}) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.createListing(itemData, {
      ...options,
      domain,
      onProgress: (step, current, total) => {
        event.sender.send("listing-creation-progress", { step, current, total });
      },
    });
  });

  ipcMain.handle("publish-listing", async (_event, listingId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.publishListing(listingId, domain);
  });

  ipcMain.handle("delete-listing", async (_event, listingId: number, isDraft: boolean) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.deleteListing(listingId, isDraft, domain);
  });

  // ─── Local Items (Draft Inventory) ──────────────────────────────────────────

  ipcMain.handle("get-items", () => {
    return state.items;
  });

  ipcMain.handle("save-item", async (_event, item: Partial<LocalItem>) => {
    const now = new Date().toISOString();

    if (!item.id) {
      item.id = crypto.randomUUID();
      item.createdAt = now;
    }
    item.updatedAt = now;

    // Download remote photos to local storage
    if (item.photos && item.photos.length > 0) {
      const isUpdate = state.items.some((i) => i.id === item.id);
      try {
        item.photos = await downloadItemPhotos(item.id!, item.photos, isUpdate);
      } catch (err) {
        console.warn("[save-item] Photo download failed:", (err as Error).message);
        // Continue with original photo URLs
      }
    }

    // Merge with defaults to ensure required fields are present
    const defaults: Omit<LocalItem, "id" | "createdAt" | "updatedAt"> = {
      title: "",
      description: "",
      price: 0,
      currency: "GBP",
      categoryId: null,
      conditionId: null,
      brandId: null,
      sizeId: null,
      color1Id: null,
      color2Id: null,
      packageSizeId: null,
      shippingMethodId: null,
      photos: [],
      stock: 1,
      relistingEnabled: true,
      categoryAttributes: {},
    };

    const idx = state.items.findIndex((i) => i.id === item.id);
    const existing = idx >= 0 ? state.items[idx] : {};
    const complete: LocalItem = { ...defaults, ...existing, ...item } as LocalItem;

    if (idx >= 0) {
      state.items[idx] = complete;
    } else {
      state.items.push(complete);
    }
    saveItems(state.items);
    return complete;
  });

  ipcMain.handle("delete-item", (_event, itemId: string) => {
    const idx = state.items.findIndex((i) => i.id === itemId);
    if (idx >= 0) {
      state.items.splice(idx, 1);
      saveItems(state.items);
      deleteItemPhotos(itemId);
    }
    return { success: true };
  });

  ipcMain.handle("bulk-list-items", async (event, itemIds: string[], options: { asDraft?: boolean } = {}) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    const asDraft = options.asDraft || false;

    const results: Array<{ itemId: string; success: boolean; error?: string }> = [];

    for (const itemId of itemIds) {
      const item = state.items.find((i) => i.id === itemId);
      if (!item) {
        results.push({ itemId, success: false, error: "Item not found" });
        continue;
      }

      try {
        await vintedApi.createListing(item, {
          asDraft,
          domain,
          onProgress: (step, current, total) => {
            event.sender.send("listing-creation-progress", { step, current, total });
          },
        });
        item.updatedAt = new Date().toISOString();
        saveItems(state.items);
        results.push({ itemId, success: true });
      } catch (err) {
        results.push({ itemId, success: false, error: (err as Error).message });
      }
    }

    return results;
  });

  // ─── Item Upload Helpers ──────────────────────────────────────────────────────

  ipcMain.handle("get-categories", async () => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getCategories(domain);
  });

  ipcMain.handle("get-category-attributes", async (_event, categoryId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getCategoryAttributes(categoryId, domain);
  });

  ipcMain.handle("get-conditions", async (_event, catalogId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getConditions(catalogId, domain);
  });

  ipcMain.handle("get-package-sizes", async (_event, catalogId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);
    return vintedApi.getPackageSizes(catalogId, domain);
  });

  // ─── Settings ───────────────────────────────────────────────────────────────

  ipcMain.handle("get-settings", () => {
    return getSettings();
  });

  ipcMain.handle("save-settings", (_event, newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    return { success: true };
  });

  // ─── Relisting ─────────────────────────────────────────────────────────────────

  ipcMain.handle("get-relist-queue", () => {
    return relisting.getQueue();
  });

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

  // ─── Labels / Printing ───────────────────────────────────────────────────

  ipcMain.handle("get-printers", async () => {
    return listPrinters();
  });

  ipcMain.handle("get-paper-sizes", async (_event, printerName: string) => {
    return getPaperSizesForPrinter(printerName);
  });

  ipcMain.handle("print-shipping-label", async (_event, shipmentId: number, courier: string) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);

    const result = await vintedApi.getShippingLabelUrl(shipmentId, domain);
    if (!result.label_url) {
      throw new Error("No label URL available");
    }

    return printShippingLabel(
      result.label_url,
      courier,
      settings.labelPrinter?.printerName || undefined,
      settings.labelPrinter?.paperSize || undefined,
    );
  });

  ipcMain.handle("open-raw-shipping-label", async (_event, shipmentId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);

    const result = await vintedApi.getShippingLabelUrl(shipmentId, domain);
    if (!result.label_url) {
      throw new Error("No label URL available");
    }

    await shell.openExternal(result.label_url);
    return { success: true };
  });

  ipcMain.handle("order-shipping-label", async (event, transactionId: number) => {
    const settings = getSettings();
    const domain = getDomain(settings.site);

    const sendProgress = (step: string) => {
      event.sender.send("label-generation-progress", { transactionId, step });
    };

    sendProgress("Fetching shipping address");

    // Fetch default shipping address to get the seller address ID
    const addressResult = await vintedApi.getDefaultShippingAddress(domain);
    const sellerAddressId = addressResult.user_address?.id;
    if (!sellerAddressId) {
      throw new Error("No default shipping address configured");
    }

    // Determine the best label type based on settings + available options
    const order = state.cachedOrders.find((o) => o.transactionId === transactionId);
    let labelType = settings.preferredLabelType || "printable";

    if (order?.shipmentId) {
      try {
        sendProgress("Obtaining label options for courier");
        const labelOpts = await vintedApi.getShipmentLabelOptions(order.shipmentId, domain);
        if (labelOpts.label_types.length > 0 && !labelOpts.label_types.includes(labelType)) {
          // Preferred type not available — use whatever is available
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

  // ─── Browser ────────────────────────────────────────────────────────────────

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
