import {
  ArrowUpTrayIcon,
  BanknotesIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  CloudArrowUpIcon,
  CurrencyPoundIcon,
  DocumentPlusIcon,
  ExclamationTriangleIcon,
  ShoppingBagIcon,
} from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Calendar } from "@shared/components/ui/calendar";
import { Card } from "@shared/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@shared/components/ui/dropdown-menu";
import { Label } from "@shared/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@shared/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shared/components/ui/tooltip";
import { endOfMonth, format, isWithinInterval, parseISO, startOfMonth } from "date-fns";
import React, { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { LocalItem, Order } from "../../../shared/types";
import { ProgressModal, type ProgressState } from "../components/ProgressModal";
import { useItemsSync } from "../context/ItemsSyncContext";
import { useListingSync } from "../context/ListingSyncContext";
import { useNotificationSync } from "../context/NotificationSyncContext";
import { useOrdersSync } from "../context/OrdersSyncContext";
import { useToast } from "../context/ToastContext";
import { runBulkOperation } from "../hooks/useBulkOperation";
import { useGlobalRefresh } from "../hooks/useGlobalRefresh";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardProps {
  loggedIn: boolean;
}

interface ChartDataPoint {
  date: string;
  value: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrencySymbol(orders: Order[]): string {
  // Use the currency from the first order that has one, default to £
  for (const o of orders) {
    if (o.currency) {
      const symbols: Record<string, string> = {
        GBP: "£",
        EUR: "€",
        USD: "$",
        PLN: "zł",
        CZK: "Kč",
        SEK: "kr",
      };
      return symbols[o.currency.toUpperCase()] ?? o.currency;
    }
  }
  return "£";
}

/** Parse the priceNumeric from an order, falling back to 0. */
function orderValue(order: Order): number {
  return order.priceNumeric ?? 0;
}

/** Determine if an order needs user action. */
function orderNeedsAction(order: Order): boolean {
  return order.status === "needs_action";
}

const RevenueChart = lazy(() => import("../components/RevenueChart"));

// ─── Component ───────────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({ loggedIn }) => {
  const { addToast } = useToast();
  const { orders } = useOrdersSync();
  const { listingMap, refreshListings, patchListingMap } = useListingSync();
  const { items, upsertItem } = useItemsSync();
  const { setHighlight } = useNotificationSync();

  const handleGlobalRefresh = useCallback(() => {
    void window.api.refreshMyOrders().catch(() => {});
    refreshListings().catch(() => {});
  }, [refreshListings]);
  useGlobalRefresh("dashboard", handleGlobalRefresh);

  // Date range — default to current month
  const now = new Date();
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(now));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(now));

  // Progress state for bulk actions
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const cancelledRef = useRef(false);

  // ─── Filtered orders for the chosen date range ─────────────────────

  const filteredOrders = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    // Set `to` to end of day
    to.setHours(23, 59, 59, 999);

    return orders.filter((o) => {
      if (!o.createdAt) return false;
      try {
        const d = parseISO(o.createdAt);
        return isWithinInterval(d, { start: from, end: to });
      } catch {
        return false;
      }
    });
  }, [orders, dateFrom, dateTo]);

  // ─── Stats ─────────────────────────────────────────────────────────

  const currencySymbol = useMemo(() => getCurrencySymbol(orders), [orders]);

  const totalRevenue = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + orderValue(o), 0);
  }, [filteredOrders]);

  const orderCount = filteredOrders.length;

  const averageOrderValue = useMemo(() => {
    return orderCount > 0 ? totalRevenue / orderCount : 0;
  }, [totalRevenue, orderCount]);

  const pendingBalance = useMemo(() => {
    return orders.filter((o) => o.orderStatus !== "complete" && o.orderStatus !== "cancelled").reduce((sum, o) => sum + orderValue(o), 0);
  }, [orders]);

  // ─── Chart data ────────────────────────────────────────────────────

  const chartData = useMemo((): ChartDataPoint[] => {
    // Group order values by date
    const map = new Map<string, number>();
    for (const o of filteredOrders) {
      if (!o.createdAt) continue;
      const dateKey = format(parseISO(o.createdAt), "dd MMM");
      map.set(dateKey, (map.get(dateKey) ?? 0) + orderValue(o));
    }

    // Build sorted array from the date range
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const points: ChartDataPoint[] = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const key = format(cursor, "dd MMM");
      points.push({ date: key, value: map.get(key) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return points;
  }, [filteredOrders, dateFrom, dateTo]);

  // ─── Todo lists ────────────────────────────────────────────────────

  /** In-stock items that have no associated listing at all. */
  const itemsWithoutListing = useMemo(() => {
    return items
      .filter((item) => {
        if (item.stock <= 0) return false;
        const entry = listingMap.get(item.title.toLowerCase().trim());
        if (!entry) return true;
        // Sold/Reserved = effectively no current listing (item needs re-listing)
        return entry.status === "Sold" || entry.status === "Reserved";
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [items, listingMap]);

  /** Draft listings awaiting publish (items that have a draft listing). */
  const draftsAwaitingPublish = useMemo(() => {
    return items
      .filter((item) => {
        if (item.stock <= 0) return false;
        const entry = listingMap.get(item.title.toLowerCase().trim());
        return entry?.status === "Draft";
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [items, listingMap]);

  /** Orders that need user action. */
  const actionableOrders = useMemo(() => {
    return orders.filter(orderNeedsAction);
  }, [orders]);

  // ─── Bulk actions ──────────────────────────────────────────────────

  const handleBulkListItems = useCallback(
    async (targetItems: LocalItem[], asDraft: boolean) => {
      if (!loggedIn) {
        addToast("Log in to list items", "error");
        return;
      }
      if (targetItems.length === 0) return;

      const settings = await window.api.getSettings();
      const minMs = (settings.bulkRepost?.minIntervalSeconds ?? 30) * 1000;
      const maxMs = (settings.bulkRepost?.maxIntervalSeconds ?? 60) * 1000;

      cancelledRef.current = false;

      await runBulkOperation({
        items: targetItems,
        title: `Listing ${targetItems.length} item(s)${asDraft ? " as draft" : ""}`,
        cancelledRef,
        setProgress,
        minIntervalMs: minMs,
        maxIntervalMs: maxMs,
        action: async (item, updateAction, updateItemStep) => {
          const photoCount = item.photos?.length ?? 0;
          const totalSteps = photoCount + 1 + (asDraft ? 0 : 1);

          const cleanup = window.api.onListingCreationProgress(({ step, current }) => {
            updateItemStep(current, totalSteps);
            updateAction(step + "…");
          });

          updateItemStep(1, totalSteps);
          updateAction(asDraft ? "Listing as draft…" : "Listing on Vinted…");
          try {
            const result = await window.api.createListing(item, { asDraft });
            const created = result as Record<string, unknown>;
            const vintedItem = (created.item || created) as Record<string, unknown>;
            const vintedId = (vintedItem.id as number) || 0;
            patchListingMap(item.title, { status: asDraft ? "Draft" : "Active", id: vintedId });
            upsertItem({ ...item, updatedAt: new Date().toISOString() });
          } finally {
            cleanup();
          }
        },
        onComplete: () => {
          refreshListings().catch(() => {});
        },
      });
    },
    [loggedIn, addToast, patchListingMap, upsertItem, refreshListings],
  );

  const handleBulkPublishDrafts = useCallback(
    async (targetItems: LocalItem[]) => {
      if (!loggedIn) {
        addToast("Log in to publish drafts", "error");
        return;
      }
      if (targetItems.length === 0) return;

      const draftEntries = targetItems
        .map((item) => {
          const entry = listingMap.get(item.title.toLowerCase().trim());
          return entry ? { item, listingId: entry.id, title: item.title } : null;
        })
        .filter(Boolean) as { item: LocalItem; listingId: number; title: string }[];

      if (draftEntries.length === 0) return;

      const settings = await window.api.getSettings();
      const minMs = (settings.bulkRepost?.minIntervalSeconds ?? 30) * 1000;
      const maxMs = (settings.bulkRepost?.maxIntervalSeconds ?? 60) * 1000;

      cancelledRef.current = false;

      await runBulkOperation({
        items: draftEntries,
        title: `Publishing ${draftEntries.length} draft(s)`,
        cancelledRef,
        setProgress,
        minIntervalMs: minMs,
        maxIntervalMs: maxMs,
        action: async (entry, updateAction) => {
          updateAction("Publishing draft…");
          await window.api.publishListing(entry.listingId);
          patchListingMap(entry.title, { status: "Active", id: entry.listingId });
        },
        onComplete: () => {
          refreshListings().catch(() => {});
        },
      });
    },
    [loggedIn, addToast, listingMap, patchListingMap, refreshListings],
  );

  // ─── Render ────────────────────────────────────────────────────────

  if (!loggedIn) {
    return <div className="flex items-center justify-center h-full text-neutral-500 text-sm">Log in to view your dashboard</div>;
  }

  return (
    <div className="space-y-6">
      {/* ─── Date Range ──────────────────────────────────────────────── */}
      <div className="flex gap-4">
        <div className="space-y-1.5">
          <Label className="text-sm">From</Label>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" className="w-44 justify-start text-left font-normal" />}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {format(dateFrom, "dd MMM yyyy")}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">To</Label>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" className="w-44 justify-start text-left font-normal" />}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {format(dateTo, "dd MMM yyyy")}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* ─── Stats Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BanknotesIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Total Revenue</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {currencySymbol}
            {totalRevenue.toFixed(2)}
          </p>
        </Card>

        <Card className="p-5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShoppingBagIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Orders</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{orderCount}</p>
        </Card>

        <Card className="p-5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CurrencyPoundIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Avg. Order Value</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {currencySymbol}
            {averageOrderValue.toFixed(2)}
          </p>
        </Card>

        <Card className="p-5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ClockIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Pending Balance</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {currencySymbol}
            {pendingBalance.toFixed(2)}
          </p>
        </Card>
      </div>

      {/* ─── Revenue Chart ───────────────────────────────────────────── */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Order Value Over Time</h3>
        {chartData.length > 0 ? (
          <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded" />}>
            <RevenueChart data={chartData} currencySymbol={currencySymbol} />
          </Suspense>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">No orders in this period</p>
        )}
      </Card>

      {/* ─── Todo Lists ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {/* In stock items without any listing */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardDocumentListIcon className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground flex-1">In Stock Items Without Listing</h3>
            {itemsWithoutListing.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" className="h-6 px-2 text-xs" />}>
                  Actions <ChevronDownIcon className="w-3 h-3 ml-1" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleBulkListItems(itemsWithoutListing, false)}>List items</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkListItems(itemsWithoutListing, true)}>List items as draft</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {itemsWithoutListing.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">All in-stock items have a listing</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {itemsWithoutListing.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  {item.photos.length > 0 && (
                    <div className="w-7 h-7 rounded bg-muted overflow-hidden flex-shrink-0">
                      <img src={item.photos[0]} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <span className="truncate flex-1">{item.title}</span>
                  <Tooltip>
                    <TooltipTrigger>
                      <Button variant="ghost" className="h-6 w-6 p-0 flex-shrink-0" onClick={() => handleBulkListItems([item], false)}>
                        <ArrowUpTrayIcon className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>List item</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger>
                      <Button variant="ghost" className="h-6 w-6 p-0 flex-shrink-0" onClick={() => handleBulkListItems([item], true)}>
                        <DocumentPlusIcon className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>List as draft</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Drafts awaiting publish */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardDocumentListIcon className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground flex-1">Drafts Awaiting Publish</h3>
            {draftsAwaitingPublish.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" className="h-6 px-2 text-xs" />}>
                  Actions <ChevronDownIcon className="w-3 h-3 ml-1" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleBulkPublishDrafts(draftsAwaitingPublish)}>Publish drafts</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {draftsAwaitingPublish.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No draft listings awaiting publish</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {draftsAwaitingPublish.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  {item.photos.length > 0 && (
                    <div className="w-7 h-7 rounded bg-muted overflow-hidden flex-shrink-0">
                      <img src={item.photos[0]} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <span className="truncate flex-1">{item.title}</span>
                  <Tooltip>
                    <TooltipTrigger>
                      <Button variant="ghost" className="h-6 w-6 p-0 flex-shrink-0" onClick={() => handleBulkPublishDrafts([item])}>
                        <CloudArrowUpIcon className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Publish draft</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Orders needing action */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Orders Needing Action</h3>
          </div>
          {actionableOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No orders need your attention</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {actionableOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-1 -mx-1 transition-colors"
                  onClick={() => {
                    if (order.transactionId != null) {
                      setHighlight({ page: "orders", referenceId: order.transactionId });
                    }
                  }}
                >
                  {order.itemThumbnail && (
                    <div className="w-7 h-7 rounded bg-muted overflow-hidden flex-shrink-0">
                      <img src={order.itemThumbnail} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <span className="truncate flex-1">{order.itemTitle}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{order.price ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {progress && <ProgressModal progress={progress} onClose={() => setProgress(null)} />}
    </div>
  );
};

export default React.memo(Dashboard);
