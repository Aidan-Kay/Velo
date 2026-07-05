import type { JourneySummaryResult, Order, Purchase, TransactionDetail } from "../shared/types";
import * as vintedApi from "./vinted/api";
import { deriveOrderStage } from "./vinted/mappers";

/**
 * Shared transaction enrichment for both seller-side orders and buyer-side
 * purchases. The two sides differ only in which counterparty is "interesting"
 * (buyer for orders, seller for purchases).
 */

interface CounterpartyFields {
  id: number | null;
  username: string;
  avatar: string | null;
  profileUrl: string | null;
}

interface CommonEnrichment {
  courier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shipmentId: number | null;
  shipmentStatus: number | null;
  carrierLogoUrl: string | null;
  estimatedDelivery: string | null;
  isBundle: boolean;
  bundleItems: Array<{ title: string; thumbnail: string | null }>;
}

async function fetchShippingInfo(transactionId: number, domain: string): Promise<{ courier: string | null; carrierLogo: string | null }> {
  const instructions = (await vintedApi.getShippingInstructions(transactionId, domain)) as {
    shipping_instructions?: { carrier?: { name?: string; icon_url?: string } };
  };
  return {
    courier: instructions?.shipping_instructions?.carrier?.name || null,
    carrierLogo: instructions?.shipping_instructions?.carrier?.icon_url || null,
  };
}

function buildCommonEnrichment(
  detail: TransactionDetail,
  journey: JourneySummaryResult | null,
  shippingCourier: string | null,
  shippingCarrierLogo: string | null,
  fallback: CommonEnrichment,
): CommonEnrichment {
  const items = detail.order?.items;
  const isBundle = Array.isArray(items) && items.length > 1;

  return {
    courier: shippingCourier || detail.shipment?.carrier_code || fallback.courier,
    trackingNumber: journey?.trackingCode || detail.shipment?.tracking_code || fallback.trackingNumber,
    trackingUrl: journey?.trackingUrl || detail.shipment?.tracking_url || fallback.trackingUrl,
    shipmentId: detail.shipment?.id || fallback.shipmentId,
    shipmentStatus: detail.shipment?.status ?? fallback.shipmentStatus ?? null,
    carrierLogoUrl: journey?.carrierLogoUrl || shippingCarrierLogo || fallback.carrierLogoUrl,
    estimatedDelivery: journey?.estimatedDelivery || fallback.estimatedDelivery,
    isBundle,
    bundleItems: isBundle
      ? items!.map((item) => ({
          title: item.title || "",
          thumbnail: item.photos?.[0]?.thumbnails?.find((t) => t.type === "thumb150x210")?.url || null,
        }))
      : fallback.bundleItems,
  };
}

function extractCounterparty(
  party: TransactionDetail["buyer"] | TransactionDetail["seller"],
  domain: string,
  fallback: { id: number | null; username: string; avatar: string | null; profileUrl: string | null },
): CounterpartyFields {
  const id = party?.id ?? fallback.id;
  const username = party?.login ?? fallback.username;
  const avatar = party?.photo?.url ?? fallback.avatar;
  const profileUrl = id && username ? `https://${domain}/member/${id}-${username}` : fallback.profileUrl;
  return { id, username, avatar, profileUrl };
}

async function fetchEnrichment(
  transactionId: number,
  domain: string,
  options: { fetchShipping: boolean },
): Promise<{
  detail: TransactionDetail;
  journey: JourneySummaryResult | null;
  shippingCourier: string | null;
  shippingCarrierLogo: string | null;
}> {
  const detail: TransactionDetail = await vintedApi.getTransactionDetail(transactionId, domain);

  const [shippingResult, journeyResult] = await Promise.allSettled([
    options.fetchShipping ? fetchShippingInfo(transactionId, domain) : Promise.resolve(null),
    detail.shipment?.id ? vintedApi.getJourneySummary(transactionId, domain) : Promise.resolve(null),
  ]);

  let shippingCourier: string | null = null;
  let shippingCarrierLogo: string | null = null;
  if (shippingResult.status === "fulfilled" && shippingResult.value) {
    shippingCourier = shippingResult.value.courier;
    shippingCarrierLogo = shippingResult.value.carrierLogo;
  } else if (shippingResult.status === "rejected") {
    console.warn(`[enrichment] Shipping instructions unavailable for ${transactionId}:`, shippingResult.reason?.message);
  }

  const journey = journeyResult.status === "fulfilled" ? (journeyResult.value as JourneySummaryResult | null) : null;
  if (journeyResult.status === "rejected") {
    console.warn(
      `[enrichment] Journey summary unavailable for ${transactionId}:`,
      (journeyResult as PromiseRejectedResult).reason?.message,
    );
  }

  return { detail, journey, shippingCourier, shippingCarrierLogo };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enrichOrder(order: Order, domain: string): Promise<Order> {
  if (!order.transactionId) return order;

  const { detail, journey, shippingCourier, shippingCarrierLogo } = await fetchEnrichment(order.transactionId, domain, {
    fetchShipping: true,
  });

  const buyer = extractCounterparty(detail.buyer, domain, {
    id: order.buyerId,
    username: order.buyerUsername,
    avatar: order.buyerAvatar,
    profileUrl: order.buyerProfileUrl ?? null,
  });

  const common = buildCommonEnrichment(detail, journey, shippingCourier, shippingCarrierLogo, order);

  return {
    ...order,
    orderStatus: order.statusLabel ? deriveOrderStage(order.statusLabel) : order.orderStatus,
    buyerId: buyer.id,
    buyerUsername: buyer.username,
    buyerAvatar: buyer.avatar,
    buyerProfileUrl: buyer.profileUrl,
    ...common,
  };
}

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

export async function enrichPurchase(purchase: Purchase, domain: string): Promise<Purchase> {
  if (!purchase.transactionId) return purchase;

  const { detail, journey } = await fetchEnrichment(purchase.transactionId, domain, { fetchShipping: false });

  const seller = extractCounterparty(detail.seller, domain, {
    id: purchase.sellerId,
    username: purchase.sellerUsername,
    avatar: purchase.sellerAvatar,
    profileUrl: purchase.sellerProfileUrl,
  });

  const common = buildCommonEnrichment(detail, journey, null, null, purchase);

  return {
    ...purchase,
    orderStatus: purchase.statusLabel ? deriveOrderStage(purchase.statusLabel) : purchase.orderStatus,
    sellerId: seller.id,
    sellerUsername: seller.username,
    sellerAvatar: seller.avatar,
    sellerProfileUrl: seller.profileUrl,
    ...common,
  };
}

export function pickPurchaseEnrichmentFields(cached: Purchase): Partial<Purchase> {
  return {
    sellerId: cached.sellerId,
    sellerUsername: cached.sellerUsername,
    sellerProfileUrl: cached.sellerProfileUrl,
    sellerAvatar: cached.sellerAvatar,
    courier: cached.courier,
    trackingNumber: cached.trackingNumber,
    trackingUrl: cached.trackingUrl,
    shipmentId: cached.shipmentId,
    shipmentStatus: cached.shipmentStatus,
    carrierLogoUrl: cached.carrierLogoUrl,
    estimatedDelivery: cached.estimatedDelivery,
    isBundle: cached.isBundle,
    bundleItems: cached.bundleItems,
  };
}
