import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import React, { useState } from "react";

// ─── Single Repost Listing Modal ──────────────────────────────────────────────

interface SingleRepostListingProps {
  title: string;
  initialPrice: string;
  onConfirm: (price: string, asDraft: boolean) => void;
  onCancel: () => void;
}

export const SingleRepostListingModal: React.FC<SingleRepostListingProps> = ({ title, initialPrice, onConfirm, onCancel }) => {
  const [price, setPrice] = useState(initialPrice);
  const [asDraft, setAsDraft] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Repost Listing</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Price</Label>
          <Input type="number" step="0.01" min="0" className="w-full" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Create as draft</span>
          <Switch checked={asDraft} onCheckedChange={setAsDraft} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(price, asDraft)}>Repost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Bulk Repost Listing Modal ────────────────────────────────────────────────

interface BulkRepostListingProps {
  selectedCount: number;
  onConfirm: (asDraft: boolean) => void;
  onCancel: () => void;
}

export const BulkRepostListingModal: React.FC<BulkRepostListingProps> = ({ selectedCount, onConfirm, onCancel }) => {
  const [asDraft, setAsDraft] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Bulk Repost</DialogTitle>
          <DialogDescription>{selectedCount} listing(s) selected</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Create as draft</span>
          <Switch checked={asDraft} onCheckedChange={setAsDraft} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(asDraft)}>Start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
