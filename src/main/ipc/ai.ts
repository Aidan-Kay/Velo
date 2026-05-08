import { ipcMain } from "electron";

import type { AiListingDraft } from "../../shared/types";
import { generateListingDraft } from "../ai";
import type { IpcDeps } from "./types";

export function setupAiIpc({ state, getSettings }: IpcDeps): void {
  ipcMain.handle("ai-generate-listing-draft", async (_event, itemId: string): Promise<AiListingDraft> => {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) throw new Error("Item not found");

    const settings = getSettings();
    return generateListingDraft({
      title: item.title || "",
      photoPaths: item.photos || [],
      settings: settings.aiAssist,
    });
  });
}
