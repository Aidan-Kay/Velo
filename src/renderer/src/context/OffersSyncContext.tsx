import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { OfferDelta, ReceivedOffer } from "../../../shared/types";

// ─── Context types ────────────────────────────────────────────────────────────

interface OffersSyncState {
  offers: ReceivedOffer[];
  refreshing: boolean;
  refreshOffers: () => Promise<void>;
  acceptOffer: (transactionId: number, offerRequestId: number) => Promise<void>;
  counterOffer: (transactionId: number, price: number, currency: string) => Promise<void>;
  ignoreOffer: (offerRequestId: number) => Promise<void>;
  unignoreOffer: (offerRequestId: number) => Promise<void>;
  updateOfferBundleItems: (offerId: number, bundleItems: Array<{ title: string; thumbnail: string | null }>) => void;
}

const OffersSyncContext = createContext<OffersSyncState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface OffersSyncProviderProps {
  loggedIn: boolean;
  children: React.ReactNode;
}

export const OffersSyncProvider: React.FC<OffersSyncProviderProps> = ({ loggedIn, children }) => {
  const [offers, setOffers] = useState<ReceivedOffer[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Load cached offers on mount
  useEffect(() => {
    if (!loggedIn) return;
    window.api.getReceivedOffers().then((result) => {
      setOffers(result.offers);
    });
  }, [loggedIn]);

  // Listen for background polling delta updates
  useEffect(() => {
    const cleanup = window.api.onOffersDelta((delta: OfferDelta) => {
      setOffers((prev) => {
        let next = delta.removedIds.length > 0 ? prev.filter((o) => !delta.removedIds.includes(o.id)) : prev;
        if (delta.upserted.length > 0) {
          next = [...next];
          for (const offer of delta.upserted) {
            const idx = next.findIndex((o) => o.id === offer.id);
            if (idx >= 0) {
              next[idx] = offer;
            } else {
              next.unshift(offer);
            }
          }
        }
        return next;
      });
    });
    return cleanup;
  }, []);

  // Listen for auto-accepted offers
  useEffect(() => {
    const cleanup = window.api.onOfferAutoAccepted((offer: ReceivedOffer) => {
      setOffers((prev) => {
        const idx = prev.findIndex((o) => o.id === offer.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = offer;
          return copy;
        }
        return [offer, ...prev];
      });
    });
    return cleanup;
  }, []);

  const refreshOffers = useCallback(async () => {
    if (!loggedIn) return;
    setRefreshing(true);
    try {
      await window.api.refreshReceivedOffers();
      // Data comes via delta IPC; also re-fetch the full list
      const result = await window.api.getReceivedOffers();
      setOffers(result.offers);
    } finally {
      setRefreshing(false);
    }
  }, [loggedIn]);

  const handleAcceptOffer = useCallback(async (transactionId: number, offerRequestId: number) => {
    await window.api.acceptOffer(transactionId, offerRequestId);
    setOffers((prev) => prev.map((o) => (o.offerRequestId === offerRequestId ? { ...o, status: "accepted" as const } : o)));
  }, []);

  const handleCounterOffer = useCallback(async (transactionId: number, price: number, currency: string) => {
    await window.api.counterOffer(transactionId, price, currency);
    setOffers((prev) => prev.map((o) => (o.transactionId === transactionId ? { ...o, status: "countered" as const } : o)));
  }, []);

  const handleIgnoreOffer = useCallback(async (offerRequestId: number) => {
    await window.api.ignoreOffer(offerRequestId);
    setOffers((prev) => prev.map((o) => (o.offerRequestId === offerRequestId ? { ...o, status: "ignored" as const } : o)));
  }, []);

  const handleUnignoreOffer = useCallback(async (offerRequestId: number) => {
    await window.api.unignoreOffer(offerRequestId);
    setOffers((prev) => prev.map((o) => (o.offerRequestId === offerRequestId ? { ...o, status: "pending" as const } : o)));
  }, []);

  const updateOfferBundleItems = useCallback((offerId: number, bundleItems: Array<{ title: string; thumbnail: string | null }>) => {
    setOffers((prev) => prev.map((o) => (o.id === offerId ? { ...o, bundleItems } : o)));
  }, []);

  const value = useMemo<OffersSyncState>(
    () => ({
      offers,
      refreshing,
      refreshOffers,
      acceptOffer: handleAcceptOffer,
      counterOffer: handleCounterOffer,
      ignoreOffer: handleIgnoreOffer,
      unignoreOffer: handleUnignoreOffer,
      updateOfferBundleItems,
    }),
    [
      offers,
      refreshing,
      refreshOffers,
      handleAcceptOffer,
      handleCounterOffer,
      handleIgnoreOffer,
      handleUnignoreOffer,
      updateOfferBundleItems,
    ],
  );

  return <OffersSyncContext.Provider value={value}>{children}</OffersSyncContext.Provider>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOffersSync(): OffersSyncState {
  const ctx = useContext(OffersSyncContext);
  if (!ctx) throw new Error("useOffersSync must be used within an OffersSyncProvider");
  return ctx;
}
