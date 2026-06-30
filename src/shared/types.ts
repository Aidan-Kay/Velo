// ─── Vinted Listing (from API) ────────────────────────────────────────────────

export interface VintedListing {
  id: number;
  title: string;
  description: string;
  price: string | null;
  priceNumeric: number | null;
  currency: string;
  thumbnail: string | null;
  photos: string[];
  views: number;
  favourites: number;
  createdAt: string | null;
  updatedAt: string | null;
  status: string;
  statusRaw: number;
  url: string;
  brandTitle: string;
  sizeTitle: string;
  categoryId: number | null;
  color1: string;
  color2: string;
}

// ─── Local Item (draft inventory) ─────────────────────────────────────────────

export interface LocalItem {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  categoryId: number | null;
  conditionId: number | null;
  brandId: number | null;
  sizeId: number | null;
  color1Id: number | null;
  color2Id: number | null;
  packageSizeId: number | null;
  shippingMethodId: number | null;
  photos: string[];
  stock: number;
  /** Whether automatic relisting is enabled for this item. Defaults to true. */
  relistingEnabled: boolean;
  /** Dynamic category-specific attribute values: { attributeCode: valueId | valueId[] } */
  categoryAttributes: Record<string, number | number[]>;
  // Extended listing fields (optional — not present on older saved items)
  videoGameRatingId?: number | null;
  measurementLength?: number | null;
  measurementWidth?: number | null;
  isbn?: string | null;
  manufacturer?: string | null;
  manufacturerLabelling?: string | null;
  model?: string | null;
  domesticShipmentPrice?: number | null;
  internationalShipmentPrice?: number | null;
  /** Auto-accept offer % threshold for this item. null = use global setting. */
  autoAcceptOfferPercent: number | null;
  /** User-defined tags for organisation and filtering. */
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Order ────────────────────────────────────────────────────────────────────

export type OrderStatus = "needs_action" | "waiting" | "complete";
export type OrderStage =
  | "payment_successful"
  | "label_sent"
  | "label_failed"
  | "shipped"
  | "delivered"
  | "complete"
  | "cancelled"
  | "await_pickup"
  | "unknown";

export interface Order {
  id: number;
  transactionId: number | null;
  conversationId: number | null;
  conversationUrl: string | null;
  itemTitle: string;
  itemThumbnail: string | null;
  price: string | null;
  priceNumeric: number | null;
  currency: string;
  buyerId: number | null;
  buyerUsername: string;
  buyerAvatar: string | null;
  courier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shipmentId: number | null;
  shipmentStatus: number | null;
  carrierLogoUrl: string | null;
  estimatedDelivery: string | null;
  status: OrderStatus;
  orderStatus: OrderStage;
  statusLabel: string;
  createdAt: string | null;
  completedAt: string | null;
  isBundle: boolean;
  bundleItems: Array<{ title: string; thumbnail: string | null }>;
  /** Whether stock was replenished after this order was cancelled. */
  stockReplenished?: boolean;
  /** Whether stock was already reduced for this order. */
  stockReduced?: boolean;
  /** Whether the seller has manually marked this order as packed. */
  packed?: boolean;
  /** Whether the buyer profile link has been resolved. */
  buyerProfileUrl?: string | null;
}

// ─── Category / Catalog Tree ──────────────────────────────────────────────────

export interface CategoryNode {
  id: number;
  code: string;
  title: string;
  path: string;
  catalogs: CategoryNode[];
  color_field_visibility?: number;
  size_field_visibility?: number;
  brand_field_visibility?: number;
  multiple_size_group_ids?: number[];
}

// ─── Category Attributes ──────────────────────────────────────────────────────

export interface CategoryAttributeOption {
  id: number;
  title: string;
  type: "default" | "group";
  description?: string;
  group_title?: string;
  has_children?: boolean;
  options?: CategoryAttributeOption[];
}

export interface CategoryAttributeConfig {
  title: string;
  description: string | null;
  placeholder: string | null;
  field_placeholder: string | null;
  display_type: string; // "list_search", "select", etc.
  selection_type: string; // "single", "multiple"
  selection_limit: number;
  required: boolean;
  options: CategoryAttributeOption[];
}

export interface CategoryAttribute {
  code: string;
  value_ids: number[] | null;
  value: unknown;
  configuration: CategoryAttributeConfig;
}

// ─── Conditions ───────────────────────────────────────────────────────────────

export interface Condition {
  id: number;
  title: string;
  explanation: string;
}

// ─── Package Sizes ────────────────────────────────────────────────────────────

export interface PackageSize {
  id: number;
  code: string;
  title: string;
  name: string;
  description: string;
  weight_description: string;
}

// ─── Journey Summary ──────────────────────────────────────────────────────────

export interface JourneySummaryResult {
  trackingCode: string | null;
  trackingUrl: string | null;
  carrierLogoUrl: string | null;
  carrierCode: string | null;
  estimatedDelivery: string | null;
  status: string | null;
}

// ─── Transaction Detail ───────────────────────────────────────────────────────

export interface TransactionDetail {
  id: number;
  buyer?: { id?: number; login?: string; photo?: { url?: string } };
  seller?: { id?: number; login?: string; photo?: { url?: string } };
  item?: { id?: number; title?: string; photos?: Array<{ thumbnails?: Array<{ type: string; url: string }> }> };
  shipment?: {
    id?: number;
    status?: number;
    carrier_code?: string;
    tracking_code?: string;
    tracking_url?: string;
  };
  order?: {
    item_count?: number;
    item_ids?: number[];
    items?: Array<{
      id?: number;
      title?: string;
      photos?: Array<{ thumbnails?: Array<{ type: string; url: string }> }>;
    }>;
  };
  items_count?: number;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface RelistingSettings {
  enabled: boolean;
  listAsDraft: boolean;
  delayMinutes: number;
}

export interface BulkRepostSettings {
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
}

export interface LabelPrinterSettings {
  printerName: string;
  paperSize: string;
}

export type LabelTypePreference = "printable" | "digital";

export interface PollingIntervalSettings {
  ordersMinutes: number;
  listingsMinutes: number;
  purchasesMinutes: number;
  offersMinutes: number;
}

export interface RelistScheduledStartSettings {
  enabled: boolean;
  /** "HH:MM" 24h local time, e.g. "19:00". null when not set. */
  time: string | null;
}

export interface PriceRulePreset {
  id: string;
  percentOff: number;
  olderThanDays: number;
}

export interface OfferAutomationRule {
  id: string;
  tag: string;
  itemCount: number;
  minimumOfferAmount: number;
}

export type AiAssistProvider = "openai" | "ollama" | "llamacpp";

export interface AiAssistSettings {
  provider: AiAssistProvider;
  openaiApiKey?: string;
  openaiModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  llamacppEndpoint?: string;
  llamacppModel?: string;
  systemPrompt?: string;
}

export interface AppSettings {
  site: string;
  minimizeToTray: boolean;
  darkMode: boolean;
  relisting: RelistingSettings;
  bulkRepost: BulkRepostSettings;
  labelPrinter?: LabelPrinterSettings;
  pollingIntervals: PollingIntervalSettings;
  /** Whether to automatically reduce item stock when an order is placed. */
  reduceStockOnOrdered: boolean;
  /** Whether to automatically generate shipping labels when new orders are found. */
  autoGenerateLabels: boolean;
  /** Preferred label type when generating shipping labels ("printable" or "digital"). */
  preferredLabelType: LabelTypePreference;
  /** Global auto-accept offer threshold (percentage). null = disabled. */
  autoAcceptOfferPercent: number | null;
  /** Global auto-ignore offer threshold (percentage). Offers below this percentage of the original price are auto-ignored locally. null = disabled. */
  autoIgnoreOfferPercent: number | null;
  /** Whether to show Windows native notifications for new orders and offers. */
  enableNativeNotifications: boolean;
  /** Optional gate that defers the next due relist until a wall-clock time today (HH:MM, local). */
  relistScheduledStart: RelistScheduledStartSettings;
  /** User-managed bundle offer auto-accept rules. */
  offerAutomationRules: OfferAutomationRule[];
  /** User-managed bulk price rule presets. */
  priceRulePresets: PriceRulePreset[];
  /** AI assist provider configuration for title/description generation. */
  aiAssist: AiAssistSettings;
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose" | "silly";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  raw: string;
}

export interface LogQuery {
  levels?: LogLevel[];
  search?: string;
  limit?: number;
  offsetFromEnd?: number;
}

// ─── Bulk Price Rule ──────────────────────────────────────────────────────────

export interface BulkPriceRuleInput {
  percentOff: number;
  olderThanDays: number;
  dryRun?: boolean;
}

export interface BulkPriceRuleResult {
  matched: number;
  updated: number;
  failed: Array<{ listingId: number; error: string }>;
}

export interface BulkPriceProgress {
  index: number;
  total: number;
  listingId: number;
  ok: boolean;
  error?: string;
}

// ─── AI Assist ────────────────────────────────────────────────────────────────

export interface AiListingDraft {
  title: string;
  description: string;
}

// ─── Shipment Status Codes ────────────────────────────────────────────────────

export const SHIPMENT_STATUS = {
  NO_LABEL: 1,
  LABEL_GENERATED: 230,
  IN_TRANSIT: 300,
  DELIVERED: 400,
} as const;

// ─── Order Delta (for efficient IPC) ──────────────────────────────────────────

export interface OrderDelta {
  upserted: Order[];
  removedIds: number[];
}

// ─── Listing Delta (for efficient IPC) ────────────────────────────────────────

export interface ListingDelta {
  upserted: VintedListing[];
  removedIds: number[];
}

// ─── Purchase (buyer perspective) ─────────────────────────────────────────────

export interface Purchase {
  id: number;
  transactionId: number | null;
  conversationId: number | null;
  conversationUrl: string | null;
  itemTitle: string;
  itemThumbnail: string | null;
  price: string | null;
  priceNumeric: number | null;
  currency: string;
  sellerId: number | null;
  sellerUsername: string;
  sellerAvatar: string | null;
  sellerProfileUrl: string | null;
  courier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shipmentId: number | null;
  shipmentStatus: number | null;
  carrierLogoUrl: string | null;
  estimatedDelivery: string | null;
  status: OrderStatus;
  orderStatus: OrderStage;
  statusLabel: string;
  createdAt: string | null;
  completedAt: string | null;
  isBundle: boolean;
  bundleItems: Array<{ title: string; thumbnail: string | null }>;
}

export interface PurchaseDelta {
  upserted: Purchase[];
  removedIds: number[];
}

// ─── Received Offer ───────────────────────────────────────────────────────────

export type OfferStatus = "pending" | "accepted" | "cancelled" | "ignored" | "countered";

export interface OfferPrice {
  amount: string;
  currencyCode: string;
}

export interface ReceivedOffer {
  id: number;
  transactionId: number;
  conversationId: number;
  offerRequestId: number;
  itemId: number;
  itemTitle: string;
  itemThumbnail: string | null;
  isBundle: boolean;
  bundleItemIds: number[];
  bundleItems: Array<{ title: string; thumbnail: string | null }>;
  conversationUrl: string | null;
  buyerId: number;
  buyerUsername: string;
  buyerAvatar: string | null;
  buyerProfileUrl: string | null;
  originalPrice: OfferPrice;
  originalPriceLabel: string;
  offerPrice: OfferPrice;
  offerPriceLabel: string;
  status: OfferStatus;
  statusTitle: string;
  current: boolean;
  offeredAt: string;
  autoAccepted?: boolean;
}

export interface OfferDelta {
  upserted: ReceivedOffer[];
  removedIds: number[];
}

export interface SellerOfferOptions {
  minPrice: number | null;
  maxPrice: number | null;
  currency: string;
}

export interface InboxConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
  unread: boolean;
  oppositeUser: {
    id: number | null;
    login: string;
    avatarUrl: string | null;
  };
}

export interface ConversationMessage {
  id: number;
  entityType: string;
  body: string | null;
  createdAt: string;
  fromUserId: number | null;
  isOwnMessage: boolean;
}

export interface ConversationDetail {
  id: number;
  oppositeUser: {
    id: number | null;
    login: string;
    avatarUrl: string | null;
    profileUrl: string | null;
  };
  itemTitle: string | null;
  itemThumbnail: string | null;
  messages: ConversationMessage[];
}

export interface InboxDelta {
  upserted: InboxConversationSummary[];
  removedIds: number[];
}

// ─── App Notification ─────────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  type: "new_order" | "new_offer";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  referenceId: number;
  navigateTo: "orders" | "offers";
}

