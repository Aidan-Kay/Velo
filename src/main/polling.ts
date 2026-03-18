import type { JourneySummaryResult, Order, Pagination, TransactionDetail, VintedListing } from "../shared/types";
import * as vintedApi from "./vinted/api";

// ─── Config ────────────────────────────────────────────────────────────────

const POLL_MIN_MS = 4 * 60 * 1000; // 4 minutes
const POLL_MAX_MS = 6 * 60 * 1000; // 6 minutes
const LISTINGS_PER_PAGE = 100;
const ORDERS_PER_PAGE = 100;

function randomInterval(): number {
  return POLL_MIN_MS + Math.random() * (POLL_MAX_MS - POLL_MIN_MS);
}

// ─── Callbacks ─────────────────────────────────────────────────────────────

interface PollingCallbacks {
  getDomain: () => string;
  getCachedOrders: () => Order[];
  getCachedListings: () => VintedListing[];
  onListingsUpdated: (items: VintedListing[], pagination: Pagination) => void;
  onOrdersUpdated: (orders: Order[], pagination: Pagination) => void;
}

// ─── Polling Manager ───────────────────────────────────────────────────────

export class PollingManager {
  private listingsTimer: ReturnType<typeof setTimeout> | null = null;
  private ordersTimer: ReturnType<typeof setTimeout> | null = null;
  private listingsFetching = false;
  private ordersFetching = false;
  private callbacks: PollingCallbacks;
  private running = false;

  constructor(callbacks: PollingCallbacks) {
    this.callbacks = callbacks;
  }

  /** Start background polling (call after login). */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[polling] Started background polling");

