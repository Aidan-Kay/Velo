import type { Order, OrderStage, OrderStatus, Purchase, VintedListing } from "../../shared/types";
import { CURRENCY_SYMBOLS } from "../shared/constants";

// ─── Raw API response types ────────────────────────────────────────────────

export interface RawThumbnail {
  type: string;
  url: string;
  width: number;
  height: number;
}

export interface RawPhoto {
  url?: string;
  full_size_url?: string;
  thumbnails?: RawThumbnail[];
  is_main?: boolean;
}

export interface RawPrice {
  amount?: string;
  currency_code?: string;
}

export interface RawItem {
  id: number;
  title?: string;
  description?: string;
  price?: RawPrice | string | number;
  currency?: string;
  photos?: RawPhoto[];
  view_count?: number;
  favourite_count?: number;
  created_at?: string;
  url?: string;
  brand?: string;
  brand_title?: string;
  size_title?: string;
  size?: string;
  catalog_id?: number;
  color1?: string;
  color2?: string;
  status?: number | string;
  is_draft?: boolean;
  is_closed?: boolean;
  is_reserved?: boolean;
  is_processing?: boolean;
  is_hidden?: boolean;
  is_visible?: boolean;
  path?: string;
  push_up?: { next_push_up_time?: string };
}

// Orders API (/api/v2/my_orders) — flat structure
export interface RawOrderEntry {
  conversation_id?: number;
  transaction_id?: number;
  title?: string;
  price?: RawPrice;
  status?: string;
  date?: string;
  photo?: RawPhoto;
  transaction_user_status?: string;
}

// ─── Listing Mappers ────────────────────────────────────────────────────────

/** Extract a creation timestamp from a photo URL.
 *  Vinted photo URLs end with a unix-timestamp filename, e.g.
 *  https://images1.vinted.net/t/.../f800/1774971858.webp → 1774971858
 *  Returns an ISO string or null if extraction fails. */
function extractPhotoTimestamp(photos: RawPhoto[] | undefined): string | null {
  if (!photos?.length) return null;
  const url = photos[0].full_size_url || photos[0].url;
  if (!url) return null;
  const match = url.match(/\/(\d{9,11})\.\w+(?:\?|$)/);
  if (!match) return null;
  const epoch = parseInt(match[1], 10);
  if (isNaN(epoch)) return null;
  return new Date(epoch * 1000).toISOString();
}

/** Map a raw Vinted wardrobe item to our VintedListing shape. */
export function mapRawToVintedListing(raw: RawItem, domain: string): VintedListing {
  const rawPrice = raw.price as RawPrice | undefined;
  const priceAmount = rawPrice?.amount != null ? parseFloat(rawPrice.amount) : null;
  const currency = rawPrice?.currency_code || raw.currency || "GBP";
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency + " ";

  const firstPhoto = raw.photos?.[0];
  const thumbnail =
    firstPhoto?.thumbnails?.find((t) => t.type === "thumb310x430")?.url ||
    firstPhoto?.thumbnails?.find((t) => t.type === "thumb150x210")?.url ||
    firstPhoto?.url ||
    null;

  return {
    id: raw.id,
    title: raw.title || "",
    description: raw.description || "",
    price: priceAmount != null ? `${currencySymbol}${priceAmount.toFixed(2)}` : null,
    priceNumeric: priceAmount,
    currency,
    thumbnail,
    photos: Array.isArray(raw.photos) ? (raw.photos.map((p) => p.full_size_url || p.url).filter(Boolean) as string[]) : [],
    views: raw.view_count || 0,
    favourites: raw.favourite_count || 0,
    createdAt: extractPhotoTimestamp(raw.photos) || raw.created_at || null,
    updatedAt: null,
    status: getStatusLabel(raw),
    statusRaw: typeof raw.status === "number" ? raw.status : 0,
    url: raw.url || `https://${domain}${raw.path || "/items/" + raw.id}`,
    brandTitle: raw.brand || raw.brand_title || "",
    sizeTitle: raw.size_title || raw.size || "",
    categoryId: raw.catalog_id || null,
    color1: raw.color1 || "",
    color2: raw.color2 || "",
  };
}

function getStatusLabel(raw: RawItem): string {
  if (raw.is_draft) return "Draft";
  if (raw.is_closed) return "Sold";
  if (raw.is_reserved) return "Reserved";
  if (raw.is_processing) return "Processing";
  if (raw.is_hidden) return "Hidden";
  return "Active";
}

/** Map an item_upload detail response to our VintedListing shape. */
export function mapItemUploadToVintedListing(detail: Record<string, unknown>, listingId: number, domain: string): VintedListing {
  const priceObj = detail.price as { amount?: string; currency_code?: string } | undefined;
  const priceAmount = priceObj?.amount != null ? parseFloat(priceObj.amount) : null;
  const currency = priceObj?.currency_code || (detail.currency as string) || "GBP";
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency + " ";

  const rawPhotos = (detail.photos as RawPhoto[]) || [];
  const firstPhoto = rawPhotos[0];
  const thumbnail =
    firstPhoto?.thumbnails?.find((t) => t.type === "thumb310x430")?.url ||
    firstPhoto?.thumbnails?.find((t) => t.type === "thumb150x210")?.url ||
    firstPhoto?.url ||
    null;

  const isDraft = detail.is_draft as boolean | undefined;
  const isClosed = detail.is_closed as boolean | undefined;
  let statusLabel: string;
  if (isDraft) {
    statusLabel = "Draft";
  } else if (isClosed) {
    statusLabel = "Hidden";
  } else {
    statusLabel = "Active";
  }

  return {
    id: listingId,
    title: (detail.title as string) || "",
    description: (detail.description as string) || "",
    price: priceAmount != null ? `${currencySymbol}${priceAmount.toFixed(2)}` : null,
    priceNumeric: priceAmount,
    currency,
    thumbnail,
    photos: rawPhotos.map((p) => p.full_size_url || p.url).filter(Boolean) as string[],
    views: 0,
    favourites: 0,
    createdAt: extractPhotoTimestamp(rawPhotos) || null,
    updatedAt: null,
    status: statusLabel,
    statusRaw: isDraft ? 0 : 1,
    url: `https://${domain}/items/${listingId}`,
    brandTitle: (detail.brand_dto as { title?: string })?.title || "",
    sizeTitle: "",
    categoryId: (detail.catalog_id as number) || null,
    color1: (detail.color1 as string) || "",
    color2: (detail.color2 as string) || "",
  };
}

