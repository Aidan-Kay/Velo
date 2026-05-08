import {
  ArrowUpTrayIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { Input } from "@shared/components/ui/input";
import { Switch } from "@shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@shared/components/ui/table";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalItem } from "../../../shared/types";
import { Badge } from "../components/Badge";
import { BulkEditItemsModal, type BulkEditUpdates } from "../components/BulkEditItemsModal";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import EditItemModal from "../components/EditItemModal";
import type { FilterOption } from "../components/FilterBar";
import FilterBar from "../components/FilterBar";
import { ProgressModal, type ProgressState } from "../components/ProgressModal";
import { SortArrow } from "../components/SortArrow";
import { useItemsSync } from "../context/ItemsSyncContext";
import { useListingSync } from "../context/ListingSyncContext";
import { useToast } from "../context/ToastContext";
import { runBulkOperation } from "../hooks/useBulkOperation";
import { useGlobalRefresh } from "../hooks/useGlobalRefresh";
import { useTableSort } from "../hooks/useTableSort";

interface ItemsProps {
  loggedIn: boolean;
}

type SortColumn = "title" | "description" | "price" | "stock" | "status";

/** Derive listing status for a local item from the shared listing map. */
function getListingStatus(item: LocalItem, listingMap: Map<string, { status: string; id: number }>): "active" | "draft" | "not_listed" {
  const titleKey = item.title.toLowerCase().trim();
  const entry = listingMap.get(titleKey);
  if (entry) {
    if (entry.status === "Draft") return "draft";
    if (entry.status === "Sold" || entry.status === "Reserved") return "not_listed";
    return "active";
  }
  return "not_listed";
}

// Isolated input so local value state is separate from the persisted item.stock,
// allowing the onBlur comparison to correctly detect user-made changes.

const STOCK_OPTIONS = [
  { value: "in_stock", label: "In stock" },
  { value: "out_of_stock", label: "Out of stock" },
];

