import type { AppSettings, Order, Pagination, Purchase, ReceivedOffer, VintedListing } from "../shared/types";
import { enrichOrder, enrichPurchase, pickEnrichmentFields, pickPurchaseEnrichmentFields } from "./order-enrichment";
import * as vintedApi from "./vinted/api";
import type { GetReceivedOffersResult } from "./vinted/offers";

// ─── Config ────────────────────────────────────────────────────────────────

const LISTINGS_PER_PAGE = 100;
const ORDERS_PER_PAGE = 100;
const PURCHASES_PER_PAGE = 100;
const JITTER_FRACTION = 0.2; // ±20%
const MAX_AGE_DAYS = 30;

/** Keep only items created within the past N days. */
function isWithinMaxAge(createdAt: string | null): boolean {
  if (!createdAt) return true;
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return new Date(createdAt).getTime() >= cutoff;
}

/** Convert minutes to ms with ±20% jitter. */
function intervalMs(minutes: number): number {
  const base = minutes * 60 * 1000;
  const jitter = base * JITTER_FRACTION * (Math.random() * 2 - 1); // -20% to +20%
  return Math.max(30_000, base + jitter); // floor at 30s
}

/**
 * One polled resource: owns its timer, in-flight flag, and re-entrancy guard.
 * The actual fetch logic is supplied as a callback.
 */
class PolledResource<TResult> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fetching = false;

  constructor(
    private readonly name: string,
    private readonly intervalMinutes: () => number,
    private readonly doFetch: () => Promise<TResult>,
    private readonly fallback: () => TResult,
    private readonly isRunning: () => boolean,
  ) {}

  /** Run a single poll cycle and reschedule. */
  async poll(): Promise<void> {
    try {
      await this.fetch();
    } catch (err) {
      console.error(`[polling] Unexpected error in ${this.name} poll:`, err);
    } finally {
      this.schedule();
    }
  }

  /** Force a fetch now (e.g. user-triggered refresh). Bypasses scheduling. */
  async fetch(): Promise<TResult> {
    if (this.fetching) {
      console.log(`[polling] ${this.name} fetch already in progress, skipping`);
      return this.fallback();
    }
    this.fetching = true;
    try {
      return await this.doFetch();
    } finally {
      this.fetching = false;
    }
  }

  private schedule(): void {
    if (!this.isRunning()) return;
    const delay = intervalMs(this.intervalMinutes());
    console.log(`[polling] Next ${this.name} poll in ${Math.round(delay / 1000)}s`);
    this.timer = setTimeout(() => this.poll(), delay);
  }

  clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Force-clear the in-flight guard. Used after system resume: if a fetch was mid-flight
   * when the OS suspended, its `executeJavaScript` promise may never settle (the hidden
   * window gets destroyed by `resetClientWindow()` on resume). Without this reset, every
   * subsequent poll would short-circuit to `fallback()` and polling would silently die.
   */
  resetInFlight(): void {
    if (this.fetching) {
      console.warn(`[polling] ${this.name} fetch was still in-flight at reset; clearing guard`);
      this.fetching = false;
    }
  }
}

// ─── Callbacks ─────────────────────────────────────────────────────────────

export interface PollingCallbacks {
  getDomain: () => string;
  getSettings: () => AppSettings;
  getCachedOrders: () => Order[];
  getCachedListings: () => VintedListing[];
  getCachedPurchases: () => Purchase[];
  getCachedOffers: () => ReceivedOffer[];
  getLastOfferPollTimestamp: () => string | null;
  onListingsUpdated: (items: VintedListing[], pagination: Pagination) => void;
  onOrdersUpdated: (orders: Order[], pagination: Pagination) => void;
  onPurchasesUpdated: (purchases: Purchase[], pagination: Pagination) => void;
  onOffersUpdated: (offers: ReceivedOffer[], latestTimestamp: string | null) => void;
  onOfferAutoAccepted: (offer: ReceivedOffer) => void;
}

