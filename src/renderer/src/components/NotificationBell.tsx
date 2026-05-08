import { BellIcon, ShoppingCartIcon, TagIcon } from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@shared/components/ui/dropdown-menu";
import { Separator } from "@shared/components/ui/separator";
import React, { useCallback } from "react";
import type { AppNotification } from "../../../shared/types";
import { useNotificationSync } from "../context/NotificationSyncContext";

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

const TypeIcon: React.FC<{ type: AppNotification["type"] }> = ({ type }) => {
  if (type === "new_order") return <ShoppingCartIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
  return <TagIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
};

const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markRead, markAllRead, clearAll, setHighlight } = useNotificationSync();

  const handleNotificationClick = useCallback(
    (notification: AppNotification) => {
      markRead(notification.id);
      setHighlight({ page: notification.navigateTo, referenceId: notification.referenceId });
    },
    [markRead, setHighlight],
  );

  const sorted = [...notifications].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const badgeText = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button variant="ghost" size="icon" className="relative h-8 w-8">
            <BellIcon className="w-6 h-6 text-muted-foreground hover:text-foreground transition-colors" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-none">
                {badgeText}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-medium text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  markAllRead();
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Mark all read
              </button>
            )}
          </div>
          <Separator />

          {/* Notification list */}
          <div className="max-h-96 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No notifications</div>
            ) : (
              sorted.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer"
                >
                  {/* Unread dot */}
                  <div className="flex-shrink-0 w-2 pt-1.5">
                    {!notification.read && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <TypeIcon type={notification.type} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{notification.title}</span>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {formatRelativeTime(notification.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{notification.message}</p>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </div>

          {/* Footer */}
          {sorted.length > 0 && (
            <>
              <Separator />
              <div className="px-3 py-2 flex justify-center">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearAll();
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default NotificationBell;
