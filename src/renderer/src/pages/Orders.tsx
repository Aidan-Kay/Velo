import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  PlusCircleIcon,
  PrinterIcon,
} from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { Checkbox } from "@shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@shared/components/ui/dropdown-menu";
import { Skeleton } from "@shared/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@shared/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shared/components/ui/tooltip";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Order } from "../../../shared/types";
import { SHIPMENT_STATUS } from "../../../shared/types";
import { Badge, type BadgeProps } from "../components/Badge";
import FilterBar, { type FilterOption } from "../components/FilterBar";
import { ProgressModal, type ProgressState } from "../components/ProgressModal";
import { SortArrow } from "../components/SortArrow";
import { useNotificationSync } from "../context/NotificationSyncContext";
import { useOrdersSync } from "../context/OrdersSyncContext";
import { useToast } from "../context/ToastContext";
import { useGlobalRefresh } from "../hooks/useGlobalRefresh";
import { useTableSort } from "../hooks/useTableSort";

interface OrdersProps {
  loggedIn: boolean;
  isActive?: boolean;
}

const statusOptions: FilterOption[] = [
  { value: "needs_action", label: "Needs action" },
  { value: "waiting", label: "Waiting" },
  { value: "complete", label: "Complete" },
];

const STATUS_BADGE: Record<string, BadgeProps["variant"]> = {
  needs_action: "needs-action",
  waiting: "waiting",
  complete: "complete",
};

const STAGE_LABELS: Record<string, string> = {
  payment_successful: "payment successful",
  label_sent: "label sent",
  label_failed: "label failed",
  shipped: "shipped",
  delivered: "delivered",
  complete: "completed",
  cancelled: "cancelled",
  await_pickup: "awaiting pickup",
  unknown: "unknown",
};

const STAGE_BADGE: Record<string, BadgeProps["variant"]> = {
  payment_successful: "waiting",
  label_sent: "label-sent",
  label_failed: "label-failed",
  shipped: "shipped",
  delivered: "completed",
  complete: "completed",
  cancelled: "cancelled",
  await_pickup: "awaiting-pickup",
  unknown: "hidden",
};

type SortColumn = "date" | "item" | "buyer" | "price" | "status" | "stage" | "courier";

/** Cached date formatter — avoids repeated toLocaleString ICU lookups per row.
 *  Cache is keyed by dateStr + current-day stamp so "Today"/"Yesterday" stays correct.
 *  LRU-bounded to prevent unbounded growth across long sessions. */
const _ORDER_DATE_CACHE_LIMIT = 500;
const _orderDateCache = new Map<string, { date: string; time: string; dayStamp: number }>();
function formatOrderDate(dateStr: string | null): { date: string; time: string } | null {
  if (!dateStr) return null;
  try {
    const now = new Date();
    const dayStamp = now.getFullYear() * 10000 + now.getMonth() * 100 + now.getDate();
    const cached = _orderDateCache.get(dateStr);
    if (cached && cached.dayStamp === dayStamp) return { date: cached.date, time: cached.time };

    const date = new Date(dateStr);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const orderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    let dayStr: string;
    if (orderDay.getTime() === today.getTime()) dayStr = "Today";
    else if (orderDay.getTime() === yesterday.getTime()) dayStr = "Yesterday";
    else dayStr = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

    if (_orderDateCache.size >= _ORDER_DATE_CACHE_LIMIT) {
      const oldest = _orderDateCache.keys().next().value;
      if (oldest !== undefined) _orderDateCache.delete(oldest);
    }
    _orderDateCache.set(dateStr, { date: dayStr, time, dayStamp });
    return { date: dayStr, time };
  } catch {
    return { date: dateStr, time: "" };
  }
}

