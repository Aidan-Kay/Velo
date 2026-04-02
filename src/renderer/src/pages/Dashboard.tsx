import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BanknotesIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  CurrencyPoundIcon,
  ExclamationTriangleIcon,
  ShoppingBagIcon,
} from "@heroicons/react/20/solid";
import { endOfMonth, format, isWithinInterval, parseISO, startOfMonth } from "date-fns";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LocalItem, Order, VintedListing } from "../../../shared/types";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardProps {
  loggedIn: boolean;
  addToast: (message: string, type?: "success" | "error" | "info") => void;
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

// ─── Component ───────────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({ loggedIn, addToast }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [listings, setListings] = useState<VintedListing[]>([]);

  // Date range — default to current month
  const now = new Date();
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(now));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(now));

  // ─── Load data ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [ordersResult, itemsResult, listingsResult] = await Promise.all([
        window.api.getMyOrders(),
        window.api.getItems(),
        window.api.getMyListings(),
      ]);
      setOrders(ordersResult.orders);
      setItems(itemsResult);
      setListings(listingsResult.items);
    } catch {
      addToast("Failed to load dashboard data", "error");
    }
  }, [addToast]);

  useEffect(() => {
    if (loggedIn) loadData();
  }, [loggedIn, loadData]);

  // Listen for background updates
  useEffect(() => {
    const cleanupOrders = window.api.onOrdersUpdated((data) => setOrders(data.orders));
    const cleanupListings = window.api.onListingsUpdated((data) => setListings(data.items));
    return () => {
      cleanupOrders();
      cleanupListings();
    };
  }, []);

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

  /** Priority: Active > Draft > everything else. Higher number wins. */
  const LISTING_PRIORITY: Record<string, number> = { Active: 3, Draft: 2, Hidden: 1 };

  const listingMap = useMemo(() => {
    const map = new Map<string, VintedListing>();
    for (const l of listings) {
      const key = l.title.toLowerCase().trim();
      const existing = map.get(key);
      const newPriority = LISTING_PRIORITY[l.status] ?? 0;
      const existingPriority = existing ? (LISTING_PRIORITY[existing.status] ?? 0) : -1;
      if (newPriority > existingPriority) {
        map.set(key, l);
      }
    }
    return map;
  }, [listings]);

  /** In-stock items that have no associated listing at all. */
  const itemsWithoutListing = useMemo(() => {
    return items.filter((item) => {
      if (item.stock <= 0) return false;
      const listing = listingMap.get(item.title.toLowerCase().trim());
      return !listing;
    });
  }, [items, listingMap]);

  /** Draft listings awaiting publish (items that have a draft listing). */
  const draftsAwaitingPublish = useMemo(() => {
    return items.filter((item) => {
      if (item.stock <= 0) return false;
      const listing = listingMap.get(item.title.toLowerCase().trim());
      return listing?.status.toLowerCase() === "draft";
    });
  }, [items, listingMap]);

  /** Orders that need user action. */
  const actionableOrders = useMemo(() => {
    return orders.filter(orderNeedsAction);
  }, [orders]);

  // ─── Render ────────────────────────────────────────────────────────

  if (!loggedIn) {
    return <div className="flex items-center justify-center h-full text-neutral-500 text-sm">Log in to view your dashboard</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Dashboard</h2>

      {/* ─── Date Range ──────────────────────────────────────────────── */}
      <div className="flex items-end gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-44 justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateFrom, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-44 justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateTo, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* ─── Stats Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BanknotesIcon className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Total Revenue</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {currencySymbol}
            {totalRevenue.toFixed(2)}
          </p>
        </Card>

        <Card className="p-5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShoppingBagIcon className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Orders</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{orderCount}</p>
        </Card>

        <Card className="p-5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CurrencyPoundIcon className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Avg. Order Value</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {currencySymbol}
            {averageOrderValue.toFixed(2)}
          </p>
        </Card>
      </div>

      {/* ─── Revenue Chart ───────────────────────────────────────────── */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Order Value Over Time</h3>
        {chartData.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${currencySymbol}${v}`}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                    color: "var(--foreground)",
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={((value: any) => [`${currencySymbol}${Number(value).toFixed(2)}`, "Revenue"]) as any}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                />
                <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill="url(#revenueGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
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
            <h3 className="text-sm font-medium text-foreground">In Stock Items Without Listing</h3>
          </div>
          {itemsWithoutListing.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">All in-stock items have a listing</p>
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
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Stock: {item.stock}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Drafts awaiting publish */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardDocumentListIcon className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Drafts Awaiting Publish</h3>
          </div>
          {draftsAwaitingPublish.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No draft listings awaiting publish</p>
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
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Stock: {item.stock}</span>
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
            <p className="text-xs text-muted-foreground py-4 text-center">No orders need your attention</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {actionableOrders.map((order) => (
                <li key={order.id} className="flex items-center gap-2 text-sm">
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
    </div>
  );
};

export default Dashboard;