// ─── Relist Queue Entry ───────────────────────────────────────────────────────

export type RelistStatus = "pending" | "processing" | "completed" | "failed";

export interface RelistEntry {
  itemId: string;
  itemTitle: string;
  soldAt: string;
  queuedAt: string;
  relistAt: string | null;
  status: RelistStatus;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface Pagination {
  current_page?: number;
  total_pages?: number;
  total_entries?: number;
  per_page?: number;
}

export interface LoginResult {
  success: boolean;
  userId: number | null;
  error?: string;
}

export interface SessionResult {
  loggedIn: boolean;
  userId: number | null;
}

export interface BulkListResult {
  itemId: string;
  success: boolean;
  error?: string;
}

// ─── IPC API (exposed via contextBridge) ──────────────────────────────────────

export interface PrinterInfo {
  deviceId: string;
  name: string;
  paperSizes: string[];
}

export interface ElectronAPI {
  // Auth
  login: () => Promise<LoginResult>;
  checkSession: () => Promise<SessionResult>;
  logout: () => Promise<void>;
  getLoginStatus: () => Promise<SessionResult>;

  // Listings (cached)
  getMyListings: () => Promise<{ items: VintedListing[]; pagination: Pagination }>;
  refreshMyListings: () => Promise<{ items: VintedListing[]; pagination: Pagination }>;
  refreshSingleListing: (listingId: number) => Promise<VintedListing | null>;
  getListingDetails: (id: number) => Promise<Record<string, unknown>>;
  getItemUploadDetail: (itemId: number) => Promise<Record<string, unknown>>;

