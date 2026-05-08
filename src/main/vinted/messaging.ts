import type { Pagination } from "../../shared/types";
import { DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";

const VINTED_API = "/api/v2";

// ─── Inbox ──────────────────────────────────────────────────────────────────

export interface InboxConversation {
  id: number;
  title: string;
  updated_at: string;
  unread: boolean;
  opposite_user?: {
    id?: number;
    login?: string;
    photo?: { url?: string };
  };
}

interface InboxResponse {
  conversations?: InboxConversation[];
  pagination?: Pagination;
}

export async function getInbox(
  domain: string = DEFAULT_DOMAIN,
  page = 1,
  perPage = 20,
): Promise<{ conversations: InboxConversation[]; pagination: Pagination }> {
  const client = getClient(domain);
  if (!client.isLoggedIn || !client.userId) {
    throw new Error("Not logged in");
  }

  const apiUrl = `https://${client.domain}${VINTED_API}/inbox`;
  const params: Record<string, unknown> = { page, per_page: perPage };

  console.log(`[vinted] Fetching inbox (page ${page})...`);
  const response = await client.get<InboxResponse>(apiUrl, params);

  if (response.status !== 200) {
    throw new Error(`Inbox fetch failed (status ${response.status})`);
  }

  return {
    conversations: response.data?.conversations || [],
    pagination: response.data?.pagination || {},
  };
}
