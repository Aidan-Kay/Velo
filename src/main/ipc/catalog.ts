import { ipcMain } from "electron";

import { getDomain } from "../shared/constants";
import * as vintedApi from "../vinted/api";
import type { IpcDeps } from "./types";

export function setupCatalogIpc({ getSettings }: IpcDeps): void {
  ipcMain.handle("get-categories", async () => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getCategories(domain);
  });

  ipcMain.handle("get-category-attributes", async (_event, categoryId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getCategoryAttributes(categoryId, domain);
  });

  ipcMain.handle("get-conditions", async (_event, catalogId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getConditions(catalogId, domain);
  });

  ipcMain.handle("get-package-sizes", async (_event, catalogId: number) => {
    const domain = getDomain(getSettings().site);
    return vintedApi.getPackageSizes(catalogId, domain);
  });
}