const StockFilterDropdown: React.FC<{
  stockFilter: string[];
  onStockFilterChange: (value: string[]) => void;
}> = ({ stockFilter, onStockFilterChange }) => {
  const allSelected = stockFilter.length === 0 || stockFilter.length === STOCK_OPTIONS.length;

  const toggle = (v: string) => {
    if (stockFilter.includes(v)) {
      const next = stockFilter.filter((x) => x !== v);
      onStockFilterChange(next);
    } else {
      const next = [...stockFilter, v];
      onStockFilterChange(next.length === STOCK_OPTIONS.length ? [] : next);
    }
  };

  const label = allSelected
    ? "All stock"
    : stockFilter.length === 1
      ? (STOCK_OPTIONS.find((o) => o.value === stockFilter[0])?.label ?? stockFilter[0])
      : `${stockFilter.length} selected`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="w-36 justify-between" />}>
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-36">
        <DropdownMenuCheckboxItem checked={allSelected} onCheckedChange={() => onStockFilterChange([])}>
          All stock
        </DropdownMenuCheckboxItem>
        {STOCK_OPTIONS.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={allSelected || stockFilter.includes(opt.value)}
            onCheckedChange={() => toggle(opt.value)}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const TagFilterDropdown: React.FC<{
  allTags: string[];
  tagFilter: string[];
  onTagFilterChange: (value: string[]) => void;
}> = ({ allTags, tagFilter, onTagFilterChange }) => {
  const allSelected = tagFilter.length === 0;

  const toggle = (tag: string) => {
    if (tagFilter.includes(tag)) {
      onTagFilterChange(tagFilter.filter((t) => t !== tag));
    } else {
      onTagFilterChange([...tagFilter, tag]);
    }
  };

  const label = allSelected ? "All tags" : tagFilter.length === 1 ? tagFilter[0] : `${tagFilter.length} tags`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="w-36 justify-between" disabled={allTags.length === 0} />}>
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44 max-h-72 overflow-auto">
        <DropdownMenuCheckboxItem checked={allSelected} onCheckedChange={() => onTagFilterChange([])}>
          All tags
        </DropdownMenuCheckboxItem>
        {allTags.map((tag) => (
          <DropdownMenuCheckboxItem key={tag} checked={tagFilter.includes(tag)} onCheckedChange={() => toggle(tag)}>
            {tag}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const StockInput: React.FC<{ item: LocalItem; onSave: (newStock: number) => void }> = ({ item, onSave }) => {
  const [value, setValue] = useState(item.stock);
  useEffect(() => {
    setValue(item.stock);
  }, [item.stock]);
  return (
    <Input
      type="number"
      min="0"
      className="w-16 text-center text-xs py-1"
      value={value}
      onChange={(e) => setValue(parseInt(e.target.value, 10) || 0)}
      onWheel={(e) => e.currentTarget.blur()}
      onBlur={() => {
        if (value !== item.stock) onSave(value);
      }}
    />
  );
};

// ─── Memoized Item Row ───────────────────────────────────────────────────────

interface ItemRowProps {
  item: LocalItem;
  itemStatus: "active" | "draft" | "not_listed";
  isSelected: boolean;
  isListing: boolean;
  isPublishing: boolean;
  loggedIn: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (item: LocalItem) => void;
  onDelete: (item: LocalItem) => void;
  onListItem: (item: LocalItem, asDraft?: boolean) => void;
  onPublishDraft: (item: LocalItem) => void;
  onQuickStockUpdate: (item: LocalItem, newStock: number) => void;
  onToggleRelisting: (item: LocalItem, enabled: boolean) => void;
}

const ItemRow = React.memo<ItemRowProps>(
  ({
    item,
    itemStatus,
    isSelected,
    isListing,
    isPublishing,
    loggedIn,
    onToggleSelect,
    onEdit,
    onDelete,
    onListItem,
    onPublishDraft,
    onQuickStockUpdate,
    onToggleRelisting,
  }) => {
    const listed = itemStatus !== "not_listed";
    return (
      <TableRow>
        {/* Checkbox */}
        <TableCell>
          <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(item.id)} />
        </TableCell>

        {/* Item (thumbnail + title) */}
        <TableCell className="max-w-0">
          <div className="flex items-center gap-3">
            {item.photos.length > 0 && (
              <div className="w-10 h-10 rounded bg-muted overflow-hidden flex-shrink-0">
                <img src={item.photos[0]} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{item.title}</div>
              {(item.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(item.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className="inline-block rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TableCell>

        {/* Description */}
        <TableCell className="text-muted-foreground text-xs">
          <span className="truncate block max-w-[300px]">{item.description || "—"}</span>
        </TableCell>

        {/* Price */}
        <TableCell className="font-medium whitespace-nowrap">
          {item.price} {item.currency}
        </TableCell>

        {/* Relist toggle */}
        <TableCell>
          <Switch checked={item.relistingEnabled !== false} onCheckedChange={(checked) => onToggleRelisting(item, checked)} />
        </TableCell>

        {/* Stock (inline editable) */}
        <TableCell>
          <StockInput item={item} onSave={(newStock) => onQuickStockUpdate(item, newStock)} />
        </TableCell>

        {/* Status */}
        <TableCell>
          {itemStatus === "active" && <Badge variant="active">Active</Badge>}
          {itemStatus === "draft" && <Badge variant="waiting">Draft</Badge>}
          {itemStatus === "not_listed" && <Badge variant="hidden">Not active</Badge>}
        </TableCell>

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
                {!listed && loggedIn && item.stock > 0 && (
                  <>
                    <DropdownMenuItem onClick={() => onListItem(item)} disabled={isListing}>
                      <ArrowUpTrayIcon className="w-4 h-4" />
                      {isListing ? "Listing…" : "List on Vinted"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onListItem(item, true)} disabled={isListing}>
                      <ArrowUpTrayIcon className="w-4 h-4" />
                      List as draft
                    </DropdownMenuItem>
                  </>
                )}
                {itemStatus === "draft" && loggedIn && item.stock > 0 && (
                  <DropdownMenuItem onClick={() => onPublishDraft(item)} disabled={isPublishing}>
                    <ArrowUpTrayIcon className="w-4 h-4" />
                    {isPublishing ? "Publishing…" : "Publish"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onEdit(item)}>
                  <PencilSquareIcon className="w-4 h-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(item)}>
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

const Items: React.FC<ItemsProps> = ({ loggedIn }) => {
  const { addToast } = useToast();
  const { listingMap, patchListingMap, refreshListings } = useListingSync();
  const { items, loading, upsertItem, removeItem, setItems } = useItemsSync();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<Partial<LocalItem>>({});
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkListing, setBulkListing] = useState(false);
  const [listingItem, setListingItem] = useState<string | null>(null);
  const [publishingItem, setPublishingItem] = useState<string | null>(null);
  const { sortColumn, sortDirection, handleSort } = useTableSort<SortColumn>("title");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [stockFilter, setStockFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<LocalItem | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const cancelledRef = useRef(false);

  const handleGlobalRefresh = useCallback(() => {
    refreshListings().catch(() => {});
  }, [refreshListings]);
  useGlobalRefresh("items", handleGlobalRefresh);

  const statusOptions: FilterOption[] = [
    { value: "active", label: "Active" },
    { value: "draft", label: "Draft" },
    { value: "not_listed", label: "Not active" },
  ];

  // ─── Filter & Sort ─────────────────────────────────────────────────────
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags ?? []) set.add(tag);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const result = items.filter((item) => {
      // Stock filter
      if (stockFilter.length > 0 && stockFilter.length < 2) {
        const inStock = item.stock > 0;
        if (stockFilter.includes("in_stock") && !inStock) return false;
        if (stockFilter.includes("out_of_stock") && inStock) return false;
      }
      if (statusFilter.length > 0 && !statusFilter.includes(getListingStatus(item, listingMap))) return false;
      if (tagFilter.length > 0) {
        const itemTags = item.tags ?? [];
        if (!tagFilter.every((t) => itemTags.includes(t))) return false;
      }
      if (!search) return true;
      const q = search.toLowerCase();
      const tagMatch = (item.tags ?? []).some((t) => t.toLowerCase().includes(q));
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || tagMatch;
    });

    const dir = sortDirection === "asc" ? 1 : -1;
    result.sort((a, b) => {
      switch (sortColumn) {
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "description":
          return dir * a.description.localeCompare(b.description);
        case "price":
          return dir * (a.price - b.price);
        case "stock":
          return dir * (a.stock - b.stock);
        case "status": {
          const statusOrder: Record<string, number> = { active: 2, draft: 1, not_listed: 0 };
          const aStatus = getListingStatus(a, listingMap);
          const bStatus = getListingStatus(b, listingMap);
          return dir * ((statusOrder[aStatus] ?? 0) - (statusOrder[bStatus] ?? 0));
        }
        default:
          return 0;
      }
    });

    return result;
  }, [items, search, statusFilter, stockFilter, sortColumn, sortDirection, listingMap, tagFilter]);

  // ─── CRUD ───────────────────────────────────────────────────────────────

  const openEditModal = (item: LocalItem) => {
    setEditItem({ ...item });
    setModalOpen(true);
  };

  const handleSave = async (itemData: Partial<LocalItem>) => {
    if (!itemData.title?.trim()) {
      addToast("Title is required", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await window.api.saveItem(itemData);
      upsertItem(saved);
      setModalOpen(false);
      addToast(itemData.id ? "Item updated" : "Item added", "success");
    } catch {
      addToast("Failed to save item", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item: LocalItem) => setConfirmDeleteItem(item);

  const confirmDelete = async () => {
    if (!confirmDeleteItem) return;
    const item = confirmDeleteItem;
    setConfirmDeleteItem(null);
    try {
      await window.api.deleteItem(item.id);
      removeItem(item.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      addToast("Item deleted", "success");
    } catch {
      addToast("Failed to delete item", "error");
    }
  };

  // ─── Inline stock update ──────────────────────────────────────────────
  const handleQuickStockUpdate = async (item: LocalItem, newStock: number) => {
    try {
      const saved = await window.api.saveItem({ ...item, stock: newStock });
      upsertItem(saved);
    } catch {
      addToast("Failed to update stock", "error");
    }
  };

  // ─── Toggle relisting ─────────────────────────────────────────────────
  const handleToggleRelisting = async (item: LocalItem, enabled: boolean) => {
    try {
      const saved = await window.api.saveItem({ ...item, relistingEnabled: enabled });
      upsertItem(saved);
    } catch {
      addToast("Failed to update relisting setting", "error");
    }
  };

  // ─── List individual item ──────────────────────────────────────────────
  const handleListItem = async (item: LocalItem, asDraft = false) => {
    if (!loggedIn) {
      addToast("Log in to list items", "error");
      return;
    }
    setListingItem(item.id);

    const photoCount = item.photos?.length ?? 0;
    const totalSteps = photoCount + 1 + (asDraft ? 0 : 1);

    setProgress({
      title: asDraft ? "Listing as Draft" : "Listing on Vinted",
      total: 1,
      completed: 0,
      failed: 0,
      currentTitle: item.title,
      currentAction: asDraft ? "Creating draft listing…" : "Creating listing…",
      done: false,
      itemStep: 1,
      itemStepTotal: totalSteps,
    });

    // Listen for per-photo progress from the main process
    const cleanup = window.api.onListingCreationProgress(({ step, current }) => {
      setProgress((p) => (p ? { ...p, itemStep: current, itemStepTotal: totalSteps, currentAction: step + "…" } : p));
    });

    try {
      const result = await window.api.createListing(item, { asDraft });
      const created = result as Record<string, unknown>;
      const vintedItem = (created.item || created) as Record<string, unknown>;
      const vintedId = (vintedItem.id as number) || 0;

      // Optimistic update — show the new status immediately
      patchListingMap(item.title, { status: asDraft ? "Draft" : "Active", id: vintedId });
      upsertItem({ ...item, updatedAt: new Date().toISOString() });
      setProgress((p) => (p ? { ...p, completed: 1, done: true, currentAction: asDraft ? "Listed as draft" : "Listed on Vinted" } : p));
      // Refresh so Listings page picks up the new listing
      refreshListings().catch(() => {});
    } catch (err) {
      setProgress((p) => (p ? { ...p, failed: 1, done: true, currentAction: `Failed: ${(err as Error).message}` } : p));
    } finally {
      cleanup();
      setListingItem(null);
    }
  };

  // ─── Publish draft ────────────────────────────────────────────────────
  const handlePublishDraft = async (item: LocalItem) => {
    const titleKey = item.title.toLowerCase().trim();
    const entry = listingMap.get(titleKey);
    if (!loggedIn || !entry) {
      addToast("Item must be listed as a draft first", "error");
      return;
    }
    setPublishingItem(item.id);
    addToast("Publishing draft…", "info");
    try {
      await window.api.publishListing(entry.id);

      // Optimistic update — flip Draft → Active immediately
      patchListingMap(item.title, { status: "Active", id: entry.id });

      addToast("Draft published", "success");
      // Refresh so Listings page picks up the status change
      refreshListings().catch(() => {});
    } catch {
      addToast("Failed to publish draft", "error");
    } finally {
      setPublishingItem(null);
    }
  };

  // ─── Selection / bulk list ──────────────────────────────────────────────
  const toggleSelect = (id: string) => {
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
      setSelected(new Set(filtered.map((item) => item.id)));
    }
  };

  const handleBulkList = async (asDraft = false) => {
    if (!loggedIn) {
      addToast("Log in to list items", "error");
      return;
    }
    if (selected.size === 0) return;

    const selectedItems = filtered.filter((i) => selected.has(i.id));
    if (selectedItems.length === 0) return;

    const settings = await window.api.getSettings();
    const minMs = (settings.bulkRepost?.minIntervalSeconds ?? 30) * 1000;
    const maxMs = (settings.bulkRepost?.maxIntervalSeconds ?? 60) * 1000;

    cancelledRef.current = false;
    setBulkListing(true);

    await runBulkOperation({
      items: selectedItems,
      title: `Listing ${selectedItems.length} item(s)${asDraft ? " as draft" : ""}`,
      cancelledRef,
      setProgress,
      minIntervalMs: minMs,
      maxIntervalMs: maxMs,
      action: async (item, updateAction, updateItemStep) => {
        const photoCount = item.photos?.length ?? 0;
        const totalSteps = photoCount + 1 + (asDraft ? 0 : 1);

        // Listen for per-photo progress from the main process
        const cleanup = window.api.onListingCreationProgress(({ step, current }) => {
          updateItemStep(current, totalSteps);
          updateAction(step + "…");
        });

        updateItemStep(1, totalSteps);
        updateAction(asDraft ? "Listing as draft…" : "Listing on Vinted…");
        try {
          const result = await window.api.createListing(item, { asDraft });
          const created = result as Record<string, unknown>;
          const vintedItem = (created.item || created) as Record<string, unknown>;
          const vintedId = (vintedItem.id as number) || 0;
          patchListingMap(item.title, { status: asDraft ? "Draft" : "Active", id: vintedId });
          upsertItem({ ...item, updatedAt: new Date().toISOString() });
        } finally {
          cleanup();
        }
      },
      onComplete: () => {
        refreshListings().catch(() => {});
        setSelected(new Set());
      },
    });

    setBulkListing(false);
  };

  // ─── Bulk edit ──────────────────────────────────────────────────────
  const handleBulkEdit = async (updates: BulkEditUpdates) => {
    setShowBulkEdit(false);
    const selectedItems = filtered.filter((i) => selected.has(i.id));
    if (selectedItems.length === 0) return;

    let successCount = 0;
    for (const item of selectedItems) {
      const patch: Partial<LocalItem> = { ...item };
      if (updates.price !== undefined) patch.price = updates.price;
      if (updates.stock !== undefined) patch.stock = updates.stock;
      if (updates.autoAcceptOfferPercent !== undefined) patch.autoAcceptOfferPercent = updates.autoAcceptOfferPercent;
      if (updates.tagsMode && updates.tags) {
        const existing = item.tags ?? [];
        const incoming = updates.tags;
        if (updates.tagsMode === "replace") {
          patch.tags = Array.from(new Set(incoming));
        } else if (updates.tagsMode === "add") {
          const merged = [...existing];
          for (const t of incoming) {
            if (!merged.some((e) => e.toLowerCase() === t.toLowerCase())) merged.push(t);
          }
          patch.tags = merged;
        } else if (updates.tagsMode === "remove") {
          const lower = new Set(incoming.map((t) => t.toLowerCase()));
          patch.tags = existing.filter((t) => !lower.has(t.toLowerCase()));
        }
      }

      try {
        const saved = await window.api.saveItem(patch);
        upsertItem(saved);
        successCount++;
      } catch {
        addToast(`Failed to update "${item.title}"`, "error");
      }
    }

    if (successCount > 0) {
      addToast(`Updated ${successCount} item(s)`, "success");
    }
  };

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

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 h-full">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusOptions={statusOptions}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
        statusAllLabel="All statuses"
        actions={
          <div className="flex items-center gap-3">
            <StockFilterDropdown stockFilter={stockFilter} onStockFilterChange={setStockFilter} />
            <TagFilterDropdown allTags={allTags} tagFilter={tagFilter} onTagFilterChange={setTagFilter} />
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button variant="outline" disabled={bulkListing || !loggedIn}>
                      Bulk Actions
                      <ChevronDownIcon className="w-4 h-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleBulkList(false)} disabled={bulkListing || !loggedIn}>
                      <ArrowUpTrayIcon className="w-4 h-4" />
                      Bulk List
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkList(true)} disabled={bulkListing || !loggedIn}>
                      <DocumentDuplicateIcon className="w-4 h-4" />
                      List as Draft
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowBulkEdit(true)}>
                      <PencilSquareIcon className="w-4 h-4" />
                      Bulk Edit
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        }
      />

      {loading && items.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {items.length === 0 ? "No items yet — add one to get started" : "No matching items"}
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
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("description")}>
                    Description
                    <SortArrow column="description" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("price")}>
                    Price
                    <SortArrow column="price" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead>Relist</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("stock")}>
                    Stock
                    <SortArrow column="stock" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                    Listing Status
                    <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {virtualItems.length > 0 && virtualItems[0].start > 0 && <tr style={{ height: virtualItems[0].start }} />}
                {virtualItems.map((vRow) => {
                  const item = filtered[vRow.index];
                  const itemStatus = getListingStatus(item, listingMap);
                  return (
                    <ItemRow
                      key={item.id}
                      item={item}
                      itemStatus={itemStatus}
                      isSelected={selected.has(item.id)}
                      isListing={listingItem === item.id}
                      isPublishing={publishingItem === item.id}
                      loggedIn={loggedIn}
                      onToggleSelect={toggleSelect}
                      onEdit={openEditModal}
                      onDelete={handleDelete}
                      onListItem={handleListItem}
                      onPublishDraft={handlePublishDraft}
                      onQuickStockUpdate={handleQuickStockUpdate}
                      onToggleRelisting={handleToggleRelisting}
                    />
                  );
                })}
                {virtualItems.length > 0 && (
                  <tr style={{ height: virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end }} />
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* ─── Add / Edit Modal ────────────────────────────────────────────── */}
      <EditItemModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editItem={editItem}
        onSave={handleSave}
        saving={saving}
        addToast={addToast}
      />

      {confirmDeleteItem && (
        <DeleteConfirmModal
          title="Delete Item"
          itemName={confirmDeleteItem.title}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteItem(null)}
        />
      )}

      {showBulkEdit && (
        <BulkEditItemsModal selectedCount={selected.size} onConfirm={handleBulkEdit} onCancel={() => setShowBulkEdit(false)} />
      )}

      {progress && <ProgressModal progress={progress} onClose={() => setProgress(null)} />}
    </div>
  );
};

export default React.memo(Items);