  // Orders (cached)
  getMyOrders: () => Promise<{ orders: Order[]; pagination: Pagination }>;
  refreshMyOrders: () => Promise<{ orders: Order[]; pagination: Pagination }>;
  refreshSingleOrder: (transactionId: number) => Promise<Order | null>;
  getTransactionDetail: (transactionId: number) => Promise<TransactionDetail>;
  getShippingLabelUrl: (shipmentId: number) => Promise<{ label_url: string }>;
  getJourneySummary: (transactionId: number) => Promise<JourneySummaryResult>;
  replenishOrderStock: (transactionId: number) => Promise<{ success: boolean }>;
  setOrderPacked: (transactionId: number, packed: boolean) => Promise<{ success: boolean }>;

  // Purchases (cached)
  getMyPurchases: () => Promise<{ purchases: Purchase[]; pagination: Pagination }>;
  refreshMyPurchases: () => Promise<{ purchases: Purchase[]; pagination: Pagination }>;
  refreshSinglePurchase: (transactionId: number) => Promise<Purchase | null>;

  // Offers (cached)
  getReceivedOffers: () => Promise<{ offers: ReceivedOffer[] }>;
  refreshReceivedOffers: () => Promise<{ offers: ReceivedOffer[]; latestTimestamp: string | null }>;
  acceptOffer: (transactionId: number, offerRequestId: number) => Promise<{ success: boolean }>;
  counterOffer: (transactionId: number, price: number, currency: string) => Promise<{ success: boolean }>;
  getSellerOfferOptions: (transactionId: number) => Promise<SellerOfferOptions>;
  ignoreOffer: (offerRequestId: number) => Promise<{ success: boolean }>;
  unignoreOffer: (offerRequestId: number) => Promise<{ success: boolean }>;

