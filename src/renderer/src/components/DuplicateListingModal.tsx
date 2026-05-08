import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import React, { useState } from "react";

interface DuplicateListingModalProps {
  title: string;
  onConfirm: (copyPhotos: boolean, asDraft: boolean) => void;
  onCancel: () => void;
}

export const DuplicateListingModal: React.FC<DuplicateListingModalProps> = ({ title, onConfirm, onCancel }) => {
  const [copyPhotos, setCopyPhotos] = useState(true);
  const [asDraft, setAsDraft] = useState(true);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Duplicate Listing</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Copy photos</Label>
            <Switch checked={copyPhotos} onCheckedChange={setCopyPhotos} />
          </div>

          <div className="flex items-center justify-between">
            <Label>List as draft</Label>
            <Switch checked={asDraft} onCheckedChange={setAsDraft} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(copyPhotos, asDraft)}>Duplicate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