function OrderRowSkeleton() {
  return (
    <TableRow aria-busy="true" className="pointer-events-none">
      <TableCell className="w-10"></TableCell>
      <TableCell>
        <div className="space-y-1">
          <Skeleton className="h-4 w-18" />
          <Skeleton className="h-3 w-12" />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded" />
          <Skeleton className="h-4 w-36" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-24 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Memoized Order Row ──────────────────────────────────────────────────────

interface OrderRowProps {
  order: Order;
  isSelected: boolean;
  isExpanded: boolean;
  isRefreshing: boolean;
  isPrinting: boolean;
  isOpeningLabel: boolean;
  isGenerating: boolean;
  isReplenishing: boolean;
  highlighted: boolean;
  onToggleSelect: (id: number) => void;
  onToggleBundle: (id: number) => void;
  onPrintLabel: (order: Order) => void;
  onOpenRawLabel: (order: Order) => void;
  onGenerateLabel: (order: Order) => void;
  onRefreshOrder: (order: Order) => void;
  onReplenishStock: (order: Order) => void;
  onTogglePacked: (order: Order) => void;
}

const OrderRow = React.memo<OrderRowProps>(
  ({
    order,
    isSelected,
    isExpanded,
    isRefreshing,
    isPrinting,
    isOpeningLabel,
    isGenerating,
    isReplenishing,
    highlighted,
    onToggleSelect,
    onToggleBundle,
    onPrintLabel,
    onOpenRawLabel,
    onGenerateLabel,
    onRefreshOrder,
    onReplenishStock,
    onTogglePacked,
  }) => {
    if (isRefreshing) {
      return <OrderRowSkeleton />;
    }

    const dt = formatOrderDate(order.createdAt);

    return (
      <>
        <TableRow className={highlighted ? "notification-highlight" : undefined}>
          {/* Checkbox */}
          <TableCell className="w-10">
            <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(order.id)} />
          </TableCell>

          {/* Date */}
          <TableCell className="text-sm whitespace-nowrap">
            {!dt ? (
              <span>—</span>
            ) : (
              <div>
                <div>{dt.date}</div>
                {dt.time && <div className="text-muted-foreground">{dt.time}</div>}
              </div>
            )}
          </TableCell>

          {/* Item */}
          <TableCell className="max-w-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-muted overflow-hidden flex-shrink-0">
                {order.itemThumbnail ? (
                  <img src={order.itemThumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs">—</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{order.itemTitle}</div>
                {order.isBundle && (
                  <Button
                    variant="link"
                    onClick={() => onToggleBundle(order.id)}
                    className="text-xs mt-0.5 p-0 h-auto flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronRightIcon className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    Bundle ({order.bundleItems.length} items)
                  </Button>
                )}
              </div>
            </div>
          </TableCell>

          {/* Buyer */}
          <TableCell>
            {order.buyerProfileUrl ? (
              <Button
                variant="link"
                className="p-0 h-auto cursor-pointer inline-flex items-center gap-1"
                onClick={() => window.api.openExternal(order.buyerProfileUrl!)}
              >
                {order.buyerUsername}
                <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
              </Button>
            ) : (
              order.buyerUsername
            )}
          </TableCell>

          {/* Price */}
          <TableCell className="font-medium whitespace-nowrap">{order.price ?? "—"}</TableCell>

          {/* Status */}
          <TableCell>
            <Badge variant={STATUS_BADGE[order.status] ?? "waiting"}>{order.status.replace("_", " ")}</Badge>
          </TableCell>

          {/* Stage */}
          <TableCell>
            <div className="flex items-center gap-1.5">
              <Badge variant={STAGE_BADGE[order.orderStatus] ?? "hidden"}>{STAGE_LABELS[order.orderStatus] ?? order.orderStatus}</Badge>
              {order.packed && (
                <Tooltip>
                  <TooltipTrigger>
                    <ArchiveBoxIcon className="w-4 h-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>Packed</TooltipContent>
                </Tooltip>
              )}
            </div>
          </TableCell>

          {/* Courier */}
          <TableCell className="text-muted-foreground text-xs">
            <div className="flex items-center gap-2">
              {order.carrierLogoUrl && <img src={order.carrierLogoUrl} alt="" className="w-5 h-5 object-contain flex-shrink-0" />}
              <span>{order.courier !== "—" ? order.courier : "—"}</span>
            </div>
          </TableCell>

          {/* Tracking */}
          <TableCell>
            <div>
              {order.trackingNumber ? (
                order.trackingUrl ? (
                  <Tooltip>
                    <TooltipTrigger>
                      <Button
                        variant="link"
                        className="p-0 h-auto cursor-pointer inline-flex items-center gap-1"
                        onClick={() => window.api.openExternal(order.trackingUrl!)}
                      >
                        {order.trackingNumber}
                        <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open tracking page</TooltipContent>
                  </Tooltip>
                ) : (
                  <span>{order.trackingNumber}</span>
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {order.estimatedDelivery && <div className="text-muted-foreground mt-0.5 text-xs">Est. {order.estimatedDelivery}</div>}
            </div>
          </TableCell>

          {/* Actions */}
          <TableCell>
            <div className="flex items-center justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <EllipsisVerticalIcon className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-auto min-w-max" align="end">
                  {order.shipmentId && (order.shipmentStatus ?? 0) >= SHIPMENT_STATUS.LABEL_GENERATED && (
                    <>
                      <DropdownMenuItem onClick={() => onPrintLabel(order)} disabled={isPrinting}>
                        <PrinterIcon className="w-4 h-4" />
                        {isPrinting ? "Printing…" : "Print shipping label"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onOpenRawLabel(order)} disabled={isOpeningLabel}>
                        <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                        {isOpeningLabel ? "Opening…" : "Open shipping label"}
                      </DropdownMenuItem>
                    </>
                  )}
                  {order.transactionId && (order.shipmentStatus === SHIPMENT_STATUS.NO_LABEL || order.shipmentStatus === null) && (
                    <DropdownMenuItem onClick={() => onGenerateLabel(order)} disabled={isGenerating}>
                      <PlusCircleIcon className="w-4 h-4" />
                      {isGenerating ? "Generating…" : "Generate shipping label"}
                    </DropdownMenuItem>
                  )}
                  {order.conversationUrl && (
                    <DropdownMenuItem onClick={() => window.api.openExternal(order.conversationUrl!)}>
                      <ChatBubbleLeftRightIcon className="w-4 h-4" />
                      Open conversation
                    </DropdownMenuItem>
                  )}
                  {order.transactionId && (
                    <DropdownMenuItem onClick={() => onRefreshOrder(order)} disabled={isRefreshing}>
                      <ArrowPathIcon className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                      Refresh order
                    </DropdownMenuItem>
                  )}
                  {order.transactionId && (
                    <DropdownMenuItem onClick={() => onTogglePacked(order)}>
                      <ArchiveBoxIcon className="w-4 h-4" />
                      {order.packed ? "Mark as unpacked" : "Mark as packed"}
                    </DropdownMenuItem>
                  )}
                  {order.orderStatus === "cancelled" && order.transactionId && (
                    <DropdownMenuItem onClick={() => onReplenishStock(order)} disabled={order.stockReplenished === true || isReplenishing}>
                      <ArrowUturnLeftIcon className="w-4 h-4" />
                      {order.stockReplenished ? "Stock replenished" : isReplenishing ? "Replenishing…" : "Replenish stock"}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TableCell>
        </TableRow>

        {/* Bundle expansion rows */}
        {order.isBundle &&
          isExpanded &&
          order.bundleItems.map((bundleItem, idx) => (
            <TableRow key={`${order.id}-bundle-${idx}`} className="bg-muted/30">
              <TableCell className="px-4 py-2"></TableCell>
              <TableCell className="px-4 py-2"></TableCell>
              <TableCell className="px-4 py-2" colSpan={8}>
                <div className="flex items-center gap-3 pl-6">
                  <div className="w-8 h-8 rounded bg-muted overflow-hidden flex-shrink-0">
                    {bundleItem.thumbnail ? (
                      <img src={bundleItem.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs">—</div>
                    )}
                  </div>
                  <span className="text-sm">{bundleItem.title}</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
      </>
    );
  },
);

// ─── Main Component ──────────────────────────────────────────────────────────

const Orders: React.FC<OrdersProps> = ({ loggedIn, isActive }) => {
  const { addToast } = useToast();
  const { orders, refreshing: loading, refreshOrders } = useOrdersSync();
  const { consumeHighlight, highlightRef } = useNotificationSync();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["needs_action", "waiting"]);
  const [openingLabel, setOpeningLabel] = useState<number | null>(null);
  const [printingLabel, setPrintingLabel] = useState<number | null>(null);
  const [generatingLabel, setGeneratingLabel] = useState<number | null>(null);
  const [refreshingOrder, setRefreshingOrder] = useState<number | null>(null);
  const [replenishingOrder, setReplenishingOrder] = useState<number | null>(null);
  const [expandedBundles, setExpandedBundles] = useState<Set<number>>(new Set());
  const [labelProgress, setLabelProgress] = useState<ProgressState | null>(null);
  const labelProgressOrderRef = useRef<Order | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<ProgressState | null>(null);
  const bulkCancelledRef = useRef(false);
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>("date", "desc");
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  // Manual refresh
  const handleRefresh = useCallback(async () => {
    if (!loggedIn) return;
    addToast("Refreshing orders…", "info");
    try {
      await refreshOrders();
      addToast("Orders refreshed", "success");
    } catch {
      addToast("Failed to refresh orders", "error");
    }
  }, [loggedIn, addToast, refreshOrders]);

  useGlobalRefresh("orders", handleRefresh);

  // Print shipping label (crop + print/open in viewer)
  const handlePrintLabel = useCallback(
    async (order: Order) => {
      if (!order.shipmentId) return;
      setPrintingLabel(order.id);
      try {
        const result = await window.api.printShippingLabel(order.shipmentId, order.courier);
        if (result.success) {
          addToast("Label sent to printer", "success");
        } else {
          addToast("Print failed — check your printer", "error");
        }
      } catch (err) {
        addToast(`Failed to print label: ${(err as Error).message}`, "error");
      } finally {
        setPrintingLabel(null);
      }
    },
    [addToast],
  );

  // Open raw shipping label (uncropped PDF in browser)
  const handleOpenRawLabel = useCallback(
    async (order: Order) => {
      if (!order.shipmentId) return;
      setOpeningLabel(order.id);
      try {
        await window.api.openRawShippingLabel(order.shipmentId);
      } catch (err) {
        addToast(`Failed to open label: ${(err as Error).message}`, "error");
      } finally {
        setOpeningLabel(null);
      }
    },
    [addToast],
  );

  // Generate shipping label (order one if it doesn't exist)
  const handleGenerateLabel = useCallback(async (order: Order) => {
    if (!order.transactionId) return;
    setGeneratingLabel(order.id);
    labelProgressOrderRef.current = order;

    setLabelProgress({
      title: "Generating Shipping Label",
      total: 1,
      completed: 0,
      failed: 0,
      currentTitle: order.itemTitle,
      currentAction: "Starting…",
      done: false,
    });

    const cleanup = window.api.onLabelGenerationProgress(({ step }) => {
      setLabelProgress((p) => (p ? { ...p, currentAction: step } : p));
    });

    try {
      await window.api.orderShippingLabel(order.transactionId);
      setLabelProgress((p) => (p ? { ...p, currentAction: "Waiting for Vinted to process…" } : p));
      await new Promise((r) => setTimeout(r, 3000));
      setLabelProgress((p) => (p ? { ...p, currentAction: "Refreshing order…" } : p));
      await window.api.refreshSingleOrder(order.transactionId);
      setLabelProgress((p) => (p ? { ...p, completed: 1, done: true, currentAction: "Shipping label generated" } : p));
    } catch (err) {
      setLabelProgress((p) => (p ? { ...p, failed: 1, done: true, currentAction: `Failed: ${(err as Error).message}` } : p));
    } finally {
      cleanup();
      setGeneratingLabel(null);
    }
  }, []);

  // Refresh a single order's data
  const handleRefreshOrder = useCallback(
    async (order: Order) => {
      if (!order.transactionId) return;
      setRefreshingOrder(order.id);
      try {
        await window.api.refreshSingleOrder(order.transactionId);
      } catch {
        addToast("Failed to refresh order", "error");
      } finally {
        setRefreshingOrder(null);
      }
    },
    [addToast],
  );

  // Replenish stock for a cancelled order
  const handleReplenishStock = useCallback(
    async (order: Order) => {
      if (!order.transactionId) return;
      setReplenishingOrder(order.id);
      try {
        await window.api.replenishOrderStock(order.transactionId);
        addToast("Stock replenished", "success");
      } catch {
        addToast("Failed to replenish stock", "error");
      } finally {
        setReplenishingOrder(null);
      }
    },
    [addToast],
  );

  // Toggle packed flag on an order
  const handleTogglePacked = useCallback(
    async (order: Order) => {
      if (!order.transactionId) return;
      const next = !order.packed;
      try {
        await window.api.setOrderPacked(order.transactionId, next);
        addToast(next ? "Marked as packed" : "Marked as unpacked", "success");
      } catch {
        addToast("Failed to update packed state", "error");
      }
    },
    [addToast],
  );

  // Toggle bundle expansion
  const toggleBundle = useCallback((orderId: number) => {
    setExpandedBundles((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  // Handle print from the label generation progress modal
  const handlePrintFromProgress = useCallback(async () => {
    const order = labelProgressOrderRef.current;
    if (!order) return;
    const latestOrder = orders.find((o) => o.id === order.id) || order;
    if (latestOrder.shipmentId) {
      setLabelProgress(null);
      labelProgressOrderRef.current = null;
      await handlePrintLabel(latestOrder);
    }
  }, [orders, handlePrintLabel]);

  // ─── Selection ────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((o) => o.id)));
    }
  };

  // ─── Bulk generate shipping labels ─────────────────────────────────────
  const handleBulkGenerateLabels = async () => {
    const eligibleOrders = filtered.filter(
      (o) => selected.has(o.id) && o.transactionId && (o.shipmentStatus === SHIPMENT_STATUS.NO_LABEL || o.shipmentStatus === null),
    );
    if (eligibleOrders.length === 0) {
      addToast("No eligible orders selected (already have labels)", "info");
      return;
    }

    bulkCancelledRef.current = false;
    setBulkProgress({
      title: `Generating labels for ${eligibleOrders.length} order(s)`,
      total: eligibleOrders.length,
      completed: 0,
      failed: 0,
      currentTitle: "",
      currentAction: "",
      done: false,
    });

    let completed = 0;
    let failed = 0;

    for (const order of eligibleOrders) {
      if (bulkCancelledRef.current) break;

      setBulkProgress((p) =>
        p
          ? {
              ...p,
              currentTitle: order.itemTitle,
              currentAction: "Generating shipping label…",
            }
          : p,
      );

      // Listen for per-order progress
      const cleanup = window.api.onLabelGenerationProgress(({ step }) => {
        setBulkProgress((p) => (p ? { ...p, currentAction: step } : p));
      });

      try {
        await window.api.orderShippingLabel(order.transactionId!);
        completed++;
        // Brief delay for Vinted to process
        await new Promise((r) => setTimeout(r, 2000));
        await window.api.refreshSingleOrder(order.transactionId!);
      } catch {
        failed++;
      } finally {
        cleanup();
      }

      setBulkProgress((p) => (p ? { ...p, completed, failed } : p));
    }

    setBulkProgress((p) =>
      p
        ? {
            ...p,
            completed,
            failed,
            done: true,
            currentTitle: "",
            currentAction: `${completed} generated${failed > 0 ? `, ${failed} failed` : ""}`,
          }
        : p,
    );
    setSelected(new Set());
  };

  // ─── Filter & Sort ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const result = orders.filter((o) => {
      if (statusFilter.length > 0 && !statusFilter.includes(o.status)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          o.itemTitle.toLowerCase().includes(q) ||
          o.buyerUsername.toLowerCase().includes(q) ||
          (o.trackingNumber ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });

    const dir = sortDirection === "asc" ? 1 : -1;
    result.sort((a, b) => {
      switch (sortColumn) {
        case "date":
          return dir * (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
        case "item":
          return dir * a.itemTitle.localeCompare(b.itemTitle);
        case "buyer":
          return dir * a.buyerUsername.localeCompare(b.buyerUsername);
        case "price":
          return dir * ((a.priceNumeric ?? 0) - (b.priceNumeric ?? 0));
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "stage":
          return dir * a.orderStatus.localeCompare(b.orderStatus);
        case "courier":
          return dir * a.courier.localeCompare(b.courier);
        default:
          return 0;
      }
    });

    return result;
  }, [orders, statusFilter, search, sortColumn, sortDirection]);

  // ─── Virtualizer ──────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 57;
  const BUNDLE_ROW_HEIGHT = 41;

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(
      (index: number) => {
        const order = filtered[index];
        if (order?.isBundle && expandedBundles.has(order.id)) {
          return ROW_HEIGHT + order.bundleItems.length * BUNDLE_ROW_HEIGHT;
        }
        return ROW_HEIGHT;
      },
      [filtered, expandedBundles],
    ),
    overscan: 5,
    getItemKey: useCallback((index: number) => filtered[index]?.id ?? index, [filtered]),
  });

  const virtualItems = virtualizer.getVirtualItems();

  // ─── Notification highlight scroll ──────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const highlight = consumeHighlight();
    if (!highlight || highlight.page !== "orders") return;
    const idx = filtered.findIndex((o) => o.transactionId === highlight.referenceId);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: "center" });
    setHighlightedId(filtered[idx].id);
    const timer = setTimeout(() => setHighlightedId(null), 2000);
    return () => clearTimeout(timer);
  }, [isActive, consumeHighlight, highlightRef, filtered, virtualizer]);

  // ─── Render ─────────────────────────────────────────────────────────────
  if (!loggedIn) {
    return <div className="flex items-center justify-center h-full text-neutral-500 text-sm">Log in to view your orders</div>;
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusOptions={statusOptions}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
        actions={
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline">
                    Bulk Actions
                    <ChevronDownIcon className="w-4 h-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-auto min-w-max" align="end">
                  <DropdownMenuItem onClick={handleBulkGenerateLabels}>
                    <PlusCircleIcon className="w-4 h-4" />
                    Generate Shipping Labels
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" onClick={handleRefresh} disabled={loading} className="flex-shrink-0">
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {loading && orders.length === 0 ? (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Skeleton className="h-4 w-4" />
                </TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-full">Item</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 6 }).map((_, i) => (
                <OrderRowSkeleton key={i} />
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {orders.length === 0 ? "No orders yet" : "No matching orders"}
        </div>
      ) : (
        <Card className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <div ref={scrollContainerRef} className="overflow-auto flex-1">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>
                    <Checkbox checked={selected.size > 0 && selected.size === filtered.length} onCheckedChange={selectAll} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("date")}>
                    Date
                    <SortArrow column="date" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="w-full cursor-pointer select-none" onClick={() => handleSort("item")}>
                    Item
                    <SortArrow column="item" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("buyer")}>
                    Buyer
                    <SortArrow column="buyer" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("price")}>
                    Price
                    <SortArrow column="price" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                    Status
                    <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("stage")}>
                    Stage
                    <SortArrow column="stage" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("courier")}>
                    Courier
                    <SortArrow column="courier" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && filtered.length > 0 ? (
                  Array.from({ length: Math.min(filtered.length, 8) }).map((_, i) => <OrderRowSkeleton key={`skel-${i}`} />)
                ) : (
                  <>
                    {virtualItems.length > 0 && virtualItems[0].start > 0 && <tr style={{ height: virtualItems[0].start }} />}
                    {virtualItems.map((virtualRow) => {
                      const order = filtered[virtualRow.index];
                      return (
                        <OrderRow
                          key={order.id}
                          order={order}
                          isSelected={selected.has(order.id)}
                          isExpanded={expandedBundles.has(order.id)}
                          isRefreshing={refreshingOrder === order.id}
                          isPrinting={printingLabel === order.id}
                          isOpeningLabel={openingLabel === order.id}
                          isGenerating={generatingLabel === order.id}
                          isReplenishing={replenishingOrder === order.id}
                          highlighted={highlightedId === order.id}
                          onToggleSelect={toggleSelect}
                          onToggleBundle={toggleBundle}
                          onPrintLabel={handlePrintLabel}
                          onOpenRawLabel={handleOpenRawLabel}
                          onGenerateLabel={handleGenerateLabel}
                          onRefreshOrder={handleRefreshOrder}
                          onReplenishStock={handleReplenishStock}
                          onTogglePacked={handleTogglePacked}
                        />
                      );
                    })}
                    {virtualItems.length > 0 && (
                      <tr style={{ height: virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end }} />
                    )}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Label generation progress modal */}
      {labelProgress && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && labelProgress.done) {
              setLabelProgress(null);
              labelProgressOrderRef.current = null;
            }
          }}
        >
          <DialogContent className="max-w-md" showCloseButton={labelProgress.done}>
            <DialogHeader>
              <DialogTitle className="font-semibold">{labelProgress.title}</DialogTitle>
            </DialogHeader>

            {!labelProgress.done && (
              <div className="space-y-2 min-w-0">
                {labelProgress.currentTitle && <p className="text-sm text-foreground font-medium truncate">{labelProgress.currentTitle}</p>}
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground truncate">{labelProgress.currentAction}</p>
                </div>
              </div>
            )}

            {labelProgress.done && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{labelProgress.currentAction}</p>
                <DialogFooter>
                  {labelProgress.failed === 0 && (
                    <Button onClick={handlePrintFromProgress}>
                      <PrinterIcon className="w-4 h-4 mr-1" />
                      Print
                    </Button>
                  )}
                  <Button
                    variant={labelProgress.failed > 0 ? "default" : "outline"}
                    onClick={() => {
                      setLabelProgress(null);
                      labelProgressOrderRef.current = null;
                    }}
                  >
                    Close
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Bulk label generation progress modal */}
      {bulkProgress && <ProgressModal progress={bulkProgress} onClose={() => setBulkProgress(null)} />}
    </div>
  );
};

export default React.memo(Orders);
