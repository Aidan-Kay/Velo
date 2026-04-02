import type { LocalItem, RelistEntry } from "../shared/types";
import { loadRelistQueue, saveRelistQueue } from "./persistence";

/**
 * RelistingManager
 *
 * Monitors sold items and automatically relists them after a configurable delay.
 * Items with stock > 1 in the local inventory are queued for relisting.
 */

interface RelistingDeps {
  getSettings: () => { relisting?: { enabled?: boolean; listAsDraft?: boolean; delayMinutes?: number } };
  onRelist: (itemId: string, asDraft: boolean) => Promise<void>;
}

export class RelistingManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: RelistEntry[] = [];
  private deps: RelistingDeps;

  constructor(deps: RelistingDeps) {
    this.deps = deps;
    this.queue = loadRelistQueue();
    this.start();
  }

  queueForRelist(item: LocalItem, soldAt: string): void {
    const existing = this.queue.find((q) => q.itemId === item.id);
    if (existing) return;

    const entry: RelistEntry = {
      itemId: item.id,
      itemTitle: item.title,
      soldAt,
      queuedAt: new Date().toISOString(),
      relistAt: null,
      status: "pending",
    };

    this.queue.push(entry);
    saveRelistQueue(this.queue);
    console.log(`[relist] Queued "${item.title}" for relisting`);
  }

  removeFromQueue(itemId: string): void {
    const idx = this.queue.findIndex((q) => q.itemId === itemId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      saveRelistQueue(this.queue);
    }
  }

  getQueue(): RelistEntry[] {
    return [...this.queue];
  }

  start(): void {
    this.stop();
    this.checkAndRelist();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async checkAndRelist(): Promise<void> {
    const settings = this.deps.getSettings();
    const relistSettings = settings.relisting || {};

    if (!relistSettings.enabled) {
      this.timer = setTimeout(() => this.checkAndRelist(), 60_000);
      return;
    }

    const delayMs = (relistSettings.delayMinutes || 30) * 60 * 1000;
    const now = Date.now();

    for (const entry of this.queue) {
      if (entry.status !== "pending") continue;

      const soldTime = new Date(entry.soldAt).getTime();
      const relistTime = soldTime + delayMs;

      entry.relistAt = new Date(relistTime).toISOString();

      if (now >= relistTime) {
        entry.status = "processing";
        saveRelistQueue(this.queue);

        try {
          await this.deps.onRelist(entry.itemId, relistSettings.listAsDraft ?? true);
          entry.status = "completed";
          console.log(`[relist] Successfully relisted "${entry.itemTitle}"`);
        } catch (err) {
          entry.status = "failed";
          console.error(`[relist] Failed to relist "${entry.itemTitle}":`, (err as Error).message);
        }

        saveRelistQueue(this.queue);
      }
    }

    // Clean up completed/failed entries older than 24 hours
    const cutoff = now - 24 * 60 * 60 * 1000;
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => {
      if (q.status === "completed" || q.status === "failed") {
        return new Date(q.queuedAt).getTime() > cutoff;
      }
      return true;
    });
    if (this.queue.length !== before) {
      saveRelistQueue(this.queue);
    }

    this.timer = setTimeout(() => this.checkAndRelist(), 30_000);
  }
}
