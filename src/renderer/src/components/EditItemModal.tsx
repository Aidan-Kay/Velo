import { SparklesIcon } from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import { Switch } from "@shared/components/ui/switch";
import { Textarea } from "@shared/components/ui/textarea";
import React, { useEffect, useState } from "react";
import type { LocalItem } from "../../../shared/types";

interface EditItemModalProps {
  open: boolean;
  onClose: () => void;
  editItem: Partial<LocalItem>;
  onSave: (item: Partial<LocalItem>) => void;
  saving: boolean;
  addToast: (message: string, type?: "success" | "error" | "info") => void;
}

const EditItemModal: React.FC<EditItemModalProps> = ({ open, onClose, editItem, onSave, saving, addToast }) => {
  const [item, setItem] = useState<Partial<LocalItem>>({});
  const [aiBusy, setAiBusy] = useState(false);

  // Sync edit item on open
  useEffect(() => {
    if (open) {
      setItem({ ...editItem });
    }
  }, [open, editItem]);

  const updateField = <K extends keyof LocalItem>(field: K, value: LocalItem[K]) => {
    setItem((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    if (!item.title?.trim()) {
      addToast("Title is required", "error");
      return;
    }
    if (item.price != null && item.price < 0) {
      addToast("Price cannot be negative", "error");
      return;
    }
    onSave(item);
  };

  const canUseAi = !!item.id && !!item.photos && item.photos.length > 0;

  const handleGenerateAi = async () => {
    if (!item.id) {
      addToast("Save the item once before generating with AI", "info");
      return;
    }
    if (!item.photos || item.photos.length === 0) {
      addToast("Add at least one photo first", "error");
      return;
    }

    if ((item.title && item.title.trim()) || (item.description && item.description.trim())) {
      const ok = window.confirm("Replace existing title and description with AI output?");
      if (!ok) return;
    }

    setAiBusy(true);
    try {
      const draft = await window.api.aiGenerateListingDraft(item.id);
      setItem((prev) => ({ ...prev, title: draft.title, description: draft.description }));
      addToast("AI draft generated", "success");
    } catch (err) {
      addToast(`AI generation failed: ${(err as Error).message}`, "error");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Title */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                Title <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateAi}
                disabled={!canUseAi || aiBusy}
                title={canUseAi ? "Generate title and description from photos" : "Save the item with photos first"}
              >
                <SparklesIcon className="w-4 h-4 mr-1" />
                {aiBusy ? "Generating…" : "Generate with AI"}
              </Button>
            </div>
            <Input value={item.title ?? ""} onChange={(e) => updateField("title", e.target.value)} placeholder="Item title" />
          </div>

          {/* Description */}
          <div className="space-y-3">
            <Label>Description</Label>
            <Textarea
              className="h-36 resize-none"
              value={item.description ?? ""}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Describe your item…"
            />
          </div>

          {/* Price & Stock */}
          <div className="flex gap-4">
            <div className="flex-1 space-y-3">
              <Label>
                Price <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={item.price ?? 0}
                onChange={(e) => updateField("price", Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </div>
            <div className="w-28 space-y-3">
              <Label>Stock</Label>
              <Input
                type="number"
                min="0"
                value={item.stock ?? 1}
                onChange={(e) => updateField("stock", Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
            </div>
          </div>

          {/* Auto-Accept Offers */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-accept offers</Label>
                <p className="text-xs text-muted-foreground">Override the global threshold for this item</p>
              </div>
              <Switch
                checked={item.autoAcceptOfferPercent !== null && item.autoAcceptOfferPercent !== undefined}
                onCheckedChange={(checked) => updateField("autoAcceptOfferPercent", checked ? 90 : null)}
              />
            </div>
            {item.autoAcceptOfferPercent != null && (
              <Input
                type="number"
                min="1"
                max="100"
                className="w-32"
                value={item.autoAcceptOfferPercent}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val) && val >= 1 && val <= 100) {
                    updateField("autoAcceptOfferPercent", val);
                  }
                }}
              />
            )}
          </div>

          {/* Tags */}
          <div className="space-y-3">
            <Label>Tags</Label>
            <Input
              value={(item.tags ?? []).join(", ")}
              onChange={(e) =>
                updateField(
                  "tags",
                  e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0),
                )
              }
              placeholder="Comma-separated tags"
            />
          </div>

          {/* Package Size */}
          <div className="space-y-3">
            <Label>Package size</Label>
            <Select
              value={item.packageSizeId != null ? String(item.packageSizeId) : ""}
              onValueChange={(val) => updateField("packageSizeId", val ? Number(val) : null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Not selected" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Not selected</SelectItem>
                <SelectItem value="1">Small</SelectItem>
                <SelectItem value="2">Medium</SelectItem>
                <SelectItem value="3">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditItemModal;
