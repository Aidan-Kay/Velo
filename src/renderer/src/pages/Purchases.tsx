import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
} from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@shared/components/ui/dropdown-menu";
import { Skeleton } from "@shared/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@shared/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shared/components/ui/tooltip";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Purchase } from "../../../shared/types";
import { Badge, type BadgeProps } from "../components/Badge";
import FilterBar, { type FilterOption } from "../components/FilterBar";
import { SortArrow } from "../components/SortArrow";
import { usePurchasesSync } from "../context/PurchasesSyncContext";
import { useToast } from "../context/ToastContext";
import { useGlobalRefresh } from "../hooks/useGlobalRefresh";
import { useTableSort } from "../hooks/useTableSort";

interface PurchasesProps {
  loggedIn: boolean;
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
  label_ordered: "label ordered",
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
  label_ordered: "waiting",
  label_sent: "label-sent",
  label_failed: "label-failed",
  shipped: "shipped",
  delivered: "completed",
  complete: "completed",
  cancelled: "cancelled",
  await_pickup: "awaiting-pickup",
  unknown: "hidden",
};

type SortColumn = "date" | "item" | "seller" | "price" | "status" | "stage" | "courier";

const ROW_HEIGHT = 57;
const BUNDLE_ROW_HEIGHT = 41;

