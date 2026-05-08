import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import React, { useState } from "react";

export interface BulkEditUpdates {
  price?: number;
  stock?: number;
  autoAcceptOfferPercent?: number | null;
  tagsMode?: "add" | "remove" | "replace";
  tags?: string[];
}

interface BulkEditItemsModalProps {
  selectedCount: number;
  onConfirm: (updates: BulkEditUpdates) => void;
  onCancel: () => void;
}

export const BulkEditItemsModal: React.FC<BulkEditItemsModalProps> = ({ selectedCount, onConfirm, onCancel }) => {
  const [updatePrice, setUpdatePrice] = useState(false);
  const [price, setPrice] = useState("");
  const [updateStock, setUpdateStock] = useState(false);
  const [stock, setStock] = useState("");
  const [updateAutoAccept, setUpdateAutoAccept] = useState(false);
  const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(false);
  const [autoAcceptPercent, setAutoAcceptPercent] = useState("");
  const [updateTags, setUpdateTags] = useState(false);
  const [tagsMode, setTagsMode] = useState<"add" | "remove" | "replace">("add");
  const [tagsInput, setTagsInput] = useState("");

  const handleConfirm = () => {
    const updates: BulkEditUpdates = {};
    if (updatePrice && price !== "") {
      updates.price = Math.max(0, parseFloat(price) || 0);
    }
    if (updateStock && stock !== "") {
      updates.stock = Math.max(0, parseInt(stock, 10) || 0);
    }
    if (updateAutoAccept) {
      if (autoAcceptEnabled && autoAcceptPercent !== "") {
        updates.autoAcceptOfferPercent = Math.max(0, Math.min(100, parseFloat(autoAcceptPercent) || 0));
      } else {
        updates.autoAcceptOfferPercent = null;
      }
    }
    if (updateTags) {
      const parsed = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      updates.tagsMode = tagsMode;
      updates.tags = parsed;
    }
    onConfirm(updates);
  };

  const hasAnyField = updatePrice || updateStock || updateAutoAccept || updateTags;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Bulk Edit</DialogTitle>
          <DialogDescription>{selectedCount} item(s) selected</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Price */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={updatePrice} onCheckedChange={(checked) => setUpdatePrice(checked === true)} />
              <Label>Update price</Label>
            </div>
            {updatePrice && (
              <Input type="number" step="0.01" min="0" placeholder="New price" value={price} onChange={(e) => setPrice(e.target.value)} />
            )}
          </div>

          {/* Stock */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={updateStock} onCheckedChange={(checked) => setUpdateStock(checked === true)} />
              <Label>Update stock</Label>
            </div>
            {updateStock && (
              <Input type="number" min="0" placeholder="New stock" value={stock} onChange={(e) => setStock(e.target.value)} />
            )}
          </div>

          {/* Auto-accept offers */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={updateAutoAccept} onCheckedChange={(checked) => setUpdateAutoAccept(checked === true)} />
              <Label>Update auto-accept</Label>
            </div>
            {updateAutoAccept && (
              <div className="space-y-2 pl-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Enable auto-accept</span>
                  <Switch checked={autoAcceptEnabled} onCheckedChange={setAutoAcceptEnabled} />
                </div>
                {autoAcceptEnabled && (
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Discount % threshold"
                    value={autoAcceptPercent}
                    onChange={(e) => setAutoAcceptPercent(e.target.value)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={updateTags} onCheckedChange={(checked) => setUpdateTags(checked === true)} />
              <Label>Update tags</Label>
            </div>
            {updateTags && (
              <div className="space-y-2 pl-6">
                <div className="flex gap-1">
                  {(["add", "remove", "replace"] as const).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={tagsMode === mode ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTagsMode(mode)}
                      className="flex-1 capitalize"
                    >
                      {mode}
                    </Button>
                  ))}
                </div>
                <Input placeholder="Comma-separated tags" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!hasAnyField}>
            Update {selectedCount} item(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
