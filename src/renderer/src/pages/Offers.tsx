import {
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CurrencyPoundIcon,
  EllipsisVerticalIcon,
  NoSymbolIcon,
} from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@shared/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@shared/components/ui/table";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReceivedOffer } from "../../../shared/types";
import { Badge, type BadgeProps } from "../components/Badge";
import CounterOfferModal from "../components/CounterOfferModal";
import FilterBar, { type FilterOption } from "../components/FilterBar";
import { SortArrow } from "../components/SortArrow";
import { useNotificationSync } from "../context/NotificationSyncContext";
import { useOffersSync } from "../context/OffersSyncContext";
import { useToast } from "../context/ToastContext";
import { useGlobalRefresh } from "../hooks/useGlobalRefresh";
import { useTableSort } from "../hooks/useTableSort";

interface OffersProps {
  loggedIn: boolean;
  isActive?: boolean;
}

const statusOptions: FilterOption[] = [
  { value: "pending", label: "Pending" },
  { value: "countered", label: "Countered" },
  { value: "accepted", label: "Accepted" },
  { value: "cancelled", label: "Cancelled" },
  { value: "ignored", label: "Ignored" },
];

const STATUS_BADGE: Record<string, BadgeProps["variant"]> = {
  pending: "pending",
  countered: "countered",
  accepted: "complete",
  cancelled: "cancelled",
  ignored: "ignored",
};

type SortColumn = "date" | "item" | "buyer" | "originalPrice" | "offerPrice" | "status";

const ROW_HEIGHT = 57;
const BUNDLE_ROW_HEIGHT = 41;

const _offerDateCache = new Map<string, { date: string; time: string; dayStamp: number }>();
function formatOfferDate(dateStr: string | null): { date: string; time: string } | null {
  if (!dateStr) return null;
  try {
    const now = new Date();
    const dayStamp = now.getFullYear() * 10000 + now.getMonth() * 100 + now.getDate();
    const cached = _offerDateCache.get(dateStr);
    if (cached && cached.dayStamp === dayStamp) return { date: cached.date, time: cached.time };

    const d = new Date(dateStr);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const orderDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    let dayStr: string;
    if (orderDay.getTime() === today.getTime()) dayStr = "Today";
    else if (orderDay.getTime() === yesterday.getTime()) dayStr = "Yesterday";
    else dayStr = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

    _offerDateCache.set(dateStr, { date: dayStr, time, dayStamp });
    return { date: dayStr, time };
  } catch {
    return { date: dateStr, time: "" };
  }
}

// ─── Memoised Row ──────────────────────────────────────────────────────────

interface OfferRowProps {
  offer: ReceivedOffer;
  isExpanded: boolean;
  loadingBundleItems: boolean;
  onAccept: (offer: ReceivedOffer) => void;
  onCounterOffer: (offer: ReceivedOffer) => void;
  onIgnore: (offer: ReceivedOffer) => void;
  onUnignore: (offer: ReceivedOffer) => void;
  onOpenExternal: (url: string) => void;
  onToggleBundle: (offer: ReceivedOffer) => void;
  accepting: boolean;
  highlighted: boolean;
}

