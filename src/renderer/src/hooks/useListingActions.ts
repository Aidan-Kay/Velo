import { useCallback, useMemo, useRef, useState } from "react";
import { titleKey } from "../../../shared/lib/match";
import type { LocalItem, VintedListing } from "../../../shared/types";
import type { ProgressState } from "../components/ProgressModal";
import { runBulkOperation } from "./useBulkOperation";

// ─── Public types ────────────────────────────────────────────────────────────

interface UseListingActionsDeps {
  addToast: (message: string, type?: "success" | "error" | "info") => void;
  refreshListings: () => Promise<void>;
  refreshSingleListing: (id: number) => Promise<void>;
  patchListingMap: (title: string, patch: { status: string; id: number } | null) => void;
  savedItems: LocalItem[];
  refreshSavedItems: () => void;
  clearSelection: () => void;
}

export interface ListingActions {
  // State
  publishingId: number | null;
  refreshingId: number | null;
  confirmDeleteListing: VintedListing | null;
  repostListing: VintedListing | null;
  showBulkRepostConfig: boolean;
  progress: ProgressState | null;
  duplicateListing: VintedListing | null;

  // State setters (for modals/UI)
  setConfirmDeleteListing: React.Dispatch<React.SetStateAction<VintedListing | null>>;
  setRepostListing: React.Dispatch<React.SetStateAction<VintedListing | null>>;
  setShowBulkRepostConfig: React.Dispatch<React.SetStateAction<boolean>>;
  setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>;
  setDuplicateListing: React.Dispatch<React.SetStateAction<VintedListing | null>>;

  // Helpers
  isSavedAsItem: (listing: VintedListing) => boolean;

  // Single actions
  handleDelete: (listing: VintedListing) => void;
  confirmDelete: () => Promise<void>;
  handleSaveAsItem: (listing: VintedListing) => Promise<void>;
  handlePublishDraft: (listing: VintedListing) => Promise<void>;
  handleRefreshListing: (listing: VintedListing) => Promise<void>;
  openRepostModal: (listing: VintedListing) => void;
  handleRepost: (repostPrice: string, repostAsDraft: boolean) => Promise<void>;
  handleDuplicateListing: (copyPhotos: boolean, asDraft: boolean) => Promise<void>;

  // Bulk actions
  handleBulkRepost: (asDraft: boolean, selected: Set<number>, filtered: VintedListing[]) => Promise<void>;
  handleBulkPublish: (selected: Set<number>, filtered: VintedListing[]) => Promise<void>;
  handleBulkDelete: (selected: Set<number>, filtered: VintedListing[]) => Promise<void>;
  handleBulkSave: (selected: Set<number>, filtered: VintedListing[]) => Promise<void>;
  handleBulkRefresh: (selected: Set<number>, filtered: VintedListing[]) => Promise<void>;

  // Cancellation
  cancelledRef: React.RefObject<boolean>;
}

// ─── Data mapping ────────────────────────────────────────────────────────────

