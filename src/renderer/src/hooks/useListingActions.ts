import { useCallback, useRef, useState } from "react";
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

  // State setters (for modals/UI)
  setConfirmDeleteListing: React.Dispatch<React.SetStateAction<VintedListing | null>>;
  setRepostListing: React.Dispatch<React.SetStateAction<VintedListing | null>>;
  setShowBulkRepostConfig: React.Dispatch<React.SetStateAction<boolean>>;
  setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>;

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

  // Bulk actions
  handleBulkRepost: (asDraft: boolean, selected: Set<number>, filtered: VintedListing[]) => Promise<void>;
  handleBulkPublish: (selected: Set<number>, filtered: VintedListing[]) => Promise<void>;
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

  // Bulk repost config modal
  const [showBulkRepostConfig, setShowBulkRepostConfig] = useState(false);

  // Progress modal
  const [progress, setProgress] = useState<ProgressState | null>(null);

  // Cancellation ref
  const cancelledRef = useRef(false);

  // ─── Helpers ─────────────────────────────────────────────────────────

  const isSavedAsItem = useCallback(
    (listing: VintedListing): boolean => savedItems.some((item) => item.title.toLowerCase().trim() === listing.title.toLowerCase().trim()),
    [savedItems],
  );

  const findExistingItem = useCallback(
    (listing: VintedListing): LocalItem | undefined =>
      savedItems.find((item) => item.title.toLowerCase().trim() === listing.title.toLowerCase().trim()),
    [savedItems],
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

  const handleBulkRepost = async (bulkRepostAsDraft: boolean, selected: Set<number>, filtered: VintedListing[]) => {
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
        clearSelection();
      },
    });
  };

  // ─── Bulk publish ────────────────────────────────────────────────

  const handleBulkPublish = async (selected: Set<number>, filtered: VintedListing[]) => {
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
      action: async (listing, updateAction) => {
        updateAction("Publishing draft…");
        await window.api.publishListing(listing.id);
        patchListingMap(listing.title, { status: "Active", id: listing.id });
      },
      onComplete: () => {
        refreshListings().catch(() => {});
        clearSelection();
      },
    });
  };

  // ─── Bulk save as item ───────────────────────────────────────────

  const handleBulkSave = async (selected: Set<number>, filtered: VintedListing[]) => {
    const selectedListings = filtered.filter((l) => selected.has(l.id));
    if (selectedListings.length === 0) return;

    cancelledRef.current = false;

    await runBulkOperation({
      items: selectedListings,
      title: `Saving ${selectedListings.length} listing(s) as items`,
      cancelledRef,
      setProgress,
      minIntervalMs: 0,
      maxIntervalMs: 0,
      action: async (listing, updateAction) => {
        updateAction("Fetching detail…");
        await saveListingAsItem(listing);
      },
      onComplete: () => {
        refreshSavedItems();
        clearSelection();
      },
    });
  };

  // ─── Bulk refresh ────────────────────────────────────────────────

  const handleBulkRefresh = async (selected: Set<number>, filtered: VintedListing[]) => {
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
      action: async (listing, updateAction) => {
        updateAction("Refreshing…");
        await refreshSingleListing(listing.id);
      },
      onComplete: () => {
        clearSelection();
      },
    });
  };

  return {
    publishingId,
    refreshingId,
    confirmDeleteListing,
    repostListing,
    showBulkRepostConfig,
    progress,
    setConfirmDeleteListing,
    setRepostListing,
    setShowBulkRepostConfig,
    setProgress,
    isSavedAsItem,
    handleDelete,
    confirmDelete,
    handleSaveAsItem,
    handlePublishDraft,
    handleRefreshListing,
    openRepostModal,
    handleRepost,
    handleBulkRepost,
    handleBulkPublish,
    handleBulkSave,
    handleBulkRefresh,
    cancelledRef,
  };
}
