import type { ConversationDetail, ConversationMessage, InboxConversationSummary, Pagination } from "../../shared/types";
import { getDomain } from "../shared/constants";
import { getClient } from "../vinted/lib/requester";
import type { InboxConversation } from "../vinted/messaging";
import * as vintedApi from "../vinted/api";
import type { IpcDeps } from "./types";
import { ipcMain } from "electron";

export function setupInboxIpc(deps: IpcDeps): void {
  const domain = () => getDomain(deps.getSettings().site);

  ipcMain.handle("get-inbox-conversations", async (_event, page = 1) => {
    const { conversations, pagination } = await vintedApi.getInbox(domain(), page, 20);
    const summaries: InboxConversationSummary[] = conversations.map((c) => mapConversationSummary(c));
    return { conversations: summaries, pagination };
  });

  ipcMain.handle("get-conversation-detail", async (_event, conversationId: number) => {
    const d = domain();
    const client = getClient(d);
    const raw = await vintedApi.getConversationDetail(conversationId, d);
    return mapConversationDetail(raw, client.userId ?? null);
  });

  ipcMain.handle("send-message", async (_event, conversationId: number, body: string) => {
    return vintedApi.sendMessage(conversationId, body, domain());
  });
}

function mapConversationSummary(c: InboxConversation): InboxConversationSummary {
  return {
    id: c.id,
    title: c.title,
    updatedAt: c.updated_at,
    unread: c.unread,
    oppositeUser: {
      id: c.opposite_user?.id ?? null,
      login: c.opposite_user?.login ?? "Unknown",
      avatarUrl: c.opposite_user?.photo?.url ?? null,
    },
  };
}

function mapConversationDetail(raw: any, currentUserId: number | null): ConversationDetail {
  const messages: ConversationMessage[] = (raw.messages ?? []).map((m: any) => {
    const fromUserId: number | null = m.author_id ?? m.user_id ?? null;
    return {
      id: m.id ?? 0,
      entityType: m.entity_type ?? "text_message",
      body: m.body ?? null,
      createdAt: m.created_at ?? new Date().toISOString(),
      fromUserId,
      isOwnMessage: currentUserId !== null && fromUserId === currentUserId,
    };
  });

  const thumbs: Array<{ type: string; url: string }> = raw.transaction?.item_photo?.thumbnails ?? [];
  const thumb = thumbs.find((t) => t.type === "thumb") ?? thumbs[0];

  return {
    id: raw.id ?? 0,
    oppositeUser: {
      id: raw.opposite_user?.id ?? null,
      login: raw.opposite_user?.login ?? "Unknown",
      avatarUrl: raw.opposite_user?.photo?.url ?? null,
      profileUrl: raw.opposite_user?.profile_url ?? null,
    },
    itemTitle: raw.transaction?.item_title ?? null,
    itemThumbnail: thumb?.url ?? null,
    messages,
  };
}
