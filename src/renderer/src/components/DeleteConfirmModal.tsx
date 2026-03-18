import { Button } from "./ui/button";

interface DeleteConfirmModalProps {
  title: string;
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({ title, itemName, onConfirm, onCancel }: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card rounded-lg border border-border p-6 w-full max-w-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Are you sure you want to delete <span className="text-foreground font-medium">&ldquo;{itemName}&rdquo;</span>? This cannot be
          undone.
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" onClick={onConfirm} className="text-red-400 hover:text-red-300">
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
