import { ipcMain } from "electron";

import type { BulkPriceProgress, BulkPriceRuleInput, BulkPriceRuleResult } from "../../shared/types";
import { getDomain } from "../shared/constants";
import { editListingPrice } from "../vinted/listings";
import type { IpcDeps } from "./types";

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function setupPriceRulesIpc({ state, getSettings, getWindow, polling }: IpcDeps): void {
  ipcMain.handle("apply-bulk-price-rule", async (_event, input: BulkPriceRuleInput): Promise<BulkPriceRuleResult> => {
    const { percentOff, olderThanDays, dryRun = false } = input;

    if (typeof percentOff !== "number" || percentOff <= 0 || percentOff >= 100) {
      throw new Error("percentOff must be between 0 and 100");
    }
    if (typeof olderThanDays !== "number" || olderThanDays < 0) {
      throw new Error("olderThanDays must be >= 0");
    }

    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    const candidates = state.cachedListings.filter((l) => {
      if (l.status.toLowerCase() !== "active") return false;
      if (l.priceNumeric == null || l.priceNumeric <= 0) return false;
      if (!l.createdAt) return false;
      const created = new Date(l.createdAt).getTime();
      if (Number.isNaN(created)) return false;
      return created <= cutoff;
    });

    const result: BulkPriceRuleResult = {
      matched: candidates.length,
      updated: 0,
      failed: [],
    };

    if (dryRun) return result;

    const domain = getDomain(getSettings().site);
    const total = candidates.length;
    const win = getWindow();

    for (let i = 0; i < candidates.length; i++) {
      const listing = candidates[i];
      const newPrice = roundTo2((listing.priceNumeric as number) * (1 - percentOff / 100));

      let progress: BulkPriceProgress;
      if (newPrice <= 0 || newPrice >= (listing.priceNumeric as number)) {
        progress = { index: i + 1, total, listingId: listing.id, ok: false, error: "no-op" };
      } else {
        try {
          await editListingPrice(listing.id, newPrice, domain);
          result.updated += 1;
          progress = { index: i + 1, total, listingId: listing.id, ok: true };
        } catch (err) {
          const message = (err as Error).message;
          result.failed.push({ listingId: listing.id, error: message });
          progress = { index: i + 1, total, listingId: listing.id, ok: false, error: message };
        }
      }

      if (win && !win.isDestroyed()) {
        win.webContents.send("bulk-price-progress", progress);
      }
    }

    if (result.updated > 0) {
      try {
        await polling.refreshListings();
      } catch (err) {
        console.warn("[price-rules] Failed to refresh listings after bulk update:", (err as Error).message);
      }
    }

    return result;
  });
}