  // Inbox
  getInboxConversations: (page?: number) => Promise<{ conversations: InboxConversationSummary[]; pagination: Pagination }>;
  getConversationDetail: (conversationId: number) => Promise<ConversationDetail>;
  sendMessage: (conversationId: number, body: string) => Promise<{ success: boolean }>;

  // Listing actions
  createListing: (itemData: Partial<LocalItem>, options?: { asDraft?: boolean }) => Promise<Record<string, unknown>>;
  publishListing: (id: number) => Promise<Record<string, unknown>>;
  deleteListing: (id: number, isDraft: boolean) => Promise<{ success: boolean }>;

  // Local items
  getItems: () => Promise<LocalItem[]>;
  saveItem: (item: Partial<LocalItem>) => Promise<LocalItem>;
  deleteItem: (id: string) => Promise<{ success: boolean }>;
  bulkListItems: (itemIds: string[], options?: { asDraft?: boolean }) => Promise<BulkListResult[]>;

  // Item upload helpers
  getCategories: () => Promise<CategoryNode[]>;
  getCategoryAttributes: (categoryId: number) => Promise<CategoryAttribute[]>;
  getConditions: (catalogId: number) => Promise<Condition[]>;
  getPackageSizes: (catalogId: number) => Promise<PackageSize[]>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;