/** Map a VintedListing + its upload detail into a LocalItem for saving. */
export async function buildItemFromListing(listing: VintedListing, existing: LocalItem | undefined): Promise<Partial<LocalItem>> {
  const detail = await window.api.getItemUploadDetail(listing.id);
  const detailDescription = (detail.description as string) || listing.description;
  const detailPhotos = Array.isArray(detail.photos)
    ? ((detail.photos as Array<{ full_size_url?: string; url?: string }>).map((p) => p.full_size_url || p.url).filter(Boolean) as string[])
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

  return itemData;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useListingActions({
  addToast,
  refreshListings,
  refreshSingleListing,
  patchListingMap,
  savedItems,
  refreshSavedItems,
  clearSelection,
}: UseListingActionsDeps): ListingActions {
  // Single-action state
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [confirmDeleteListing, setConfirmDeleteListing] = useState<VintedListing | null>(null);

  // Single repost modal
  const [repostListing, setRepostListing] = useState<VintedListing | null>(null);

  // Duplicate listing modal
  const [duplicateListing, setDuplicateListing] = useState<VintedListing | null>(null);

  // Bulk repost config modal
  const [showBulkRepostConfig, setShowBulkRepostConfig] = useState(false);

  // Progress modal
  const [progress, setProgress] = useState<ProgressState | null>(null);

  // Cancellation ref
  const cancelledRef = useRef(false);

  // ─── Helpers ─────────────────────────────────────────────────────────

  const savedItemsByKey = useMemo(() => new Map(savedItems.map((item) => [titleKey(item.title), item])), [savedItems]);

  const isSavedAsItem = useCallback((listing: VintedListing): boolean => savedItemsByKey.has(titleKey(listing.title)), [savedItemsByKey]);

  const findExistingItem = useCallback(
    (listing: VintedListing): LocalItem | undefined => savedItemsByKey.get(titleKey(listing.title)),
    [savedItemsByKey],
  );

  // ─── Delete ──────────────────────────────────────────────────────────

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

  // ─── Save as item ───────────────────────────────────────────────────

  const saveListingAsItem = async (listing: VintedListing): Promise<void> => {
    const itemData = await buildItemFromListing(listing, findExistingItem(listing));
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

  // ─── Publish draft ─────────────────────────────────────────────────

  const handlePublishDraft = async (listing: VintedListing) => {
    setPublishingId(listing.id);
    addToast("Publishing draft…", "info");
    try {
      await window.api.publishListing(listing.id);
      addToast(`Published "${listing.title}"`, "success");
      patchListingMap(listing.title, { status: "Active", id: listing.id });
    } catch {
      addToast("Failed to publish draft", "error");
    } finally {
      setPublishingId(null);
    }
  };

  // ─── Refresh listing ──────────────────────────────────────────────

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

  // ─── Single repost ────────────────────────────────────────────────

  const openRepostModal = (listing: VintedListing) => setRepostListing(listing);

  const handleDuplicateListing = async (copyPhotos: boolean, asDraft: boolean) => {
    if (!duplicateListing) return;
    const listing = duplicateListing;
    setDuplicateListing(null);

    const photoCount = listing.photos?.length ?? 0;
    const totalSteps = (copyPhotos ? photoCount : 0) + 1 + (asDraft ? 0 : 1);

    setProgress({
      title: "Duplicating Listing",
      total: 1,
      completed: 0,
      failed: 0,
      currentTitle: listing.title,
      currentAction: "Fetching listing detail…",
      done: false,
      itemStep: 1,
      itemStepTotal: totalSteps,
    });

    const cleanup = window.api.onListingCreationProgress(({ step, current }) => {
      setProgress((p) => (p ? { ...p, itemStep: current, itemStepTotal: totalSteps, currentAction: step + "…" } : p));
    });

    try {
      const itemData = await buildItemFromListing(listing, undefined);
      if (!copyPhotos) {
        itemData.photos = [];
      }
      delete itemData.id;

      setProgress((p) => (p ? { ...p, currentAction: asDraft ? "Creating draft listing…" : "Creating listing…" } : p));
      await window.api.createListing(itemData, { asDraft });

      setProgress((p) => (p ? { ...p, completed: 1, done: true, currentAction: "Done" } : p));
      addToast(`Duplicated "${listing.title}"`, "success");
      refreshListings().catch(() => {});
    } catch (err) {
      setProgress((p) => (p ? { ...p, failed: 1, done: true, currentAction: `Failed: ${(err as Error).message}` } : p));
    } finally {
      cleanup();
    }
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
      const result = await window.api.createListing({ ...item, price: priceNum }, { asDraft: true });
      const draftId = (result as Record<string, unknown>).item
        ? (((result as Record<string, unknown>).item as Record<string, unknown>).id as number)
        : 0;

      setProgress((p) => (p ? { ...p, currentAction: "Deleting old listing…", itemStep: 2 } : p));
      await window.api.deleteListing(listing.id, listing.status.toLowerCase() === "draft");

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

  // ─── Bulk repost ─────────────────────────────────────────────────

  /** Shared boilerplate for bulk listing actions: filter, load settings, run, refresh, clear. */
  const runListingBulk = async (
    title: string,
    selected: Set<number>,
    filtered: VintedListing[],
    options: {
      filterPredicate?: (listing: VintedListing) => boolean;
      emptyMessage?: string;
      action: Parameters<typeof runBulkOperation<VintedListing>>[0]["action"];
      onComplete?: () => void;
      // Override the default min/max intervals from settings.
      minIntervalMs?: number;
      maxIntervalMs?: number;
    },
  ) => {
    let listings = filtered.filter((l) => selected.has(l.id));
    if (options.filterPredicate) listings = listings.filter(options.filterPredicate);

    if (listings.length === 0) {
      if (options.emptyMessage) addToast(options.emptyMessage, "error");
      return;
    }

    let minMs = options.minIntervalMs;
    let maxMs = options.maxIntervalMs;
    if (minMs == null || maxMs == null) {
      const settings = await window.api.getSettings();
      minMs = (settings.bulkRepost?.minIntervalSeconds ?? 30) * 1000;
      maxMs = (settings.bulkRepost?.maxIntervalSeconds ?? 60) * 1000;
    }

    cancelledRef.current = false;

    await runBulkOperation({
      items: listings,
      title,
      cancelledRef,
      setProgress,
      minIntervalMs: minMs,
      maxIntervalMs: maxMs,
      action: options.action,
      onComplete: () => {
        options.onComplete?.();
        clearSelection();
      },
    });
  };

  const handleBulkRepost = async (bulkRepostAsDraft: boolean, selected: Set<number>, filtered: VintedListing[]) =>
    runListingBulk(`Reposting ${filtered.filter((l) => selected.has(l.id) && isSavedAsItem(l)).length} listing(s)`, selected, filtered, {
      filterPredicate: isSavedAsItem,
      emptyMessage: "No selected listings have saved items — save them as items first",
      action: async (listing, updateAction, updateItemStep) => {
        const item = findExistingItem(listing);
        const photoCount = item!.photos?.length ?? 0;
        const totalSteps = photoCount + 1 + 1 + (bulkRepostAsDraft ? 0 : 1);

        const cleanup = window.api.onListingCreationProgress(({ step, current }) => {
          updateItemStep(current, totalSteps);
          updateAction(step + "…");
        });

        updateItemStep(1, totalSteps);
        updateAction("Creating draft listing…");
        let result: Record<string, unknown>;
        try {
          result = await window.api.createListing({ ...item!, price: item!.price }, { asDraft: true });
        } finally {
          cleanup();
        }
        const draftId = result.item ? ((result.item as Record<string, unknown>).id as number) : 0;

        updateItemStep(photoCount + 2, totalSteps);
        updateAction("Deleting old listing…");
        await window.api.deleteListing(listing.id, listing.status.toLowerCase() === "draft");

        if (!bulkRepostAsDraft && draftId) {
          updateItemStep(totalSteps, totalSteps);
          updateAction("Publishing draft…");
          await window.api.publishListing(draftId);
        }

        patchListingMap(listing.title, null);
      },
      onComplete: () => {
        refreshListings().catch(() => {});
      },
    });

  const handleBulkPublish = async (selected: Set<number>, filtered: VintedListing[]) =>
    runListingBulk(
      `Publishing ${filtered.filter((l) => selected.has(l.id) && l.status.toLowerCase() === "draft").length} draft(s)`,
      selected,
      filtered,
      {
        filterPredicate: (l) => l.status.toLowerCase() === "draft",
        emptyMessage: "No draft listings selected",
        action: async (listing, updateAction) => {
          updateAction("Publishing draft…");
          await window.api.publishListing(listing.id);
          patchListingMap(listing.title, { status: "Active", id: listing.id });
        },
        onComplete: () => {
          refreshListings().catch(() => {});
        },
      },
    );

  const handleBulkDelete = async (selected: Set<number>, filtered: VintedListing[]) =>
    runListingBulk(`Deleting ${filtered.filter((l) => selected.has(l.id)).length} listing(s)`, selected, filtered, {
      action: async (listing, updateAction) => {
        updateAction("Deleting listing…");
        await window.api.deleteListing(listing.id, listing.status.toLowerCase() === "draft");
        patchListingMap(listing.title, null);
      },
      onComplete: () => {
        refreshListings().catch(() => {});
      },
    });

  const handleBulkSave = async (selected: Set<number>, filtered: VintedListing[]) =>
    runListingBulk(`Saving ${filtered.filter((l) => selected.has(l.id)).length} listing(s) as items`, selected, filtered, {
      minIntervalMs: 0,
      maxIntervalMs: 0,
      action: async (listing, updateAction) => {
        updateAction("Fetching detail…");
        await saveListingAsItem(listing);
      },
      onComplete: () => {
        refreshSavedItems();
      },
    });

  const handleBulkRefresh = async (selected: Set<number>, filtered: VintedListing[]) =>
    runListingBulk(`Refreshing ${filtered.filter((l) => selected.has(l.id)).length} listing(s)`, selected, filtered, {
      minIntervalMs: 500,
      maxIntervalMs: 1500,
      action: async (listing, updateAction) => {
        updateAction("Refreshing…");
        await refreshSingleListing(listing.id);
      },
    });

  return {
    publishingId,
    refreshingId,
    confirmDeleteListing,
    repostListing,
    showBulkRepostConfig,
    progress,
    duplicateListing,
    setConfirmDeleteListing,
    setRepostListing,
    setShowBulkRepostConfig,
    setProgress,
    setDuplicateListing,
    isSavedAsItem,
    handleDelete,
    confirmDelete,
    handleSaveAsItem,
    handlePublishDraft,
    handleRefreshListing,
    openRepostModal,
    handleRepost,
    handleDuplicateListing,
    handleBulkRepost,
    handleBulkPublish,
    handleBulkDelete,
    handleBulkSave,
    handleBulkRefresh,
    cancelledRef,
  };
}
