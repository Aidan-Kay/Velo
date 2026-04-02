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

  // ─── Relisting ───────────────────────────────────────────────────────────────────
  getRelistQueue: () => ipcRenderer.invoke("get-relist-queue"),
  queueForRelist: (itemId, soldAt) => ipcRenderer.invoke("queue-for-relist", itemId, soldAt),
  removeFromRelistQueue: (itemId) => ipcRenderer.invoke("remove-from-relist-queue", itemId),

  // ─── Browser ──────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // ─── Events (main → renderer) ────────────────────────────────────────────
  onSessionStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => callback(status);
    ipcRenderer.on("session-status", handler);
    return () => {
      ipcRenderer.off("session-status", handler);
    };
  },
  onItemRelisted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("item-relisted", handler);
    return () => {
      ipcRenderer.off("item-relisted", handler);
    };
  },
  onListingsUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("listings-updated", handler);
    return () => {
      ipcRenderer.off("listings-updated", handler);
    };
  },
  onOrdersUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("orders-updated", handler);
    return () => {
      ipcRenderer.off("orders-updated", handler);
    };
  },
  onListingCreationProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { step: string; current: number; total: number }) => callback(data);
    ipcRenderer.on("listing-creation-progress", handler);
    return () => {
      ipcRenderer.off("listing-creation-progress", handler);
    };
  },
  onLabelGenerationProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { transactionId: number; step: string }) => callback(data);
    ipcRenderer.on("label-generation-progress", handler);
    return () => {
      ipcRenderer.off("label-generation-progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);
