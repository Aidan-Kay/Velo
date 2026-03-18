import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "../shared/types";

const api: ElectronAPI = {
  // ─── Authentication ───────────────────────────────────────────────────────
  login: () => ipcRenderer.invoke("vinted-login"),
  checkSession: () => ipcRenderer.invoke("vinted-check-session"),
  logout: () => ipcRenderer.invoke("vinted-logout"),
  getLoginStatus: () => ipcRenderer.invoke("vinted-login-status"),

  // ─── My Listings (cached) ───────────────────────────────────────────────
  getMyListings: () => ipcRenderer.invoke("get-my-listings"),
  refreshMyListings: () => ipcRenderer.invoke("refresh-my-listings"),
  refreshSingleListing: (listingId) => ipcRenderer.invoke("refresh-single-listing", listingId),
  getListingDetails: (id) => ipcRenderer.invoke("get-listing-details", id),
  getItemUploadDetail: (itemId) => ipcRenderer.invoke("get-item-upload-detail", itemId),

  // ─── Orders (cached) ─────────────────────────────────────────────────────
  getMyOrders: () => ipcRenderer.invoke("get-my-orders"),
  refreshMyOrders: () => ipcRenderer.invoke("refresh-my-orders"),
  refreshSingleOrder: (transactionId) => ipcRenderer.invoke("refresh-single-order", transactionId),
  getTransactionDetail: (transactionId) => ipcRenderer.invoke("get-transaction-detail", transactionId),
  getShippingLabelUrl: (shipmentId) => ipcRenderer.invoke("get-shipping-label-url", shipmentId),
  getJourneySummary: (transactionId) => ipcRenderer.invoke("get-journey-summary", transactionId),
  replenishOrderStock: (transactionId) => ipcRenderer.invoke("replenish-order-stock", transactionId),

  // ─── Listing Actions ──────────────────────────────────────────────────────
  createListing: (itemData, options) => ipcRenderer.invoke("create-listing", itemData, options),
  publishListing: (id) => ipcRenderer.invoke("publish-listing", id),
  deleteListing: (id, isDraft) => ipcRenderer.invoke("delete-listing", id, isDraft),

  // ─── Local Items ──────────────────────────────────────────────────────────
  getItems: () => ipcRenderer.invoke("get-items"),
  saveItem: (item) => ipcRenderer.invoke("save-item", item),
  deleteItem: (id) => ipcRenderer.invoke("delete-item", id),
  bulkListItems: (itemIds, options) => ipcRenderer.invoke("bulk-list-items", itemIds, options),

  // ─── Item Upload Helpers ──────────────────────────────────────────────────
  getCategories: () => ipcRenderer.invoke("get-categories"),
  getCategoryAttributes: (categoryId) => ipcRenderer.invoke("get-category-attributes", categoryId),
  getConditions: (catalogId) => ipcRenderer.invoke("get-conditions", catalogId),
  getPackageSizes: (catalogId) => ipcRenderer.invoke("get-package-sizes", catalogId),

  // ─── Settings ─────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // ─── Labels / Printing ─────────────────────────────────────────────────
  printShippingLabel: (shipmentId, courier) => ipcRenderer.invoke("print-shipping-label", shipmentId, courier),
  openRawShippingLabel: (shipmentId) => ipcRenderer.invoke("open-raw-shipping-label", shipmentId),
  orderShippingLabel: (transactionId) => ipcRenderer.invoke("order-shipping-label", transactionId),
  getPrinters: () => ipcRenderer.invoke("get-printers"),
  getPaperSizes: (printerName) => ipcRenderer.invoke("get-paper-sizes", printerName),

  // ─── Restocking ───────────────────────────────────────────────────────────
  getRestockQueue: () => ipcRenderer.invoke("get-restock-queue"),
  queueForRestock: (itemId, soldAt) => ipcRenderer.invoke("queue-for-restock", itemId, soldAt),
  removeFromRestockQueue: (itemId) => ipcRenderer.invoke("remove-from-restock-queue", itemId),

  // ─── Browser ──────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // ─── Events (main → renderer) ────────────────────────────────────────────
  onSessionStatus: (callback) => {
    ipcRenderer.removeAllListeners("session-status");
    ipcRenderer.on("session-status", (_event, status) => callback(status));
  },
  onItemRestocked: (callback) => {
    ipcRenderer.removeAllListeners("item-restocked");
    ipcRenderer.on("item-restocked", (_event, data) => callback(data));
  },
  onListingsUpdated: (callback) => {
    ipcRenderer.removeAllListeners("listings-updated");
    ipcRenderer.on("listings-updated", (_event, data) => callback(data));
  },
  onOrdersUpdated: (callback) => {
    ipcRenderer.removeAllListeners("orders-updated");
    ipcRenderer.on("orders-updated", (_event, data) => callback(data));
  },
  onListingCreationProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { step: string; current: number; total: number }) => callback(data);
    ipcRenderer.on("listing-creation-progress", handler);
    return () => {
      ipcRenderer.off("listing-creation-progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);
