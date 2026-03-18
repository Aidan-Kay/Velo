import type { LocalItem, RestockEntry } from "../shared/types";
import { loadRestockQueue, saveRestockQueue } from "./persistence";

/**
 * Restocking Manager
 *
 * Monitors sold items and automatically relists them after a configurable delay.
 * Items with stock > 1 in the local inventory are queued for relisting.
 */

let _timer: ReturnType<typeof setTimeout> | null = null;
let _queue: RestockEntry[] = [];
let _getSettings: (() => { restocking?: { enabled?: boolean; listAsDraft?: boolean; delayMinutes?: number } }) | null = null;
let _onRestock: ((itemId: string, asDraft: boolean) => Promise<void>) | null = null;

export function initRestocking(getSettings: typeof _getSettings, onRestock: typeof _onRestock): void {
  _getSettings = getSettings;
  _onRestock = onRestock;
  _queue = loadRestockQueue();
  startRestockLoop();
}

export function queueForRestock(item: LocalItem, soldAt: string): void {
  const existing = _queue.find((q) => q.itemId === item.id);
  if (existing) return;

  const entry: RestockEntry = {
    itemId: item.id,
    itemTitle: item.title,
    soldAt,
    queuedAt: new Date().toISOString(),
    relistAt: null,
    status: "pending",
  };

  _queue.push(entry);
  saveRestockQueue(_queue);
  console.log(`[restock] Queued "${item.title}" for restocking`);
}

export function removeFromQueue(itemId: string): void {
  const idx = _queue.findIndex((q) => q.itemId === itemId);
  if (idx >= 0) {
    _queue.splice(idx, 1);
    saveRestockQueue(_queue);
  }
}

export function getRestockQueue(): RestockEntry[] {
  return [..._queue];
}

export function startRestockLoop(): void {
  stopRestockLoop();
  checkAndRestock();
}

export function stopRestockLoop(): void {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

async function checkAndRestock(): Promise<void> {
  const settings = _getSettings ? _getSettings() : {};
  const restockSettings = settings.restocking || {};

  if (!restockSettings.enabled) {
    _timer = setTimeout(checkAndRestock, 60_000);
    return;
  }

  const delayMs = (restockSettings.delayMinutes || 30) * 60 * 1000;
  const now = Date.now();

  for (const entry of _queue) {
    if (entry.status !== "pending") continue;

    const soldTime = new Date(entry.soldAt).getTime();
    const relistTime = soldTime + delayMs;

    entry.relistAt = new Date(relistTime).toISOString();

    if (now >= relistTime) {
      entry.status = "processing";
      saveRestockQueue(_queue);

      try {
        if (_onRestock) {
          await _onRestock(entry.itemId, restockSettings.listAsDraft ?? true);
        }
        entry.status = "completed";
        console.log(`[restock] Successfully relisted "${entry.itemTitle}"`);
      } catch (err) {
        entry.status = "failed";
        console.error(`[restock] Failed to relist "${entry.itemTitle}":`, (err as Error).message);
      }

      saveRestockQueue(_queue);
    }
  }

  // Clean up completed/failed entries older than 24 hours
  const cutoff = now - 24 * 60 * 60 * 1000;
  const before = _queue.length;
  _queue = _queue.filter((q) => {
    if (q.status === "completed" || q.status === "failed") {
      return new Date(q.queuedAt).getTime() > cutoff;
    }
    return true;
  });
  if (_queue.length !== before) {
    saveRestockQueue(_queue);
  }

  _timer = setTimeout(checkAndRestock, 30_000);
}