// ─── Polling Manager ───────────────────────────────────────────────────────

export class PollingManager {
  private readonly listings: PolledResource<{ items: VintedListing[]; pagination: Pagination }>;
  private readonly orders: PolledResource<{ orders: Order[]; pagination: Pagination }>;
  private readonly purchases: PolledResource<{ purchases: Purchase[]; pagination: Pagination }>;
  private readonly offers: PolledResource<GetReceivedOffersResult>;
  private readonly all: PolledResource<unknown>[];
  private callbacks: PollingCallbacks;
  private running = false;

  constructor(callbacks: PollingCallbacks) {
    this.callbacks = callbacks;
    const settings = () => this.callbacks.getSettings().pollingIntervals;
    const isRunning = () => this.running;

    this.listings = new PolledResource(
      "listings",
      () => settings().listingsMinutes,
      () => this.fetchListings(),
      () => ({ items: this.callbacks.getCachedListings(), pagination: {} }),
      isRunning,
    );
    this.orders = new PolledResource(
      "orders",
      () => settings().ordersMinutes,
      () => this.fetchOrders(),
      () => ({ orders: this.callbacks.getCachedOrders(), pagination: {} }),
      isRunning,
    );
    this.purchases = new PolledResource(
      "purchases",
      () => settings().purchasesMinutes,
      () => this.fetchPurchases(),
      () => ({ purchases: this.callbacks.getCachedPurchases(), pagination: {} }),
      isRunning,
    );
    this.offers = new PolledResource(
      "offers",
      () => settings().offersMinutes,
      () => this.fetchOffers(),
      () => ({ offers: [], latestTimestamp: null }),
      isRunning,
    );
    this.all = [
      this.listings as PolledResource<unknown>,
      this.orders as PolledResource<unknown>,
      this.purchases as PolledResource<unknown>,
      this.offers as PolledResource<unknown>,
    ];
  }

