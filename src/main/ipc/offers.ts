import { ipcMain } from "electron";

import { getDomain } from "../shared/constants";
import * as vintedApi from "../vinted/api";
import type { IpcDeps } from "./types";

export function setupOffersIpc({ state, getSettings, polling }: IpcDeps): void {
  ipcMain.handle("get-received-offers", () => ({ offers: state.cachedOffers }));

  ipcMain.handle("refresh-received-offers", async () => polling.refreshOffers());

  ipcMain.handle("accept-offer", async (_event, transactionId: number, offerRequestId: number) => {
    const domain = getDomain(getSettings().site);
    await vintedApi.acceptOffer(transactionId, offerRequestId, domain);
    polling.applyOfferPatch({ offerRequestId }, { status: "accepted" });
    return { success: true };
  });

  ipcMain.handle("counter-offer", async (_event, transactionId: number, price: number, currency: string) => {
    const domain = getDomain(getSettings().site);
    await vintedApi.counterOffer(transactionId, price, currency, domain);
    polling.applyOfferPatch({ transactionId }, { status: "countered" });
    return { success: true };
  });

  ipcMain.handle("ignore-offer", (_event, offerRequestId: number) => {
    polling.applyOfferPatch({ offerRequestId }, { status: "ignored" });
    return { success: true };
  });

  ipcMain.handle("unignore-offer", (_event, offerRequestId: number) => {
    polling.applyOfferPatch({ offerRequestId }, { status: "pending" });
    return { success: true };
  });

  ipcMain.handle("get-seller-offer-options", async (_event, transactionId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getSellerOfferOptions(transactionId, domain);
  });
}
