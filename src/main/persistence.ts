import { app } from "electron";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import type { AppSettings, LocalItem, Order, Pagination, RelistEntry, VintedListing } from "../shared/types";

export const userDataPath: string = app.getPath("userData");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSync<T>(filename: string, fallback: T): T {
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

/** Pending write operations keyed by filename, coalesced via debounce. */
const _pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function writeJsonAsync(filename: string, data: unknown): void {
  // Debounce writes — coalesce rapid successive writes into a single disk write
  const existing = _pendingWrites.get(filename);
  if (existing) clearTimeout(existing);

  _pendingWrites.set(
    filename,
    setTimeout(() => {
      _pendingWrites.delete(filename);
      const filePath = path.join(userDataPath, filename);
      fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8").catch((err) => {
        console.error(`[persistence] Failed to write ${filename}:`, (err as Error).message);
      });
    }, 100),
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  site: "co.uk",
  minimizeToTray: false,
  darkMode: true,
  relisting: {
    enabled: false,
    listAsDraft: true,
    delayMinutes: 30,
  },
  bulkRepost: {
    minIntervalSeconds: 30,
    maxIntervalSeconds: 60,
  },
  reduceStockOnShipped: true,
  autoGenerateLabels: false,
  preferredLabelType: "printable",
};

/** Validate and normalise settings to guard against corrupted data on disk. */
function validateSettings(s: AppSettings): AppSettings {
  if (typeof s.site !== "string" || !s.site) s.site = DEFAULT_SETTINGS.site;
  if (typeof s.minimizeToTray !== "boolean") s.minimizeToTray = DEFAULT_SETTINGS.minimizeToTray;
  if (typeof s.darkMode !== "boolean") s.darkMode = DEFAULT_SETTINGS.darkMode;

  // Relisting
  if (typeof s.relisting.enabled !== "boolean") s.relisting.enabled = DEFAULT_SETTINGS.relisting.enabled;
  if (typeof s.relisting.listAsDraft !== "boolean") s.relisting.listAsDraft = DEFAULT_SETTINGS.relisting.listAsDraft;
  if (typeof s.relisting.delayMinutes !== "number" || s.relisting.delayMinutes < 0)
    s.relisting.delayMinutes = DEFAULT_SETTINGS.relisting.delayMinutes;

  // Bulk repost
  if (typeof s.bulkRepost.minIntervalSeconds !== "number" || s.bulkRepost.minIntervalSeconds < 0)
    s.bulkRepost.minIntervalSeconds = DEFAULT_SETTINGS.bulkRepost.minIntervalSeconds;
  if (typeof s.bulkRepost.maxIntervalSeconds !== "number" || s.bulkRepost.maxIntervalSeconds < 0)
    s.bulkRepost.maxIntervalSeconds = DEFAULT_SETTINGS.bulkRepost.maxIntervalSeconds;
  if (s.bulkRepost.maxIntervalSeconds < s.bulkRepost.minIntervalSeconds) s.bulkRepost.maxIntervalSeconds = s.bulkRepost.minIntervalSeconds;

  // Reduce stock on shipped
  if (typeof s.reduceStockOnShipped !== "boolean") s.reduceStockOnShipped = DEFAULT_SETTINGS.reduceStockOnShipped;

  // Auto-generate labels
  if (typeof s.autoGenerateLabels !== "boolean") s.autoGenerateLabels = DEFAULT_SETTINGS.autoGenerateLabels;

  // Preferred label type
  if (s.preferredLabelType !== "printable" && s.preferredLabelType !== "digital")
    s.preferredLabelType = DEFAULT_SETTINGS.preferredLabelType;

  return s;
}

export function loadSettings(): AppSettings {
  const saved = readJsonSync<Partial<AppSettings>>("settings.json", {});
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    relisting: { ...DEFAULT_SETTINGS.relisting, ...saved.relisting },
    bulkRepost: { ...DEFAULT_SETTINGS.bulkRepost, ...saved.bulkRepost },
  };
  return validateSettings(merged);
}

export function saveSettings(settings: AppSettings): void {
  writeJsonAsync("settings.json", settings);
}

// ─── Items (Local Draft Inventory) ────────────────────────────────────────────

export function loadItems(): LocalItem[] {
  return readJsonSync<LocalItem[]>("items.json", []);
}

export function saveItems(items: LocalItem[]): void {
  writeJsonAsync("items.json", items);
}

// ─── Cached Listings ──────────────────────────────────────────────────────────

interface CachedListings {
  items: VintedListing[];
  pagination: Pagination;
  fetchedAt: string;
}

export function loadCachedListings(): CachedListings {
  return readJsonSync<CachedListings>("cached-listings.json", {
    items: [],
    pagination: {},
    fetchedAt: "",
  });
}

export function saveCachedListings(data: CachedListings): void {
  writeJsonAsync("cached-listings.json", data);
}

// ─── Cached Orders ────────────────────────────────────────────────────────────

interface CachedOrders {
  orders: Order[];
  pagination: Pagination;
  fetchedAt: string;
}

export function loadCachedOrders(): CachedOrders {
  return readJsonSync<CachedOrders>("cached-orders.json", {
    orders: [],
    pagination: {},
    fetchedAt: "",
  });
}

export function saveCachedOrders(data: CachedOrders): void {
  writeJsonAsync("cached-orders.json", data);
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
  return readJsonSync<WindowState | null>("window-state.json", null);
}

export function saveWindowState(win: Electron.BrowserWindow): void {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    writeJsonAsync("window-state.json", {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }, 500);
}

// ─── Relist Queue ─────────────────────────────────────────────────────────────────

export function loadRelistQueue(): RelistEntry[] {
  return readJsonSync<RelistEntry[]>("restock-queue.json", []);
}

export function saveRelistQueue(queue: RelistEntry[]): void {
  writeJsonAsync("restock-queue.json", queue);
}
