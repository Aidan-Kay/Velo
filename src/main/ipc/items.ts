import * as crypto from "crypto";
import { ipcMain } from "electron";

import type { LocalItem } from "../../shared/types";
import { saveItems } from "../persistence";
import { deleteItemPhotos, downloadItemPhotos } from "../photo-downloader";
import { getDomain } from "../shared/constants";
import * as vintedApi from "../vinted/api";
import type { IpcDeps } from "./types";

export function setupItemsIpc({ state, getSettings }: IpcDeps): void {
  ipcMain.handle("get-items", () => state.items);

  ipcMain.handle("save-item", (_event, item: Partial<LocalItem>) => {
    const now = new Date().toISOString();

    if (!item.id) {
      item.id = crypto.randomUUID();
      item.createdAt = now;
    }
    item.updatedAt = now;

    const defaults: Omit<LocalItem, "id" | "createdAt" | "updatedAt"> = {
      title: "",
      description: "",
      price: 0,
      currency: "GBP",
      categoryId: null,
      conditionId: null,
      brandId: null,
      sizeId: null,
      color1Id: null,
      color2Id: null,
      packageSizeId: null,
      shippingMethodId: null,
      photos: [],
      stock: 1,
      relistingEnabled: true,
      categoryAttributes: {},
      autoAcceptOfferPercent: null,
      tags: [],
    };

    const idx = state.items.findIndex((i) => i.id === item.id);
    const existing = idx >= 0 ? state.items[idx] : {};
    const complete: LocalItem = { ...defaults, ...existing, ...item } as LocalItem;

    if (idx >= 0) {
      state.items[idx] = complete;
    } else {
      state.items.push(complete);
    }
    saveItems(state.items);

    // Download remote photos in the background (don't block the response)
    if (complete.photos && complete.photos.length > 0 && complete.photos.some((p) => p.startsWith("http"))) {
      const isUpdate = idx >= 0;
      downloadItemPhotos(complete.id, complete.photos, isUpdate)
        .then((localPaths) => {
          complete.photos = localPaths;
          saveItems(state.items);
        })
        .catch((err) => console.warn("[save-item] Background photo download failed:", (err as Error).message));
    }

    return complete;
  });

  ipcMain.handle("delete-item", (_event, itemId: string) => {
    const idx = state.items.findIndex((i) => i.id === itemId);
    if (idx >= 0) {
      state.items.splice(idx, 1);
      saveItems(state.items);
      deleteItemPhotos(itemId);
    }
    return { success: true };
  });

  ipcMain.handle("bulk-list-items", async (event, itemIds: string[], options: { asDraft?: boolean } = {}) => {
    const domain = getDomain(getSettings().site);
    const asDraft = options.asDraft || false;

    const results: Array<{ itemId: string; success: boolean; error?: string }> = [];

    for (const itemId of itemIds) {
      const item = state.items.find((i) => i.id === itemId);
      if (!item) {
        results.push({ itemId, success: false, error: "Item not found" });
        continue;
      }

      try {
        await vintedApi.createListing(item, {
          asDraft,
          domain,
          onProgress: (step, current, total) => {
            event.sender.send("listing-creation-progress", { step, current, total });
          },
        });
        item.updatedAt = new Date().toISOString();
        saveItems(state.items);
        results.push({ itemId, success: true });
      } catch (err) {
        results.push({ itemId, success: false, error: (err as Error).message });
      }
    }

    return results;
  });
}
