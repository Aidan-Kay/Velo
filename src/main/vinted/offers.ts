import type { OfferStatus, ReceivedOffer, SellerOfferOptions } from "../../shared/types";
import { CURRENCY_SYMBOLS, DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";
import { getInbox } from "./messaging";

const VINTED_API = "/api/v2";

// ─── Raw types from conversation messages ───────────────────────────────────

interface RawOfferEntity {
  offer_request_id?: number;
  status?: number; // 10=Pending, 20=Accepted, 40=Cancelled
  status_title?: string;
  price?: { amount?: string; currency_code?: string };
  original_price?: { amount?: string; currency_code?: string };
  current?: boolean;
  user_id?: number;
  transaction_id?: number;
}

interface RawMessage {
  entity_type?: string;
  entity?: RawOfferEntity;
  created_at_ts?: string;
}

interface RawConversation {
  id: number;
  messages?: RawMessage[];
  transaction?: {
    id?: number;
    current_user_side?: string;
    item_id?: number;
    item_title?: string;
    item_ids?: number[];
    is_bundle?: boolean;
    item_photo?: {
      url?: string;
      thumbnails?: Array<{ type: string; url: string }>;
    };
  };
  opposite_user?: {
    id?: number;
    login?: string;
    photo?: { url?: string };
    profile_url?: string;
  };
}

// ─── Offer status mapping ───────────────────────────────────────────────────

function mapOfferStatus(rawStatus?: number): OfferStatus {
  switch (rawStatus) {
    case 20:
      return "accepted";
    case 40:
      return "cancelled";
    default:
      return "pending";
  }
}

function formatPriceLabel(amount?: string, currencyCode?: string): string {
  const symbol = CURRENCY_SYMBOLS[currencyCode || ""] || (currencyCode ? currencyCode + " " : "");
  return amount ? `${symbol}${parseFloat(amount).toFixed(2)}` : "—";
}

// ─── Get Received Offers ────────────────────────────────────────────────────

export interface GetReceivedOffersResult {
  offers: ReceivedOffer[];
  latestTimestamp: string | null;
}

/**
 * Scan inbox conversations for received offers.
 * Pages through inbox until all conversations updated since `sinceTimestamp` are processed.
 * On first run (sinceTimestamp is null), only fetches the first page.
 */
export async function getReceivedOffers(
  domain: string = DEFAULT_DOMAIN,
  sinceTimestamp: string | null = null,
): Promise<GetReceivedOffersResult> {
  const client = getClient(domain);
  const offers: ReceivedOffer[] = [];
  let latestTimestamp: string | null = null;
  let page = 1;
  const perPage = 20;

  while (true) {
    const { conversations, pagination } = await getInbox(domain, page, perPage);

    if (conversations.length === 0) break;

    // Track the latest updated_at across all pages
    for (const conv of conversations) {
      if (conv.updated_at && (!latestTimestamp || conv.updated_at > latestTimestamp)) {
        latestTimestamp = conv.updated_at;
      }
    }

    // Filter to conversations updated since our last poll
    const relevantConversations = sinceTimestamp ? conversations.filter((c) => c.updated_at > sinceTimestamp) : conversations; // First run: process all on this page

    // Fetch full conversation details and extract offers
    for (const conv of relevantConversations) {
      try {
        const offersFromConv = await extractOffersFromConversation(conv.id, client.domain);
        offers.push(...offersFromConv);
      } catch (err) {
        console.warn(`[offers] Failed to process conversation ${conv.id}:`, (err as Error).message);
      }
    }

    // Stop paging conditions:
    // 1) First run (no sinceTimestamp): only first page
    // 2) All conversations on this page are older than sinceTimestamp
    // 3) No more pages
    if (!sinceTimestamp) break;

    const allOlderThanThreshold = conversations.every((c) => c.updated_at <= sinceTimestamp);
    if (allOlderThanThreshold) break;

    const totalPages = pagination.total_pages || 1;
    if (page >= totalPages) break;

    page++;
  }

  return { offers, latestTimestamp };
}

/**
 * Fetch a full conversation and extract offer_request_message entities.
 * Only processes seller-side conversations.
 */
async function extractOffersFromConversation(conversationId: number, domain: string): Promise<ReceivedOffer[]> {
  const client = getClient(domain);
  const apiUrl = `https://${client.domain}${VINTED_API}/conversations/${conversationId}`;
  const response = await client.get<{ conversation?: RawConversation }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch conversation ${conversationId} (status ${response.status})`);
  }

  const conv = response.data?.conversation;
  if (!conv) return [];

  // Only process conversations where current user is the seller
  if (conv.transaction?.current_user_side !== "seller") return [];

  const txn = conv.transaction;
  const oppositeUser = conv.opposite_user;
  const offers: ReceivedOffer[] = [];

  const itemThumbnail =
    txn?.item_photo?.thumbnails?.find((t) => t.type === "thumb310x430")?.url ||
    txn?.item_photo?.thumbnails?.find((t) => t.type === "thumb150x210")?.url ||
    txn?.item_photo?.url ||
    null;

  for (const msg of conv.messages || []) {
    if (msg.entity_type !== "offer_request_message") continue;

    const entity = msg.entity;
    if (!entity?.offer_request_id) continue;

    const status = mapOfferStatus(entity.status);
    const priceCurrency = entity.price?.currency_code || "GBP";
    const originalCurrency = entity.original_price?.currency_code || priceCurrency;

    offers.push({
      id: entity.offer_request_id,
      transactionId: entity.transaction_id || txn?.id || 0,
      conversationId: conv.id,
      offerRequestId: entity.offer_request_id,
      itemId: txn?.item_id || 0,
      itemTitle: txn?.item_title || "Unknown Item",
      itemThumbnail,
      isBundle: txn?.is_bundle || false,
      bundleItemIds: txn?.item_ids || [],
      bundleItems: [],
      conversationUrl: `https://${domain}/inbox/${conv.id}`,
      buyerId: oppositeUser?.id || entity.user_id || 0,
      buyerUsername: oppositeUser?.login || "—",
      buyerAvatar: oppositeUser?.photo?.url || null,
      buyerProfileUrl: oppositeUser?.profile_url || null,
      originalPrice: {
        amount: entity.original_price?.amount || "0",
        currencyCode: originalCurrency,
      },
      originalPriceLabel: formatPriceLabel(entity.original_price?.amount, originalCurrency),
      offerPrice: {
        amount: entity.price?.amount || "0",
        currencyCode: priceCurrency,
      },
      offerPriceLabel: formatPriceLabel(entity.price?.amount, priceCurrency),
      status,
      statusTitle: entity.status_title || status,
      current: entity.current ?? false,
      offeredAt: msg.created_at_ts || new Date().toISOString(),
    });
  }

  return offers;
}

