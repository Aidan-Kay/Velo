import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Order, OrderDelta } from "../../../shared/types";

// ─── Context types ────────────────────────────────────────────────────────────

interface OrdersSyncState {
  /** Raw orders array from Vinted. */
  orders: Order[];
  /** Whether a refresh is in progress. */
  refreshing: boolean;
  /** Force-refresh orders from the Vinted API. */
  refreshOrders: () => Promise<void>;
  /** Refresh a single order by transaction ID. */
  refreshSingleOrder: (transactionId: number) => Promise<void>;
  /** Directly update the orders array (e.g. after a local mutation). */
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
}

const OrdersSyncContext = createContext<OrdersSyncState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface OrdersSyncProviderProps {
  loggedIn: boolean;
  children: React.ReactNode;
}

export const OrdersSyncProvider: React.FC<OrdersSyncProviderProps> = ({ loggedIn, children }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Load cached orders on mount (no API call)
  useEffect(() => {
    if (!loggedIn) return;
    window.api.getMyOrders().then((result) => {
      setOrders(result.orders);
    });
  }, [loggedIn]);

  // Listen for background polling delta updates
  useEffect(() => {
    const cleanup = window.api.onOrdersDelta((delta: OrderDelta) => {
      setOrders((prev) => {
        // Remove orders that no longer exist
        let next = delta.removedIds.length > 0 ? prev.filter((o) => !o.transactionId || !delta.removedIds.includes(o.transactionId)) : prev;
        // Upsert changed/new orders
        if (delta.upserted.length > 0) {
          next = [...next];
          for (const order of delta.upserted) {
            const idx = next.findIndex((o) => o.transactionId === order.transactionId);
            if (idx >= 0) {
              next[idx] = order;
            } else {
              next.unshift(order);
            }
          }
        }
        return next;
      });
    });
    return cleanup;
  }, []);

  // Force-refresh (triggers API call via polling manager)
  const refreshOrders = useCallback(async () => {
    if (!loggedIn) return;
    setRefreshing(true);
    try {
      const result = await window.api.refreshMyOrders();
      setOrders(result.orders);
    } finally {
      setRefreshing(false);
    }
  }, [loggedIn]);

  // Refresh a single order via the IPC bridge
  const refreshSingleOrder = useCallback(
    async (transactionId: number) => {
      if (!loggedIn) return;
      try {
        const updated = await window.api.refreshSingleOrder(transactionId);
        if (updated) {
          setOrders((prev) => {
            const idx = prev.findIndex((o) => o.transactionId === transactionId);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = updated;
              return copy;
            }
            return prev;
          });
        }
      } catch (err) {
        console.error(`Failed to refresh order ${transactionId}:`, err);
      }
    },
    [loggedIn],
  );

  const value = useMemo<OrdersSyncState>(
    () => ({ orders, refreshing, refreshOrders, refreshSingleOrder, setOrders }),
    [orders, refreshing, refreshOrders, refreshSingleOrder],
  );

  return <OrdersSyncContext.Provider value={value}>{children}</OrdersSyncContext.Provider>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrdersSync(): OrdersSyncState {
  const ctx = useContext(OrdersSyncContext);
  if (!ctx) throw new Error("useOrdersSync must be used within an OrdersSyncProvider");
  return ctx;
}
