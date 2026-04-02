import { Card } from "@/components/ui/card";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  HeartIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalItem, VintedListing } from "../../../shared/types";
import { Badge, type BadgeProps } from "../components/Badge";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import FilterBar, { FilterOption } from "../components/FilterBar";
import { ProgressModal } from "../components/ProgressModal";
import { BulkRepostListingModal, SingleRepostListingModal } from "../components/RepostListingModal";
import { SortArrow } from "../components/SortArrow";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useListingSync } from "../context/ListingSyncContext";
import { useListingActions } from "../hooks/useListingActions";
import { useTableSort } from "../hooks/useTableSort";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ListingsProps {
  loggedIn: boolean;
  addToast: (message: string, type?: "success" | "error" | "info") => void;
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

// ─── Component ───────────────────────────────────────────────────────────────

const Listings: React.FC<ListingsProps> = ({ loggedIn, addToast }) => {
  const { listings, refreshing: loading, refreshListings, refreshSingleListing, patchListingMap } = useListingSync();

  // Filters & sort
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [showSold, setShowSold] = useState(false);
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>();

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Local items
  const [savedItems, setSavedItems] = useState<LocalItem[]>([]);

  const refreshSavedItems = useCallback(() => {
    window.api
      .getItems()
      .then(setSavedItems)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSavedItems();
  }, [refreshSavedItems]);

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
      // Hide sold listings unless "Show sold" is checked
      if (!showSold && l.status.toLowerCase() === "sold") return false;
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
  }, [listings, search, statusFilter, showSold, sortColumn, sortDirection]);

  // ─── Selection ─────────────────────────────────────────────────────────

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  // ─── Render ────────────────────────────────────────────────────────────

  if (!loggedIn) {
    return <div className="flex items-center justify-center h-full text-neutral-500 text-sm">Log in to view your listings</div>;
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
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
              <Checkbox checked={showSold} onCheckedChange={(checked) => setShowSold(checked === true)} />
              Show sold
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Bulk Actions
                      <ChevronDownIcon className="w-4 h-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
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
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            <Button variant="outline" onClick={handleRefresh} disabled={loading} className="flex-shrink-0">
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </>
        }
      />

      {loading && listings.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading listings…</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {listings.length === 0 ? "No listings found" : "No matching listings"}
        </div>
      ) : (
        <div>
          <Card className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 py-3 w-10">
                    <Checkbox checked={selected.size > 0 && selected.size === filtered.length} onCheckedChange={selectAll} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("title")}>
                    Item
                    <SortArrow column="title" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("price")}>
                    Price
                    <SortArrow column="price" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("favourites")}>
                    Favourites
                    <SortArrow column="favourites" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("views")}>
                    Views
                    <SortArrow column="views" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("status")}>
                    Status
                    <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
                    Created
                    <SortArrow column="createdAt" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((listing) => (
                  <TableRow key={listing.id}>
                    {/* Checkbox */}
                    <TableCell className="px-4 py-3">
                      <Checkbox checked={selected.has(listing.id)} onCheckedChange={() => toggleSelect(listing.id)} />
                    </TableCell>

                    {/* Item (thumbnail + title as link) */}
                    <TableCell className="px-4 py-3">
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
                            className="truncate max-w-[350px] font-medium hover:underline cursor-pointer text-left inline-flex items-center gap-1"
                          >
                            {listing.title}
                            <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                          </button>
                        ) : (
                          <span className="truncate max-w-[350px] font-medium">{listing.title}</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Price */}
                    <TableCell className="px-4 py-3 font-medium whitespace-nowrap">{listing.price ?? "—"}</TableCell>

                    {/* Favourites */}
                    <TableCell className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        <HeartIcon className="w-3.5 h-3.5 text-red-400/70" />
                        {listing.favourites}
                      </span>
                    </TableCell>

                    {/* Views */}
                    <TableCell className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        <EyeIcon className="w-3.5 h-3.5" />
                        {listing.views}
                      </span>
                    </TableCell>

                    {/* Status */}
                    <TableCell className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[listing.status.toLowerCase()] ?? "default"}>{listing.status}</Badge>
                    </TableCell>

                    {/* Created */}
                    <TableCell className="px-4 py-3 text-muted-foreground text-sm whitespace-nowrap">
                      {listing.createdAt
                        ? new Date(listing.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
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
                            {listing.status.toLowerCase() === "draft" && (
                              <DropdownMenuItem
                                onClick={() => actions.handlePublishDraft(listing)}
                                disabled={actions.publishingId === listing.id}
                              >
                                <ArrowUpTrayIcon className="w-4 h-4" />
                                {actions.publishingId === listing.id ? "Publishing…" : "Publish"}
                              </DropdownMenuItem>
                            )}
                            {listing.status.toLowerCase() === "active" && actions.isSavedAsItem(listing) && (
                              <DropdownMenuItem onClick={() => actions.openRepostModal(listing)}>
                                <ArrowPathIcon className="w-4 h-4" />
                                Repost
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => actions.handleRefreshListing(listing)}
                              disabled={actions.refreshingId === listing.id}
                            >
                              <ArrowPathIcon className={`w-4 h-4 ${actions.refreshingId === listing.id ? "animate-spin" : ""}`} />
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
                            <DropdownMenuItem onClick={() => actions.handleSaveAsItem(listing)}>
                              <ArrowUpTrayIcon className="w-4 h-4" />
                              {actions.isSavedAsItem(listing) ? "Update item" : "Save as item"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => actions.handleDelete(listing)}>
                              <TrashIcon className="w-4 h-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
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

      {/* ─── Progress Modal ───────────────────────────────────────────────── */}
      {actions.progress && <ProgressModal progress={actions.progress} onClose={() => actions.setProgress(null)} />}
    </div>
  );
};

export default Listings;