// ─── Order Mappers ──────────────────────────────────────────────────────────

/** Simple deterministic hash for generating stable fallback IDs. */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

/** Map a raw order entry to our Order shape. */
export function normalizeOrder(raw: RawOrderEntry, domain: string): Order {
  const priceAmount = raw.price?.amount != null ? parseFloat(raw.price.amount) : null;
  const currency = raw.price?.currency_code || "GBP";
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency + " ";

  const thumbnail =
    raw.photo?.thumbnails?.find((t) => t.type === "thumb310x430")?.url ||
    raw.photo?.thumbnails?.find((t) => t.type === "thumb150x210")?.url ||
    raw.photo?.url ||
    null;

  return {
    id: raw.transaction_id || raw.conversation_id || -simpleHash(`${raw.title}-${raw.date}`),
    transactionId: raw.transaction_id || null,
    conversationId: raw.conversation_id || null,
    conversationUrl: raw.conversation_id ? `https://${domain}/inbox/${raw.conversation_id}` : null,
    itemTitle: raw.title || "Unknown Item",
    itemThumbnail: thumbnail,
    price: priceAmount != null ? `${currencySymbol}${priceAmount.toFixed(2)}` : null,
    priceNumeric: priceAmount,
    currency,
    buyerId: null,
    buyerUsername: "—",
    buyerAvatar: null,
    courier: "—",
    trackingNumber: null,
    trackingUrl: null,
    shipmentId: null,
    shipmentStatus: null,
    carrierLogoUrl: null,
    estimatedDelivery: null,
    status: deriveOrderStatus(raw.transaction_user_status, raw.status),
    orderStatus: deriveOrderStage(raw.status),
    statusLabel: raw.status || "",
    createdAt: raw.date || null,
    completedAt: null,
    isBundle: false,
    bundleItems: [],
  };
}

/** Map a raw order entry (purchased perspective) to our Purchase shape. */
export function normalizePurchase(raw: RawOrderEntry, domain: string): Purchase {
  const priceAmount = raw.price?.amount != null ? parseFloat(raw.price.amount) : null;
  const currency = raw.price?.currency_code || "GBP";
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency + " ";

  const thumbnail =
    raw.photo?.thumbnails?.find((t) => t.type === "thumb310x430")?.url ||
    raw.photo?.thumbnails?.find((t) => t.type === "thumb150x210")?.url ||
    raw.photo?.url ||
    null;

  return {
    id: raw.transaction_id || raw.conversation_id || -simpleHash(`${raw.title}-${raw.date}`),
    transactionId: raw.transaction_id || null,
    conversationId: raw.conversation_id || null,
    conversationUrl: raw.conversation_id ? `https://${domain}/inbox/${raw.conversation_id}` : null,
    itemTitle: raw.title || "Unknown Item",
    itemThumbnail: thumbnail,
    price: priceAmount != null ? `${currencySymbol}${priceAmount.toFixed(2)}` : null,
    priceNumeric: priceAmount,
    currency,
    sellerId: null,
    sellerUsername: "—",
    sellerAvatar: null,
    sellerProfileUrl: null,
    courier: "—",
    trackingNumber: null,
    trackingUrl: null,
    shipmentId: null,
    shipmentStatus: null,
    carrierLogoUrl: null,
    estimatedDelivery: null,
    status: deriveOrderStatus(raw.transaction_user_status, raw.status),
    orderStatus: deriveOrderStage(raw.status),
    statusLabel: raw.status || "",
    createdAt: raw.date || null,
    completedAt: null,
    isBundle: false,
    bundleItems: [],
  };
}

/** Maps transaction_user_status + status string to our OrderStatus enum. */
export function deriveOrderStatus(txUserStatus?: string, statusStr?: string): OrderStatus {
  if (txUserStatus === "completed") return "complete";
  if (txUserStatus === "failed") return "complete";
  if (txUserStatus === "needs_action") return "needs_action";
  if (statusStr?.toLowerCase().includes("complet")) return "complete";
  if (statusStr?.toLowerCase().includes("cancel")) return "complete";
  return "waiting";
}

/** Maps Vinted status string to our OrderStage enum. */
export function deriveOrderStage(statusStr?: string): OrderStage {
  if (!statusStr) return "unknown";
  const s = statusStr.toLowerCase();
  if (s.includes("cancelled")) return "cancelled";
  if (s.includes("payment successful")) return "payment_successful";
  if (s.includes("label ordered")) return "label_ordered";
  if (s.includes("label sent")) return "label_sent";
  if (s.includes("sending label failed")) return "label_failed";
  if (s.includes("on its way")) return "shipped";
  if (s.includes("parcel at buyer")) return "await_pickup";
  if (s.includes("delivered")) return "delivered";
  if (s.includes("complete")) return "complete";
  return "unknown";
}
