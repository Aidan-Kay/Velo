import React, { useEffect, useState } from "react";
import type { LocalItem } from "../../../shared/types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

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
    onSave(item);
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
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input value={item.title ?? ""} onChange={(e) => updateField("title", e.target.value)} placeholder="Item title" />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              className="h-24 resize-none"
              value={item.description ?? ""}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Describe your item…"
            />
          </div>

          {/* Price & Stock */}
          <div className="flex gap-4">
            <div className="flex-1 space-y-1.5">
              <Label>Price *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={item.price ?? 0}
                onChange={(e) => updateField("price", parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="w-28 space-y-1.5">
              <Label>Stock</Label>
              <Input
                type="number"
                min="0"
                value={item.stock ?? 1}
                onChange={(e) => updateField("stock", parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditItemModal;
