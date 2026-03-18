import { Button } from "./ui/button";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card rounded-lg border border-border p-6 w-full max-w-md space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{progress.title}</h3>

        {/* Overall progress bar */}
        <div className="w-full bg-neutral-700 rounded-full h-2 overflow-hidden">
          <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        <p className="text-xs text-muted-foreground">
          {progress.completed} / {progress.total} completed
          {progress.failed > 0 && <span className="text-red-400 ml-1">· {progress.failed} failed</span>}
        </p>

        {!progress.done && (
          <div className="space-y-2">
            {progress.currentTitle && <p className="text-xs text-foreground font-medium truncate">{progress.currentTitle}</p>}

            {/* Individual item progress bar */}
            {progress.itemStep != null && progress.itemStepTotal != null && progress.itemStepTotal > 0 && (
              <div className="w-full bg-neutral-700/50 rounded-full h-1.5 overflow-hidden">
                <div className="bg-primary/60 h-full rounded-full transition-all duration-200" style={{ width: `${itemPct}%` }} />
              </div>
            )}

            {progress.currentAction && <p className="text-xs text-muted-foreground truncate">{progress.currentAction}</p>}
          </div>
        )}

        {progress.done && (
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
