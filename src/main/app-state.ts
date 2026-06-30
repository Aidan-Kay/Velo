import type { BrowserWindow } from "electron";

import type {
  AppNotification,
  AppSettings,
  ListingDelta,
  LocalItem,
  OfferDelta,
  Order,
  OrderDelta,
  Pagination,
  Purchase,
  PurchaseDelta,
  ReceivedOffer,
  VintedListing,
} from "../shared/types";
import * as notificationManager from "./notifications";
import { autoGenerateLabelsForNewOrders, reduceStockForNewOrders } from "./order-automation";
import { saveCachedListings, saveCachedOffers, saveCachedOrders, saveCachedPurchases, saveNotifications } from "./persistence";
import type { PollingCallbacks } from "./polling";
import { computeDelta } from "./shared/delta";

export interface AppState {
  items: LocalItem[];
  cachedListings: VintedListing[];
  cachedListingsPagination: Pagination;
  cachedOrders: Order[];
  cachedOrdersPagination: Pagination;
  cachedPurchases: Purchase[];
  cachedPurchasesPagination: Pagination;
  cachedOffers: ReceivedOffer[];
  lastOfferPollTimestamp: string | null;
  notifications: AppNotification[];
}

export interface NotificationDeps {
  getNotifications: () => AppNotification[];
  getSettings: () => AppSettings;
  getWindow: () => BrowserWindow | null;
  saveNotifications: (notifications: AppNotification[]) => void;
}

export function createInitialState(): AppState {
  return {
    items: [],
    cachedListings: [],
    cachedListingsPagination: {},
    cachedOrders: [],
    cachedOrdersPagination: {},
    cachedPurchases: [],
    cachedPurchasesPagination: {},
    cachedOffers: [],
    lastOfferPollTimestamp: null,
    notifications: [],
  };
}

interface BuildDeps {
  state: AppState;
  getSettings: () => AppSettings;
  getWindow: () => BrowserWindow | null;
}

interface AppStateBundle {
  notifDeps: NotificationDeps;
  pollingCallbacks: Omit<PollingCallbacks, "getDomain">;
}

/**
 * Build the polling callbacks and notification deps that wire shared mutable
 * state to persistence and renderer push events. Caller (main.ts) supplies
 * `getDomain` separately so this module doesn't import constants.
 */
