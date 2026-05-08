import type { Order, Pagination, Purchase, TransactionDetail } from "../../shared/types";
import { DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";
import { normalizeOrder, normalizePurchase, type RawOrderEntry } from "./mappers";

const VINTED_API = "/api/v2";

// ─── Orders ─────────────────────────────────────────────────────────────────

interface GetMyOrdersOptions {
  domain?: string;
  page?: number;
  perPage?: number;
}

export async function getMyOrders(options: GetMyOrdersOptions = {}): Promise<{ orders: Order[]; pagination: Pagination }> {
  const { domain, page = 1, perPage = 20 } = options;
  const client = getClient(domain || DEFAULT_DOMAIN);
  if (!client.isLoggedIn || !client.userId) {
    throw new Error("Not logged in");
  }

  const apiUrl = `https://${client.domain}${VINTED_API}/my_orders`;
  const params: Record<string, unknown> = { type: "sold", status: "all", page, per_page: perPage };

  console.log(`[vinted] Fetching my orders (page ${page})...`);
  const response = await client.get<{
    my_orders?: RawOrderEntry[];
    pagination?: Pagination;
  }>(apiUrl, params);

  if (response.status !== 200) {
    throw new Error(`Vinted API returned status ${response.status}`);
  }

  const rawOrders = response.data?.my_orders || [];
  const pagination = response.data?.pagination || {};
  const orders = rawOrders.map((raw) => normalizeOrder(raw, client.domain));

  return { orders, pagination };
}

// ─── Purchases (buyer perspective) ──────────────────────────────────────────

export async function getMyPurchases(options: GetMyOrdersOptions = {}): Promise<{ purchases: Purchase[]; pagination: Pagination }> {
  const { domain, page = 1, perPage = 20 } = options;
  const client = getClient(domain || DEFAULT_DOMAIN);
  if (!client.isLoggedIn || !client.userId) {
    throw new Error("Not logged in");
  }

  const apiUrl = `https://${client.domain}${VINTED_API}/my_orders`;
  const params: Record<string, unknown> = { type: "purchased", status: "all", page, per_page: perPage };

  console.log(`[vinted] Fetching my purchases (page ${page})...`);
  const response = await client.get<{
    my_orders?: RawOrderEntry[];
    pagination?: Pagination;
  }>(apiUrl, params);

  if (response.status !== 200) {
    throw new Error(`Vinted API returned status ${response.status}`);
  }

  const rawOrders = response.data?.my_orders || [];
  const pagination = response.data?.pagination || {};
  const purchases = rawOrders.map((raw) => normalizePurchase(raw, client.domain));

  return { purchases, pagination };
}

// ─── Transaction / Conversation ─────────────────────────────────────────────

export async function getTransactionDetail(transactionId: number, domain?: string): Promise<TransactionDetail> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/transactions/${transactionId}`;

  console.log(`[vinted] Fetching transaction ${transactionId}...`);
  const response = await client.get<{ transaction?: TransactionDetail }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch transaction ${transactionId} (status ${response.status})`);
  }
  return response.data?.transaction || (response.data as unknown as TransactionDetail);
}

export async function getConversation(conversationId: number, domain?: string): Promise<unknown> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/conversations/${conversationId}`;

  console.log(`[vinted] Fetching conversation ${conversationId}...`);
  const response = await client.get(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch conversation ${conversationId} (status ${response.status})`);
  }
  return response.data;
}
