import { ipcMain } from "electron";

import type { LocalItem } from "../../shared/types";
import { getDomain } from "../shared/constants";
import * as vintedApi from "../vinted/api";
import type { IpcDeps } from "./types";

export function setupListingsIpc({ state, getSettings, polling }: IpcDeps): void {
  ipcMain.handle("get-my-listings", () => {
    return { items: state.cachedListings, pagination: state.cachedListingsPagination };
  });

  ipcMain.handle("refresh-my-listings", async () => polling.refreshListings());

  ipcMain.handle("get-listing-details", async (_event, listingId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getListingDetails(listingId, domain);
  });

  ipcMain.handle("get-item-upload-detail", async (_event, itemId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getItemUploadDetail(itemId, domain);
  });

  ipcMain.handle("refresh-single-listing", async (_event, listingId: number) => {
    return polling.refreshSingleListing(listingId);
  });

  // ─── Item Creation / Publishing ──────────────────────────────────────────

  ipcMain.handle("create-listing", async (event, itemData: Partial<LocalItem>, options: { asDraft?: boolean } = {}) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.createListing(itemData, {
      ...options,
      domain,
      onProgress: (step, current, total) => {
        event.sender.send("listing-creation-progress", { step, current, total });
      },
    });
  });

  ipcMain.handle("publish-listing", async (_event, listingId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.publishListing(listingId, domain);
  });

  ipcMain.handle("delete-listing", async (_event, listingId: number, isDraft: boolean) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.deleteListing(listingId, isDraft, domain);
  });
}
