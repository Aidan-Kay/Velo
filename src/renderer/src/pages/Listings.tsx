import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  CurrencyPoundIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  HeartIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { Checkbox } from "@shared/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@shared/components/ui/dropdown-menu";
import { Skeleton } from "@shared/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@shared/components/ui/table";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VintedListing } from "../../../shared/types";
import { Badge, type BadgeProps } from "../components/Badge";
import { BulkPriceRuleModal } from "../components/BulkPriceRuleModal";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import { DuplicateListingModal } from "../components/DuplicateListingModal";
import FilterBar, { FilterOption } from "../components/FilterBar";
import { ProgressModal } from "../components/ProgressModal";
import { BulkRepostListingModal, SingleRepostListingModal } from "../components/RepostListingModal";
import { SortArrow } from "../components/SortArrow";
import { useItemsSync } from "../context/ItemsSyncContext";
import { useListingSync } from "../context/ListingSyncContext";
import { useToast } from "../context/ToastContext";
import { useGlobalRefresh } from "../hooks/useGlobalRefresh";
import { useListingActions } from "../hooks/useListingActions";
import { useTableSort } from "../hooks/useTableSort";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ListingsProps {
  loggedIn: boolean;
}

type SortColumn = "title" | "price" | "favourites" | "views" | "status" | "createdAt";

// ─── Constants ───────────────────────────────────────────────────────────────

const statusOptions: FilterOption[] = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "hidden", label: "Hidden" },
  { value: "sold", label: "Sold" },
];

const STATUS_BADGE: Record<string, BadgeProps["variant"]> = {
  active: "active",
  draft: "draft",
  hidden: "hidden",
  sold: "sold",
};

const STATUS_ORDER: Record<string, number> = { active: 3, draft: 2, hidden: 1, sold: 0 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cached date formatter — avoids repeated toLocaleDateString ICU lookups per row. */
const _listingDateCache = new Map<string, string>();
function formatListingDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const cached = _listingDateCache.get(dateStr);
  if (cached) return cached;
  const formatted = new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  _listingDateCache.set(dateStr, formatted);
  return formatted;
}

/** Derive a Vinted edit listing URL from the listing's URL.
 *  Correct format: https://www.vinted.co.uk/items/8347893005/edit
 *  listing.url may include a slug suffix (e.g. /items/8347893005-title-slug)
 *  so we rebuild using listing.id to ensure correctness. */
function getEditUrl(listing: VintedListing): string {
  try {
    const urlObj = new URL(listing.url);
    return `${urlObj.origin}/items/${listing.id}/edit`;
  } catch {
    // Fallback: strip slug and append /edit
    return listing.url.replace(/\/items\/\d+.*$/, `/items/${listing.id}/edit`);
  }
}

