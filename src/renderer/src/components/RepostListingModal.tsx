import React, { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card rounded-lg border border-border p-6 w-full max-w-sm space-y-4">
        <h3 className="text-base font-semibold text-foreground">Repost Listing</h3>
        <p className="text-xs text-muted-foreground truncate">{title}</p>

        <div className="space-y-2">
          <Label>Price</Label>
          <Input type="number" step="0.01" min="0" className="w-full" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Create as draft</span>
          <Switch checked={asDraft} onCheckedChange={setAsDraft} />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(price, asDraft)}>
            Repost
          </Button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card rounded-lg border border-border p-6 w-full max-w-sm space-y-4">
        <h3 className="text-base font-semibold text-foreground">Bulk Repost</h3>
        <p className="text-xs text-muted-foreground">{selectedCount} listing(s) selected</p>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Create as draft</span>
          <Switch checked={asDraft} onCheckedChange={setAsDraft} />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(asDraft)}>
            Start
          </Button>
        </div>
      </div>
    </div>
  );
};
