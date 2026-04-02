import { Card } from "@/components/ui/card";
import {
  ArrowUpTrayIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalItem } from "../../../shared/types";
import { Badge } from "../components/Badge";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import EditItemModal from "../components/EditItemModal";
import type { FilterOption } from "../components/FilterBar";
import FilterBar from "../components/FilterBar";
import { ProgressModal, type ProgressState } from "../components/ProgressModal";
import { SortArrow } from "../components/SortArrow";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useListingSync } from "../context/ListingSyncContext";
import { runBulkOperation } from "../hooks/useBulkOperation";
import { useTableSort } from "../hooks/useTableSort";

interface ItemsProps {
  loggedIn: boolean;
  addToast: (message: string, type?: "success" | "error" | "info") => void;
}

type SortColumn = "title" | "description" | "price" | "stock" | "status";

// Isolated input so local value state is separate from the persisted item.stock,
// allowing the onBlur comparison to correctly detect user-made changes.
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
      onBlur={() => {
        if (value !== item.stock) onSave(value);
      }}
    />
  );
};

const Items: React.FC<ItemsProps> = ({ loggedIn, addToast }) => {
  const { listingMap, patchListingMap, refreshListings } = useListingSync();
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(false);
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
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<LocalItem | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const cancelledRef = useRef(false);

  const statusOptions: FilterOption[] = [
    { value: "active", label: "Active" },
    { value: "draft", label: "Draft" },
    { value: "not_listed", label: "Not active" },
  ];

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.getItems();
      setItems(result);
    } catch {
      addToast("Failed to load items", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const getListingStatus = (item: LocalItem): "active" | "draft" | "not_listed" => {
    const titleKey = item.title.toLowerCase().trim();
    const entry = listingMap.get(titleKey);
    if (entry) {
      if (entry.status === "Draft") return "draft";
      if (entry.status === "Sold" || entry.status === "Reserved") return "not_listed";
      return "active";
    }
    return "not_listed";
  };

  // ─── Filter & Sort ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const result = items.filter((item) => {
      if (hideOutOfStock && item.stock <= 0) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(getListingStatus(item))) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
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
          const aStatus = getListingStatus(a);
          const bStatus = getListingStatus(b);
          return dir * ((statusOrder[aStatus] ?? 0) - (statusOrder[bStatus] ?? 0));
        }
        default:
          return 0;
      }
    });

    return result;
  }, [items, search, statusFilter, hideOutOfStock, sortColumn, sortDirection, listingMap]);

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
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = saved;
          return copy;
        }
        return [saved, ...prev];
      });
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
      setItems((prev) => prev.filter((i) => i.id !== item.id));
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
      setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
    } catch {
      addToast("Failed to update stock", "error");
    }
  };

  // ─── Toggle relisting ─────────────────────────────────────────────────
  const handleToggleRelisting = async (item: LocalItem, enabled: boolean) => {
    try {
      const saved = await window.api.saveItem({ ...item, relistingEnabled: enabled });
      setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
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
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, updatedAt: new Date().toISOString() } : i)));
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
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, updatedAt: new Date().toISOString() } : i)));
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

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusOptions={statusOptions}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
        statusAllLabel="All statuses"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
              <Checkbox checked={hideOutOfStock} onCheckedChange={(checked) => setHideOutOfStock(checked === true)} />
              Hide out of stock
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={bulkListing || !loggedIn}>
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
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("description")}>
                    Description
                    <SortArrow column="description" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("price")}>
                    Price
                    <SortArrow column="price" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3">Relist</TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("stock")}>
                    Stock
                    <SortArrow column="stock" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort("status")}>
                    Listing Status
                    <SortArrow column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                  </TableHead>
                  <TableHead className="px-4 py-3 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => {
                  const itemStatus = getListingStatus(item);
                  const listed = itemStatus !== "not_listed";
                  const isItemListing = listingItem === item.id;
                  const isItemPublishing = publishingItem === item.id;

                  return (
                    <TableRow key={item.id}>
                      {/* Checkbox */}
                      <TableCell className="px-4 py-3">
                        <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleSelect(item.id)} />
                      </TableCell>

                      {/* Item (thumbnail + title) */}
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {item.photos.length > 0 && (
                            <div className="w-10 h-10 rounded bg-muted overflow-hidden flex-shrink-0">
                              <img src={item.photos[0]} alt="" className="w-full h-full object-cover" />
                            </div>
                          )}
                          <span className="truncate max-w-[350px] font-medium">{item.title}</span>
                        </div>
                      </TableCell>

                      {/* Description */}
                      <TableCell className="px-4 py-3 text-muted-foreground text-xs">
                        <span className="truncate block max-w-[350px]">{item.description || "—"}</span>
                      </TableCell>

                      {/* Price */}
                      <TableCell className="px-4 py-3 font-medium whitespace-nowrap">
                        {item.price} {item.currency}
                      </TableCell>

                      {/* Relist toggle */}
                      <TableCell className="px-4 py-3">
                        <Switch
                          checked={item.relistingEnabled !== false}
                          onCheckedChange={(checked) => handleToggleRelisting(item, checked)}
                        />
                      </TableCell>

                      {/* Stock (inline editable) */}
                      <TableCell className="px-4 py-3">
                        <StockInput item={item} onSave={(newStock) => handleQuickStockUpdate(item, newStock)} />
                      </TableCell>

                      {/* Status */}
                      <TableCell className="px-4 py-3">
                        {itemStatus === "active" && <Badge variant="active">Active</Badge>}
                        {itemStatus === "draft" && <Badge variant="waiting">Draft</Badge>}
                        {itemStatus === "not_listed" && <Badge variant="hidden">Not active</Badge>}
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
                              {!listed && loggedIn && item.stock > 0 && (
                                <>
                                  <DropdownMenuItem onClick={() => handleListItem(item)} disabled={isItemListing}>
                                    <ArrowUpTrayIcon className="w-4 h-4" />
                                    {isItemListing ? "Listing…" : "List on Vinted"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleListItem(item, true)} disabled={isItemListing}>
                                    <ArrowUpTrayIcon className="w-4 h-4" />
                                    List as draft
                                  </DropdownMenuItem>
                                </>
                              )}
                              {getListingStatus(item) === "draft" && loggedIn && item.stock > 0 && (
                                <DropdownMenuItem onClick={() => handlePublishDraft(item)} disabled={isItemPublishing}>
                                  <ArrowUpTrayIcon className="w-4 h-4" />
                                  {isItemPublishing ? "Publishing…" : "Publish"}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openEditModal(item)}>
                                <PencilSquareIcon className="w-4 h-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDelete(item)}>
                                <TrashIcon className="w-4 h-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
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

      {progress && <ProgressModal progress={progress} onClose={() => setProgress(null)} />}
    </div>
  );
};

export default Items;