export function buildAppStateBundle(deps: BuildDeps): AppStateBundle {
  const { state, getSettings, getWindow } = deps;

  let firstOrdersPollDone = false;
  let firstOffersPollDone = false;

  const notifDeps: NotificationDeps = {
    getNotifications: () => state.notifications,
    getSettings,
    getWindow,
    saveNotifications,
  };

  const sendIfOpen = (channel: string, payload: unknown): void => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  const onListingsUpdated = (items: VintedListing[], pagination: Pagination): void => {
    const { upserted, removedIds } = computeDelta<VintedListing, number>(
      state.cachedListings,
      items,
      (l) => l.id,
      (a, b) => a.status !== b.status || a.views !== b.views || a.favourites !== b.favourites || a.price !== b.price,
    );
    const delta: ListingDelta = { upserted, removedIds };

    state.cachedListings = items;
    state.cachedListingsPagination = pagination;
    saveCachedListings({ items, pagination, fetchedAt: new Date().toISOString() });

    if (upserted.length > 0 || removedIds.length > 0) {
      sendIfOpen("listings-delta", delta);
    }
  };

  const onOrdersUpdated = (orders: Order[], pagination: Pagination): void => {
    const settings = getSettings();

    // Reduce stock for orders that have just been placed
    reduceStockForNewOrders(orders, state.cachedOrders, settings, state.items);

    // Auto-generate shipping labels for new orders (runs async, doesn't block)
    const cachedSnapshot = [...state.cachedOrders];
    void autoGenerateLabelsForNewOrders(orders, cachedSnapshot, settings);

    // Generate notifications for genuinely new orders (not on first poll)
    if (firstOrdersPollDone) {
      const cachedIds = new Set(state.cachedOrders.map((o) => o.transactionId));
      for (const order of orders) {
        if (order.transactionId && !cachedIds.has(order.transactionId)) {
          const message = `Order for ${order.itemTitle} from ${order.buyerUsername}`;
          state.notifications = notificationManager.createNotification(
            notifDeps,
            state.notifications,
            "new_order",
            "New Order",
            message,
            order.transactionId,
            "orders",
          );
        }
      }
    }
    firstOrdersPollDone = true;

    // Preserve stockReplenished, stockReduced, and packed flags from cached orders
    const cachedMap = new Map(state.cachedOrders.map((o) => [o.transactionId, o]));
    for (const order of orders) {
      const cached = order.transactionId ? cachedMap.get(order.transactionId) : null;
      if (cached?.stockReplenished) order.stockReplenished = true;
      if (cached?.stockReduced) order.stockReduced = true;
      if (cached?.packed) order.packed = true;
    }

    const { upserted, removedIds } = computeDelta<Order, number>(
      state.cachedOrders,
      orders,
      (o) => o.transactionId ?? null,
      (a, b) =>
        a.statusLabel !== b.statusLabel ||
        a.shipmentStatus !== b.shipmentStatus ||
        a.stockReplenished !== b.stockReplenished ||
        a.stockReduced !== b.stockReduced ||
        a.packed !== b.packed,
    );
    const delta: OrderDelta = { upserted, removedIds };

    state.cachedOrders = orders;
    state.cachedOrdersPagination = pagination;
    saveCachedOrders({ orders, pagination, fetchedAt: new Date().toISOString() });

    if (upserted.length > 0 || removedIds.length > 0) {
      sendIfOpen("orders-delta", delta);
    }
  };

  const onPurchasesUpdated = (purchases: Purchase[], pagination: Pagination): void => {
    const { upserted, removedIds } = computeDelta<Purchase, number>(
      state.cachedPurchases,
      purchases,
      (p) => p.transactionId ?? null,
      (a, b) => a.statusLabel !== b.statusLabel || a.shipmentStatus !== b.shipmentStatus,
    );
    const delta: PurchaseDelta = { upserted, removedIds };

    state.cachedPurchases = purchases;
    state.cachedPurchasesPagination = pagination;
    saveCachedPurchases({ purchases, pagination, fetchedAt: new Date().toISOString() });

    if (upserted.length > 0 || removedIds.length > 0) {
      sendIfOpen("purchases-delta", delta);
    }
  };

  const onOffersUpdated = (offers: ReceivedOffer[], latestTimestamp: string | null): void => {
    // Generate notifications for genuinely new pending offers (not on first poll)
    if (firstOffersPollDone) {
      const cachedIds = new Set(state.cachedOffers.map((o) => o.id));
      for (const offer of offers) {
        if (!cachedIds.has(offer.id) && offer.status === "pending") {
          const message = `${offer.offerPriceLabel} offer on ${offer.itemTitle} from ${offer.buyerUsername}`;
          state.notifications = notificationManager.createNotification(
            notifDeps,
            state.notifications,
            "new_offer",
            "New Offer",
            message,
            offer.id,
            "offers",
          );
        }
      }
    }
    firstOffersPollDone = true;

    const { upserted, removedIds } = computeDelta<ReceivedOffer, number>(
      state.cachedOffers,
      offers,
      (o) => o.id,
      (a, b) => a.status !== b.status,
    );
    const delta: OfferDelta = { upserted, removedIds };

    state.cachedOffers = offers;
    if (latestTimestamp) {
      state.lastOfferPollTimestamp = latestTimestamp;
    }
    saveCachedOffers({ offers, lastPollTimestamp: state.lastOfferPollTimestamp, fetchedAt: new Date().toISOString() });

    if (upserted.length > 0 || removedIds.length > 0) {
      sendIfOpen("offers-delta", delta);
    }
  };

  const onOfferAutoAccepted = (offer: ReceivedOffer): void => {
    sendIfOpen("offer-auto-accepted", offer);
  };

  return {
    notifDeps,
    pollingCallbacks: {
      getSettings,
      getItems: () => state.items,
      getCachedOrders: () => state.cachedOrders,
      getCachedListings: () => state.cachedListings,
      getCachedPurchases: () => state.cachedPurchases,
      getCachedOffers: () => state.cachedOffers,
      getLastOfferPollTimestamp: () => state.lastOfferPollTimestamp,
      onListingsUpdated,
      onOrdersUpdated,
      onPurchasesUpdated,
      onOffersUpdated,
      onOfferAutoAccepted,
    },
  };
}
