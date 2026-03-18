import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { AppSettings, LocalItem, Order, Pagination, RestockEntry, VintedListing } from "../shared/types";

export const userDataPath: string = app.getPath("userData");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(filename: string, fallback: T): T {
  const filePath = path.join(userDataPath, filename);
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[persistence] Failed to read ${filename}:`, (err as Error).message);
    return fallback;
  }
}

function writeJson(filename: string, data: unknown): void {
  const filePath = path.join(userDataPath, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`[persistence] Failed to write ${filename}:`, (err as Error).message);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  site: "co.uk",
  minimizeToTray: false,
  darkMode: true,
  restocking: {
    enabled: false,
    listAsDraft: true,
    delayMinutes: 30,
  },
  bulkRepost: {
    minIntervalSeconds: 30,
    maxIntervalSeconds: 60,
  },
};

/** Validate and normalise settings to guard against corrupted data on disk. */
function validateSettings(s: AppSettings): AppSettings {
  if (typeof s.site !== "string" || !s.site) s.site = DEFAULT_SETTINGS.site;
  if (typeof s.minimizeToTray !== "boolean") s.minimizeToTray = DEFAULT_SETTINGS.minimizeToTray;
  if (typeof s.darkMode !== "boolean") s.darkMode = DEFAULT_SETTINGS.darkMode;

  // Restocking
  if (typeof s.restocking.enabled !== "boolean") s.restocking.enabled = DEFAULT_SETTINGS.restocking.enabled;
  if (typeof s.restocking.listAsDraft !== "boolean") s.restocking.listAsDraft = DEFAULT_SETTINGS.restocking.listAsDraft;
  if (typeof s.restocking.delayMinutes !== "number" || s.restocking.delayMinutes < 0)
    s.restocking.delayMinutes = DEFAULT_SETTINGS.restocking.delayMinutes;

  // Bulk repost
  if (typeof s.bulkRepost.minIntervalSeconds !== "number" || s.bulkRepost.minIntervalSeconds < 0)
    s.bulkRepost.minIntervalSeconds = DEFAULT_SETTINGS.bulkRepost.minIntervalSeconds;
  if (typeof s.bulkRepost.maxIntervalSeconds !== "number" || s.bulkRepost.maxIntervalSeconds < 0)
    s.bulkRepost.maxIntervalSeconds = DEFAULT_SETTINGS.bulkRepost.maxIntervalSeconds;
  if (s.bulkRepost.maxIntervalSeconds < s.bulkRepost.minIntervalSeconds) s.bulkRepost.maxIntervalSeconds = s.bulkRepost.minIntervalSeconds;

  return s;
}

export function loadSettings(): AppSettings {
  const saved = readJson<Partial<AppSettings>>("settings.json", {});
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    restocking: { ...DEFAULT_SETTINGS.restocking, ...saved.restocking },
    bulkRepost: { ...DEFAULT_SETTINGS.bulkRepost, ...saved.bulkRepost },
  };
  return validateSettings(merged);
}

export function saveSettings(settings: AppSettings): void {
  writeJson("settings.json", settings);
}

// ─── Items (Local Draft Inventory) ────────────────────────────────────────────

export function loadItems(): LocalItem[] {
  return readJson<LocalItem[]>("items.json", []);
}

export function saveItems(items: LocalItem[]): void {
  writeJson("items.json", items);
}

// ─── Cached Listings ──────────────────────────────────────────────────────────

interface CachedListings {
  items: VintedListing[];
  pagination: Pagination;
  fetchedAt: string;
}

export function loadCachedListings(): CachedListings {
  return readJson<CachedListings>("cached-listings.json", {
    items: [],
    pagination: {},
    fetchedAt: "",
  });
}

export function saveCachedListings(data: CachedListings): void {
  writeJson("cached-listings.json", data);
}

// ─── Cached Orders ────────────────────────────────────────────────────────────

interface CachedOrders {
  orders: Order[];
  pagination: Pagination;
  fetchedAt: string;
}

export function loadCachedOrders(): CachedOrders {
  return readJson<CachedOrders>("cached-orders.json", {
    orders: [],
    pagination: {},
    fetchedAt: "",
  });
}

export function saveCachedOrders(data: CachedOrders): void {
  writeJson("cached-orders.json", data);
}

// ─── Window State ─────────────────────────────────────────────────────────────

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

let _saveTimeout: ReturnType<typeof setTimeout> | null = null;

export function loadWindowState(): WindowState | null {
  return readJson<WindowState | null>("window-state.json", null);
}

export function saveWindowState(win: Electron.BrowserWindow): void {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    writeJson("window-state.json", {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }, 500);
}

// ─── Restocking Queue ─────────────────────────────────────────────────────────

export function loadRestockQueue(): RestockEntry[] {
  return readJson<RestockEntry[]>("restock-queue.json", []);
}

export function saveRestockQueue(queue: RestockEntry[]): void {
  writeJson("restock-queue.json", queue);
}
