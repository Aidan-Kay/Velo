import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Pagination, VintedListing } from "../../../shared/types";

/** Priority: Active > Draft > everything else. Higher = better. */
const LISTING_STATUS_PRIORITY: Record<string, number> = {
  Active: 3,
  Draft: 2,
  Hidden: 1,
};

/**
 * Build a map of title → best listing entry.
 * When multiple listings share the same title (e.g. Active + Sold),
 * the entry with the highest priority wins.
 */
export function buildListingMap(listings: { title: string; status: string; id: number }[]): Map<string, { status: string; id: number }> {
  const map = new Map<string, { status: string; id: number }>();
  for (const l of listings) {
    const key = l.title.toLowerCase().trim();
    const existing = map.get(key);
    const newPriority = LISTING_STATUS_PRIORITY[l.status] ?? 0;
    const existingPriority = existing ? (LISTING_STATUS_PRIORITY[existing.status] ?? 0) : -1;
    if (newPriority > existingPriority) {
      map.set(key, { status: l.status, id: l.id });
    }
  }
  return map;
}

// ─── Context types ────────────────────────────────────────────────────────────

interface ListingSyncState {
  /** Raw listing array from Vinted. */
  listings: VintedListing[];
  /** Pagination metadata. */
  pagination: Pagination;
  /** Title→status lookup built from listings (best-status-wins). */
  listingMap: Map<string, { status: string; id: number }>;
  /** Whether a refresh is in progress. */
  refreshing: boolean;
  /** Force-refresh listings from the Vinted API. Call after any listing mutation. */
  refreshListings: () => Promise<void>;
  /** Refresh a single listing by its ID. */
  refreshSingleListing: (listingId: number) => Promise<void>;
  /** Optimistically patch the listing map (instant UI feedback). */
  patchListingMap: (title: string, entry: { status: string; id: number } | null) => void;
}

const ListingSyncContext = createContext<ListingSyncState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ListingSyncProviderProps {
  loggedIn: boolean;
  children: React.ReactNode;
}

export const ListingSyncProvider: React.FC<ListingSyncProviderProps> = ({ loggedIn, children }) => {
  const [listings, setListings] = useState<VintedListing[]>([]);
  const [pagination, setPagination] = useState<Pagination>({});
  const [refreshing, setRefreshing] = useState(false);

  const listingMap = useMemo(() => buildListingMap(listings), [listings]);

  // Load cached listings on mount (no API call)
  useEffect(() => {
    if (!loggedIn) return;
    window.api.getMyListings().then((result) => {
      setListings(result.items);
      setPagination(result.pagination);
    });
  }, [loggedIn]);

  // Listen for background polling updates
  useEffect(() => {
    window.api.onListingsUpdated((data) => {
      setListings(data.items);
      setPagination(data.pagination);
    });
  }, []);

  // Force-refresh (triggers API call via polling manager)
  const refreshListings = useCallback(async () => {
    if (!loggedIn) return;
    setRefreshing(true);
    try {
      const result = await window.api.refreshMyListings();
      setListings(result.items);
      setPagination(result.pagination);
    } finally {
      setRefreshing(false);
    }
  }, [loggedIn]);

  // Refresh a single listing via the IPC bridge
  const refreshSingleListing = useCallback(
    async (listingId: number) => {
      if (!loggedIn) return;
      try {
        const updated = await window.api.refreshSingleListing(listingId);
        if (updated) {
          setListings((prev) => {
            const idx = prev.findIndex((l) => l.id === listingId);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = updated;
              return copy;
            }
            return [updated, ...prev];
          });
        }
      } catch (err) {
        console.error(`Failed to refresh listing ${listingId}:`, err);
      }
    },
    [loggedIn],
  );

  // Optimistically patch the listing map for instant UI feedback
  const patchListingMap = useCallback((title: string, entry: { status: string; id: number } | null) => {
    setListings((prev) => {
      // We manipulate the raw listings array so the map rebuilds correctly.
      const key = title.toLowerCase().trim();
      if (entry === null) {
        // Remove all listings with this title
        return prev.filter((l) => l.title.toLowerCase().trim() !== key);
      }
      // Find an existing listing with this title and update it, or add a stub
      const idx = prev.findIndex((l) => l.title.toLowerCase().trim() === key && l.id === entry.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], status: entry.status };
        return copy;
      }
      // No exact match — update the best match by title, or add a minimal stub
      const titleIdx = prev.findIndex((l) => l.title.toLowerCase().trim() === key);
      if (titleIdx >= 0) {
        const copy = [...prev];
        copy[titleIdx] = { ...copy[titleIdx], status: entry.status, id: entry.id };
        return copy;
      }
      // Add a minimal stub so the listingMap picks it up
      return [
        ...prev,
        {
          id: entry.id,
          title,
          description: "",
          price: null,
          priceNumeric: null,
          currency: "",
          thumbnail: null,
          photos: [],
          views: 0,
          favourites: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: entry.status,
          statusRaw: 0,
          url: "",
          brandTitle: "",
          sizeTitle: "",
          categoryId: null,
          color1: "",
          color2: "",
        },
      ];
    });
  }, []);

  const value = useMemo<ListingSyncState>(
    () => ({ listings, pagination, listingMap, refreshing, refreshListings, refreshSingleListing, patchListingMap }),
    [listings, pagination, listingMap, refreshing, refreshListings, refreshSingleListing, patchListingMap],
  );

  return <ListingSyncContext.Provider value={value}>{children}</ListingSyncContext.Provider>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useListingSync(): ListingSyncState {
  const ctx = useContext(ListingSyncContext);
  if (!ctx) throw new Error("useListingSync must be used within a ListingSyncProvider");
  return ctx;
}