const _purchaseDateCache = new Map<string, { date: string; time: string; dayStamp: number }>();
function formatPurchaseDate(dateStr: string | null): { date: string; time: string } | null {
  if (!dateStr) return null;
  try {
    const now = new Date();
    const dayStamp = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const key = `${dateStr}|${dayStamp}`;
    const cached = _purchaseDateCache.get(key);
    if (cached) return cached;

    const d = new Date(dateStr);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let datePart: string;
    if (d >= today) datePart = "Today";
    else if (d >= yesterday) datePart = "Yesterday";
    else datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

    const timePart = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const result = { date: datePart, time: timePart, dayStamp };
    _purchaseDateCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

// ─── Row Skeleton ─────────────────────────────────────────────────────────

const PurchaseRowSkeleton: React.FC = () => (
  <TableRow className="h-[57px]">
    <TableCell>
      <Skeleton className="h-4 w-16" />
    </TableCell>
    <TableCell>
      <Skeleton className="h-10 w-40" />
    </TableCell>
    <TableCell>
      <Skeleton className="h-4 w-20" />
    </TableCell>
    <TableCell>
      <Skeleton className="h-4 w-14" />
    </TableCell>
    <TableCell>
      <Skeleton className="h-5 w-16 rounded-full" />
    </TableCell>
    <TableCell>
      <Skeleton className="h-5 w-16 rounded-full" />
    </TableCell>
    <TableCell>
      <Skeleton className="h-4 w-16" />
    </TableCell>
    <TableCell>
      <Skeleton className="h-4 w-20" />
    </TableCell>
    <TableCell />
  </TableRow>
);

// ─── Memoised Row ──────────────────────────────────────────────────────────

interface PurchaseRowProps {
  purchase: Purchase;
  isExpanded: boolean;
  isRefreshing: boolean;
  onToggleBundle: (id: number) => void;
  onOpenExternal: (url: string) => void;
  onRefresh: (transactionId: number) => void;
}

const PurchaseRow = React.memo<PurchaseRowProps>(function PurchaseRow({
  purchase,
  isExpanded,
  isRefreshing,
  onToggleBundle,
  onOpenExternal,
  onRefresh,
}) {
  if (isRefreshing) return <PurchaseRowSkeleton />;

  const dateInfo = formatPurchaseDate(purchase.createdAt);
  const statusKey = purchase.status.replace(/ /g, "_").toLowerCase();
  const stageKey = purchase.orderStatus.replace(/ /g, "_").toLowerCase();

  return (
    <>
      <TableRow className="h-[57px]">
        {/* Date */}
        <TableCell className="whitespace-nowrap text-sm">
          {dateInfo ? (
            <div>
              <div>{dateInfo.date}</div>
              <div className="text-muted-foreground">{dateInfo.time}</div>
            </div>
          ) : (
            "—"
          )}
        </TableCell>

        {/* Item */}
        <TableCell className="max-w-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-muted overflow-hidden flex-shrink-0">
              {purchase.itemThumbnail ? (
                <img src={purchase.itemThumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs">—</div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium">{purchase.itemTitle}</div>
              {purchase.isBundle && (
                <Button
                  variant="link"
                  onClick={() => onToggleBundle(purchase.id)}
                  className="text-xs mt-0.5 p-0 h-auto flex items-center gap-1 cursor-pointer"
                >
                  <ChevronRightIcon className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  Bundle ({purchase.bundleItems.length} items)
                </Button>
              )}
            </div>
          </div>
        </TableCell>

        {/* Seller */}
        <TableCell>
          {purchase.sellerProfileUrl ? (
            <Button
              variant="link"
              className="p-0 h-auto cursor-pointer inline-flex items-center gap-1"
              onClick={() => onOpenExternal(purchase.sellerProfileUrl!)}
            >
              {purchase.sellerUsername}
              <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
            </Button>
          ) : (
            purchase.sellerUsername
          )}
        </TableCell>

        {/* Price */}
        <TableCell className="font-medium whitespace-nowrap">{purchase.price || "—"}</TableCell>

        {/* Status */}
        <TableCell>
          <Badge variant={STATUS_BADGE[statusKey] || "hidden"}>{statusKey.replace(/_/g, " ")}</Badge>
        </TableCell>

        {/* Stage */}
        <TableCell>
          <Badge variant={STAGE_BADGE[stageKey] || "hidden"}>{STAGE_LABELS[stageKey] || stageKey.replace(/_/g, " ")}</Badge>
        </TableCell>

        {/* Courier */}
        <TableCell className="text-muted-foreground text-xs">
          <div className="flex items-center gap-2">
            {purchase.carrierLogoUrl && <img src={purchase.carrierLogoUrl} alt="" className="w-5 h-5 object-contain flex-shrink-0" />}
            <span>{purchase.courier !== "—" ? purchase.courier : "—"}</span>
          </div>
        </TableCell>

        {/* Tracking */}
        <TableCell>
          <div>
            {purchase.trackingNumber ? (
              purchase.trackingUrl ? (
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="link"
                      className="p-0 h-auto cursor-pointer inline-flex items-center gap-1"
                      onClick={() => onOpenExternal(purchase.trackingUrl!)}
                    >
                      {purchase.trackingNumber}
                      <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open tracking page</TooltipContent>
                </Tooltip>
              ) : (
                <span>{purchase.trackingNumber}</span>
              )
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {purchase.estimatedDelivery && <div className="text-muted-foreground mt-0.5 text-xs">Est. {purchase.estimatedDelivery}</div>}
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
                {purchase.conversationUrl && (
                  <DropdownMenuItem onClick={() => onOpenExternal(purchase.conversationUrl!)}>
                    <ChatBubbleLeftRightIcon className="w-4 h-4" />
                    Open conversation
                  </DropdownMenuItem>
                )}
                {purchase.trackingUrl && (
                  <DropdownMenuItem onClick={() => onOpenExternal(purchase.trackingUrl!)}>
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                    Track package
                  </DropdownMenuItem>
                )}
                {purchase.transactionId && (
                  <DropdownMenuItem onClick={() => onRefresh(purchase.transactionId!)}>
                    <ArrowPathIcon className="w-4 h-4" />
                    Refresh
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>

      {/* Bundle expansion rows */}
      {purchase.isBundle &&
        isExpanded &&
        purchase.bundleItems.map((item, i) => (
          <TableRow key={`bundle-${purchase.id}-${i}`} className="h-[41px] bg-muted/30">
            <TableCell />
            <TableCell colSpan={8}>
              <div className="flex items-center gap-2 pl-6">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded bg-muted shrink-0" />
                )}
                <span className="text-sm truncate">{item.title}</span>
              </div>
            </TableCell>
          </TableRow>
        ))}
    </>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────

const Purchases: React.FC<PurchasesProps> = ({ loggedIn }) => {
  const { purchases, refreshing, refreshPurchases, refreshSinglePurchase } = usePurchasesSync();
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>();
  const { addToast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [expandedBundles, setExpandedBundles] = useState<Set<number>>(new Set());
  const [refreshingPurchases, setRefreshingPurchases] = useState<Set<number>>(new Set());

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useGlobalRefresh("purchases", refreshPurchases);

  const handleToggleBundle = useCallback((id: number) => {
    setExpandedBundles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpenExternal = useCallback((url: string) => {
    window.api.openExternal(url);
  }, []);

  const handleRefresh = useCallback(
    async (transactionId: number) => {
      setRefreshingPurchases((prev) => new Set(prev).add(transactionId));
      try {
        await refreshSinglePurchase(transactionId);
      } catch {
        addToast("Failed to refresh purchase", "error");
      } finally {
        setRefreshingPurchases((prev) => {
          const next = new Set(prev);
          next.delete(transactionId);
          return next;
        });
      }
    },
    [refreshSinglePurchase, addToast],
  );

  // Filter and sort
  const filtered = useMemo(() => {
    let result = purchases;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.itemTitle.toLowerCase().includes(q) ||
          p.sellerUsername.toLowerCase().includes(q) ||
          (p.price && p.price.toLowerCase().includes(q)),
      );
    }

    if (statusFilter.length > 0) {
      result = result.filter((p) => statusFilter.includes(p.status.replace(/ /g, "_").toLowerCase()));
    }

    if (sortColumn) {
      const dir = sortDirection === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        switch (sortColumn) {
          case "date":
            return dir * (a.createdAt || "").localeCompare(b.createdAt || "");
          case "item":
            return dir * a.itemTitle.localeCompare(b.itemTitle);
          case "seller":
            return dir * a.sellerUsername.localeCompare(b.sellerUsername);
          case "price":
            return dir * ((a.priceNumeric || 0) - (b.priceNumeric || 0));
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
    }

    return result;
  }, [purchases, search, statusFilter, sortColumn, sortDirection]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const purchase = filtered[index];
      if (purchase.isBundle && expandedBundles.has(purchase.id)) {
        return ROW_HEIGHT + purchase.bundleItems.length * BUNDLE_ROW_HEIGHT;
      }
      return ROW_HEIGHT;
    },
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex flex-col gap-4 h-full">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusOptions={statusOptions}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
        actions={
          <Button variant="outline" onClick={() => refreshPurchases()} disabled={refreshing} className="flex-shrink-0">
            {refreshing ? "Loading…" : "Refresh"}
          </Button>
        }
      />

      <Card className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div ref={scrollContainerRef} className="h-full overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card ">
              <TableRow>
                <TableHead className="w-[100px] cursor-pointer select-none" onClick={() => handleSort("date")}>
                  Date <SortArrow column="date" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("item")}>
                  Item <SortArrow column="item" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[120px] cursor-pointer select-none" onClick={() => handleSort("seller")}>
                  Seller <SortArrow column="seller" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[80px] cursor-pointer select-none" onClick={() => handleSort("price")}>
                  Price <SortArrow column="price" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[100px] cursor-pointer select-none" onClick={() => handleSort("status")}>
                  Status <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[120px] cursor-pointer select-none" onClick={() => handleSort("stage")}>
                  Stage <SortArrow column="stage" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[100px] cursor-pointer select-none" onClick={() => handleSort("courier")}>
                  Courier <SortArrow column="courier" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[140px]">Tracking</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                    {purchases.length === 0 ? "No purchases found" : "No purchases match your filters"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {virtualItems.length > 0 && <tr style={{ height: virtualItems[0].start }} />}
                  {virtualItems.map((virtualItem) => {
                    const purchase = filtered[virtualItem.index];
                    return (
                      <PurchaseRow
                        key={purchase.id}
                        purchase={purchase}
                        isExpanded={expandedBundles.has(purchase.id)}
                        isRefreshing={purchase.transactionId != null && refreshingPurchases.has(purchase.transactionId)}
                        onToggleBundle={handleToggleBundle}
                        onOpenExternal={handleOpenExternal}
                        onRefresh={handleRefresh}
                      />
                    );
                  })}
                  {virtualItems.length > 0 && (
                    <tr style={{ height: virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0) }} />
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};

export default Purchases;
