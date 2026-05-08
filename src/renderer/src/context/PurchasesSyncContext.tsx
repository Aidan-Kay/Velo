import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Purchase, PurchaseDelta } from "../../../shared/types";

// ─── Context types ────────────────────────────────────────────────────────────

interface PurchasesSyncState {
  purchases: Purchase[];
  refreshing: boolean;
  refreshPurchases: () => Promise<void>;
  refreshSinglePurchase: (transactionId: number) => Promise<void>;
}

const PurchasesSyncContext = createContext<PurchasesSyncState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface PurchasesSyncProviderProps {
  loggedIn: boolean;
  children: React.ReactNode;
}

export const PurchasesSyncProvider: React.FC<PurchasesSyncProviderProps> = ({ loggedIn, children }) => {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Load cached purchases on mount
  useEffect(() => {
    if (!loggedIn) return;
    window.api.getMyPurchases().then((result) => {
      setPurchases(result.purchases);
    });
  }, [loggedIn]);

  // Listen for background polling delta updates
  useEffect(() => {
    const cleanup = window.api.onPurchasesDelta((delta: PurchaseDelta) => {
      setPurchases((prev) => {
        let next = delta.removedIds.length > 0 ? prev.filter((p) => !p.transactionId || !delta.removedIds.includes(p.transactionId)) : prev;
        if (delta.upserted.length > 0) {
          next = [...next];
          for (const purchase of delta.upserted) {
            const idx = next.findIndex((p) => p.transactionId === purchase.transactionId);
            if (idx >= 0) {
              next[idx] = purchase;
            } else {
              next.unshift(purchase);
            }
          }
        }
        return next;
      });
    });
    return cleanup;
  }, []);

  const refreshPurchases = useCallback(async () => {
    if (!loggedIn) return;
    setRefreshing(true);
    try {
      const result = await window.api.refreshMyPurchases();
      setPurchases(result.purchases);
    } finally {
      setRefreshing(false);
    }
  }, [loggedIn]);

  const refreshSinglePurchase = useCallback(
    async (transactionId: number) => {
      if (!loggedIn) return;
      try {
        const updated = await window.api.refreshSinglePurchase(transactionId);
        if (updated) {
          setPurchases((prev) => {
            const idx = prev.findIndex((p) => p.transactionId === transactionId);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = updated;
              return copy;
            }
            return prev;
          });
        }
      } catch (err) {
        console.error(`Failed to refresh purchase ${transactionId}:`, err);
      }
    },
    [loggedIn],
  );

  const value = useMemo<PurchasesSyncState>(
    () => ({ purchases, refreshing, refreshPurchases, refreshSinglePurchase }),
    [purchases, refreshing, refreshPurchases, refreshSinglePurchase],
  );

  return <PurchasesSyncContext.Provider value={value}>{children}</PurchasesSyncContext.Provider>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePurchasesSync(): PurchasesSyncState {
  const ctx = useContext(PurchasesSyncContext);
  if (!ctx) throw new Error("usePurchasesSync must be used within a PurchasesSyncProvider");
  return ctx;
}
