import { app } from "electron";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import type {
  AppNotification,
  AppSettings,
  LocalItem,
  Order,
  Pagination,
  Purchase,
  ReceivedOffer,
  RelistEntry,
  VintedListing,
} from "../shared/types";

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

async function readJsonAsync<T>(filename: string, fallback: T): Promise<T> {
  const filePath = path.join(userDataPath, filename);
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Pending write operations keyed by filename, coalesced via debounce. */
const _pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
/** Pending payloads keyed by filename — read by flushAllWrites to write synchronously on shutdown. */
const _pendingPayloads = new Map<string, unknown>();

function writeJsonAsync(filename: string, data: unknown): void {
  // Debounce writes — coalesce rapid successive writes into a single disk write
  const existing = _pendingWrites.get(filename);
  if (existing) clearTimeout(existing);

  _pendingPayloads.set(filename, data);

  _pendingWrites.set(
    filename,
    setTimeout(() => {
      _pendingWrites.delete(filename);
      _pendingPayloads.delete(filename);
      const filePath = path.join(userDataPath, filename);
      fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8").catch((err) => {
        console.error(`[persistence] Failed to write ${filename}:`, (err as Error).message);
      });
    }, 100),
  );
}

/**
 * Synchronously flush all pending debounced writes. Call on app shutdown so
 * the last in-flight write isn't lost when the process exits before the 100ms
 * debounce timer fires.
 */
export function flushAllWrites(): void {
  for (const [filename, timer] of _pendingWrites.entries()) {
    clearTimeout(timer);
    const data = _pendingPayloads.get(filename);
    const filePath = path.join(userDataPath, filename);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error(`[persistence] Failed to flush ${filename} on shutdown:`, (err as Error).message);
    }
  }
  _pendingWrites.clear();
  _pendingPayloads.clear();
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
  pollingIntervals: {
    ordersMinutes: 5,
    listingsMinutes: 15,
    purchasesMinutes: 15,
    offersMinutes: 15,
  },
  reduceStockOnOrdered: true,
  autoGenerateLabels: false,
  preferredLabelType: "printable",
  autoAcceptOfferPercent: null,
  autoIgnoreOfferPercent: null,
  enableNativeNotifications: true,
  relistScheduledStart: { enabled: false, time: null },
  priceRulePresets: [
    { id: "preset-5-7", percentOff: 5, olderThanDays: 7 },
    { id: "preset-10-7", percentOff: 10, olderThanDays: 7 },
  ],
  aiAssist: {
    provider: "openai",
    systemPrompt: "You write concise, accurate Vinted listing titles and descriptions in British English. No emojis.",
  },
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

  // Migrate old reduceStockOnShipped → reduceStockOnOrdered
  const legacySettings = s as unknown as { reduceStockOnShipped?: boolean };
  if (typeof s.reduceStockOnOrdered !== "boolean") {
    s.reduceStockOnOrdered = typeof legacySettings.reduceStockOnShipped === "boolean"
      ? legacySettings.reduceStockOnShipped
      : DEFAULT_SETTINGS.reduceStockOnOrdered;
  }

  // Auto-generate labels
  if (typeof s.autoGenerateLabels !== "boolean") s.autoGenerateLabels = DEFAULT_SETTINGS.autoGenerateLabels;

  // Preferred label type
  if (s.preferredLabelType !== "printable" && s.preferredLabelType !== "digital")
    s.preferredLabelType = DEFAULT_SETTINGS.preferredLabelType;

  // Polling intervals
  if (!s.pollingIntervals || typeof s.pollingIntervals !== "object") s.pollingIntervals = { ...DEFAULT_SETTINGS.pollingIntervals };
  if (typeof s.pollingIntervals.ordersMinutes !== "number" || s.pollingIntervals.ordersMinutes < 1)
    s.pollingIntervals.ordersMinutes = DEFAULT_SETTINGS.pollingIntervals.ordersMinutes;
  if (typeof s.pollingIntervals.listingsMinutes !== "number" || s.pollingIntervals.listingsMinutes < 1)
    s.pollingIntervals.listingsMinutes = DEFAULT_SETTINGS.pollingIntervals.listingsMinutes;
  if (typeof s.pollingIntervals.purchasesMinutes !== "number" || s.pollingIntervals.purchasesMinutes < 1)
    s.pollingIntervals.purchasesMinutes = DEFAULT_SETTINGS.pollingIntervals.purchasesMinutes;
  if (typeof s.pollingIntervals.offersMinutes !== "number" || s.pollingIntervals.offersMinutes < 1)
    s.pollingIntervals.offersMinutes = DEFAULT_SETTINGS.pollingIntervals.offersMinutes;

  // Auto-accept offer percent
  if (s.autoAcceptOfferPercent !== null && (typeof s.autoAcceptOfferPercent !== "number" || s.autoAcceptOfferPercent < 0))
    s.autoAcceptOfferPercent = DEFAULT_SETTINGS.autoAcceptOfferPercent;

  // Auto-ignore offer percent
  if (s.autoIgnoreOfferPercent !== null && (typeof s.autoIgnoreOfferPercent !== "number" || s.autoIgnoreOfferPercent < 0))
    s.autoIgnoreOfferPercent = DEFAULT_SETTINGS.autoIgnoreOfferPercent;

  // Enable native notifications
  if (typeof s.enableNativeNotifications !== "boolean") s.enableNativeNotifications = DEFAULT_SETTINGS.enableNativeNotifications;

  // Scheduled relist start
  if (!s.relistScheduledStart || typeof s.relistScheduledStart !== "object") {
    s.relistScheduledStart = { ...DEFAULT_SETTINGS.relistScheduledStart };
  }
  if (typeof s.relistScheduledStart.enabled !== "boolean") s.relistScheduledStart.enabled = false;
  if (s.relistScheduledStart.time != null && typeof s.relistScheduledStart.time !== "string") s.relistScheduledStart.time = null;

  // Price rule presets
  if (!Array.isArray(s.priceRulePresets)) {
    s.priceRulePresets = [...DEFAULT_SETTINGS.priceRulePresets];
  } else {
    s.priceRulePresets = s.priceRulePresets.filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.percentOff === "number" &&
        p.percentOff > 0 &&
        p.percentOff < 100 &&
        typeof p.olderThanDays === "number" &&
        p.olderThanDays >= 0,
    );
  }

  // AI assist
  if (!s.aiAssist || typeof s.aiAssist !== "object") {
    s.aiAssist = { ...DEFAULT_SETTINGS.aiAssist };
  }
  if (s.aiAssist.provider !== "openai" && s.aiAssist.provider !== "ollama" && s.aiAssist.provider !== "llamacpp") {
    s.aiAssist.provider = "openai";
  }

  return s;
}