  // Label / printing
  printShippingLabel: (shipmentId: number, courier: string) => Promise<{ success: boolean }>;
  openRawShippingLabel: (shipmentId: number) => Promise<{ success: boolean }>;
  orderShippingLabel: (transactionId: number) => Promise<{ success: boolean }>;
  getPrinters: () => Promise<PrinterInfo[]>;
  getPaperSizes: (printerName: string) => Promise<string[]>;

  // Relisting
  getRelistQueue: () => Promise<RelistEntry[]>;
  queueForRelist: (itemId: string, soldAt: string) => Promise<{ success: boolean }>;
  removeFromRelistQueue: (itemId: string) => Promise<{ success: boolean }>;

  // Notifications
  getNotifications: () => Promise<AppNotification[]>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearNotifications: () => Promise<void>;

  // Browser
  openExternal: (url: string) => Promise<void>;

  // Events
  onSessionStatus: (callback: (status: SessionResult) => void) => () => void;
  onItemRelisted: (callback: (data: { itemId: string; item: LocalItem }) => void) => () => void;
  onListingsUpdated: (callback: (data: { items: VintedListing[]; pagination: Pagination }) => void) => () => void;
  onListingsDelta: (callback: (delta: ListingDelta) => void) => () => void;
  onOrdersUpdated: (callback: (data: { orders: Order[]; pagination: Pagination }) => void) => () => void;
  onOrdersDelta: (callback: (delta: OrderDelta) => void) => () => void;
  onPurchasesDelta: (callback: (delta: PurchaseDelta) => void) => () => void;
  onOffersDelta: (callback: (delta: OfferDelta) => void) => () => void;
  onOfferAutoAccepted: (callback: (offer: ReceivedOffer) => void) => () => void;
  onInboxConversationsDelta: (callback: (delta: InboxDelta) => void) => () => void;
  onListingCreationProgress: (callback: (data: { step: string; current: number; total: number }) => void) => () => void;
  onLabelGenerationProgress: (callback: (data: { transactionId: number; step: string }) => void) => () => void;
  onNotificationsUpdated: (callback: (notifications: AppNotification[]) => void) => () => void;
  onNotificationNavigate: (callback: (page: string, referenceId: number) => void) => () => void;

  // Activity log
  getLogEntries: (query?: LogQuery) => Promise<LogEntry[]>;
  openLogFile: () => Promise<{ success: boolean }>;
  clearLogFile: () => Promise<{ success: boolean }>;

  // Bulk price rule
  applyBulkPriceRule: (input: BulkPriceRuleInput) => Promise<BulkPriceRuleResult>;
  onBulkPriceProgress: (callback: (progress: BulkPriceProgress) => void) => () => void;

  // AI assist
  aiGenerateListingDraft: (itemId: string) => Promise<AiListingDraft>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