    // Immediately poll once, then schedule recurring
    this.pollListings().catch((err) => console.error("[polling] Unhandled error in listings poll:", err));
    this.pollOrders().catch((err) => console.error("[polling] Unhandled error in orders poll:", err));
  }

  /** Stop background polling (call on logout). */
  stop(): void {
    this.running = false;
    if (this.listingsTimer) {
      clearTimeout(this.listingsTimer);
      this.listingsTimer = null;
    }
    if (this.ordersTimer) {
      clearTimeout(this.ordersTimer);
      this.ordersTimer = null;
    }
    console.log("[polling] Stopped background polling");
  }

  // ─── Listings ───────────────────────────────────────────────────────────

  /** Force an immediate listings refresh (e.g. from user Refresh button). */
  async refreshListings(): Promise<{ items: VintedListing[]; pagination: Pagination }> {
    return this.fetchListings();
  }

  /** Force an immediate orders refresh (e.g. from user Refresh button). */
  async refreshOrders(): Promise<{ orders: Order[]; pagination: Pagination }> {
    return this.fetchOrders();
  }

  /** Refresh a single order's enrichment data (e.g. after generating a label). */
  async refreshSingleOrder(transactionId: number): Promise<Order | null> {
    const domain = this.callbacks.getDomain();
    const cachedOrders = this.callbacks.getCachedOrders();
    const idx = cachedOrders.findIndex((o) => o.transactionId === transactionId);
    if (idx < 0) return null;

    const order = cachedOrders[idx];
    try {
      const detail: TransactionDetail = await vintedApi.getTransactionDetail(transactionId, domain);

      // Fetch shipping instructions for courier info (available before label generation)
      let shippingCourier: string | null = null;
      let shippingCarrierLogo: string | null = null;
      try {
        const instructions = (await vintedApi.getShippingInstructions(transactionId, domain)) as {
          shipping_instructions?: { carrier?: { name?: string; icon_url?: string } };
        };
        shippingCourier = instructions?.shipping_instructions?.carrier?.name || null;
        shippingCarrierLogo = instructions?.shipping_instructions?.carrier?.icon_url || null;
      } catch (err) {
        console.warn(`[polling] Shipping instructions unavailable for ${transactionId}:`, (err as Error).message);
      }

      let journey: JourneySummaryResult | null = null;
      if (detail.shipment?.id) {
        try {
          journey = await vintedApi.getJourneySummary(transactionId, domain);
        } catch (err) {
          console.warn(`[polling] Journey summary unavailable for ${transactionId}:`, (err as Error).message);
        }
      }

      const enriched: Order = {
        ...order,
        buyerUsername: detail.buyer?.login || order.buyerUsername,
        buyerAvatar: detail.buyer?.photo?.url || order.buyerAvatar,
        courier: journey?.carrierCode || detail.shipment?.carrier_code || shippingCourier || order.courier,
        trackingNumber: journey?.trackingCode || detail.shipment?.tracking_code || order.trackingNumber,
        trackingUrl: journey?.trackingUrl || detail.shipment?.tracking_url || order.trackingUrl,
        shipmentId: detail.shipment?.id || order.shipmentId,
        shipmentStatus: detail.shipment?.status ?? order.shipmentStatus ?? null,
        carrierLogoUrl: journey?.carrierLogoUrl || shippingCarrierLogo || order.carrierLogoUrl,
        estimatedDelivery: journey?.estimatedDelivery || order.estimatedDelivery,
        isBundle: Array.isArray(detail.order?.items) && detail.order.items.length > 1,
        bundleItems:
          Array.isArray(detail.order?.items) && detail.order.items.length > 1
            ? detail.order.items.map((item) => ({
                title: item.title || "",
                thumbnail: item.photos?.[0]?.thumbnails?.find((t) => t.type === "thumb150x210")?.url || null,
              }))
            : order.bundleItems,
      };

      const updated = [...cachedOrders];
      updated[idx] = enriched;
      this.callbacks.onOrdersUpdated(updated, {});
      return enriched;
    } catch (err) {
      console.error(`[polling] Failed to refresh single order ${transactionId}:`, (err as Error).message);
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
    if (idx >= 0) {
      updated[idx] = listing;
    } else {
      updated.unshift(listing);
    }
    return updated;
  }

  private async pollListings(): Promise<void> {
    try {
      await this.fetchListings();
    } catch (err) {
      console.error("[polling] Unexpected error in pollListings:", err);
    } finally {
      this.scheduleListingsPoll();
    }
  }

  private async pollOrders(): Promise<void> {
    try {
      await this.fetchOrders();
    } catch (err) {
      console.error("[polling] Unexpected error in pollOrders:", err);
    } finally {
      this.scheduleOrdersPoll();
    }
  }

  private scheduleListingsPoll(): void {
    if (!this.running) return;
    const delay = randomInterval();
    console.log(`[polling] Next listings poll in ${Math.round(delay / 1000)}s`);
    this.listingsTimer = setTimeout(() => this.pollListings(), delay);
  }

  private scheduleOrdersPoll(): void {
    if (!this.running) return;
    const delay = randomInterval();
    console.log(`[polling] Next orders poll in ${Math.round(delay / 1000)}s`);
    this.ordersTimer = setTimeout(() => this.pollOrders(), delay);
  }

  private async fetchListings(): Promise<{ items: VintedListing[]; pagination: Pagination }> {
    if (this.listingsFetching) {
      console.log("[polling] Listings fetch already in progress, skipping");
      return { items: [], pagination: {} };
    }

    this.listingsFetching = true;
    try {
      const domain = this.callbacks.getDomain();
      console.log("[polling] Fetching listings...");
      const result = await vintedApi.getMyListings({ domain, page: 1, perPage: LISTINGS_PER_PAGE });
      this.callbacks.onListingsUpdated(result.items, result.pagination);
      return result;
    } catch (err) {
      console.error("[polling] Failed to fetch listings:", (err as Error).message);
      return { items: [], pagination: {} };
    } finally {
      this.listingsFetching = false;
    }
  }

  private async fetchOrders(): Promise<{ orders: Order[]; pagination: Pagination }> {
    if (this.ordersFetching) {
      console.log("[polling] Orders fetch already in progress, skipping");
      return { orders: [], pagination: {} };
    }

    this.ordersFetching = true;
    try {
      const domain = this.callbacks.getDomain();
      console.log("[polling] Fetching orders...");
      const result = await vintedApi.getMyOrders({ domain, page: 1, perPage: ORDERS_PER_PAGE });

      // Enrich orders whose status changed (or are new)
      const cachedOrders = this.callbacks.getCachedOrders();
      const cachedMap = new Map<number, Order>();
      for (const cached of cachedOrders) {
        if (cached.transactionId) cachedMap.set(cached.transactionId, cached);
      }

      const enrichedOrders: Order[] = [];
      for (const order of result.orders) {
        const cached = order.transactionId ? cachedMap.get(order.transactionId) : null;

        // If we have cached enrichment data and the status hasn't changed, reuse it
        if (cached && cached.statusLabel === order.statusLabel) {
          enrichedOrders.push({
            ...order,
            buyerUsername: cached.buyerUsername,
            buyerAvatar: cached.buyerAvatar,
            courier: cached.courier,
            trackingNumber: cached.trackingNumber,
            trackingUrl: cached.trackingUrl,
            shipmentId: cached.shipmentId,
            shipmentStatus: cached.shipmentStatus,
            carrierLogoUrl: cached.carrierLogoUrl,
            estimatedDelivery: cached.estimatedDelivery,
            isBundle: cached.isBundle,
            bundleItems: cached.bundleItems,
          });
          continue;
        }

        // Status changed or new order — fetch transaction detail
        if (order.transactionId) {
          try {
            const detail: TransactionDetail = await vintedApi.getTransactionDetail(order.transactionId, domain);

            // Fetch shipping instructions for courier info (available before label generation)
            let shippingCourier: string | null = null;
            let shippingCarrierLogo: string | null = null;
            try {
              const instructions = (await vintedApi.getShippingInstructions(order.transactionId, domain)) as {
                shipping_instructions?: { carrier?: { name?: string; icon_url?: string } };
              };
              shippingCourier = instructions?.shipping_instructions?.carrier?.name || null;
              shippingCarrierLogo = instructions?.shipping_instructions?.carrier?.icon_url || null;
            } catch (err) {
              console.warn(`[polling] Shipping instructions unavailable for ${order.transactionId}:`, (err as Error).message);
            }

            // Fetch journey summary for tracking/courier info (non-critical)
            let journey: JourneySummaryResult | null = null;
            if (detail.shipment?.id) {
              try {
                journey = await vintedApi.getJourneySummary(order.transactionId, domain);
              } catch (err) {
                console.warn(`[polling] Journey summary unavailable for ${order.transactionId}:`, (err as Error).message);
              }
            }

            enrichedOrders.push({
              ...order,
              buyerUsername: detail.buyer?.login || order.buyerUsername,
              buyerAvatar: detail.buyer?.photo?.url || order.buyerAvatar,
              courier: journey?.carrierCode || detail.shipment?.carrier_code || shippingCourier || order.courier,
              trackingNumber: journey?.trackingCode || detail.shipment?.tracking_code || order.trackingNumber,
              trackingUrl: journey?.trackingUrl || detail.shipment?.tracking_url || order.trackingUrl,
              shipmentId: detail.shipment?.id || order.shipmentId,
              shipmentStatus: detail.shipment?.status ?? order.shipmentStatus ?? null,
              carrierLogoUrl: journey?.carrierLogoUrl || shippingCarrierLogo || order.carrierLogoUrl,
              estimatedDelivery: journey?.estimatedDelivery || order.estimatedDelivery,
              isBundle: Array.isArray(detail.order?.items) && detail.order.items.length > 1,
              bundleItems:
                Array.isArray(detail.order?.items) && detail.order.items.length > 1
                  ? detail.order.items.map((item) => ({
                      title: item.title || "",
                      thumbnail: item.photos?.[0]?.thumbnails?.find((t) => t.type === "thumb150x210")?.url || null,
                    }))
                  : order.bundleItems,
            });
          } catch (err) {
            console.warn(`[polling] Failed to enrich order ${order.transactionId}:`, (err as Error).message);
            // Fall back to unenriched data, but keep any cached enrichment
            enrichedOrders.push(cached ? { ...order, ...pickEnrichmentFields(cached) } : order);
          }
        } else {
          enrichedOrders.push(order);
        }
      }

      this.callbacks.onOrdersUpdated(enrichedOrders, result.pagination);
      return { orders: enrichedOrders, pagination: result.pagination };
    } catch (err) {
      console.error("[polling] Failed to fetch orders:", (err as Error).message);
      return { orders: [], pagination: {} };
    } finally {
      this.ordersFetching = false;
    }
  }
}

/** Pick only enrichment fields from a cached order (to preserve when API call fails). */
function pickEnrichmentFields(cached: Order): Partial<Order> {
  return {
    buyerUsername: cached.buyerUsername,
    buyerAvatar: cached.buyerAvatar,
    courier: cached.courier,
    trackingNumber: cached.trackingNumber,
    trackingUrl: cached.trackingUrl,
    shipmentId: cached.shipmentId,
    shipmentStatus: cached.shipmentStatus,
    carrierLogoUrl: cached.carrierLogoUrl,
    estimatedDelivery: cached.estimatedDelivery,
    isBundle: cached.isBundle,
    bundleItems: cached.bundleItems,
    stockReplenished: cached.stockReplenished,
  };
}
