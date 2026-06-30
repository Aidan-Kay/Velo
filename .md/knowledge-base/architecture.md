# Velo — Architecture

## Process Model

```
┌───────────────────────────────────────────────────────────────┐
│  Main Process (src/main/main.ts → dist/main.js)               │
│                                                               │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ BrowserWindow │  │ Hidden       │  │ Tray         │        │
│  │ (UI)          │  │ BrowserWindow│  │              │        │
│  │               │  │ (Vinted API) │  │              │        │
│  └──────┬────────┘  └──────────────┘  └──────────────┘        │
│         │ preload                                             │
│  ┌──────┴──────────┐                                          │
│  │ Preload         │                                          │
│  │ (contextBridge) │                                          │
│  └──────┬──────────┘                                          │
│         │ IPC                                                 │
│  ┌──────┴──────────────────────────────────────────────┐      │
│  │ ipc-handlers.ts  — thin orchestrator                │      │
│  │ ipc/auth, listings, orders, purchases, offers,      │      │
│  │      inbox, items, catalog, settings, notifications,│      │
│  │      system, logs, price-rules, ai — domain-grouped │      │
│  │      ipcMain.handle setup                           │      │
│  ├─────────────────────────────────────────────────────┤      │
│  │ app-state.ts      — shared mutable state, delta     │      │
│  │                     computation, persistence side   │      │
│  │                     effects, renderer push events   │      │
│  ├─────────────────────────────────────────────────────┤      │
│  │ vinted/api.ts     — barrel re-export of sub-modules │      │
│  │ vinted/auth.ts    — authentication functions        │      │
│  │ vinted/listings.ts — listing CRUD, photo upload     │      │
│  │ vinted/orders.ts  — order/transaction fetching      │      │
│  │ vinted/messaging.ts — inbox API                     │      │
│  │ vinted/offers.ts  — offer detection, accept, counter│      │
│  │ vinted/shipping.ts — label ordering & tracking      │      │
│  │ vinted/catalog.ts — categories, conditions, sizes   │      │
│  │ vinted/mappers.ts — raw API → domain type mappers   │      │
│  │ vinted/lib/requester.ts — VintedClient class        │      │
│  │ persistence.ts    — file I/O for settings/items     │      │
│  │ relisting.ts      — RelistingManager class          │      │
│  │ order-enrichment.ts — shared order enrichment logic │      │
└───────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Renderer Process (src/renderer/ → dist/renderer.js)         │
│                                                              │
│  React 19 SPA                                                │
│  ├── App.tsx          — routing, toast system, session mgmt  │
│  ├── components/      — Sidebar, Toast, FilterBar,           │
│  │                       CategoryPicker, EditItemModal,      │
│  │                       CounterOfferModal, SortArrow,       │
│  │                       ProgressModal, DeleteConfirmModal,  │
│  │                       RepostListingModal                  │
│  ├── components/ui/   — shadcn/ui primitives (Button, Input, │
│  │                       Badge, Card, Dialog, Select,        │
│  │                       DropdownMenu, Tooltip, Switch,      │
│  │                       Checkbox, Label, Separator)         │
│  ├── hooks/           — useTableSort, useBulkOperation,      │
│  │                       useListingActions                   │
│  ├── lib/             — cn() utility (clsx + tailwind-merge) │
│  └── pages/           — Dashboard, Listings, Items,          │
│                          Orders, Purchases, Offers, Settings │
│                                                              │
│  Communicates with main only via window.api (ElectronAPI)    │
└──────────────────────────────────────────────────────────────┘
```

## Context Isolation

- The renderer has **no** Node.js access
- All communication goes through `contextBridge` in the preload script
- The `ElectronAPI` interface (src/shared/types.ts) is the contract between preload and renderer

## State, Delta & IPC Plumbing

Main-process shared state and the four polling-update side effects live in `src/main/app-state.ts`, not `main.ts`:

- `createInitialState()` returns the typed `AppState` object (cached listings/orders/purchases/offers, items, notifications, last-offer-poll timestamp).
- `buildAppStateBundle({ state, getSettings, getWindow })` returns:
  - `notifDeps` — dependency-injected getters for the notifications module.
  - `pollingCallbacks` — the four `onXxxUpdated` callbacks plus `onOfferAutoAccepted`. Each callback uses the generic `computeDelta<T, K>(prev, next, keyFn, changedFn)` helper from `src/main/shared/delta.ts` to derive `{ upserted, removedIds }`, persists via `saveCachedXxx`, and pushes the delta to the renderer when there are changes.
