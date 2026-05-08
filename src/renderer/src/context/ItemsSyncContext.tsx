import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LocalItem } from "../../../shared/types";

interface ItemsSyncState {
  items: LocalItem[];
  loading: boolean;
  refreshItems: () => Promise<void>;
  /** Update a single item in state (after save). */
  upsertItem: (item: LocalItem) => void;
  /** Remove an item from state (after delete). */
  removeItem: (id: string) => void;
  /** Replace full items array (for initial load / bulk ops). */
  setItems: React.Dispatch<React.SetStateAction<LocalItem[]>>;
}

const ItemsSyncContext = createContext<ItemsSyncState | null>(null);

interface ItemsSyncProviderProps {
  children: React.ReactNode;
}

export const ItemsSyncProvider: React.FC<ItemsSyncProviderProps> = ({ children }) => {
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.getItems();
      setItems(result);
    } finally {
      setLoading(false);
    }
  }, []);

  const upsertItem = useCallback((item: LocalItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = item;
        return copy;
      }
      return [item, ...prev];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // Load items on mount
  useEffect(() => {
    refreshItems();
  }, [refreshItems]);

  const value = useMemo<ItemsSyncState>(
    () => ({ items, loading, refreshItems, upsertItem, removeItem, setItems }),
    [items, loading, refreshItems, upsertItem, removeItem],
  );

  return <ItemsSyncContext.Provider value={value}>{children}</ItemsSyncContext.Provider>;
};

export function useItemsSync(): ItemsSyncState {
  const ctx = useContext(ItemsSyncContext);
  if (!ctx) throw new Error("useItemsSync must be used within an ItemsSyncProvider");
  return ctx;
}
