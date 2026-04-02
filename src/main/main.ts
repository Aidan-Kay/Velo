import { app, BrowserWindow, Menu, powerMonitor, screen, Tray } from "electron";
import log from "electron-log/main";
import * as fs from "fs";
import * as path from "path";

import type { AppSettings, LocalItem, Order, Pagination, VintedListing } from "../shared/types";
import { setupIpc } from "./ipc-handlers";
import { autoGenerateLabelsForNewOrders, reduceStockForShippedOrders } from "./order-automation";
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
import { RelistingManager } from "./relisting";
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
    // Reduce stock for orders that have just reached the "shipped" stage
    reduceStockForShippedOrders(orders, state.cachedOrders, settings, state.items);

    // Auto-generate shipping labels for new orders (runs async, doesn't block)
    const cachedSnapshot = [...state.cachedOrders];
    void autoGenerateLabelsForNewOrders(orders, cachedSnapshot, settings);

    // Preserve stockReplenished and stockReduced flags from cached orders
    const cachedMap = new Map(state.cachedOrders.map((o) => [o.transactionId, o]));
    for (const order of orders) {
      const cached = order.transactionId ? cachedMap.get(order.transactionId) : null;
      if (cached?.stockReplenished) {
        order.stockReplenished = true;
      }
      if (cached?.stockReduced) {
        order.stockReduced = true;
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
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set CSP header for production; skip in dev so Vite HMR works unimpeded
  if (app.isPackaged) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self';" +
              " script-src 'self';" +
              " style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;" +
              " font-src https://fonts.gstatic.com;" +
              " img-src 'self' file: data: https://*.vinted.co.uk https://*.vinted.fr https://*.vinted.de https://*.vinted.be https://*.vinted.es https://*.vinted.it https://*.vinted.nl https://*.vinted.pl https://*.vinted.com https://*.vinted.net;",
          ],
        },
      });
    });
  }

  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

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
  const iconPath = path.join(__dirname, "../../resources/icon.png");
  if (!fs.existsSync(iconPath)) {
    console.warn("[tray] Icon not found — skipping tray creation:", iconPath);
    return;
  }
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

// ─── Relisting ─────────────────────────────────────────────────────────────────────────

async function handleRelist(itemId: string, asDraft: boolean): Promise<void> {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Item not found for relisting");

  const domain = getDomain(settings.site);

  await vintedApi.createListing(item, { asDraft, domain });
  item.updatedAt = new Date().toISOString();
  saveItems(state.items);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("item-relisted", { itemId, item });
  }
}

const relistingManager = new RelistingManager({
  getSettings,
  onRelist: handleRelist,
});

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

  setupIpc(state, getSettings, setSettings, getWindow, polling, relistingManager);
  createWindow();
  createTray();

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

  // Reset the hidden browser window after sleep so the next API call gets a fresh context
  powerMonitor.on("resume", () => {
    console.log("[main] System resumed from sleep — resetting Vinted client window");
    vintedApi.resetClientWindow();

    // Re-validate session — if still valid, polling will recover on its next tick;
    // if not, notify the renderer so the user can re-login
    const resumeDomain = getDomain(settings.site);
    vintedApi
      .checkSession(resumeDomain)
      .then((result) => {
        console.log(`[main] Post-resume session check: loggedIn=${result.loggedIn}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("session-status", result);
        }
        if (result.loggedIn) {
          polling.start(); // idempotent — ensures polling is running
        }
      })
      .catch((err: Error) => {
        console.warn("[main] Post-resume session check failed:", err.message);
      });
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