const OfferRow = React.memo<OfferRowProps>(function OfferRow({
  offer,
  isExpanded,
  loadingBundleItems,
  onAccept,
  onCounterOffer,
  onIgnore,
  onUnignore,
  onOpenExternal,
  onToggleBundle,
  accepting,
  highlighted,
}) {
  const dt = formatOfferDate(offer.offeredAt);

  return (
    <>
      <TableRow className={highlighted ? "h-[57px] notification-highlight" : "h-[57px]"}>
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
              {offer.itemThumbnail ? (
                <img src={offer.itemThumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs">—</div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium">{offer.itemTitle}</div>
              {offer.isBundle && (
                <Button
                  variant="link"
                  onClick={() => onToggleBundle(offer)}
                  className="text-xs mt-0.5 p-0 h-auto flex items-center gap-1 cursor-pointer"
                >
                  <ChevronRightIcon className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  {loadingBundleItems ? "Loading…" : `Bundle (${offer.bundleItemIds.length} items)`}
                </Button>
              )}
            </div>
          </div>
        </TableCell>

        {/* Buyer */}
        <TableCell>
          {offer.buyerProfileUrl ? (
            <Button
              variant="link"
              className="p-0 h-auto cursor-pointer inline-flex items-center gap-1"
              onClick={() => onOpenExternal(offer.buyerProfileUrl!)}
            >
              {offer.buyerUsername}
              <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
            </Button>
          ) : (
            offer.buyerUsername
          )}
        </TableCell>

        {/* Original Price */}
        <TableCell className="text-muted-foreground font-medium whitespace-nowrap">{offer.originalPriceLabel}</TableCell>

        {/* Offer Price */}
        <TableCell className="font-medium whitespace-nowrap">{offer.offerPriceLabel}</TableCell>

        {/* Status */}
        <TableCell>
          <Badge variant={STATUS_BADGE[offer.status] || "hidden"}>{offer.autoAccepted ? "auto-accepted" : offer.status}</Badge>
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
                {offer.status === "pending" && (
                  <>
                    <DropdownMenuItem onClick={() => onAccept(offer)} disabled={accepting}>
                      <CheckCircleIcon className="w-4 h-4" />
                      {accepting ? "Accepting…" : "Accept offer"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onCounterOffer(offer)}>
                      <CurrencyPoundIcon className="w-4 h-4" />
                      Counter offer
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onIgnore(offer)}>
                      <NoSymbolIcon className="w-4 h-4" />
                      Ignore offer
                    </DropdownMenuItem>
                  </>
                )}
                {offer.status === "ignored" && (
                  <DropdownMenuItem onClick={() => onUnignore(offer)}>
                    <ArrowUturnLeftIcon className="w-4 h-4" />
                    Un-ignore offer
                  </DropdownMenuItem>
                )}
                {offer.conversationUrl && (
                  <DropdownMenuItem onClick={() => onOpenExternal(offer.conversationUrl!)}>
                    <ChatBubbleLeftRightIcon className="w-4 h-4" />
                    Open conversation
                  </DropdownMenuItem>
                )}
                {offer.buyerProfileUrl && (
                  <DropdownMenuItem onClick={() => onOpenExternal(offer.buyerProfileUrl!)}>
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                    View buyer profile
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>

      {/* Bundle expansion rows */}
      {offer.isBundle &&
        isExpanded &&
        offer.bundleItems.map((bundleItem, idx) => (
          <TableRow key={`${offer.id}-bundle-${idx}`} className="bg-muted/30">
            <TableCell className="px-4 py-2"></TableCell>
            <TableCell className="px-4 py-2" colSpan={6}>
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
});

// ─── Main Component ───────────────────────────────────────────────────────

const Offers: React.FC<OffersProps> = ({ loggedIn, isActive }) => {
  const { offers, refreshing, refreshOffers, acceptOffer, counterOffer, ignoreOffer, unignoreOffer, updateOfferBundleItems } =
    useOffersSync();
  const { consumeHighlight, highlightRef } = useNotificationSync();
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>("date", "desc");
  const { addToast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["pending"]);
  const [acceptingOffers, setAcceptingOffers] = useState<Set<number>>(new Set());
  const [counterOfferTarget, setCounterOfferTarget] = useState<ReceivedOffer | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [expandedBundles, setExpandedBundles] = useState<Set<number>>(new Set());
  const [loadingBundleOffers, setLoadingBundleOffers] = useState<Set<number>>(new Set());

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useGlobalRefresh("offers", refreshOffers);

  const handleAccept = useCallback(
    async (offer: ReceivedOffer) => {
      setAcceptingOffers((prev) => new Set(prev).add(offer.offerRequestId));
      try {
        await acceptOffer(offer.transactionId, offer.offerRequestId);
        addToast(`Accepted offer from ${offer.buyerUsername}`, "success");
      } catch {
        addToast("Failed to accept offer", "error");
      } finally {
        setAcceptingOffers((prev) => {
          const next = new Set(prev);
          next.delete(offer.offerRequestId);
          return next;
        });
      }
    },
    [acceptOffer, addToast],
  );

  const handleCounterOfferSubmit = useCallback(
    async (transactionId: number, price: number, currency: string) => {
      await counterOffer(transactionId, price, currency);
      addToast("Counter offer sent", "success");
    },
    [counterOffer, addToast],
  );

  const handleIgnore = useCallback(
    async (offer: ReceivedOffer) => {
      try {
        await ignoreOffer(offer.offerRequestId);
        addToast(`Offer from ${offer.buyerUsername} ignored`, "success");
      } catch {
        addToast("Failed to ignore offer", "error");
      }
    },
    [ignoreOffer, addToast],
  );

  const handleUnignore = useCallback(
    async (offer: ReceivedOffer) => {
      try {
        await unignoreOffer(offer.offerRequestId);
        addToast(`Offer from ${offer.buyerUsername} restored to pending`, "success");
      } catch {
        addToast("Failed to un-ignore offer", "error");
      }
    },
    [unignoreOffer, addToast],
  );

  const handleOpenExternal = useCallback((url: string) => {
    window.api.openExternal(url);
  }, []);

  const toggleBundle = useCallback(
    async (offer: ReceivedOffer) => {
      const offerId = offer.id;
      setExpandedBundles((prev) => {
        const next = new Set(prev);
        if (next.has(offerId)) {
          next.delete(offerId);
        } else {
          next.add(offerId);
        }
        return next;
      });

      // Lazy-load bundle items if not yet fetched
      if (!expandedBundles.has(offerId) && offer.bundleItems.length === 0 && offer.transactionId) {
        setLoadingBundleOffers((prev) => new Set(prev).add(offerId));
        try {
          const detail = await window.api.getTransactionDetail(offer.transactionId);
          const items = detail.order?.items || [];
          const bundleItems = items.map((item) => ({
            title: item.title || "Unknown Item",
            thumbnail:
              item.photos?.[0]?.thumbnails?.find((t) => t.type === "thumb150x210")?.url || item.photos?.[0]?.thumbnails?.[0]?.url || null,
          }));
          updateOfferBundleItems(offerId, bundleItems);
        } catch {
          addToast("Failed to load bundle items", "error");
        } finally {
          setLoadingBundleOffers((prev) => {
            const next = new Set(prev);
            next.delete(offerId);
            return next;
          });
        }
      }
    },
    [expandedBundles, updateOfferBundleItems, addToast],
  );

  // Filter and sort
  const filtered = useMemo(() => {
    let result = offers;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.itemTitle.toLowerCase().includes(q) || o.buyerUsername.toLowerCase().includes(q) || o.offerPriceLabel.toLowerCase().includes(q),
      );
    }

    if (statusFilter.length > 0) {
      result = result.filter((o) => statusFilter.includes(o.status));
    }

    if (sortColumn) {
      const dir = sortDirection === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        switch (sortColumn) {
          case "date":
            return dir * (a.offeredAt || "").localeCompare(b.offeredAt || "");
          case "item":
            return dir * a.itemTitle.localeCompare(b.itemTitle);
          case "buyer":
            return dir * a.buyerUsername.localeCompare(b.buyerUsername);
          case "originalPrice":
            return dir * (parseFloat(a.originalPrice.amount) - parseFloat(b.originalPrice.amount));
          case "offerPrice":
            return dir * (parseFloat(a.offerPrice.amount) - parseFloat(b.offerPrice.amount));
          case "status":
            return dir * a.status.localeCompare(b.status);
          default:
            return 0;
        }
      });
    }

    return result;
  }, [offers, search, statusFilter, sortColumn, sortDirection]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(
      (index: number) => {
        const offer = filtered[index];
        if (offer?.isBundle && expandedBundles.has(offer.id)) {
          return ROW_HEIGHT + offer.bundleItems.length * BUNDLE_ROW_HEIGHT;
        }
        return ROW_HEIGHT;
      },
      [filtered, expandedBundles],
    ),
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // ─── Notification highlight scroll ──────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const highlight = consumeHighlight();
    if (!highlight || highlight.page !== "offers") return;
    const idx = filtered.findIndex((o) => o.id === highlight.referenceId);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: "center" });
    setHighlightedId(filtered[idx].id);
    const timer = setTimeout(() => setHighlightedId(null), 2000);
    return () => clearTimeout(timer);
  }, [isActive, consumeHighlight, highlightRef, filtered, virtualizer]);

  return (
    <div className="flex flex-col gap-4 h-full">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusOptions={statusOptions}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
        actions={
          <Button variant="outline" onClick={() => refreshOffers()} disabled={refreshing} className="flex-shrink-0">
            {refreshing ? "Loading…" : "Refresh"}
          </Button>
        }
      />

      <Card className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div ref={scrollContainerRef} className="h-full overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-[120px] cursor-pointer select-none" onClick={() => handleSort("date")}>
                  Date <SortArrow column="date" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("item")}>
                  Item <SortArrow column="item" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[120px] cursor-pointer select-none" onClick={() => handleSort("buyer")}>
                  Buyer <SortArrow column="buyer" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[90px] cursor-pointer select-none" onClick={() => handleSort("originalPrice")}>
                  Original <SortArrow column="originalPrice" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[90px] cursor-pointer select-none" onClick={() => handleSort("offerPrice")}>
                  Offer <SortArrow column="offerPrice" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[110px] cursor-pointer select-none" onClick={() => handleSort("status")}>
                  Status <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                </TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    {offers.length === 0 ? "No offers received yet" : "No offers match your filters"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {virtualItems.length > 0 && <tr style={{ height: virtualItems[0].start }} />}
                  {virtualItems.map((virtualItem) => {
                    const offer = filtered[virtualItem.index];
                    return (
                      <OfferRow
                        key={offer.id}
                        offer={offer}
                        isExpanded={expandedBundles.has(offer.id)}
                        loadingBundleItems={loadingBundleOffers.has(offer.id)}
                        onAccept={handleAccept}
                        onCounterOffer={setCounterOfferTarget}
                        onIgnore={handleIgnore}
                        onUnignore={handleUnignore}
                        onOpenExternal={handleOpenExternal}
                        onToggleBundle={toggleBundle}
                        accepting={acceptingOffers.has(offer.offerRequestId)}
                        highlighted={highlightedId === offer.id}
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

      <CounterOfferModal
        offer={counterOfferTarget}
        open={counterOfferTarget !== null}
        onClose={() => setCounterOfferTarget(null)}
        onSubmit={handleCounterOfferSubmit}
      />
    </div>
  );
};

export default Offers;
