import { app, BrowserWindow, Menu, screen, Tray } from "electron";
import log from "electron-log/main";
import * as path from "path";

import type { AppSettings, LocalItem, Order, Pagination, VintedListing } from "../shared/types";
import { setupIpc } from "./ipc-handlers";
import {
  loadCachedListings,
  loadCachedOrders,
  loadItems,
  loadSettings,
  loadWindowState,
  saveCachedListings,
  saveCachedOrders,
  saveItems,
  saveWindowState,
} from "./persistence";
import { PollingManager } from "./polling";
import { initRestocking } from "./restocking";
import { getDomain } from "./shared/constants";
import * as vintedApi from "./vinted/api";

// ─── Logging ──────────────────────────────────────────────────────────────────
log.initialize();
log.transports.file.maxSize = 5 * 1024 * 1024;
Object.assign(console, log.functions);

// ─── App Identity ─────────────────────────────────────────────────────────────
app.name = "VintedManager";
if (process.platform === "win32") {
  app.setAppUserModelId("VintedManager");
}

// ─── Chromium Stability ───────────────────────────────────────────────────────
app.commandLine.appendSwitch("disable-quic");

// ─── Single Instance Lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ─── Shared Mutable State ─────────────────────────────────────────────────────
const state: {
  items: LocalItem[];
  cachedListings: VintedListing[];
  cachedListingsPagination: Pagination;
  cachedOrders: Order[];
  cachedOrdersPagination: Pagination;
} = {
  items: [],
  cachedListings: [],
  cachedListingsPagination: {},
  cachedOrders: [],
  cachedOrdersPagination: {},
};

let settings: AppSettings = {} as AppSettings;
const getSettings = (): AppSettings => settings;
const setSettings = (s: AppSettings): void => {
  settings = s;
};

let mainWindow: BrowserWindow | null = null;
const getWindow = (): BrowserWindow | null => mainWindow;

let tray: Tray | null = null;
let isQuitting = false;

// ─── Polling Manager ──────────────────────────────────────────────────────

/** Reduce stock for local items matching newly detected orders. */
function reduceStockForNewOrders(newOrders: Order[]): void {
  let changed = false;
  for (const order of newOrders) {
    // Skip cancelled orders — they didn't result in a sale
    if (order.orderStatus === "cancelled") continue;

    const titlesToReduce: string[] = [];
    if (order.isBundle && order.bundleItems.length > 0) {
      titlesToReduce.push(...order.bundleItems.map((b) => b.title));
    } else {
      titlesToReduce.push(order.itemTitle);
    }

    for (const title of titlesToReduce) {
      const titleKey = title.toLowerCase().trim();
      const item = state.items.find((i) => i.title.toLowerCase().trim() === titleKey);
      if (item && item.stock > 0) {
        item.stock -= 1;
        changed = true;
        console.log(`[stock] Reduced stock for "${item.title}" to ${item.stock} (order ${order.transactionId})`);
      }
    }
  }
  if (changed) {
    saveItems(state.items);
  }
}

const polling = new PollingManager({
  getDomain: () => getDomain(settings.site),
  getCachedOrders: () => state.cachedOrders,
  getCachedListings: () => state.cachedListings,
  onListingsUpdated: (items: VintedListing[], pagination: Pagination) => {
    state.cachedListings = items;
    state.cachedListingsPagination = pagination;
    saveCachedListings({ items, pagination, fetchedAt: new Date().toISOString() });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("listings-updated", { items, pagination });
    }
  },
  onOrdersUpdated: (orders: Order[], pagination: Pagination) => {
    // Detect truly new orders and reduce stock for matching local items
    if (state.cachedOrders.length > 0) {
      const existingTransactionIds = new Set(state.cachedOrders.map((o) => o.transactionId));
      const newOrders = orders.filter((o) => o.transactionId && !existingTransactionIds.has(o.transactionId));
      if (newOrders.length > 0) {
        reduceStockForNewOrders(newOrders);
      }
    }

    // Preserve stockReplenished flags from cached orders
    const cachedMap = new Map(state.cachedOrders.map((o) => [o.transactionId, o]));
    for (const order of orders) {
      const cached = order.transactionId ? cachedMap.get(order.transactionId) : null;
      if (cached?.stockReplenished) {
        order.stockReplenished = true;
      }
    }

    state.cachedOrders = orders;
    state.cachedOrdersPagination = pagination;
    saveCachedOrders({ orders, pagination, fetchedAt: new Date().toISOString() });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("orders-updated", { orders, pagination });
    }
  },
});

// ─── Second Instance ──────────────────────────────────────────────────────────
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  const saved = loadWindowState();

  let winX = saved?.x;
  let winY = saved?.y;
  if (winX != null && winY != null) {
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const b = d.bounds;
      return winX! >= b.x && winY! >= b.y && winX! < b.x + b.width && winY! < b.y + b.height;
    });
    if (!visible) {
      winX = undefined;
      winY = undefined;
      console.warn("[window] Saved position was off-screen — resetting to default.");
    }
  }

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    x: winX,
    y: winY,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#171717",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#171717",
      symbolColor: "#d4d4d4",
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "../assets/icon.png"),
  });

  mainWindow.loadFile(path.join(__dirname, "../src/renderer/index.html"));

  mainWindow.on("resized", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });
  mainWindow.on("moved", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && getSettings().minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!isQuitting && !getSettings().minimizeToTray) {
      isQuitting = true;
      app.quit();
    }
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray(): void {
  const iconPath = path.join(__dirname, "../assets/icon.png");
  tray = new Tray(iconPath);
  tray.setToolTip("Vinted Manager");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Vinted Manager",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.on("right-click", () => {
    tray?.popUpContextMenu(contextMenu);
  });

  tray.on("double-click", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// ─── Restocking Callback ──────────────────────────────────────────────────────

async function handleRestock(itemId: string, asDraft: boolean): Promise<void> {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Item not found for restocking");

  const domain = getDomain(settings.site);

  if (item.stock > 0) {
    item.stock -= 1;
  }

  await vintedApi.createListing(item, { asDraft, domain });
  item.updatedAt = new Date().toISOString();
  saveItems(state.items);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("item-restocked", { itemId, item });
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  settings = loadSettings();
  state.items = loadItems();

  // Load cached listings/orders from disk
  const cachedListings = loadCachedListings();
  state.cachedListings = cachedListings.items;
  state.cachedListingsPagination = cachedListings.pagination;
  const cachedOrders = loadCachedOrders();
  state.cachedOrders = cachedOrders.orders;
  state.cachedOrdersPagination = cachedOrders.pagination;

  setupIpc(state, getSettings, setSettings, getWindow, polling);
  createWindow();
  createTray();

  initRestocking(getSettings, handleRestock);

  // Auto-check session on startup
  const domain = getDomain(settings.site);
  vintedApi
    .checkSession(domain)
    .then((result) => {
      if (result.loggedIn) {
        console.log(`[main] Session valid — user ID: ${result.userId}`);
        polling.start();
      } else {
        console.log("[main] No valid session — login required");
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("session-status", result);
      }
    })
    .catch((err: Error) => {
      console.warn("[main] Session check failed:", err.message);
    });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Global Error Handlers ────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
