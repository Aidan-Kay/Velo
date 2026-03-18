import { Card } from "@/components/ui/card";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  PlusCircleIcon,
  PrinterIcon,
} from "@heroicons/react/20/solid";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Order } from "../../../shared/types";
import { SHIPMENT_STATUS } from "../../../shared/types";
import { Badge, type BadgeProps } from "../components/Badge";
import FilterBar, { type FilterOption } from "../components/FilterBar";
import { SortArrow } from "../components/SortArrow";
import { Button } from "../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useTableSort } from "../hooks/useTableSort";

interface OrdersProps {
  loggedIn: boolean;
  addToast: (message: string, type?: "success" | "error" | "info") => void;
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

function formatOrderDate(dateStr: string | null): { date: string; time: string } | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const orderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    if (orderDay.getTime() === today.getTime()) return { date: "Today", time };
    if (orderDay.getTime() === yesterday.getTime()) return { date: "Yesterday", time };

    const dayStr = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return { date: dayStr, time };
  } catch {
    return { date: dateStr, time: "" };
  }
}

const Orders: React.FC<OrdersProps> = ({ loggedIn, addToast }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [openingLabel, setOpeningLabel] = useState<number | null>(null);
  const [printingLabel, setPrintingLabel] = useState<number | null>(null);
  const [generatingLabel, setGeneratingLabel] = useState<number | null>(null);
  const [refreshingOrder, setRefreshingOrder] = useState<number | null>(null);
  const [replenishingOrder, setReplenishingOrder] = useState<number | null>(null);
  const [expandedBundles, setExpandedBundles] = useState<Set<number>>(new Set());
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>("date", "desc");

  // Load cached orders on mount (no API call)
  useEffect(() => {
    if (!loggedIn) return;
    window.api.getMyOrders().then((result) => {
      setOrders(result.orders);
    });
  }, [loggedIn]);

  // Listen for background polling updates
  useEffect(() => {
    window.api.onOrdersUpdated((data) => {
      setOrders(data.orders);
    });
  }, []);

  // Manual refresh
  const handleRefresh = useCallback(async () => {
    if (!loggedIn) return;
    setLoading(true);
    addToast("Refreshing orders…", "info");
    try {
      const result = await window.api.refreshMyOrders();
      setOrders(result.orders);
      addToast("Orders refreshed", "success");
    } catch {
      addToast("Failed to refresh orders", "error");
    } finally {
      setLoading(false);
    }
  }, [loggedIn, addToast]);

  // Print shipping label (crop + print/open in viewer)
  const handlePrintLabel = async (order: Order) => {
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
  };

  // Open raw shipping label (uncropped PDF in browser)
  const handleOpenRawLabel = async (order: Order) => {
    if (!order.shipmentId) return;
    setOpeningLabel(order.id);
    try {
      await window.api.openRawShippingLabel(order.shipmentId);
    } catch (err) {
      addToast(`Failed to open label: ${(err as Error).message}`, "error");
    } finally {
      setOpeningLabel(null);
    }
  };

  // Generate shipping label (order one if it doesn't exist)
  const handleGenerateLabel = async (order: Order) => {
    if (!order.transactionId) return;
    setGeneratingLabel(order.id);
    addToast("Generating shipping label…", "info");
    try {
      await window.api.orderShippingLabel(order.transactionId);
      addToast("Shipping label generated", "success");
      // Brief delay — Vinted API takes a moment to reflect the new label
      await new Promise((r) => setTimeout(r, 3000));
      // Refresh just this order to pick up the new shipment
      await window.api.refreshSingleOrder(order.transactionId);
    } catch (err) {
      addToast(`Failed to generate label: ${(err as Error).message}`, "error");
    } finally {
      setGeneratingLabel(null);
    }
  };

  // Refresh a single order's data
  const handleRefreshOrder = async (order: Order) => {
    if (!order.transactionId) return;
    setRefreshingOrder(order.id);
    try {
      await window.api.refreshSingleOrder(order.transactionId);
    } catch {
      addToast("Failed to refresh order", "error");
    } finally {
      setRefreshingOrder(null);
    }
  };

  // Replenish stock for a cancelled order
  const handleReplenishStock = async (order: Order) => {
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
  };

  // Toggle bundle expansion
  const toggleBundle = (orderId: number) => {
    setExpandedBundles((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
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

  // ─── Render ─────────────────────────────────────────────────────────────
  if (!loggedIn) {
    return <div className="flex items-center justify-center h-full text-neutral-500 text-sm">Log in to view your orders</div>;
  }

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusOptions={statusOptions}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
        actions={
          <Button variant="outline" onClick={handleRefresh} disabled={loading} className="flex-shrink-0">
            {loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />

      {loading && orders.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading orders…</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {orders.length === 0 ? "No orders yet" : "No matching orders"}
        </div>
      ) : (
        <div>
          <Card className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("date")}>
                    Date
                    <SortArrow column="date" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("item")}>
                    Item
                    <SortArrow column="item" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("buyer")}>
                    Buyer
                    <SortArrow column="buyer" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("price")}>
                    Price
                    <SortArrow column="price" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("status")}>
                    Status
                    <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("stage")}>
                    Stage
                    <SortArrow column="stage" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("courier")}>
                    Courier
                    <SortArrow column="courier" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3">Tracking</TableHead>
                  <TableHead className="px-4 py-3"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((order) => {
                  const isExpanded = expandedBundles.has(order.id);
                  return (
                    <React.Fragment key={order.id}>
                      <TableRow>
                        {/* Date */}
                        <TableCell className="px-4 py-3 text-sm whitespace-nowrap">
                          {(() => {
                            const dt = formatOrderDate(order.createdAt);
                            if (!dt) return <span>—</span>;
                            return (
                              <div>
                                <div>{dt.date}</div>
                                {dt.time && <div className="text-muted-foreground">{dt.time}</div>}
                              </div>
                            );
                          })()}
                        </TableCell>

                        {/* Item */}
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded bg-muted overflow-hidden flex-shrink-0">
                              {order.itemThumbnail ? (
                                <img src={order.itemThumbnail} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs">—</div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate max-w-[200px] font-medium">{order.itemTitle}</div>
                              {order.isBundle && (
                                <Button
                                  variant="link"
                                  onClick={() => toggleBundle(order.id)}
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
                        <TableCell className="px-4 py-3">{order.buyerUsername}</TableCell>

                        {/* Price */}
                        <TableCell className="px-4 py-3 font-medium whitespace-nowrap">{order.price ?? "—"}</TableCell>

                        {/* Status */}
                        <TableCell className="px-4 py-3">
                          <Badge variant={STATUS_BADGE[order.status] ?? "waiting"}>{order.status.replace("_", " ")}</Badge>
                        </TableCell>

                        {/* Stage */}
                        <TableCell className="px-4 py-3">
                          <Badge variant={STAGE_BADGE[order.orderStatus] ?? "hidden"}>
                            {STAGE_LABELS[order.orderStatus] ?? order.orderStatus}
                          </Badge>
                        </TableCell>

                        {/* Courier */}
                        <TableCell className="px-4 py-3 text-muted-foreground text-xs">
                          <div className="flex items-center gap-2">
                            {order.carrierLogoUrl && (
                              <img src={order.carrierLogoUrl} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
                            )}
                            <span>{order.courier !== "—" ? order.courier : "—"}</span>
                          </div>
                        </TableCell>

                        {/* Tracking */}
                        <TableCell className="px-4 py-3 text-xs">
                          <div>
                            {order.trackingNumber ? (
                              order.trackingUrl ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="link"
                                      className="p-0 h-auto cursor-pointer"
                                      onClick={() => window.api.openExternal(order.trackingUrl!)}
                                    >
                                      {order.trackingNumber}
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
                            {order.estimatedDelivery && (
                              <div className="text-muted-foreground mt-0.5 text-xs">Est. {order.estimatedDelivery}</div>
                            )}
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" className="h-8 w-8">
                                  <EllipsisVerticalIcon className="w-5 h-5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {order.shipmentId && (order.shipmentStatus ?? 0) >= SHIPMENT_STATUS.LABEL_GENERATED && (
                                  <>
                                    <DropdownMenuItem onClick={() => handlePrintLabel(order)} disabled={printingLabel === order.id}>
                                      <PrinterIcon className="w-4 h-4" />
                                      {printingLabel === order.id ? "Printing…" : "Print shipping label"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleOpenRawLabel(order)} disabled={openingLabel === order.id}>
                                      <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                                      {openingLabel === order.id ? "Opening…" : "Open shipping label"}
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {order.transactionId &&
                                  (order.shipmentStatus === SHIPMENT_STATUS.NO_LABEL || order.shipmentStatus === null) && (
                                    <DropdownMenuItem onClick={() => handleGenerateLabel(order)} disabled={generatingLabel === order.id}>
                                      <PlusCircleIcon className="w-4 h-4" />
                                      {generatingLabel === order.id ? "Generating…" : "Generate shipping label"}
                                    </DropdownMenuItem>
                                  )}
                                {order.conversationUrl && (
                                  <DropdownMenuItem onClick={() => window.api.openExternal(order.conversationUrl!)}>
                                    <ChatBubbleLeftRightIcon className="w-4 h-4" />
                                    Open conversation
                                  </DropdownMenuItem>
                                )}
                                {order.transactionId && (
                                  <DropdownMenuItem onClick={() => handleRefreshOrder(order)} disabled={refreshingOrder === order.id}>
                                    <ArrowPathIcon className={`w-4 h-4 ${refreshingOrder === order.id ? "animate-spin" : ""}`} />
                                    Refresh order
                                  </DropdownMenuItem>
                                )}
                                {order.orderStatus === "cancelled" && order.transactionId && (
                                  <DropdownMenuItem
                                    onClick={() => handleReplenishStock(order)}
                                    disabled={order.stockReplenished === true || replenishingOrder === order.id}
                                  >
                                    <ArrowUturnLeftIcon className="w-4 h-4" />
                                    {order.stockReplenished
                                      ? "Stock replenished"
                                      : replenishingOrder === order.id
                                        ? "Replenishing…"
                                        : "Replenish stock"}
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
                            <TableCell className="px-4 py-2" colSpan={8}>
                              <div className="flex items-center gap-3 pl-6">
                                <div className="w-8 h-8 rounded bg-muted overflow-hidden flex-shrink-0">
                                  {bundleItem.thumbnail ? (
                                    <img src={bundleItem.thumbnail} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-xs">—</div>
                                  )}
                                </div>
                                <span className="text-xs">{bundleItem.title}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Orders;
