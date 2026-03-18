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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalItem, VintedListing } from "../../../shared/types";
import { Badge, type BadgeProps } from "../components/Badge";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import FilterBar, { FilterOption } from "../components/FilterBar";
import { ProgressModal, type ProgressState } from "../components/ProgressModal";
import { BulkRepostListingModal, SingleRepostListingModal } from "../components/RepostListingModal";
import { SortArrow } from "../components/SortArrow";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useListingSync } from "../context/ListingSyncContext";
import { runBulkOperation } from "../hooks/useBulkOperation";
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
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>();

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Local items
  const [savedItems, setSavedItems] = useState<LocalItem[]>([]);

  // Single-action state
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [confirmDeleteListing, setConfirmDeleteListing] = useState<VintedListing | null>(null);

  // Single repost modal
  const [repostListing, setRepostListing] = useState<VintedListing | null>(null);

  // Bulk repost config modal
  const [showBulkRepostConfig, setShowBulkRepostConfig] = useState(false);

  // Progress modal (shared for all bulk + single repost)
  const [progress, setProgress] = useState<ProgressState | null>(null);

  // Cancellation ref for bulk operations
  const cancelledRef = useRef(false);

  // ─── Load saved items ──────────────────────────────────────────────────

  const refreshSavedItems = useCallback(() => {
    window.api
      .getItems()
      .then(setSavedItems)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSavedItems();
  }, [refreshSavedItems]);

  const isSavedAsItem = (listing: VintedListing): boolean => {
    return savedItems.some((item) => item.title.toLowerCase().trim() === listing.title.toLowerCase().trim());
  };

  const findExistingItem = (listing: VintedListing): LocalItem | undefined => {
    return savedItems.find((item) => item.title.toLowerCase().trim() === listing.title.toLowerCase().trim());
  };

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
      setSelected(new Set(filtered.map((l) => l.id)));
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

  // ─── Delete ────────────────────────────────────────────────────────────

  const handleDelete = (listing: VintedListing) => setConfirmDeleteListing(listing);

  const confirmDelete = async () => {
    if (!confirmDeleteListing) return;
    const listing = confirmDeleteListing;
    setConfirmDeleteListing(null);
    try {
      await window.api.deleteListing(listing.id, listing.status.toLowerCase() === "draft");
      patchListingMap(listing.title, null);
      addToast("Listing deleted", "success");
      refreshListings().catch(() => {});
    } catch {
      addToast("Failed to delete listing", "error");
    }
  };

  // ─── Save as item (core logic) ─────────────────────────────────────────

  const saveListingAsItem = async (listing: VintedListing): Promise<void> => {
    const detail = await window.api.getItemUploadDetail(listing.id);
    const detailDescription = (detail.description as string) || listing.description;
    const detailPhotos = Array.isArray(detail.photos)
      ? ((detail.photos as Array<{ full_size_url?: string; url?: string }>)
          .map((p) => p.full_size_url || p.url)
          .filter(Boolean) as string[])
      : listing.photos;

    const itemData: Partial<LocalItem> = {
      title: listing.title,
      description: detailDescription,
      price: listing.priceNumeric ?? 0,
      currency: listing.currency,
      categoryId: (detail.catalog_id as number) || listing.categoryId,
      conditionId: null,
      brandId: (detail.brand_id as number) || null,
      sizeId: (detail.size_id as number) || null,
      color1Id: (detail.color1_id as number) || null,
      color2Id: (detail.color2_id as number) || null,
      packageSizeId: (detail.package_size_id as number) || null,
      shippingMethodId: null,
      photos: detailPhotos,
      stock: 1,
      categoryAttributes: {},
      videoGameRatingId: (detail.video_game_rating_id as number) ?? null,
      measurementLength: (detail.measurement_length as number) ?? null,
      measurementWidth: (detail.measurement_width as number) ?? null,
      isbn: (detail.isbn as string) ?? null,
      manufacturer: (detail.manufacturer as string) ?? null,
      manufacturerLabelling: (detail.manufacturer_labelling as string) ?? null,
      model: (detail.model as string) ?? null,
      domesticShipmentPrice: (detail.domestic_shipment_price as number) ?? null,
      internationalShipmentPrice: (detail.international_shipment_price as number) ?? null,
    };

    const existing = findExistingItem(listing);
    if (existing) {
      itemData.id = existing.id;
      itemData.stock = existing.stock;
    }

    const attrs = detail.item_attributes as Array<{ code: string; ids: number[] }> | undefined;
    if (Array.isArray(attrs)) {
      const mapped: Record<string, number | number[]> = {};
      for (const attr of attrs) {
        mapped[attr.code] = attr.ids.length === 1 ? attr.ids[0] : attr.ids;
      }
      itemData.categoryAttributes = mapped;
    }

    if (detail.status && itemData.categoryId) {
      try {
        const conditions = await window.api.getConditions(itemData.categoryId);
        const condTitle = (detail.status as string).toLowerCase();
        const matched = conditions.find((c) => c.title.toLowerCase() === condTitle);
        if (matched) itemData.conditionId = matched.id;
      } catch {
        /* non-critical */
      }
    }

    await window.api.saveItem(itemData);
  };

  const handleSaveAsItem = async (listing: VintedListing) => {
    try {
      addToast(`Fetching detail for "${listing.title}"…`, "info");
      await saveListingAsItem(listing);
      addToast(findExistingItem(listing) ? `Updated "${listing.title}"` : `Saved "${listing.title}" as item`, "success");
      refreshSavedItems();
    } catch {
      addToast("Failed to save as item", "error");
    }
  };

  // ─── Publish draft ────────────────────────────────────────────────────

  const handlePublishDraft = async (listing: VintedListing) => {
    setPublishingId(listing.id);
    addToast("Publishing draft…", "info");
    try {
      await window.api.publishListing(listing.id);
      addToast(`Published "${listing.title}"`, "success");
      patchListingMap(listing.title, { status: "Active", id: listing.id });
      //refreshSingleListing(listing.id).catch(() => {});
    } catch {
      addToast("Failed to publish draft", "error");
    } finally {
      setPublishingId(null);
    }
  };

  // ─── Single repost ────────────────────────────────────────────────────

  const handleRefreshListing = async (listing: VintedListing) => {
    setRefreshingId(listing.id);
    addToast(`Refreshing "${listing.title}"…`, "info");
    try {
      await refreshSingleListing(listing.id);
      addToast(`Refreshed "${listing.title}"`, "success");
    } catch {
      addToast("Failed to refresh listing", "error");
    } finally {
      setRefreshingId(null);
    }
  };

  const openRepostModal = (listing: VintedListing) => {
    setRepostListing(listing);
  };

  const handleRepost = async (repostPrice: string, repostAsDraft: boolean) => {
    if (!repostListing) return;
    const listing = repostListing;
    const item = findExistingItem(listing);
    if (!item) {
      addToast("Save this listing as an item first before reposting", "error");
      return;
    }

    const priceNum = parseFloat(repostPrice) || item.price;
    const totalSteps = repostAsDraft ? 2 : 3;

    setRepostListing(null);
    setProgress({
      title: "Reposting Listing",
      total: 1,
      completed: 0,
      failed: 0,
      currentTitle: listing.title,
      currentAction: "Creating draft listing…",
      done: false,
      itemStep: 1,
      itemStepTotal: totalSteps,
    });

    try {
      // Step 1: Create draft listing
      const result = await window.api.createListing({ ...item, price: priceNum }, { asDraft: true });
      const draftId = (result as Record<string, unknown>).item
        ? (((result as Record<string, unknown>).item as Record<string, unknown>).id as number)
        : 0;

      // Step 2: Delete old listing
      setProgress((p) => (p ? { ...p, currentAction: "Deleting old listing…", itemStep: 2 } : p));
      await window.api.deleteListing(listing.id, listing.status.toLowerCase() === "draft");

      // Step 3: Publish draft (if not listing as draft)
      if (!repostAsDraft && draftId) {
        setProgress((p) => (p ? { ...p, currentAction: "Publishing draft…", itemStep: 3 } : p));
        await window.api.publishListing(draftId);
      }

      patchListingMap(listing.title, null);
      setProgress((p) => (p ? { ...p, completed: 1, done: true, currentAction: "Done" } : p));
      refreshListings().catch(() => {});
    } catch (err) {
      setProgress((p) => (p ? { ...p, failed: 1, done: true, currentAction: `Failed: ${(err as Error).message}` } : p));
    }
  };

  // ─── Bulk repost ──────────────────────────────────────────────────────

  const handleBulkRepost = async (bulkRepostAsDraft: boolean) => {
    const selectedListings = filtered.filter((l) => selected.has(l.id));
    const repostable = selectedListings.filter((l) => isSavedAsItem(l));

    if (repostable.length === 0) {
      addToast("No selected listings have saved items — save them as items first", "error");
      return;
    }

    const settings = await window.api.getSettings();
    const minMs = (settings.bulkRepost?.minIntervalSeconds ?? 30) * 1000;
    const maxMs = (settings.bulkRepost?.maxIntervalSeconds ?? 60) * 1000;

    cancelledRef.current = false;

    await runBulkOperation({
      items: repostable,
      title: `Reposting ${repostable.length} listing(s)`,
      cancelledRef,
      setProgress,
      minIntervalMs: minMs,
      maxIntervalMs: maxMs,
      action: async (listing, updateAction, updateItemStep) => {
        const item = findExistingItem(listing);
        const photoCount = item!.photos?.length ?? 0;
        // photos + draft + delete + optional publish
        const totalSteps = photoCount + 1 + 1 + (bulkRepostAsDraft ? 0 : 1);

        // Listen for per-photo progress from the main process
        const cleanup = window.api.onListingCreationProgress(({ step, current }) => {
          updateItemStep(current, totalSteps);
          updateAction(step + "…");
        });

        // Step 1: Create draft listing (photos + draft reported via progress events)
        updateItemStep(1, totalSteps);
        updateAction("Creating draft listing…");
        let result: Record<string, unknown>;
        try {
          result = await window.api.createListing({ ...item!, price: item!.price }, { asDraft: true });
        } finally {
          cleanup();
        }
        const draftId = result.item ? ((result.item as Record<string, unknown>).id as number) : 0;

        // Step: Delete old listing
        updateItemStep(photoCount + 2, totalSteps);
        updateAction("Deleting old listing…");
        await window.api.deleteListing(listing.id, listing.status.toLowerCase() === "draft");

        // Step: Publish draft (if not listing as draft)
        if (!bulkRepostAsDraft && draftId) {
          updateItemStep(totalSteps, totalSteps);
          updateAction("Publishing draft…");
          await window.api.publishListing(draftId);
        }

        patchListingMap(listing.title, null);
      },
      onComplete: () => {
        refreshListings().catch(() => {});
        setSelected(new Set());
      },
    });
  };

  // ─── Bulk publish ─────────────────────────────────────────────────────

  const handleBulkPublish = async () => {
    const drafts = filtered.filter((l) => selected.has(l.id) && l.status.toLowerCase() === "draft");
    if (drafts.length === 0) {
      addToast("No draft listings selected", "error");
      return;
    }

    const settings = await window.api.getSettings();
    const minMs = (settings.bulkRepost?.minIntervalSeconds ?? 30) * 1000;
    const maxMs = (settings.bulkRepost?.maxIntervalSeconds ?? 60) * 1000;

    cancelledRef.current = false;

    await runBulkOperation({
      items: drafts,
      title: `Publishing ${drafts.length} draft(s)`,
      cancelledRef,
      setProgress,
      minIntervalMs: minMs,
      maxIntervalMs: maxMs,
      action: async (listing, updateAction, _updateItemStep) => {
        updateAction("Publishing draft…");
        await window.api.publishListing(listing.id);
        patchListingMap(listing.title, { status: "Active", id: listing.id });
      },
      onComplete: () => {
        refreshListings().catch(() => {});
        setSelected(new Set());
      },
    });
  };

  // ─── Bulk save as item ────────────────────────────────────────────────

  const handleBulkSave = async () => {
    const selectedListings = filtered.filter((l) => selected.has(l.id));
    if (selectedListings.length === 0) return;

    const settings = await window.api.getSettings();
    const minMs = (settings.bulkRepost?.minIntervalSeconds ?? 30) * 1000;
    const maxMs = (settings.bulkRepost?.maxIntervalSeconds ?? 60) * 1000;

    cancelledRef.current = false;

    await runBulkOperation({
      items: selectedListings,
      title: `Saving ${selectedListings.length} listing(s) as items`,
      cancelledRef,
      setProgress,
      minIntervalMs: minMs,
      maxIntervalMs: maxMs,
      action: async (listing, updateAction, _updateItemStep) => {
        updateAction("Fetching detail…");
        await saveListingAsItem(listing);
      },
      onComplete: () => {
        refreshSavedItems();
        setSelected(new Set());
      },
    });
  };

  // ─── Bulk refresh ─────────────────────────────────────────────────────

  const handleBulkRefresh = async () => {
    const selectedListings = filtered.filter((l) => selected.has(l.id));
    if (selectedListings.length === 0) return;

    cancelledRef.current = false;

    await runBulkOperation({
      items: selectedListings,
      title: `Refreshing ${selectedListings.length} listing(s)`,
      cancelledRef,
      setProgress,
      minIntervalMs: 500,
      maxIntervalMs: 1500,
      action: async (listing, updateAction, _updateItemStep) => {
        updateAction("Refreshing…");
        await refreshSingleListing(listing.id);
      },
      onComplete: () => {
        setSelected(new Set());
      },
    });
  };

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
                        setShowBulkRepostConfig(true);
                      }}
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      Repost
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleBulkPublish}>
                      <ArrowUpTrayIcon className="w-4 h-4" />
                      Publish
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleBulkSave}>
                      <DocumentDuplicateIcon className="w-4 h-4" />
                      Save Items
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleBulkRefresh}>
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
                            className="truncate max-w-[350px] font-medium hover:underline cursor-pointer text-left"
                          >
                            {listing.title}
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
                              <DropdownMenuItem onClick={() => handlePublishDraft(listing)} disabled={publishingId === listing.id}>
                                <ArrowUpTrayIcon className="w-4 h-4" />
                                {publishingId === listing.id ? "Publishing…" : "Publish"}
                              </DropdownMenuItem>
                            )}
                            {listing.status.toLowerCase() === "active" && isSavedAsItem(listing) && (
                              <DropdownMenuItem onClick={() => openRepostModal(listing)}>
                                <ArrowPathIcon className="w-4 h-4" />
                                Repost
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleRefreshListing(listing)} disabled={refreshingId === listing.id}>
                              <ArrowPathIcon className={`w-4 h-4 ${refreshingId === listing.id ? "animate-spin" : ""}`} />
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
                            <DropdownMenuItem onClick={() => handleSaveAsItem(listing)}>
                              <ArrowUpTrayIcon className="w-4 h-4" />
                              {isSavedAsItem(listing) ? "Update item" : "Save as item"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(listing)}>
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
      {confirmDeleteListing && (
        <DeleteConfirmModal
          title="Delete Listing"
          itemName={confirmDeleteListing.title}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteListing(null)}
        />
      )}

      {/* ─── Single Repost Listing Modal ───────────────────────────────────── */}
      {repostListing && (
        <SingleRepostListingModal
          title={repostListing.title}
          initialPrice={repostListing.priceNumeric?.toString() ?? ""}
          onConfirm={handleRepost}
          onCancel={() => setRepostListing(null)}
        />
      )}

      {/* ─── Bulk Repost Listing Modal ─────────────────────────────────────── */}
      {showBulkRepostConfig && (
        <BulkRepostListingModal
          selectedCount={selected.size}
          onConfirm={(asDraft) => {
            setShowBulkRepostConfig(false);
            handleBulkRepost(asDraft);
          }}
          onCancel={() => setShowBulkRepostConfig(false)}
        />
      )}

      {/* ─── Progress Modal ───────────────────────────────────────────────── */}
      {progress && <ProgressModal progress={progress} onClose={() => setProgress(null)} />}
    </div>
  );
};

export default Listings;
