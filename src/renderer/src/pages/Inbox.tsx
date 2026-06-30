import { ArrowPathIcon, PaperAirplaneIcon } from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationDetail, ConversationMessage, InboxConversationSummary, InboxDelta } from "../../../shared/types";

interface InboxProps {
  loggedIn: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDay.getTime() === today.getTime()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (msgDay.getTime() === yesterday.getTime()) {
    return "Yesterday";
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDay.getTime() === today.getTime()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (msgDay.getTime() === yesterday.getTime()) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return (
    date.toLocaleDateString([], { day: "numeric", month: "short" }) +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

const Inbox: React.FC<InboxProps> = ({ loggedIn }) => {
  const [conversations, setConversations] = useState<InboxConversationSummary[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadConversations = useCallback(
    async (page = 1) => {
      if (!loggedIn) return;
      setLoading(true);
      try {
        const result = await window.api.getInboxConversations(page);
        setConversations((prev) => (page === 1 ? result.conversations : [...prev, ...result.conversations]));
        setTotalPages(result.pagination.total_pages ?? 1);
        setCurrentPage(page);
      } catch (err) {
        console.error("[inbox] Failed to load conversations:", err);
      } finally {
        setLoading(false);
      }
    },
    [loggedIn],
  );

  const loadDetail = useCallback(async (convId: number) => {
    setDetailLoading(true);
    try {
      const d = await window.api.getConversationDetail(convId);
      setDetail(d);
    } catch (err) {
      console.error("[inbox] Failed to load conversation detail:", err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) {
      loadConversations(1);
    }
  }, [loggedIn, loadConversations]);

  useEffect(() => {
    if (activeConvId !== null) {
      loadDetail(activeConvId);
    } else {
      setDetail(null);
    }
  }, [activeConvId, loadDetail]);

  useEffect(() => {
    if (detail) {
      scrollToBottom();
    }
  }, [detail, scrollToBottom]);

  useEffect(() => {
    const cleanup = window.api.onInboxConversationsDelta((delta: InboxDelta) => {
      setConversations((prev) => {
        const updated = [...prev];
        for (const conv of delta.upserted) {
          const idx = updated.findIndex((c) => c.id === conv.id);
          if (idx >= 0) {
            updated[idx] = conv;
          } else {
            updated.unshift(conv);
          }
        }
        updated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return updated;
      });
      if (activeConvId !== null && delta.upserted.some((c) => c.id === activeConvId)) {
        loadDetail(activeConvId);
      }
    });
    return cleanup;
  }, [activeConvId, loadDetail]);

  const handleSend = useCallback(async () => {
    if (!messageInput.trim() || activeConvId === null || sending) return;
    const body = messageInput.trim();
    setMessageInput("");
    setSending(true);

    const optimisticMsg: ConversationMessage = {
      id: Date.now(),
      entityType: "text_message",
      body,
      createdAt: new Date().toISOString(),
      fromUserId: null,
      isOwnMessage: true,
    };
    setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, optimisticMsg] } : prev));

    try {
      await window.api.sendMessage(activeConvId, body);
    } catch (err) {
      console.error("[inbox] Failed to send message:", err);
      setDetail((prev) => (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticMsg.id) } : prev));
      setMessageInput(body);
    } finally {
      setSending(false);
    }
  }, [messageInput, activeConvId, sending]);

  useEffect(() => {
    scrollToBottom();
  }, [detail?.messages.length, scrollToBottom]);

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-80 shrink-0 flex flex-col border-r border-border/50">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <span className="text-sm font-semibold">Inbox</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadConversations(1)} disabled={loading}>
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConvId(conv.id)}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-accent transition-colors border-b border-border/30 ${
                activeConvId === conv.id ? "bg-accent" : ""
              }`}
            >
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-medium text-muted-foreground overflow-hidden">
                {conv.oppositeUser.avatarUrl ? (
                  <img src={conv.oppositeUser.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  conv.oppositeUser.login.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{conv.oppositeUser.login}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(conv.updatedAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground truncate">{conv.title}</span>
                  {conv.unread && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />}
                </div>
              </div>
            </button>
          ))}
          {currentPage < totalPages && (
            <div className="p-4 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => loadConversations(currentPage + 1)} disabled={loading}>
                {loading ? "Loading\u2026" : "Load More"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeConvId === null ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-muted-foreground">Select a conversation</span>
          </div>
        ) : detailLoading && !detail ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading\u2026</span>
          </div>
        ) : detail ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 shrink-0">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground overflow-hidden">
                {detail.oppositeUser.avatarUrl ? (
                  <img src={detail.oppositeUser.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  detail.oppositeUser.login.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{detail.oppositeUser.login}</div>
                {detail.itemTitle && <div className="text-xs text-muted-foreground truncate">{detail.itemTitle}</div>}
              </div>
              {detail.itemThumbnail && (
                <img src={detail.itemThumbnail} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {detail.messages.map((msg) => {
                if (msg.entityType !== "text_message") {
                  return (
                    <div key={msg.id} className="text-center text-xs text-muted-foreground my-2">
                      [system: {msg.entityType}]
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className={`flex ${msg.isOwnMessage ? "justify-end" : "justify-start"}`}>
                    <div className="flex flex-col gap-1 max-w-[70%]">
                      <div
                        className={
                          msg.isOwnMessage
                            ? "bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm"
                            : "bg-muted rounded-lg px-3 py-2 text-sm"
                        }
                      >
                        {msg.body}
                      </div>
                      <span className={`text-xs text-muted-foreground ${msg.isOwnMessage ? "text-right" : "text-left"}`}>
                        {formatMessageTime(msg.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Send bar */}
            <div className="px-4 py-3 border-t border-border/50 flex items-end gap-2 shrink-0">
              <Textarea
                rows={2}
                className="resize-none flex-1"
                placeholder="Type a message\u2026"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button size="icon" className="shrink-0" onClick={handleSend} disabled={!messageInput.trim() || sending}>
                <PaperAirplaneIcon className="w-4 h-4" />
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default Inbox;