- `main.ts` only wires the bundle to `PollingManager` and supplies `getDomain`, keeping the entry file focused on lifecycle (window/tray/protocol/session-recovery).

IPC channels are registered by domain modules under `src/main/ipc/` (auth, listings, orders, purchases, offers, items, catalog, settings, notifications, system). Each module exports a `setupXxxIpc(deps: IpcDeps)` function; `ipc-handlers.ts` is now a ~30-line orchestrator that calls each in turn. Shared dependencies are typed as `IpcDeps` in `src/main/ipc/types.ts`.

## Catalog Cache

`src/main/vinted/catalog.ts` wraps `getCategories`, `getCategoryAttributes`, `getConditions`, and `getPackageSizes` in an in-memory TTL cache (1 hour, keyed by domain + arguments). Modal opens that re-request the same catalog data hit the cache instead of re-fetching. `clearCatalogCache()` is exported for future use (e.g. on logout / site change).

## Shutdown Flush

`persistence.ts` exposes `flushAllWrites()` which synchronously writes every pending debounced payload to disk. `main.ts` calls it inside `app.on("before-quit")` so the last in-flight write (within the 100ms debounce window) is never lost on quit.

## Photo Download Deduplication

`photo-downloader.ts` keeps a `Map<itemId, Promise<string[]>>` of in-flight downloads. Concurrent `save-item` IPC calls for the same item share a single download promise instead of racing each other to write the same files.

## Vinted Integration Flow

### Authentication

1. User clicks "Log in" → renderer calls `window.api.login()`
2. Main process opens a **visible** BrowserWindow pointing to `https://www.vinted.{site}/`
3. User logs in manually; the window watches for navigation to authenticated pages
4. On success, login cookies are stored in the `persist:vinted` session partition
5. The visible window closes; all subsequent API calls reuse the same session

### API Requests

