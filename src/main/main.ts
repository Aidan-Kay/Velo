import { app, BrowserWindow, Menu, net, powerMonitor, protocol, screen, Tray } from "electron";
import log from "electron-log/main";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

import type { AppSettings } from "../shared/types";
import { buildAppStateBundle, createInitialState } from "./app-state";
import { setupIpc } from "./ipc-handlers";
import {
  DEFAULT_SETTINGS,
  flushAllWrites,
  loadCachedListings,
  loadCachedOffers,
  loadCachedOrders,
  loadCachedPurchases,
  loadItems,
  loadNotifications,
  loadSettings,
  loadWindowState,
  saveItems,
  saveWindowState,
} from "./persistence";
import { PollingManager } from "./polling";
import { RelistingManager } from "./relisting";
import { getDomain } from "./shared/constants";
import { isTransientError } from "./shared/retry";
import * as vintedApi from "./vinted/api";

// ─── Logging ──────────────────────────────────────────────────────────────────
log.initialize();
log.transports.file.maxSize = 5 * 1024 * 1024;
Object.assign(console, log.functions);

// ─── App Identity ─────────────────────────────────────────────────────────────
app.name = "Velo";
if (process.platform === "win32") {
  app.setAppUserModelId("Velo");
}

// ─── Chromium Stability ───────────────────────────────────────────────────────
app.commandLine.appendSwitch("disable-quic");

// ─── Single Instance Lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ─── Shared Mutable State ─────────────────────────────────────────────────────
const state = createInitialState();

let settings: AppSettings = { ...DEFAULT_SETTINGS };
const getSettings = (): AppSettings => settings;
const setSettings = (s: AppSettings): void => {
  settings = s;
};

let mainWindow: BrowserWindow | null = null;
const getWindow = (): BrowserWindow | null => mainWindow;

let tray: Tray | null = null;
let isQuitting = false;
let resumeRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Polling Manager ──────────────────────────────────────────────────────
// State updates, delta computation, persistence, and renderer push events
// are encapsulated in app-state.ts. This file only wires the bundle to
// PollingManager and supplies the domain getter.

const { notifDeps: notificationDeps, pollingCallbacks } = buildAppStateBundle({ state, getSettings, getWindow });

const polling = new PollingManager({
  ...pollingCallbacks,
  getDomain: () => getDomain(settings.site),
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
              " style-src 'self' 'unsafe-inline';" +
              " font-src 'self';" +
              " img-src 'self' file: local-file: data: https://*.vinted.co.uk https://*.vinted.fr https://*.vinted.de https://*.vinted.be https://*.vinted.es https://*.vinted.it https://*.vinted.nl https://*.vinted.pl https://*.vinted.com https://*.vinted.net;",
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
  tray.setToolTip("Velo");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Velo",
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

// ─── Custom Protocol ──────────────────────────────────────────────────────────
// Register a custom 'local-file' protocol so the renderer can load local item
// photos when served from http://localhost (Vite dev server).
protocol.registerSchemesAsPrivileged([
  { scheme: "local-file", privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } },
]);

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const clearResumeRecoveryTimer = (): void => {
    if (resumeRecoveryTimer) {
      clearTimeout(resumeRecoveryTimer);
      resumeRecoveryTimer = null;
    }
  };

  const runPostResumeRecovery = (attempt = 1): void => {
    clearResumeRecoveryTimer();
    console.log(`[main] Resume recovery attempt ${attempt}`);
    vintedApi.resetClientWindow();

    const resumeDomain = getDomain(settings.site);
    vintedApi
      .checkSession(resumeDomain)
      .then((result) => {
        clearResumeRecoveryTimer();
        console.log(`[main] Post-resume session check: loggedIn=${result.loggedIn}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("session-status", result);
        }

        if (result.loggedIn) {
          polling.recoverAfterResume();
          return;
        }

        polling.stop();
      })
      .catch((err: Error) => {
        if (isTransientError(err)) {
          const delay = Math.min(30_000, Math.max(5_000, attempt * 5_000));
          console.warn(
            `[main] Post-resume session check failed on attempt ${attempt}: ${err.message}. Retrying in ${Math.round(delay / 1000)}s`,
          );
          resumeRecoveryTimer = setTimeout(() => runPostResumeRecovery(attempt + 1), delay);
          return;
        }

        console.warn("[main] Post-resume session check failed:", err.message);
      });
  };

  // Handle local-file:// requests by resolving to file:// paths
  protocol.handle("local-file", (request) => {
    // Extract the filesystem path from the custom URL and convert properly
    // local-file://C:/Users/... → file:///C:/Users/... (pathToFileURL handles platform differences)
    const filePath = decodeURIComponent(request.url.replace(/^local-file:\/\/\/?/, ""));
    return net.fetch(pathToFileURL(filePath).href);
  });

  // Load all persisted data in parallel (async I/O)
  const [loadedSettings, loadedItems, loadedListings, loadedOrders, loadedPurchases, loadedOffers, loadedNotifications] = await Promise.all(
    [loadSettings(), loadItems(), loadCachedListings(), loadCachedOrders(), loadCachedPurchases(), loadCachedOffers(), loadNotifications()],
  );

  settings = loadedSettings;
  state.items = loadedItems;
  state.cachedListings = loadedListings.items;
  state.cachedListingsPagination = loadedListings.pagination;
  state.cachedOrders = loadedOrders.orders;
  state.cachedOrdersPagination = loadedOrders.pagination;
  state.cachedPurchases = loadedPurchases.purchases;
  state.cachedPurchasesPagination = loadedPurchases.pagination;
  state.cachedOffers = loadedOffers.offers;
  state.lastOfferPollTimestamp = loadedOffers.lastPollTimestamp;
  state.notifications = loadedNotifications;

  // One-time migration: legacy photo URLs → local-file:/// protocol
  let itemsMigrated = false;
  for (const item of state.items) {
    if (item.photos) {
      const migrated = item.photos.map((p) => {
        // Legacy file:// → local-file:///
        if (p.startsWith("file://")) return p.replace("file://", "local-file://");
        // Fix two-slash local-file:// → three-slash local-file:///
        if (p.startsWith("local-file://") && !p.startsWith("local-file:///")) {
          return p.replace("local-file://", "local-file:///");
        }
        return p;
      });
      if (migrated.some((p, i) => p !== item.photos[i])) {
        item.photos = migrated;
        itemsMigrated = true;
      }
    }
  }
  if (itemsMigrated) saveItems(state.items);

  setupIpc({ state, getSettings, setSettings, getWindow, polling, relisting: relistingManager, notifDeps: notificationDeps });
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
  powerMonitor.on("suspend", () => {
    console.log("[main] System suspending — stopping polling so no fetches are mid-flight at sleep");
    polling.stop();
  });

  powerMonitor.on("resume", () => {
    console.log("[main] System resumed from sleep — checking session and rebuilding polling timers");
    runPostResumeRecovery();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (resumeRecoveryTimer) {
    clearTimeout(resumeRecoveryTimer);
    resumeRecoveryTimer = null;
  }
  // Flush any pending debounced writes synchronously so the final state is persisted.
  try {
    flushAllWrites();
  } catch (err) {
    console.error("[main] flushAllWrites failed:", (err as Error).message);
  }
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
