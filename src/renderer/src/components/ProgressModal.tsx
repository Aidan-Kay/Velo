import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";

export interface ProgressState {
  title: string;
  total: number;
  completed: number;
  failed: number;
  currentTitle: string;
  currentAction: string;
  done: boolean;
  /** Current item sub-step (1-based). Shown as a secondary progress bar when set. */
  itemStep?: number;
  /** Total sub-steps for the current item. */
  itemStepTotal?: number;
}

interface ProgressModalProps {
  progress: ProgressState;
  onClose: () => void;
}

export function ProgressModal({ progress, onClose }: ProgressModalProps) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const itemPct = progress.itemStep && progress.itemStepTotal ? Math.round((progress.itemStep / progress.itemStepTotal) * 100) : 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && progress.done) onClose();
      }}
    >
      <DialogContent className="max-w-md" showCloseButton={progress.done}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{progress.title}</DialogTitle>
        </DialogHeader>

        {/* Overall progress bar */}
        <div className="w-full bg-neutral-700 rounded-full h-2 overflow-hidden">
          <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        <p className="text-sm text-muted-foreground">
          {progress.completed} / {progress.total} completed
          {progress.failed > 0 && <span className="text-red-400 ml-1">· {progress.failed} failed</span>}
        </p>

        {!progress.done && (
          <div className="space-y-2 min-w-0">
            {progress.currentTitle && <p className="text-sm text-foreground font-medium truncate">{progress.currentTitle}</p>}

            {/* Individual item progress bar */}
            {progress.itemStep != null && progress.itemStepTotal != null && progress.itemStepTotal > 0 && (
              <div className="w-full bg-neutral-700/50 rounded-full h-1.5 overflow-hidden">
                <div className="bg-primary/60 h-full rounded-full transition-all duration-200" style={{ width: `${itemPct}%` }} />
              </div>
            )}

            {progress.currentAction && <p className="text-sm text-muted-foreground truncate">{progress.currentAction}</p>}
          </div>
        )}

        {progress.done && (
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
