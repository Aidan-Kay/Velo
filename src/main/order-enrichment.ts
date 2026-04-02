import type { JourneySummaryResult, Order, TransactionDetail } from "../shared/types";
import * as vintedApi from "./vinted/api";

/**
 * Enrich an order with transaction detail, shipping instructions, and journey summary.
 * Shipping instructions and journey summary are fetched in parallel where possible (#16).
 */
export async function enrichOrder(order: Order, domain: string): Promise<Order> {
  if (!order.transactionId) return order;

  const detail: TransactionDetail = await vintedApi.getTransactionDetail(order.transactionId, domain);

  // Fetch shipping instructions and journey summary in parallel
  const [shippingResult, journeyResult] = await Promise.allSettled([
    fetchShippingInfo(order.transactionId, domain),
    detail.shipment?.id ? vintedApi.getJourneySummary(order.transactionId, domain) : Promise.resolve(null),
  ]);

  const shipping = shippingResult.status === "fulfilled" ? shippingResult.value : null;
  if (shippingResult.status === "rejected") {
    console.warn(`[enrichment] Shipping instructions unavailable for ${order.transactionId}:`, shippingResult.reason?.message);
  }

  const journey: JourneySummaryResult | null = journeyResult.status === "fulfilled" ? journeyResult.value : null;
  if (journeyResult.status === "rejected") {
    console.warn(`[enrichment] Journey summary unavailable for ${order.transactionId}:`, journeyResult.reason?.message);
  }

  const buyerId = detail.buyer?.id || order.buyerId;
  const buyerUsername = detail.buyer?.login || order.buyerUsername;
  const buyerProfileUrl = buyerId && buyerUsername ? `https://${domain}/member/${buyerId}-${buyerUsername}` : order.buyerProfileUrl;

  return {
    ...order,
    buyerId,
    buyerUsername,
    buyerProfileUrl,
    buyerAvatar: detail.buyer?.photo?.url || order.buyerAvatar,
    courier: detail.shipment?.carrier_code || shipping?.courier || order.courier,
    trackingNumber: journey?.trackingCode || detail.shipment?.tracking_code || order.trackingNumber,
    trackingUrl: journey?.trackingUrl || detail.shipment?.tracking_url || order.trackingUrl,
    shipmentId: detail.shipment?.id || order.shipmentId,
    shipmentStatus: detail.shipment?.status ?? order.shipmentStatus ?? null,
    carrierLogoUrl: journey?.carrierLogoUrl || shipping?.carrierLogo || order.carrierLogoUrl,
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
}

/** Fetch shipping instructions and extract courier info. */
async function fetchShippingInfo(transactionId: number, domain: string): Promise<{ courier: string | null; carrierLogo: string | null }> {
  const instructions = (await vintedApi.getShippingInstructions(transactionId, domain)) as {
    shipping_instructions?: { carrier?: { name?: string; icon_url?: string } };
  };
  return {
    courier: instructions?.shipping_instructions?.carrier?.name || null,
    carrierLogo: instructions?.shipping_instructions?.carrier?.icon_url || null,
  };
}

/** Pick only enrichment fields from a cached order (to preserve when API call fails). */
export function pickEnrichmentFields(cached: Order): Partial<Order> {
  return {
    buyerId: cached.buyerId,
    buyerUsername: cached.buyerUsername,
    buyerProfileUrl: cached.buyerProfileUrl,
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
    stockReduced: cached.stockReduced,
  };
}