1. `VintedClient` singleton uses a **hidden** BrowserWindow with `persist:vinted` partition
2. Requests are executed via `webContents.executeJavaScript(fetch(...))` inside the hidden window
3. This bypasses CloudFlare anti-bot checks because the hidden browser is a real Chromium context
4. POST/PUT/DELETE requests extract a CSRF token from cookies first
5. If a CloudFlare challenge is detected, the hidden window navigates to the challenge page and waits for resolution
6. A global rate limiter enforces a randomised 0.5–1.5 second gap between any two API calls (mutex pattern in `requester.ts` via `_nextAvailableAt` timestamp; safe under concurrent callers because reservation is atomic in JavaScript's single-threaded model)
7. All HTTP methods (`get`, `post`, `put`, `delete`, `postFile`) share a single `_execute` retry helper inside `VintedClient`. The helper centralises Cloudflare-challenge handling, 401 session-refresh, 403 CSRF-refresh (mutating requests only), network-error window recreation, and exponential backoff. Each public method only constructs the JS fetch source string and delegates retry to `_execute`.

### Session Partition

- Single partition: `persist:vinted`
- Unlike listing-watch (which uses per-domain partitions for anonymous access), this app uses one authenticated session
- Cookies persist across app restarts

## IPC Channels

| Channel                       | Direction       | Purpose                                                                                                                                                           |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------- | --------------- | ---------------------------------------------- | --- | ------------------ | --------------- | ----------------------------------------------------------------------------- | --- | ------------------------ | --------------- | -------------------------------------- |
| `vinted-login`                | renderer → main | Open login window                                                                                                                                                 |
| `vinted-check-session`        | renderer → main | Check if session is valid                                                                                                                                         |
| `vinted-logout`               | renderer → main | Clear session cookies                                                                                                                                             |
| `vinted-login-status`         | renderer → main | Get current login state                                                                                                                                           |
| `get-my-listings`             | renderer → main | Return cached listings (no API call)                                                                                                                              |
| `refresh-my-listings`         | renderer → main | Force API refresh of listings                                                                                                                                     |
| `get-listing-details`         | renderer → main | Fetch single listing detail                                                                                                                                       |
| `get-item-upload-detail`      | renderer → main | Fetch item upload detail (for save-as-item)                                                                                                                       |
| `get-my-orders`               | renderer → main | Return cached orders (no API call)                                                                                                                                |
| `refresh-my-orders`           | renderer → main | Force API refresh of orders                                                                                                                                       |
| `refresh-single-order`        | renderer → main | Re-enrich a single order by transactionId                                                                                                                         |     | `replenish-order-stock` | renderer → main | Replenish stock for items in a cancelled order |     | `set-order-packed` | renderer → main | Set an order's local `packed` flag (routes through `polling.applyOrderPatch`) |     | `refresh-single-listing` | renderer → main | Re-fetch a single listing by listingId |
| `get-transaction-detail`      | renderer → main | Fetch transaction detail (buyer, courier, tracking)                                                                                                               |
| `get-shipping-label-url`      | renderer → main | Get shipping label download URL                                                                                                                                   |
| `get-journey-summary`         | renderer → main | Get shipment tracking / courier journey summary                                                                                                                   |
| `get-categories`              | renderer → main | Fetch category tree                                                                                                                                               |
| `get-category-attributes`     | renderer → main | Fetch dynamic attributes for a category                                                                                                                           |
| `get-conditions`              | renderer → main | Fetch item condition options                                                                                                                                      |
| `get-package-sizes`           | renderer → main | Fetch available package sizes                                                                                                                                     |
| `create-listing`              | renderer → main | Create a listing from local item                                                                                                                                  |
| `publish-listing`             | renderer → main | Publish a draft listing                                                                                                                                           |
| `delete-listing`              | renderer → main | Delete a listing                                                                                                                                                  |
| `get-items`                   | renderer → main | Load local item inventory                                                                                                                                         |
| `save-item`                   | renderer → main | Add or update a local item                                                                                                                                        |
| `delete-item`                 | renderer → main | Delete a local item                                                                                                                                               |
| `bulk-list-items`             | renderer → main | List multiple items at once                                                                                                                                       |
| `get-settings`                | renderer → main | Load app settings                                                                                                                                                 |
| `save-settings`               | renderer → main | Save app settings                                                                                                                                                 |
| `get-relist-queue`            | renderer → main | Load relist queue                                                                                                                                                 |
| `queue-for-relist`            | renderer → main | Add item to relist queue                                                                                                                                          |
| `remove-from-relist-queue`    | renderer → main | Remove from relist queue                                                                                                                                          |
| `open-external`               | renderer → main | Open URL in default browser                                                                                                                                       |
| `print-shipping-label`        | renderer → main | Download, crop, and print a shipping label                                                                                                                        |
| `open-raw-shipping-label`     | renderer → main | Open raw (uncropped) shipping label URL in browser                                                                                                                |
| `order-shipping-label`        | renderer → main | Generate shipping label for an order (uses preferred label type + label_options API fallback)                                                                     |
| `get-printers`                | renderer → main | List available system printers                                                                                                                                    |
| `get-paper-sizes`             | renderer → main | Get paper sizes for a specific printer                                                                                                                            |
| `session-status`              | main → renderer | Push session state changes                                                                                                                                        |
| `item-relisted`               | main → renderer | Notify when item is relisted                                                                                                                                      |
| `label-generation-progress`   | main → renderer | Push per-step progress during shipping label generation                                                                                                           |
| `listings-delta`              | main → renderer | Push delta (upserted + removedIds) from listing polling — renderer applies in-place                                                                               |
| `orders-updated`              | main → renderer | Push full orders array on manual refresh                                                                                                                          |
| `orders-delta`                | main → renderer | Push delta (upserted + removedIds) from polling — also used for one-shot order patches (e.g. stock replenishment) routed through `PollingManager.applyOrderPatch` |
| `listing-creation-progress`   | main → renderer | Push per-step progress during listing creation                                                                                                                    |
| `get-my-purchases`            | renderer → main | Return cached purchases (no API call)                                                                                                                             |
| `refresh-my-purchases`        | renderer → main | Force API refresh of purchases                                                                                                                                    |
| `refresh-single-purchase`     | renderer → main | Re-enrich a single purchase by transactionId                                                                                                                      |
| `get-received-offers`         | renderer → main | Return cached received offers (no API call)                                                                                                                       |
| `refresh-received-offers`     | renderer → main | Force API refresh of received offers                                                                                                                              |
| `accept-offer`                | renderer → main | Accept a buyer's offer                                                                                                                                            |
| `counter-offer`               | renderer → main | Send a counter-offer to a buyer, sets local status to "countered" and persists                                                                                    |
| `get-seller-offer-options`    | renderer → main | Get min/max counter-offer price for a transaction                                                                                                                 |
| `ignore-offer`                | renderer → main | Set an offer's local status to "ignored" and persist                                                                                                              |
| `unignore-offer`              | renderer → main | Revert an ignored offer's status to "pending" and persist                                                                                                         |
| `purchases-delta`             | main → renderer | Push delta (upserted + removedIds) from purchase polling — renderer applies in-place                                                                              |
| `offers-delta`                | main → renderer | Push delta (upserted + removedIds) from offer polling — renderer applies in-place                                                                                 |
| `offer-auto-accepted`         | main → renderer | Notify when an offer is auto-accepted during polling                                                                                                              |
| `get-notifications`           | renderer → main | Load persisted notifications                                                                                                                                      |
| `mark-notification-read`      | renderer → main | Mark single notification as read                                                                                                                                  |
| `mark-all-notifications-read` | renderer → main | Mark all notifications as read                                                                                                                                    |
| `clear-notifications`         | renderer → main | Clear all notifications                                                                                                                                           |
| `notifications-updated`       | main → renderer | Push full notifications array after any change                                                                                                                    |
| `notification-navigate`       | main → renderer | Navigate to page + highlight row (from native notification click)                                                                                                 |
| `get-log-entries`             | renderer → main | Tail-read and parse `main.log`, apply level/search/limit filters, return `LogEntry[]`                                                                             |
| `open-log-file`               | renderer → main | Open the on-disk `main.log` via `shell.openPath`                                                                                                                  |
| `clear-log-file`              | renderer → main | Truncate `main.log` (UI confirms first)                                                                                                                           |
| `apply-bulk-price-rule`       | renderer → main | Apply a `{ percentOff, olderThanDays, dryRun? }` rule to cached active listings; returns `{ matched, updated, failed }`                                           |
| `bulk-price-progress`         | main → renderer | Per-listing progress during a bulk price rule run                                                                                                                 |
| `ai-generate-listing-draft`   | renderer → main | Generate `{ title, description }` for a saved item via the configured AI provider (uses up to 3 of the item's photos)                                             |
| `get-inbox-conversations`     | renderer → main | Fetch paginated inbox conversation summaries                                                                                                                      |
| `get-conversation-detail`     | renderer → main | Fetch full conversation with messages (maps `isOwnMessage` via `client.userId`)                                                                                   |
| `send-message`                | renderer → main | Post a message to a conversation                                                                                                                                  |
| `inbox-conversations-delta`   | main → renderer | Push conversation list updates (defined in types/preload but not currently emitted by polling — reserved for future inbox polling)                                |

## Background Polling

The `PollingManager` (`src/main/polling.ts`) runs in the main process after login. It composes four `PolledResource<T>` instances — one per resource type (listings, orders, purchases, offers) — each owning its own timer, in-flight guard, and rescheduling logic. Per-resource intervals come from `AppSettings.pollingIntervals` (in minutes). Each timer applies ±20% jitter with a 30-second floor.

The `PolledResource<T>` helper class encapsulates the timer/in-flight/scheduling boilerplate; the per-resource fetch logic is supplied as a callback. Order/purchase enrichment shares a single generic `enrichWithCache<T>` routine that maps cached items, reuses cached enrichment when `statusLabel` is unchanged, and only re-fetches transaction detail when the status has progressed.

- **Listings**: polled at the configured interval (default 15 min). Results cached to `cached-listings.json` and delta (changed/removed listings) pushed to renderer via `listings-delta`.
- **Orders**: polled at the configured interval (default 5 min). Response status is compared with cached orders — transaction detail API is only called for orders whose `statusLabel` has changed (or new orders). Shipping instructions API (`getShippingInstructions`) is called for all newly-enriched orders to obtain courier name and carrier logo even before a label is generated. Journey summary API is also called for orders with shipments to get carrier logo and estimated delivery. Enrichment data (buyer, courier, tracking, shipmentId, shipmentStatus, carrierLogoUrl, estimatedDelivery, bundle info) is persisted with the order cache. New orders generate in-app notifications (suppressed on first poll after startup to avoid flooding).
- **Purchases**: polled at the configured interval (default 15 min). Fetches buyer-side orders via `GET /my_orders?type=purchased&status=all`, enriches with transaction detail (seller info). Cached to `cached-purchases.json`, delta pushed via `purchases-delta`.
- **Offers**: polled at the configured interval (default 15 min). Scans inbox conversations updated since last poll timestamp, filters seller-side conversations, extracts `offer_request_message` entities. First run fetches only first inbox page. New offers are merged with existing cache via Map. Auto-accept first evaluates `settings.offerAutomationRules`: a rule matches only when the offer's bundle size exactly matches `itemCount`, the absolute total offer amount meets `minimumOfferAmount`, every offered item title resolves to at least one saved local item via the shared `titleKey()` matcher, and every matched saved item set contains the configured tag. If no automation rule matches, the existing percentage-based auto-accept path runs using the global threshold (or per-item override). Accepted offers are marked `autoAccepted: true` and notified via `offer-auto-accepted`. After auto-accept, an auto-ignore pass mutates `status` to `"ignored"` (local-only, no API call) for any still-pending offer below `autoIgnoreOfferPercent`. Local-only statuses (`"ignored"`, `"countered"`) are preserved across polling merges, yielding only to `"accepted"` / `"cancelled"` from the API. Cached to `cached-offers-received.json`, delta pushed via `offers-delta`. New offers generate in-app notifications (suppressed on first poll after startup).
- **Stock reduction**: when a new order is first seen during polling (not previously in cache), the corresponding local item stock is automatically decremented by 1 for each matching item (matched by title). This behaviour is controlled by the `reduceStockOnOrdered` setting (default: `true`). Each order is marked with `stockReduced: true` to prevent double-reduction. Cancelled orders are skipped. For bundle orders, each bundle item's stock is reduced individually. Only items with `relistingEnabled !== false` are eligible for automatic relisting.
- **Stock replenishment**: cancelled orders have a "Replenish Stock" action in the UI that increases matching item stock by 1 and marks the order with `stockReplenished: true` to disable repeated replenishment. The `stockReplenished`, `stockReduced`, and `packed` flags are preserved across polling updates.
- **Auto-label generation**: when `autoGenerateLabels` is enabled, newly detected orders (not previously in cache) without a label automatically have a shipping label generated. The preferred label type from settings is used, with a fallback via the `label_options` API if the preferred type isn't available for the courier.
- **Single-item refresh**: `refreshSingleOrder(transactionId)` re-enriches one order (transaction detail + journey summary) and updates the cached array in-place. `refreshSingleListing(listingId)` fetches one listing via the item_upload detail API (`/api/v2/item_upload/items/{id}`) and updates/inserts it in the cached listings, preserving cached view/favourite counts (the item_upload API doesn't return these). Both push the updated array to the renderer.
- **Smart relist scheduler**: when `settings.relistScheduledStart.enabled && time` is set, `RelistingManager.checkAndRelist` floors any due `relistTime` at today's `HH:MM` (local). If the configured time has already passed today, the gate is a no-op and normal behaviour resumes. The queue shape and per-item delay logic are unchanged — only the wait-until check is gated.
- **Bulk price edits**: `vinted/listings.ts` exposes `editListingPrice(listingId, newPrice, domain)` which fetches the item-upload detail, rebuilds the same completion payload used by `publishListing`, and overrides only the price. The bulk-price-rule handler iterates cached active listings older than N days, calls `editListingPrice` per match through the global rate-limiter, emits `bulk-price-progress`, and refreshes listings on completion.
- **Rate limiting**: a global mutex queue in `requester.ts` (`_nextAvailableAt` timestamp + atomic reservation) ensures a randomised 0.5–1.5 second gap between any two Vinted API calls across the entire app.
- **Cache preservation on poll failure**: each `fetchListings/Orders/Purchases/Offers` catch block returns the previously cached array (rather than `[]`). Manual-refresh IPC handlers therefore can't briefly wipe renderer state on a transient network error.
- **Pagination cap warning**: when a poll returns exactly `perPage` items the polling layer logs a `console.warn` so we have visibility if a user exceeds the 100-item single-page fetch.
- Polling starts when the user logs in and stops on logout. It is also started from the `vinted-check-session` IPC handler as a safety net (the `start()` method is idempotent).
- **Sleep recovery**: when the system resumes from sleep, `powerMonitor.on('resume')` in `main.ts` runs a retrying recovery loop: it resets the hidden BrowserWindow, re-checks the session, and if the machine is still offline it retries instead of incorrectly marking the user logged out. Once the session is confirmed, `PollingManager.recoverAfterResume()` forces immediate listings/orders polls and rebuilds both one-shot timers so polling cannot get stuck with `running = true` but no active timers. `VintedClient` also treats Chromium `ERR_*` network failures as transient, recreates the hidden window, and rethrows so the caller can decide whether to retry or surface the failure.
- The renderer reads cached data on page mount (`get-my-listings` / `get-my-orders`) and listens for push events. The "Refresh" button triggers `refresh-my-listings` / `refresh-my-orders` which force an immediate API poll. Per-item refresh buttons call `refresh-single-order` / `refresh-single-listing` for targeted updates without fetching the entire list.

## Cross-Page Notification Sync

The `NotificationSyncContext` (`src/renderer/src/context/NotificationSyncContext.tsx`) manages in-app notification state. The `NotificationBell` component and Orders/Offers pages consume it via `useNotificationSync()`.

- **Single source of truth**: notifications are loaded from persistence on mount, updated via `notifications-updated` IPC push events.
- **Shared state**: `notifications`, `unreadCount`, `markRead(id)`, `markAllRead()`, `clearAll()`.
- **Highlight ref mechanism**: `setHighlight(page, referenceId)` stores a pending highlight; consuming pages call `consumeHighlight()` to scroll-to and visually highlight the target row (2s fade animation). Triggered by native notification clicks via `notification-navigate` IPC.
- **Native notification navigation**: `onNotificationNavigate` listener receives `(page, referenceId)` from main process (fired when a Windows native notification is clicked), navigates to the target page and sets the highlight.

## Cross-Page Listing Sync

The `ListingSyncContext` (`src/renderer/src/context/ListingSyncContext.tsx`) is a React context that centralises all listing state. The Items, Listings, and Dashboard pages consume it via `useListingSync()`.

- **Single source of truth**: listing data is loaded once (from cache on mount, from polling updates) and shared across pages.
- **Optimistic updates**: `patchListingMap(title, entry)` allows instant UI feedback when a listing is created, deleted, published, or reposted.
- **Full refresh**: after any mutation, `refreshListings()` is called to fetch the latest data from the API, ensuring both pages converge to the correct state.
- **Single-listing refresh**: `refreshSingleListing(listingId)` fetches one listing via IPC and updates it in the local state array. Used after actions like publish draft to avoid a full re-fetch.
- **`buildListingMap()`**: when multiple listings share the same title (e.g. Active + Sold), the entry with the highest priority wins (Active > Draft > Hidden > other).

## Cross-Page Order Sync

The `OrdersSyncContext` (`src/renderer/src/context/OrdersSyncContext.tsx`) mirrors the ListingSyncContext pattern for order data. The Orders and Dashboard pages consume it via `useOrdersSync()`.

- **Single source of truth**: orders are loaded once from cache on mount, updated from polling pushes.
- **Shared state**: `orders`, `refreshing`, `refreshOrders()`, `refreshSingleOrder(transactionId)`, `setOrders`.
- **Eliminates duplicate IPC**: previously both Orders and Dashboard had independent IPC calls to `get-my-orders` and separate listeners for `orders-updated`.

## Cross-Page Purchase Sync

The `PurchasesSyncContext` (`src/renderer/src/context/PurchasesSyncContext.tsx`) mirrors the OrdersSyncContext pattern for purchase data. The Purchases page consumes it via `usePurchasesSync()`.

- **Single source of truth**: purchases are loaded once from cache on mount, updated from `purchases-delta` polling pushes.
- **Shared state**: `purchases`, `refreshing`, `refreshPurchases()`, `refreshSinglePurchase(transactionId)`.

## Cross-Page Offer Sync

The `OffersSyncContext` (`src/renderer/src/context/OffersSyncContext.tsx`) manages received offer state. The Offers page consumes it via `useOffersSync()`.

- **Single source of truth**: offers are loaded once from cache on mount, updated from `offers-delta` and `offer-auto-accepted` polling pushes.
- **Shared state**: `offers`, `refreshing`, `refreshOffers()`, `acceptOffer(transactionId, offerRequestId)`, `counterOffer(transactionId, offerRequestId, price)`, `updateOfferBundleItems(offerId, bundleItems)` (updates bundle item details in local state after lazy-load expansion).

## Build Pipeline

```
electron.vite.config.ts
├── main:     src/main/main.ts         → out/main/main.mjs         (node, esm)
│          src/main/label-worker.ts → out/main/label-worker.mjs (node, esm, worker thread)
├── preload:  src/preload/preload.ts   → out/preload/preload.js    (node, cjs)
└── renderer: src/renderer/index.html  → out/renderer/             (browser, Vite dev server with HMR in dev mode)

Tailwind CSS: processed by @tailwindcss/vite plugin in the renderer build, imported from src/renderer/src/index.tsx
```

- `npm run dev` starts the Vite dev server for the renderer (with HMR) and builds main+preload, then launches Electron
- `npm run build` builds all three targets to the `out/` directory
- `npm start` (electron-vite preview) builds and launches the production bundle
- `npm run typecheck` runs `tsc --noEmit` for type-safety validation
- `npm run build:win` packages with electron-builder for Windows
- CSP is enforced programmatically via `webContents.session.webRequest.onHeadersReceived` in production; omitted in dev for Vite HMR compatibility

## Label Pipeline

1. User clicks "Print Label" on an order → renderer calls `window.api.printShippingLabel(shipmentId, courier)`
2. Main process fetches the label URL via `getShippingLabelUrl()` and downloads the PDF using the Vinted session
3. The PDF is cropped in a **worker thread** (`label-worker.ts`) using courier-specific coordinates from `COURIER_CROPS` in `label-printer.ts`:
   - **Evri**: crops to the label area at `(17.15, 394.64, 290, 425.25)`, no rotation
   - **InPost Locker**: crops to `(102, 10.89, 417, 295)` and applies -90° rotation (label is sideways on the page)
   - **InPost Home**: crops to `(150, 10, 297, 421)`, no rotation (portrait A5-sized label)
   - **Unknown couriers**: falls back to top-half crop
   - `normaliseCourier()` distinguishes InPost variants: courier names containing both "inpost" and "home" map to `inpost-home`; other "inpost" names map to `inpost-locker`
4. The cropped PDF is written to a temp file in `os.tmpdir()`
5. The cropped PDF is sent to the configured printer (or system default) via `pdf-to-printer`'s `print()` function with optional printer name and paper size from the `labelPrinter` settings
6. The temp file is cleaned up in a `finally` block after printing

Printer settings are stored in `AppSettings.labelPrinter` as a typed `LabelPrinterSettings` interface (`{ printerName: string, paperSize: string }`). The Settings page lists available printers via `getPrinters()` (uses `pdf-to-printer`'s `getPrinters()` which returns name, deviceId, and supported paper sizes). When a printer is selected, its supported paper sizes are shown in a second dropdown.

If an order has no shipping label yet (shipmentStatus = 1 or null), the user can click "Generate Label" which calls `orderShippingLabel(transactionId)`. This fetches the seller's default shipping address and calls the Vinted API to generate the label. The "Print Label" button only appears when shipmentStatus ≥ 230 (label generated). An "Open Label" action is also available which opens the raw (uncropped) label URL directly in the browser via `openRawShippingLabel`.

Shipment status codes: 1 = no label, 230 = label generated, 300 = in transit, 400 = delivered.

## Item Photo Downloads

When a listing is saved as a local item:

1. The `save-item` IPC handler returns the saved item immediately with remote photo URLs
2. Photo download runs in the background (fire-and-forget) via `downloadItemPhotos(itemId, photos, forceRedownload)` from `photo-downloader.ts`
3. Each remote (https) photo URL is downloaded via `net.request` using the `persist:vinted` session
4. Photos are saved to `userData/item-photos/{itemId}/photo-{idx}.{ext}`
5. The item's photo array is updated with `local-file://` URLs and re-saved to disk after download completes
6. When updating an existing item, `forceRedownload` is set to `true` so photos are always re-downloaded (listings may have updated photos)
7. When an item is deleted, `deleteItemPhotos(itemId)` cleans up the photo directory

A custom `local-file://` protocol is registered in `main.ts` (`protocol.registerSchemesAsPrivileged` + `protocol.handle`) which resolves to proper `file:///` URLs via Node's `pathToFileURL()` and `net.fetch`. This is necessary because electron-vite serves the renderer from `http://localhost` in dev mode, and browsers block `file://` resource access from HTTP origins. The `get-items` IPC handler migrates any legacy `file://` URLs to `local-file://` for backward compatibility.

This ensures items can be re-uploaded even after the original Vinted listing ends and CDN URLs expire.

## Keyboard Shortcuts

A single global `keydown` listener installed in `App.tsx` powers all in-app shortcuts. It reads the current `page` state via closure and:

- Suppresses all shortcuts when the active element is an `<input>`, `<textarea>`, or `[contenteditable]`, **except** `/` (which always preventDefaults and dispatches the focus event so the user can jump between search bars).
- Ignores any keydown with Ctrl/Meta/Alt modifiers.
- Letter keys (`d`, `l`, `i`, `o`, `p`, `f`, `a`, `s`, `n`) call `setPage(...)` to navigate between pages (`d` Dashboard, `l` Listings, `i` Items, `o` Orders, `p` Purchases, `f` Offers, `a` Activity Log, `s` Settings, `n` Inbox).
- `/` dispatches a `CustomEvent("app:focus-search", { detail: { page } })` on `window`. The shared `FilterBar` listens for this event and focuses its search input via a container ref, skipping any FilterBar that is inside an element with the `page-hidden` class so only the active page's search bar receives focus.
- `r` dispatches a `CustomEvent("app:refresh", { detail: { page } })`. Pages opt in via the `useGlobalRefresh(page, handler)` hook (`src/renderer/src/hooks/useGlobalRefresh.ts`), which only fires `handler` when `event.detail.page === page` so hidden pages stay quiet.

## Page Mounting Strategy

All ten pages (Dashboard, Listings, Items, Orders, Purchases, Offers, Automations, Inbox, Activity Log, Settings) are rendered via `App.tsx`'s route switch. The active page is visible inside the shared `page-container`, and page navigation swaps the rendered route while preserving the cross-page sync providers above it.

## Performance Optimisations

- **Lazy-loaded recharts**: The `RevenueChart` component (containing the ~769KB recharts bundle) is loaded via `React.lazy()` only when the Dashboard renders chart data. This removes recharts from the initial bundle.
- **Local fonts**: `@fontsource-variable/inter` replaces the render-blocking Google Fonts `@import`, eliminating a network round-trip on startup.
- **CSS containment**: Hidden pages use `content-visibility: auto` and `contain-intrinsic-size` so the browser can skip layout/paint for off-screen content.
- **One-time photo URL migration**: Legacy `file://` → `local-file://` photo URL migration runs once at startup (in `main.ts`) and persists, rather than running on every `get-items` IPC call.
- **No flushSync**: All `flushSync` calls were removed from `ListingSyncContext` and `Orders` to avoid forcing synchronous layout recalculations.
- **Shared contexts**: `OrdersSyncContext` and `ListingSyncContext` eliminate duplicate IPC calls; Dashboard no longer maintains separate copies of orders/listings state.
- **Delta-based IPC**: Polling pushes only changed/removed items via `orders-delta`, `listings-delta`, `purchases-delta`, and `offers-delta` instead of full arrays. Single-item mutations from IPC handlers (`replenish-order-stock`, `accept-offer`, `counter-offer`, `ignore-offer`, `unignore-offer`) route through `PollingManager.applyOrderPatch` / `applyOfferPatch` so they emit on the same delta channels — there is no separate `order-patched` channel.
- **Virtual scrolling**: Items, Orders, and Listings tables use `@tanstack/react-virtual` to render only visible rows (~15-20 + 5 overscan), reducing DOM nodes by ~80%. All tables use spacer `<tr>` elements for padding.
- **Memoized table rows**: `OrderRow`, `ListingRow`, and `ItemRow` are extracted as `React.memo` components with stable `useCallback` handlers, preventing unnecessary re-renders on state changes that don't affect a given row.
- **Toast context**: `ToastContext` holds toast state in its own React context, preventing cascade re-renders of all pages when toasts are created.
- **Items sync context**: `ItemsSyncContext` shares item state between Dashboard and Items pages, eliminating duplicate IPC calls and stale data.
- **Date format caching**: Listings and Orders pages cache `toLocaleDateString`/`toLocaleTimeString` results at the module level to avoid repeated ICU lookups in the render path.
- **CSS will-change refinement**: Only the active page gets GPU compositor layer promotion; hidden pages no longer consume GPU memory.
- **Async startup reads**: Settings, items, listings, and orders caches are loaded from disk concurrently via `Promise.all` using async I/O at startup.
- **Background photo downloads**: The `save-item` handler returns immediately; photos are downloaded in the background without blocking the renderer.
- **Manual chunk splitting**: The Vite renderer build splits vendor code into separate chunks (`vendor-react`, `vendor-datefns`, `vendor-virtual`) for parallel V8 parsing.
- **Worker thread for PDF**: Label PDF cropping is offloaded to a Node.js `worker_threads` worker (`label-worker.ts`), keeping the main process event loop free for IPC during PDF operations.