function ListingRowSkeleton() {
  return (
    <TableRow aria-busy="true" className="pointer-events-none">
      <TableCell></TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded" />
          <Skeleton className="h-4 w-48" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-10" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-10" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Memoized Listing Row ────────────────────────────────────────────────────

interface ListingRowProps {
  listing: VintedListing;
  isSelected: boolean;
  isRefreshing: boolean;
  isPublishing: boolean;
  isSaved: boolean;
  onToggleSelect: (id: number) => void;
  onPublishDraft: (listing: VintedListing) => void;
  onOpenRepostModal: (listing: VintedListing) => void;
  onRefreshListing: (listing: VintedListing) => void;
  onSaveAsItem: (listing: VintedListing) => void;
  onDelete: (listing: VintedListing) => void;
  onDuplicate: (listing: VintedListing) => void;
}

const ListingRow = React.memo<ListingRowProps>(
  ({
    listing,
    isSelected,
    isRefreshing,
    isPublishing,
    isSaved,
    onToggleSelect,
    onPublishDraft,
    onOpenRepostModal,
    onRefreshListing,
    onSaveAsItem,
    onDelete,
    onDuplicate,
  }) => {
    if (isRefreshing || isPublishing) {
      return <ListingRowSkeleton />;
    }

    return (
      <TableRow>
        {/* Checkbox */}
        <TableCell>
          <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(listing.id)} />
        </TableCell>

        {/* Item (thumbnail + title as link) */}
        <TableCell className="max-w-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-muted overflow-hidden flex-shrink-0">
              {listing.thumbnail ? (
                <img src={listing.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs">—</div>
              )}
            </div>
            {listing.status.toLowerCase() !== "draft" ? (
              <button
                onClick={() => window.api.openExternal(listing.url)}
                className="truncate min-w-0 font-medium hover:underline cursor-pointer text-left inline-flex items-center gap-1"
              >
                {listing.title}
                <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
              </button>
            ) : (
              <span className="truncate min-w-0 font-medium">{listing.title}</span>
            )}
          </div>
        </TableCell>

        {/* Price */}
        <TableCell className="font-medium whitespace-nowrap">{listing.price ?? "—"}</TableCell>

        {/* Favourites */}
        <TableCell>
          <span className="inline-flex items-center gap-1">
            <HeartIcon className="w-3.5 h-3.5 text-red-400/70" />
            {listing.favourites}
          </span>
        </TableCell>

        {/* Views */}
        <TableCell>
          <span className="inline-flex items-center gap-1">
            <EyeIcon className="w-3.5 h-3.5" />
            {listing.views}
          </span>
        </TableCell>

        {/* Status */}
        <TableCell>
          <Badge variant={STATUS_BADGE[listing.status.toLowerCase()] ?? "default"}>{listing.status}</Badge>
        </TableCell>

        {/* Created */}
        <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{formatListingDate(listing.createdAt)}</TableCell>

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
                {listing.status.toLowerCase() === "draft" && (
                  <DropdownMenuItem onClick={() => onPublishDraft(listing)} disabled={isPublishing}>
                    <ArrowUpTrayIcon className="w-4 h-4" />
                    {isPublishing ? "Publishing…" : "Publish"}
                  </DropdownMenuItem>
                )}
                {listing.status.toLowerCase() === "active" && isSaved && (
                  <DropdownMenuItem onClick={() => onOpenRepostModal(listing)}>
                    <ArrowPathIcon className="w-4 h-4" />
                    Repost
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onRefreshListing(listing)} disabled={isRefreshing}>
                  <ArrowPathIcon className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                  Refresh
                </DropdownMenuItem>
                {listing.status.toLowerCase() !== "draft" && (
                  <DropdownMenuItem onClick={() => window.api.openExternal(listing.url)}>
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                    View on Vinted
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => window.api.openExternal(getEditUrl(listing))}>
                  <PencilSquareIcon className="w-4 h-4" />
                  Edit on Vinted
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSaveAsItem(listing)}>
                  <ArrowUpTrayIcon className="w-4 h-4" />
                  {isSaved ? "Update item" : "Save as item"}
                </DropdownMenuItem>
                {listing.status.toLowerCase() !== "sold" && (
                  <DropdownMenuItem onClick={() => onDuplicate(listing)}>
                    <DocumentDuplicateIcon className="w-4 h-4" />
                    Duplicate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onDelete(listing)}>
                  <TrashIcon className="w-4 h-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
    );
  },
);

// ─── Component ───────────────────────────────────────────────────────────────

const Listings: React.FC<ListingsProps> = ({ loggedIn }) => {
  const { addToast } = useToast();
  const { listings, refreshing: loading, refreshListings, refreshSingleListing, patchListingMap } = useListingSync();

  // Filters & sort
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["active", "draft", "hidden"]);
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>();

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showBulkPriceRule, setShowBulkPriceRule] = useState(false);
  const [priceRulePresets, setPriceRulePresets] = useState<import("../../../shared/types").PriceRulePreset[]>([]);

  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => setPriceRulePresets(s.priceRulePresets ?? []))
      .catch(() => {});
  }, [showBulkPriceRule]);

  // Shared items
  const { items: savedItems, refreshItems: refreshSavedItems } = useItemsSync();

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ─── Actions hook ──────────────────────────────────────────────────────

  const actions = useListingActions({
    addToast,
    refreshListings,
    refreshSingleListing,
    patchListingMap,
    savedItems,
    refreshSavedItems,
    clearSelection,
  });

  // ─── Filter & sort ─────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const result = listings.filter((l) => {
      if (statusFilter.length > 0 && !statusFilter.includes(l.status.toLowerCase())) return false;
      if (search) {
        const q = search.toLowerCase();
        return l.title.toLowerCase().includes(q) || l.brandTitle.toLowerCase().includes(q);
      }
      return true;
    });

    if (sortColumn) {
      const dir = sortDirection === "asc" ? 1 : -1;
      result.sort((a, b) => {
        switch (sortColumn) {
          case "title":
            return dir * a.title.localeCompare(b.title);
          case "price":
            return dir * ((a.priceNumeric ?? 0) - (b.priceNumeric ?? 0));
          case "favourites":
            return dir * (a.favourites - b.favourites);
          case "views":
            return dir * (a.views - b.views);
          case "status":
            return dir * ((STATUS_ORDER[a.status.toLowerCase()] ?? 0) - (STATUS_ORDER[b.status.toLowerCase()] ?? 0));
          case "createdAt": {
            const aDate = a.createdAt || "";
            const bDate = b.createdAt || "";
            return dir * aDate.localeCompare(bDate);
          }
          default:
            return 0;
        }
      });
    }

    return result;
  }, [listings, search, statusFilter, sortColumn, sortDirection]);

  // ─── Selection ─────────────────────────────────────────────────────────

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
      setSelected(new Set(filtered.map((listing) => listing.id)));
    }
  };

  // ─── Refresh ───────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    if (!loggedIn) return;
    addToast("Refreshing listings…", "info");
    try {
      await refreshListings();
      addToast("Listings refreshed", "success");
    } catch {
      addToast("Failed to refresh listings", "error");
    }
  }, [loggedIn, addToast, refreshListings]);

  useGlobalRefresh("listings", handleRefresh);

  // ─── Virtualizer ──────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 57,
    overscan: 5,
    getItemKey: useCallback((index: number) => filtered[index]?.id ?? index, [filtered]),
  });

  const virtualItems = virtualizer.getVirtualItems();

  // ─── Render ────────────────────────────────────────────────────────────

  if (!loggedIn) {
    return <div className="flex items-center justify-center h-full text-neutral-500 text-sm">Log in to view your listings</div>;
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
          <>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button variant="outline">
                      Bulk Actions
                      <ChevronDownIcon className="w-4 h-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-auto min-w-max" align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        actions.setShowBulkRepostConfig(true);
                      }}
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      Repost
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.handleBulkPublish(selected, filtered)}>
                      <ArrowUpTrayIcon className="w-4 h-4" />
                      Publish
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.handleBulkSave(selected, filtered)}>
                      <DocumentDuplicateIcon className="w-4 h-4" />
                      Save Items
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.handleBulkRefresh(selected, filtered)}>
                      <ArrowPathIcon className="w-4 h-4" />
                      Refresh
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setShowBulkDeleteConfirm(true)}>
                      <TrashIcon className="w-4 h-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            <Button variant="outline" onClick={() => setShowBulkPriceRule(true)} className="flex-shrink-0">
              <CurrencyPoundIcon className="w-4 h-4 mr-1" />
              Bulk price…
            </Button>
            <Button variant="outline" onClick={handleRefresh} disabled={loading} className="flex-shrink-0">
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </>
        }
      />

      {loading && listings.length === 0 ? (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Skeleton className="h-4 w-4" />
                </TableHead>
                <TableHead className="w-full">Item</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Favourites</TableHead>
                <TableHead>Views</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 8 }).map((_, i) => (
                <ListingRowSkeleton key={i} />
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {listings.length === 0 ? "No listings found" : "No matching listings"}
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
                  <TableHead className="w-full cursor-pointer select-none" onClick={() => handleSort("title")}>
                    Item
                    <SortArrow column="title" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("price")}>
                    Price
                    <SortArrow column="price" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("favourites")}>
                    Favourites
                    <SortArrow column="favourites" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("views")}>
                    Views
                    <SortArrow column="views" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                    Status
                    <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
                    Created
                    <SortArrow column="createdAt" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && filtered.length > 0 ? (
                  Array.from({ length: Math.min(filtered.length, 10) }).map((_, i) => <ListingRowSkeleton key={`skel-${i}`} />)
                ) : (
                  <>
                    {virtualItems.length > 0 && virtualItems[0].start > 0 && <tr style={{ height: virtualItems[0].start }} />}
                    {virtualItems.map((virtualRow) => {
                      const listing = filtered[virtualRow.index];
                      return (
                        <ListingRow
                          key={listing.id}
                          listing={listing}
                          isSelected={selected.has(listing.id)}
                          isRefreshing={actions.refreshingId === listing.id}
                          isPublishing={actions.publishingId === listing.id}
                          isSaved={actions.isSavedAsItem(listing)}
                          onToggleSelect={toggleSelect}
                          onPublishDraft={actions.handlePublishDraft}
                          onOpenRepostModal={actions.openRepostModal}
                          onRefreshListing={actions.handleRefreshListing}
                          onSaveAsItem={actions.handleSaveAsItem}
                          onDelete={actions.handleDelete}
                          onDuplicate={actions.setDuplicateListing}
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

      {/* ─── Delete Confirmation Modal ────────────────────────────────────── */}
      {actions.confirmDeleteListing && (
        <DeleteConfirmModal
          title="Delete Listing"
          itemName={actions.confirmDeleteListing.title}
          onConfirm={actions.confirmDelete}
          onCancel={() => actions.setConfirmDeleteListing(null)}
        />
      )}

      {showBulkDeleteConfirm && (
        <DeleteConfirmModal
          title="Delete Listings"
          message={`Are you sure you want to delete ${selected.size} selected listing${selected.size === 1 ? "" : "s"}? This cannot be undone.`}
          confirmLabel="Delete all"
          onConfirm={() => {
            setShowBulkDeleteConfirm(false);
            actions.handleBulkDelete(selected, filtered);
          }}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}

      {/* ─── Single Repost Listing Modal ───────────────────────────────────── */}
      {actions.repostListing && (
        <SingleRepostListingModal
          title={actions.repostListing.title}
          initialPrice={actions.repostListing.priceNumeric?.toString() ?? ""}
          onConfirm={actions.handleRepost}
          onCancel={() => actions.setRepostListing(null)}
        />
      )}

      {/* ─── Bulk Repost Listing Modal ─────────────────────────────────────── */}
      {actions.showBulkRepostConfig && (
        <BulkRepostListingModal
          selectedCount={selected.size}
          onConfirm={(asDraft) => {
            actions.setShowBulkRepostConfig(false);
            actions.handleBulkRepost(asDraft, selected, filtered);
          }}
          onCancel={() => actions.setShowBulkRepostConfig(false)}
        />
      )}

      {/* ─── Duplicate Listing Modal ──────────────────────────────────── */}
      {actions.duplicateListing && (
        <DuplicateListingModal
          title={actions.duplicateListing.title}
          onConfirm={actions.handleDuplicateListing}
          onCancel={() => actions.setDuplicateListing(null)}
        />
      )}

      {/* ─── Progress Modal ───────────────────────────────────────────────── */}
      {actions.progress && <ProgressModal progress={actions.progress} onClose={() => actions.setProgress(null)} />}

      {/* ─── Bulk Price Rule Modal ────────────────────────────────────────── */}
      {showBulkPriceRule && (
        <BulkPriceRuleModal
          presets={priceRulePresets}
          onClose={() => setShowBulkPriceRule(false)}
          onComplete={() => {
            void refreshListings();
          }}
        />
      )}
    </div>
  );
};

export default React.memo(Listings);
