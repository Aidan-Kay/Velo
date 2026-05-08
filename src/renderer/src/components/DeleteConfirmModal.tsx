import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";

interface DeleteConfirmModalProps {
  title: string;
  itemName?: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({ title, itemName, message, confirmLabel = "Delete", onConfirm, onCancel }: DeleteConfirmModalProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {message ?? (
              <>
                Are you sure you want to delete <span className="text-foreground font-medium">&ldquo;{itemName}&rdquo;</span>? This cannot
                be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