export async function loadSettings(): Promise<AppSettings> {
  const saved = await readJsonAsync<Partial<AppSettings>>("settings.json", {});
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    relisting: { ...DEFAULT_SETTINGS.relisting, ...saved.relisting },
    bulkRepost: { ...DEFAULT_SETTINGS.bulkRepost, ...saved.bulkRepost },
    pollingIntervals: { ...DEFAULT_SETTINGS.pollingIntervals, ...saved.pollingIntervals },
    relistScheduledStart: { ...DEFAULT_SETTINGS.relistScheduledStart, ...saved.relistScheduledStart },
    priceRulePresets: saved.priceRulePresets ?? DEFAULT_SETTINGS.priceRulePresets,
    aiAssist: { ...DEFAULT_SETTINGS.aiAssist, ...saved.aiAssist },
  };
  return validateSettings(merged);
}

export function saveSettings(settings: AppSettings): void {
  writeJsonAsync("settings.json", settings);
}

// ─── Items (Local Draft Inventory) ────────────────────────────────────────────

export async function loadItems(): Promise<LocalItem[]> {
  return readJsonAsync<LocalItem[]>("items.json", []);
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

export async function loadCachedListings(): Promise<CachedListings> {
  return readJsonAsync<CachedListings>("cached-listings.json", {
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

export async function loadCachedOrders(): Promise<CachedOrders> {
  return readJsonAsync<CachedOrders>("cached-orders.json", {
    orders: [],
    pagination: {},
    fetchedAt: "",
  });
}

export function saveCachedOrders(data: CachedOrders): void {
  writeJsonAsync("cached-orders.json", data);
}

// ─── Cached Purchases ─────────────────────────────────────────────────────────

interface CachedPurchases {
  purchases: Purchase[];
  pagination: Pagination;
  fetchedAt: string;
}

export async function loadCachedPurchases(): Promise<CachedPurchases> {
  return readJsonAsync<CachedPurchases>("cached-purchases.json", {
    purchases: [],
    pagination: {},
    fetchedAt: "",
  });
}

export function saveCachedPurchases(data: CachedPurchases): void {
  writeJsonAsync("cached-purchases.json", data);
}

// ─── Cached Offers ────────────────────────────────────────────────────────────

interface CachedOffers {
  offers: ReceivedOffer[];
  lastPollTimestamp: string | null;
  fetchedAt: string;
}

export async function loadCachedOffers(): Promise<CachedOffers> {
  return readJsonAsync<CachedOffers>("cached-offers-received.json", {
    offers: [],
    lastPollTimestamp: null,
    fetchedAt: "",
  });
}

export function saveCachedOffers(data: CachedOffers): void {
  writeJsonAsync("cached-offers-received.json", data);
}

// ─── Notifications ────────────────────────────────────────────────────────────

const MAX_NOTIFICATIONS = 100;

export async function loadNotifications(): Promise<AppNotification[]> {
  return readJsonAsync<AppNotification[]>("notifications.json", []);
}

export function saveNotifications(notifications: AppNotification[]): void {
  const trimmed = notifications.length > MAX_NOTIFICATIONS ? notifications.slice(-MAX_NOTIFICATIONS) : notifications;
  writeJsonAsync("notifications.json", trimmed);
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
