import type { ProgressState } from "../components/ProgressModal";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomInterval = (minMs: number, maxMs: number) => Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

export interface BulkOperationItem {
  title: string;
}

interface BulkOperationOptions<T extends BulkOperationItem> {
  items: T[];
  title: string;
  action: (item: T, updateAction: (action: string) => void, updateItemStep: (step: number, total: number) => void) => Promise<void>;
  cancelledRef: React.RefObject<boolean>;
  setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>;
  minIntervalMs: number;
  maxIntervalMs: number;
  onComplete?: () => void;
}

/**
 * Generic bulk operation runner with progress tracking and randomised delays.
 * Reduces duplication across handleBulkRepost, handleBulkPublish, handleBulkSave.
 */
export async function runBulkOperation<T extends BulkOperationItem>({
  items,
  title,
  action,
  cancelledRef,
  setProgress,
  minIntervalMs,
  maxIntervalMs,
  onComplete,
}: BulkOperationOptions<T>): Promise<void> {
  setProgress({
    title,
    total: items.length,
    completed: 0,
    failed: 0,
    currentTitle: "",
    currentAction: "",
    done: false,
  });

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    if (cancelledRef.current) break;
    const item = items[i];

    const updateAction = (actionText: string) => {
      setProgress((p) => (p ? { ...p, currentTitle: item.title, currentAction: actionText } : p));
    };

    const updateItemStep = (step: number, total: number) => {
      setProgress((p) => (p ? { ...p, itemStep: step, itemStepTotal: total } : p));
    };

    try {
      updateAction("Processing…");
      await action(item, updateAction, updateItemStep);
      completed++;
    } catch {
      failed++;
    }

    setProgress((p) => (p ? { ...p, completed, failed } : p));

    if (i < items.length - 1 && !cancelledRef.current) {
      const delay = randomInterval(minIntervalMs, maxIntervalMs);
      setProgress((p) => (p ? { ...p, currentAction: `Waiting ${Math.ceil(delay / 1000)}s…`, currentTitle: "" } : p));
      await sleep(delay);
    }
  }

  setProgress((p) => (p ? { ...p, done: true, currentAction: "", currentTitle: "" } : p));
  onComplete?.();
}