// ─── Accept / Counter / Options ─────────────────────────────────────────────

export async function acceptOffer(transactionId: number, offerRequestId: number, domain: string = DEFAULT_DOMAIN): Promise<void> {
  const client = getClient(domain);
  const apiUrl = `https://${client.domain}${VINTED_API}/transactions/${transactionId}/offer_requests/${offerRequestId}/accept`;

  console.log(`[offers] Accepting offer ${offerRequestId} on transaction ${transactionId}...`);
  const response = await client.put(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to accept offer (status ${response.status})`);
  }
}

export async function counterOffer(transactionId: number, price: number, currency: string, domain: string = DEFAULT_DOMAIN): Promise<void> {
  const client = getClient(domain);
  const apiUrl = `https://${client.domain}${VINTED_API}/transactions/${transactionId}/offers`;

  console.log(`[offers] Counter-offering on transaction ${transactionId}: ${price} ${currency}...`);
  const response = await client.post(apiUrl, {
    offer: { price: price.toString(), currency_code: currency },
  });

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Failed to create counter-offer (status ${response.status})`);
  }
}

export async function getSellerOfferOptions(transactionId: number, domain: string = DEFAULT_DOMAIN): Promise<SellerOfferOptions> {
  const client = getClient(domain);
  const apiUrl = `https://${client.domain}${VINTED_API}/transactions/${transactionId}/offers/seller_options`;

  console.log(`[offers] Fetching seller offer options for transaction ${transactionId}...`);
  const response = await client.get<{
    seller_options?: {
      min_price?: { amount?: string; currency_code?: string };
      max_price?: { amount?: string; currency_code?: string };
    };
  }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch seller options (status ${response.status})`);
  }

  const opts = response.data?.seller_options;
  return {
    minPrice: opts?.min_price?.amount ? parseFloat(opts.min_price.amount) : null,
    maxPrice: opts?.max_price?.amount ? parseFloat(opts.max_price.amount) : null,
    currency: opts?.min_price?.currency_code || opts?.max_price?.currency_code || "GBP",
  };
}
