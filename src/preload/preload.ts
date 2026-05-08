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
  setOrderPacked: (transactionId, packed) => ipcRenderer.invoke("set-order-packed", transactionId, packed),

  // ─── Purchases (cached) ──────────────────────────────────────────────────
  getMyPurchases: () => ipcRenderer.invoke("get-my-purchases"),
  refreshMyPurchases: () => ipcRenderer.invoke("refresh-my-purchases"),
  refreshSinglePurchase: (transactionId) => ipcRenderer.invoke("refresh-single-purchase", transactionId),

  // ─── Received Offers (cached) ─────────────────────────────────────────────
  getReceivedOffers: () => ipcRenderer.invoke("get-received-offers"),
  refreshReceivedOffers: () => ipcRenderer.invoke("refresh-received-offers"),
  acceptOffer: (transactionId, offerRequestId) => ipcRenderer.invoke("accept-offer", transactionId, offerRequestId),
  counterOffer: (transactionId, price, currency) => ipcRenderer.invoke("counter-offer", transactionId, price, currency),
  getSellerOfferOptions: (transactionId) => ipcRenderer.invoke("get-seller-offer-options", transactionId),
  ignoreOffer: (offerRequestId) => ipcRenderer.invoke("ignore-offer", offerRequestId),
  unignoreOffer: (offerRequestId) => ipcRenderer.invoke("unignore-offer", offerRequestId),

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

  // ─── Notifications ─────────────────────────────────────────────────────────
  getNotifications: () => ipcRenderer.invoke("get-notifications"),
  markNotificationRead: (id) => ipcRenderer.invoke("mark-notification-read", id),
  markAllNotificationsRead: () => ipcRenderer.invoke("mark-all-notifications-read"),
  clearNotifications: () => ipcRenderer.invoke("clear-notifications"),

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
  onListingsDelta: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("listings-delta", handler);
    return () => {
      ipcRenderer.off("listings-delta", handler);
    };
  },
  onOrdersUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("orders-updated", handler);
    return () => {
      ipcRenderer.off("orders-updated", handler);
    };
  },
  onOrdersDelta: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("orders-delta", handler);
    return () => {
      ipcRenderer.off("orders-delta", handler);
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
  onPurchasesDelta: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("purchases-delta", handler);
    return () => {
      ipcRenderer.off("purchases-delta", handler);
    };
  },
  onOffersDelta: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("offers-delta", handler);
    return () => {
      ipcRenderer.off("offers-delta", handler);
    };
  },
  onOfferAutoAccepted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("offer-auto-accepted", handler);
    return () => {
      ipcRenderer.off("offer-auto-accepted", handler);
    };
  },
  onNotificationsUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("notifications-updated", handler);
    return () => {
      ipcRenderer.off("notifications-updated", handler);
    };
  },
  onNotificationNavigate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, page: string, referenceId: number) => callback(page, referenceId);
    ipcRenderer.on("notification-navigate", handler);
    return () => {
      ipcRenderer.off("notification-navigate", handler);
    };
  },

  // ─── Activity log ─────────────────────────────────────────────────────
  getLogEntries: (query) => ipcRenderer.invoke("get-log-entries", query),
  openLogFile: () => ipcRenderer.invoke("open-log-file"),
  clearLogFile: () => ipcRenderer.invoke("clear-log-file"),

  // ─── Bulk price rule ──────────────────────────────────────────────────
  applyBulkPriceRule: (input) => ipcRenderer.invoke("apply-bulk-price-rule", input),
  onBulkPriceProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("bulk-price-progress", handler);
    return () => {
      ipcRenderer.off("bulk-price-progress", handler);
    };
  },

  // ─── AI assist ────────────────────────────────────────────────────────
  aiGenerateListingDraft: (itemId) => ipcRenderer.invoke("ai-generate-listing-draft", itemId),
};

contextBridge.exposeInMainWorld("api", api);