  /** Start background polling (call after login). */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[polling] Started background polling");
    this.pollAll();
  }

  /** Stop background polling (call on logout). */
  stop(): void {
    this.running = false;
    this.clearTimers();
    console.log("[polling] Stopped background polling");
  }

  /** Force polling to recover after system resume or timer drift. */
  recoverAfterResume(): void {
    // Clear any stuck in-flight guards from fetches that were mid-flight at suspend.
    // (Their executeJavaScript promises may never settle once the window is reset.)
    for (const r of this.all) r.resetInFlight();

    if (!this.running) {
      console.log("[polling] Polling was not running after resume — starting fresh");
      this.start();
      return;
    }
    console.log("[polling] Recovering polling after resume");
    this.clearTimers();
    this.pollAll();
  }

  private pollAll(): void {
    for (const r of this.all) {
      r.poll().catch((err) => console.error("[polling] Unhandled error:", err));
    }
  }

  private clearTimers(): void {
    for (const r of this.all) r.clearTimer();
  }

  // ─── Public refresh API (user-triggered) ────────────────────────────────

  async refreshListings(): Promise<{ items: VintedListing[]; pagination: Pagination }> {
    return this.listings.fetch();
  }

  async refreshOrders(): Promise<{ orders: Order[]; pagination: Pagination }> {
    return this.orders.fetch();
  }

  async refreshPurchases(): Promise<{ purchases: Purchase[]; pagination: Pagination }> {
    return this.purchases.fetch();
  }

  async refreshOffers(): Promise<GetReceivedOffersResult> {
    return this.offers.fetch();
  }

  // ─── Public mutation API (IPC handlers route through here) ──────────────

  /**
   * Patch a single cached order and re-emit through the unified delta pipeline.
   * Returns the updated order, or null if the transactionId is unknown.
   */
  applyOrderPatch(transactionId: number, patch: Partial<Order>): Order | null {
    const cached = this.callbacks.getCachedOrders();
    const idx = cached.findIndex((o) => o.transactionId === transactionId);
    if (idx < 0) return null;
    const updated = [...cached];
    updated[idx] = { ...updated[idx], ...patch };
    this.callbacks.onOrdersUpdated(updated, {});
    return updated[idx];
  }

  /**
   * Patch a single cached offer (matched by `offerRequestId` or `transactionId`)
   * and re-emit through the unified delta pipeline.
   */
  applyOfferPatch(selector: { offerRequestId?: number; transactionId?: number }, patch: Partial<ReceivedOffer>): ReceivedOffer | null {
    const cached = this.callbacks.getCachedOffers();
    const idx = cached.findIndex((o) =>
      selector.offerRequestId != null ? o.offerRequestId === selector.offerRequestId : o.transactionId === selector.transactionId,
    );
    if (idx < 0) return null;
    const updated = [...cached];
    updated[idx] = { ...updated[idx], ...patch };
    this.callbacks.onOffersUpdated(updated, null);
    return updated[idx];
  }

  /** Refresh a single order's enrichment data (e.g. after generating a label). */
  async refreshSingleOrder(transactionId: number): Promise<Order | null> {
    const domain = this.callbacks.getDomain();
    const cachedOrders = this.callbacks.getCachedOrders();
    const idx = cachedOrders.findIndex((o) => o.transactionId === transactionId);
    if (idx < 0) return null;

    const order = cachedOrders[idx];
    try {
      const enriched = await enrichOrder(order, domain);
      const updated = [...cachedOrders];
      updated[idx] = enriched;
      this.callbacks.onOrdersUpdated(updated, {});
      return enriched;
    } catch (err) {
      console.error(`[polling] Failed to refresh single order ${transactionId}:`, (err as Error).message);
      return null;
    }
  }

  /** Refresh a single purchase's enrichment data. */
  async refreshSinglePurchase(transactionId: number): Promise<Purchase | null> {
    const domain = this.callbacks.getDomain();
    const cachedPurchases = this.callbacks.getCachedPurchases();
    const idx = cachedPurchases.findIndex((p) => p.transactionId === transactionId);
    if (idx < 0) return null;

    const purchase = cachedPurchases[idx];
    try {
      const enriched = await enrichPurchase(purchase, domain);
      const updated = [...cachedPurchases];
      updated[idx] = enriched;
      this.callbacks.onPurchasesUpdated(updated, {});
      return enriched;
    } catch (err) {
      console.error(`[polling] Failed to refresh single purchase ${transactionId}:`, (err as Error).message);
      return null;
    }
  }

  /** Refresh a single listing from the Vinted API and update the cache. */
  async refreshSingleListing(listingId: number): Promise<VintedListing | null> {
    const domain = this.callbacks.getDomain();
    try {
      const listing = await vintedApi.getListingAsVintedListing(listingId, domain);

      // Preserve view/favourite counts from the cached listing because the
      // item_upload detail API doesn't return them.
      const cached = this.callbacks.getCachedListings().find((l) => l.id === listingId);
      if (cached) {
        listing.views = cached.views;
        listing.favourites = cached.favourites;
        listing.createdAt = listing.createdAt || cached.createdAt;
      }

      this.callbacks.onListingsUpdated(this.updateListingInCache(listingId, listing), {});
      return listing;
    } catch (err) {
      console.error(`[polling] Failed to refresh single listing ${listingId}:`, (err as Error).message);
      return null;
    }
  }

  /** Replace or append a listing in the cached listings array. */
  private updateListingInCache(listingId: number, listing: VintedListing): VintedListing[] {
    const current = this.callbacks.getCachedListings();
    const idx = current.findIndex((l) => l.id === listingId);
    const updated = [...current];
    if (idx >= 0) updated[idx] = listing;
    else updated.unshift(listing);
    return updated;
  }

  // ─── Per-resource fetchers ─────────────────────────────────────────────

  private async fetchListings(): Promise<{ items: VintedListing[]; pagination: Pagination }> {
    try {
      const domain = this.callbacks.getDomain();
      console.log("[polling] Fetching listings...");
      const result = await vintedApi.getMyListings({ domain, page: 1, perPage: LISTINGS_PER_PAGE });
      if (result.items.length >= LISTINGS_PER_PAGE) {
        console.warn(
          `[polling] Listings fetch returned ${result.items.length} items (perPage=${LISTINGS_PER_PAGE}); additional pages may exist and are not being fetched.`,
        );
      }
      this.callbacks.onListingsUpdated(result.items, result.pagination);
      return result;
    } catch (err) {
      console.error("[polling] Failed to fetch listings:", (err as Error).message);
      // Preserve existing cache on transient failure rather than overwriting renderer state with [].
      return { items: this.callbacks.getCachedListings(), pagination: {} };
    }
  }

  /** Generic enrichment routine shared between orders & purchases. */
  private async enrichWithCache<T extends { transactionId?: number | null; statusLabel?: string | null }>(
    fresh: T[],
    cached: T[],
    enrichOne: (item: T, domain: string) => Promise<T>,
    pickFields: (cached: T) => Partial<T>,
    domain: string,
    label: string,
  ): Promise<T[]> {
    const cachedMap = new Map<number, T>();
    for (const c of cached) {
      if (c.transactionId) cachedMap.set(c.transactionId, c);
    }
    const enriched: T[] = [];
    for (const item of fresh) {
      const c = item.transactionId ? cachedMap.get(item.transactionId) : null;
      if (c && c.statusLabel === item.statusLabel) {
        enriched.push({ ...item, ...pickFields(c) });
        continue;
      }
      if (item.transactionId) {
        try {
          enriched.push(await enrichOne(item, domain));
        } catch (err) {
          console.warn(`[polling] Failed to enrich ${label} ${item.transactionId}:`, (err as Error).message);
          enriched.push(c ? { ...item, ...pickFields(c) } : item);
        }
      } else {
        enriched.push(item);
      }
    }
    return enriched;
  }

  private async fetchOrders(): Promise<{ orders: Order[]; pagination: Pagination }> {
    try {
      const domain = this.callbacks.getDomain();
      console.log("[polling] Fetching orders...");
      const result = await vintedApi.getMyOrders({ domain, page: 1, perPage: ORDERS_PER_PAGE });
      if (result.orders.length >= ORDERS_PER_PAGE) {
        console.warn(
          `[polling] Orders fetch returned ${result.orders.length} items (perPage=${ORDERS_PER_PAGE}); additional pages may exist and are not being fetched.`,
        );
      }
      result.orders = result.orders.filter((o) => isWithinMaxAge(o.createdAt));

      const enrichedOrders = await this.enrichWithCache<Order>(
        result.orders,
        this.callbacks.getCachedOrders(),
        enrichOrder,
        pickEnrichmentFields,
        domain,
        "order",
      );

      this.callbacks.onOrdersUpdated(enrichedOrders, result.pagination);
      return { orders: enrichedOrders, pagination: result.pagination };
    } catch (err) {
      console.error("[polling] Failed to fetch orders:", (err as Error).message);
      return { orders: this.callbacks.getCachedOrders(), pagination: {} };
    }
  }

  private async fetchPurchases(): Promise<{ purchases: Purchase[]; pagination: Pagination }> {
    try {
      const domain = this.callbacks.getDomain();
      console.log("[polling] Fetching purchases...");
      const result = await vintedApi.getMyPurchases({ domain, page: 1, perPage: PURCHASES_PER_PAGE });
      if (result.purchases.length >= PURCHASES_PER_PAGE) {
        console.warn(
          `[polling] Purchases fetch returned ${result.purchases.length} items (perPage=${PURCHASES_PER_PAGE}); additional pages may exist and are not being fetched.`,
        );
      }
      result.purchases = result.purchases.filter((p) => isWithinMaxAge(p.createdAt));

      const enrichedPurchases = await this.enrichWithCache<Purchase>(
        result.purchases,
        this.callbacks.getCachedPurchases(),
        enrichPurchase,
        pickPurchaseEnrichmentFields,
        domain,
        "purchase",
      );

      this.callbacks.onPurchasesUpdated(enrichedPurchases, result.pagination);
      return { purchases: enrichedPurchases, pagination: result.pagination };
    } catch (err) {
      console.error("[polling] Failed to fetch purchases:", (err as Error).message);
      return { purchases: this.callbacks.getCachedPurchases(), pagination: {} };
    }
  }

  private async fetchOffers(): Promise<GetReceivedOffersResult> {
    try {
      const domain = this.callbacks.getDomain();
      const sinceTimestamp = this.callbacks.getLastOfferPollTimestamp();
      console.log(`[polling] Fetching offers (since ${sinceTimestamp || "first run"})...`);

      const result = await vintedApi.getReceivedOffers(domain, sinceTimestamp);

      // Auto-accept logic for newly found pending offers
      const settings = this.callbacks.getSettings();
      for (const offer of result.offers) {
        if (offer.status !== "pending") continue;
        const threshold = settings.autoAcceptOfferPercent;
        if (threshold == null) continue;

        const originalAmount = parseFloat(offer.originalPrice.amount);
        const offerAmount = parseFloat(offer.offerPrice.amount);
        if (originalAmount <= 0) continue;

        const offerPercent = (offerAmount / originalAmount) * 100;
        if (offerPercent >= threshold) {
          try {
            await vintedApi.acceptOffer(offer.transactionId, offer.offerRequestId, domain);
            offer.status = "accepted";
            offer.autoAccepted = true;
            console.log(
              `[polling] Auto-accepted offer ${offer.offerRequestId} (${offerPercent.toFixed(1)}% of original vs ${threshold}% threshold)`,
            );
            this.callbacks.onOfferAutoAccepted(offer);
          } catch (err) {
            console.warn(`[polling] Failed to auto-accept offer ${offer.offerRequestId}:`, (err as Error).message);
          }
        }
      }

      // Auto-ignore logic for pending offers below the configured threshold.
      // Skip offers whose status is no longer "pending" (e.g. just auto-accepted above).
      // No API call is made — status is mutated locally and preserved across polling merges.
      for (const offer of result.offers) {
        if (offer.status !== "pending") continue;
        const ignoreThreshold = settings.autoIgnoreOfferPercent;
        if (ignoreThreshold == null) continue;

        const originalAmount = parseFloat(offer.originalPrice.amount);
        const offerAmount = parseFloat(offer.offerPrice.amount);
        if (originalAmount <= 0) continue;

        const offerPercent = (offerAmount / originalAmount) * 100;
        if (offerPercent < ignoreThreshold) {
          offer.status = "ignored";
          console.log(
            `[polling] Auto-ignored offer ${offer.offerRequestId} (${offerPercent.toFixed(1)}% of original vs ${ignoreThreshold}% threshold)`,
          );
        }
      }

      // Merge new offers with existing cached offers
      const cachedOffers = this.callbacks.getCachedOffers();
      const mergedMap = new Map<number, ReceivedOffer>();
      for (const cached of cachedOffers) mergedMap.set(cached.id, cached);
      for (const fresh of result.offers) mergedMap.set(fresh.id, fresh);

      // Preserve locally-set statuses unless Vinted has moved the offer on
      for (const cached of cachedOffers) {
        if (cached.status === "ignored" || cached.status === "countered") {
          const merged = mergedMap.get(cached.id);
          if (merged && merged.status === "pending") merged.status = cached.status;
        }
      }
      const mergedOffers = Array.from(mergedMap.values());

      this.callbacks.onOffersUpdated(mergedOffers, result.latestTimestamp);
      return result;
    } catch (err) {
      console.error("[polling] Failed to fetch offers:", (err as Error).message);
      return { offers: this.callbacks.getCachedOffers(), latestTimestamp: null };
    }
  }
}
