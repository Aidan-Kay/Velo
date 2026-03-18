import { BrowserWindow, OnBeforeRequestListenerDetails, session, Session } from "electron";
import { isTransientError } from "../../shared/retry";

// ─── Cloudflare Detection ──────────────────────────────────────────────────

const CF_MARKERS = ["challenges.cloudflare.com", "Just a moment", "cf-turnstile", "cdn-cgi/challenge-platform"];

function isCloudflareChallenge(body: string): boolean {
  return CF_MARKERS.some((marker) => body.includes(marker));
}

function isCloudflareUrl(url: string): boolean {
  return url.includes("challenges.cloudflare.com") || url.includes("cdn-cgi/challenge-platform");
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────
// Ensures a randomized 0.5-1.5 second gap between ANY Vinted API call.

let _lastCallTime = 0;
let _rateLimitChain: Promise<void> = Promise.resolve();

function withRateLimit(): Promise<void> {
  _rateLimitChain = _rateLimitChain.then(async () => {
    const now = Date.now();
    const elapsed = now - _lastCallTime;
    const minGap = 500 + Math.random() * 1000; // 0.5-1.5 seconds

    if (_lastCallTime > 0 && elapsed < minGap) {
      const wait = minGap - elapsed;
      console.log(`[vinted] Rate limiting: waiting ${Math.round(wait)}ms before next API call`);
      await new Promise<void>((r) => setTimeout(r, wait));
    }

    _lastCallTime = Date.now();
  });
  return _rateLimitChain;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  contentType: string;
  body: string;
}

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
}

/**
 * VintedClient — Authenticated HTTP client using a hidden BrowserWindow.
 *
 * Uses a persistent hidden BrowserWindow to make API requests from within a
 * real browser page context (Chromium TLS fingerprint, correct Sec-Fetch-*
 * headers, automatic cookie management). Extends the ListingWatch pattern
 * to support user login and mutating requests (POST/PUT/DELETE with CSRF).
 */
export class VintedClient {
  private _domain: string;
  private _baseUrl: string;
  private _maxRetries: number;
  private _retryBaseDelay: number;
  private _partition: string;
  private _session: Session;
  private _win: BrowserWindow | null;
  private _windowReady: boolean;
  private _windowInitPromise: Promise<BrowserWindow> | null;
  private _resourceBlockerRegistered: boolean;
  private _loggedIn: boolean;
  private _userId: number | null;
  private _proxyReady: Promise<void>;
  private _csrfToken: string | null;

  constructor(domain = "www.vinted.co.uk", proxy: string | null = null) {
    this._domain = domain;
    this._baseUrl = `https://${domain}/`;
    this._maxRetries = 3;
    this._retryBaseDelay = 1000;
    this._partition = "persist:vinted";
    this._session = session.fromPartition(this._partition);
    this._win = null;
    this._windowReady = false;
    this._windowInitPromise = null;
    this._resourceBlockerRegistered = false;
    this._loggedIn = false;
    this._userId = null;
    this._csrfToken = null;

    this._proxyReady = proxy ? this._session.setProxy({ proxyRules: proxy }) : Promise.resolve();
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get isLoggedIn(): boolean {
    return this._loggedIn;
  }

  get userId(): number | null {
    return this._userId;
  }

  get domain(): string {
    return this._domain;
  }

  // ─── Browser Window Management ──────────────────────────────────────────────

  private async _ensureWindow(): Promise<BrowserWindow> {
    if (this._win && !this._win.isDestroyed() && this._windowReady) {
      return this._win;
    }
    if (!this._windowInitPromise) {
      this._windowInitPromise = this._createWindow().finally(() => {
        this._windowInitPromise = null;
      });
    }
    return this._windowInitPromise;
  }

  private async _createWindow(): Promise<BrowserWindow> {
    await this._proxyReady;

    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
    }

    if (!this._resourceBlockerRegistered) {
      const BLOCKED_TYPES = new Set(["image", "stylesheet", "font", "media", "ping", "cspReport"]);
      this._session.webRequest.onBeforeRequest(
        { urls: ["<all_urls>"] },
        (details: OnBeforeRequestListenerDetails, callback: (response: { cancel: boolean }) => void) => {
          if (isCloudflareUrl(details.url)) {
            callback({ cancel: false });
            return;
          }
          callback({ cancel: BLOCKED_TYPES.has(details.resourceType) });
        },
      );
      this._resourceBlockerRegistered = true;
    }

    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        session: this._session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    this._win = win;
    await this._navigateAndWaitForChallenge(this._baseUrl);
    await this._extractAndCacheCsrfToken();
    this._windowReady = true;
    console.log(`[vinted] Browser window ready for ${this._domain}`);
    return win;
  }

  private async _navigateAndWaitForChallenge(url: string): Promise<void> {
    const win = this._win;
    if (!win || win.isDestroyed()) return;

    const MAX_WAIT = 30_000;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        console.warn(`[vinted] Challenge wait timed out after ${MAX_WAIT / 1000}s for ${this._domain}`);
        resolve();
      }, MAX_WAIT);

      const cleanup = () => {
        clearTimeout(timer);
        win.webContents.removeListener("did-navigate", onNavigate);
        win.webContents.removeListener("did-finish-load", onFinishLoad);
      };

      const onNavigate = (_event: Electron.Event, navUrl: string) => {
        if (navUrl.startsWith(this._baseUrl) && !navUrl.includes("cdn-cgi/")) {
          cleanup();
          setTimeout(resolve, 2000);
        }
      };

      const onFinishLoad = () => {
        const currentUrl = win.webContents.getURL();
        if (currentUrl.startsWith(this._baseUrl) && !currentUrl.includes("cdn-cgi/")) {
          cleanup();
          setTimeout(resolve, 2000);
        }
      };

      win.webContents.on("did-navigate", onNavigate);
      win.webContents.on("did-finish-load", onFinishLoad);

      win.loadURL(url).catch((err: Error) => {
        cleanup();
        reject(err);
      });
    });
  }

  private async _solveChallenge(): Promise<void> {
    if (!this._win || this._win.isDestroyed()) {
      this._windowReady = false;
      this._win = null;
      await this._ensureWindow();
      return;
    }

    console.log(`[vinted] Navigating to homepage to solve Cloudflare challenge for ${this._domain}...`);
    await this._navigateAndWaitForChallenge(this._baseUrl);
    await this._extractAndCacheCsrfToken();
  }

  private async _resetWindow(): Promise<void> {
    this._windowReady = false;
    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
    }
    this._win = null;
    await this._session.clearStorageData();
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  async login(): Promise<{ success: boolean; userId: number | null }> {
    await this._proxyReady;

    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
      this._win = null;
      this._windowReady = false;
    }

    // Remove resource blocker so login page renders fully
    this._session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (_details, callback) => {
      callback({ cancel: false });
    });

    const loginWin = new BrowserWindow({
      width: 500,
      height: 750,
      title: "Sign in to Vinted",
      autoHideMenuBar: true,
      webPreferences: {
        session: this._session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const loginUrl = this._baseUrl;

    return new Promise((resolve) => {
      let resolved = false;

      const checkLogin = async () => {
        if (resolved) return;
        try {
          const result = await loginWin.webContents.executeJavaScript(`
            fetch("/api/v2/users/current", {
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            }).then(r => r.json()).catch(() => null)
          `);

          if (result?.user?.id) {
            resolved = true;
            this._loggedIn = true;
            this._userId = result.user.id;
            console.log(`[vinted] Login successful — user ID: ${this._userId}`);
            loginWin.close();
            this._resourceBlockerRegistered = false;
            resolve({ success: true, userId: this._userId });
          }
        } catch {
          // Not logged in yet
        }
      };

      loginWin.webContents.on("did-navigate", () => {
        setTimeout(checkLogin, 1500);
      });
      loginWin.webContents.on("did-finish-load", () => {
        setTimeout(checkLogin, 1500);
      });

      loginWin.on("closed", () => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, userId: null });
        }
      });

      loginWin.loadURL(loginUrl);
    });
  }

  async checkSession(): Promise<{ loggedIn: boolean; userId: number | null }> {
    try {
      const win = await this._ensureWindow();
      const result = await win.webContents.executeJavaScript(`
        fetch("/api/v2/users/current", {
          signal: AbortSignal.timeout(10000),
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        }).then(r => r.json()).catch(() => null)
      `);

      if (result?.user?.id) {
        this._loggedIn = true;
        this._userId = result.user.id;
        return { loggedIn: true, userId: this._userId };
      }
      this._loggedIn = false;
      this._userId = null;
      return { loggedIn: false, userId: null };
    } catch {
      this._loggedIn = false;
      this._userId = null;
      return { loggedIn: false, userId: null };
    }
  }

  async logout(): Promise<void> {
    this._loggedIn = false;
    this._userId = null;
    await this._resetWindow();
    console.log("[vinted] Logged out and cleared session data");
  }

  // ─── HTTP Methods ───────────────────────────────────────────────────────────

  async get<T = unknown>(url: string, params: Record<string, unknown> = {}): Promise<ApiResponse<T>> {
    await withRateLimit();
    let tried = 0;
    while (tried < this._maxRetries) {
      tried++;
      const isLast = tried >= this._maxRetries;

      try {
        const win = await this._ensureWindow();
        const fullUrl = this._buildUrl(url, params);

        const result: FetchResult = await win.webContents.executeJavaScript(`
          fetch(${JSON.stringify(fullUrl)}, {
            signal: AbortSignal.timeout(15000),
            headers: {
              "Accept": "application/json, text/plain, */*",
              "Accept-Language": "en-GB,en;q=0.5",
              "X-Requested-With": "XMLHttpRequest"
            },
            credentials: "same-origin"
          }).then(async (r) => {
            const ct = r.headers.get("content-type") || "";
            const body = await r.text();
            return { status: r.status, contentType: ct, body: body };
          })
        `);

        if (result.contentType.includes("text/html")) {
          if (isCloudflareChallenge(result.body)) {
            console.log(`[vinted] Cloudflare challenge on attempt ${tried}/${this._maxRetries} (status ${result.status})`);
            if (isLast) throw new Error("Cloudflare challenge could not be solved after all retry attempts");
            await this._solveChallenge();
            continue;
          }
          throw new Error(`Vinted returned HTML (status ${result.status}) — not a Cloudflare challenge`);
        }

        if (result.status === 401) {
          console.log(`[vinted] 401 Unauthorised on attempt ${tried}/${this._maxRetries} — refreshing session...`);
          if (isLast) throw new Error("Vinted API returned 401 and session could not be refreshed");
          await this._navigateAndWaitForChallenge(this._baseUrl);
          continue;
        }

        const data = JSON.parse(result.body) as T;
        return { status: result.status, data };
      } catch (err) {
        if (isLast || !isTransientError(err as Error)) throw err;

        const delay = this._retryBaseDelay * Math.pow(2, tried - 1);
        console.warn(`[vinted] Error on attempt ${tried}/${this._maxRetries}, retrying in ${delay}ms: ${(err as Error).message}`);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
    throw new Error(`VintedClient.get: exhausted ${this._maxRetries} retries without a result`);
  }

  async post<T = unknown>(
    url: string,
    body: Record<string, unknown> = {},
    extraHeaders?: Record<string, string>,
    referrer?: string,
  ): Promise<ApiResponse<T>> {
    return this._mutatingRequest<T>("POST", url, body, extraHeaders, referrer);
  }

  async put<T = unknown>(
    url: string,
    body: Record<string, unknown> = {},
    extraHeaders?: Record<string, string>,
    referrer?: string,
  ): Promise<ApiResponse<T>> {
    return this._mutatingRequest<T>("PUT", url, body, extraHeaders, referrer);
  }

  async delete<T = unknown>(url: string): Promise<ApiResponse<T>> {
    return this._mutatingRequest<T>("DELETE", url, null);
  }

  /**
   * Upload a file via multipart/form-data.
   * The file bytes are passed as a base64 string to avoid issues with
   * executeJavaScript serialisation.
   * @param extraFields  Additional text fields to append to the form (e.g. photo[type]).
   */
  async postFile<T = unknown>(
    url: string,
    fieldName: string,
    fileBase64: string,
    fileName: string,
    mimeType: string,
    extraFields?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    await withRateLimit();
    let tried = 0;
    while (tried < this._maxRetries) {
      tried++;
      const isLast = tried >= this._maxRetries;

      try {
        const win = await this._ensureWindow();
        const csrfToken = await this._getCsrfToken(win);
        const anonId = await this._getAnonId(win);

        const csrfPart = csrfToken ? `headers.set("X-CSRF-Token", ${JSON.stringify(csrfToken)});` : "";
        const anonIdPart = anonId ? `headers.set("X-Anon-Id", ${JSON.stringify(anonId)});` : "";

        const fetchCode = `
          (async () => {
            const b64 = ${JSON.stringify(fileBase64)};
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: ${JSON.stringify(mimeType)} });
            const formData = new FormData();
            ${
              extraFields
                ? Object.entries(extraFields)
                    .map(([k, v]) => `formData.append(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
                    .join("\n            ")
                : ""
            }
            formData.append(${JSON.stringify(fieldName)}, blob, ${JSON.stringify(fileName)});
            const headers = new Headers();
            headers.set("Accept", "application/json, text/plain, */*, image/webp");
            ${csrfPart}
            ${anonIdPart}
            const r = await fetch(${JSON.stringify(url)}, {
              method: "POST",
              signal: AbortSignal.timeout(60000),
              headers,
              credentials: "same-origin",
              body: formData
            });
            const ct = r.headers.get("content-type") || "";
            const body = await r.text();
            return { status: r.status, contentType: ct, body };
          })()
        `;

        const result: FetchResult = await win.webContents.executeJavaScript(fetchCode);

        if (result.contentType.includes("text/html")) {
          if (isCloudflareChallenge(result.body)) {
            if (isLast) throw new Error("Cloudflare challenge could not be solved after all retry attempts");
            await this._solveChallenge();
            continue;
          }
          throw new Error(`Vinted returned HTML on file upload (status ${result.status})`);
        }

        if (result.status === 401) {
          if (isLast) throw new Error("Vinted API returned 401");
          await this._navigateAndWaitForChallenge(this._baseUrl);
          continue;
        }

        const data = result.body ? (JSON.parse(result.body) as T) : (null as T);
        return { status: result.status, data };
      } catch (err) {
        if (isLast || !isTransientError(err as Error)) throw err;

        const delay = this._retryBaseDelay * Math.pow(2, tried - 1);
        console.warn(
          `[vinted] Error on file upload attempt ${tried}/${this._maxRetries}, retrying in ${delay}ms: ${(err as Error).message}`,
        );
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
    throw new Error(`VintedClient.postFile: exhausted ${this._maxRetries} retries`);
  }

  private async _mutatingRequest<T = unknown>(
    method: string,
    url: string,
    body: Record<string, unknown> | null,
    extraHeaders?: Record<string, string>,
    referrer?: string,
  ): Promise<ApiResponse<T>> {
    await withRateLimit();
    let tried = 0;
    while (tried < this._maxRetries) {
      tried++;
      const isLast = tried >= this._maxRetries;

      try {
        const win = await this._ensureWindow();
        const csrfToken = await this._getCsrfToken(win);
        const anonId = await this._getAnonId(win);

        const headers: Record<string, string> = {
          Accept: "application/json, text/plain, */*, image/webp",
          "Content-Type": "application/json",
          "Accept-Language": "en-GB,en;q=0.7",
        };
        if (csrfToken) {
          headers["X-CSRF-Token"] = csrfToken;
        }
        if (anonId) {
          headers["X-Anon-Id"] = anonId;
        }
        if (extraHeaders) {
          Object.assign(headers, extraHeaders);
        }

        const headerEntries = Object.entries(headers)
          .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
          .join(", ");

        const bodyPart = body !== null ? `, body: ${JSON.stringify(JSON.stringify(body))}` : "";

        const referrerPart = referrer ? `, referrer: ${JSON.stringify(referrer)}` : "";

        const fetchCode = `
          fetch(${JSON.stringify(url)}, {
            method: ${JSON.stringify(method)},
            signal: AbortSignal.timeout(30000),
            headers: { ${headerEntries} },
            credentials: "same-origin"${bodyPart}${referrerPart}
          }).then(async (r) => {
            const ct = r.headers.get("content-type") || "";
            const responseBody = await r.text();
            return { status: r.status, contentType: ct, body: responseBody };
          })
        `;

        const result: FetchResult = await win.webContents.executeJavaScript(fetchCode);

        if (result.contentType.includes("text/html")) {
          if (isCloudflareChallenge(result.body)) {
            if (isLast) throw new Error("Cloudflare challenge could not be solved after all retry attempts");
            await this._solveChallenge();
            continue;
          }
          throw new Error(`Vinted returned HTML on ${method} (status ${result.status})`);
        }

        if (result.status === 401) {
          if (isLast) throw new Error("Vinted API returned 401");
          await this._navigateAndWaitForChallenge(this._baseUrl);
          continue;
        }

        // CSRF token was missing or stale — refresh page context and retry
        if (result.status === 403) {
          if (isLast) {
            const data = result.body ? (JSON.parse(result.body) as T) : (null as T);
            return { status: result.status, data };
          }
          console.log(`[vinted] 403 Forbidden on attempt ${tried}/${this._maxRetries} — refreshing page for fresh CSRF...`);
          await this._navigateAndWaitForChallenge(this._baseUrl);
          await this._extractAndCacheCsrfToken();
          continue;
        }

        const data = result.body ? (JSON.parse(result.body) as T) : (null as T);
        return { status: result.status, data };
      } catch (err) {
        if (isLast || !isTransientError(err as Error)) throw err;

        const delay = this._retryBaseDelay * Math.pow(2, tried - 1);
        console.warn(`[vinted] Error on ${method} attempt ${tried}/${this._maxRetries}, retrying in ${delay}ms: ${(err as Error).message}`);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
    throw new Error(`VintedClient.${method.toLowerCase()}: exhausted ${this._maxRetries} retries`);
  }

  /**
   * Extract CSRF token from the page and cache it.
   * Called once after every page navigation (window creation, challenge solve, 403 retry).
   * Vinted's Next.js app embeds the token in hydration data as "CSRF_TOKEN":"...".
   * The hydration scripts load asynchronously, so we poll until the token appears.
   */
  private async _extractAndCacheCsrfToken(): Promise<void> {
    if (!this._win || this._win.isDestroyed()) return;

    const MAX_POLLS = 10;
    const POLL_INTERVAL_MS = 500;

    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      try {
        const token = await this._win.webContents.executeJavaScript(`
          (function() {
            var html = document.documentElement.outerHTML;
            var m = html.match(/"CSRF_TOKEN\\\\":\\\\"([^"]+)\\\\"/);
            return m ? m[1] : null;
          })()
        `);

        if (token) {
          this._csrfToken = token;
          console.log(`[vinted] CSRF token cached (after ${attempt + 1} poll(s)): ${token.substring(0, 8)}...`);
          return;
        }
      } catch {
        // Window may have been destroyed mid-poll
        if (!this._win || this._win.isDestroyed()) return;
      }

      if (attempt < MAX_POLLS - 1) {
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }

    console.warn(`[vinted] CSRF token not found after ${MAX_POLLS} polls (${(MAX_POLLS * POLL_INTERVAL_MS) / 1000}s)`);
  }

  /** Return the cached CSRF token (extracted on page load). */
  private async _getCsrfToken(_win: BrowserWindow): Promise<string | null> {
    if (!this._csrfToken) {
      console.warn("[vinted] No cached CSRF token available — mutating requests may fail with 403");
    }
    return this._csrfToken;
  }

  private async _getAnonId(win: BrowserWindow): Promise<string | null> {
    try {
      return await win.webContents.executeJavaScript(`
        (function() {
          const match = document.cookie.match(/(?:^|;\\s*)anon_id=([^;]+)/);
          return match ? decodeURIComponent(match[1]) : null;
        })()
      `);
    } catch {
      return null;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private _buildUrl(url: string, params: Record<string, unknown>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return url;
    const parts: string[] = [];
    for (const [k, v] of entries) {
      const values = Array.isArray(v) ? v : [v];
      for (const val of values) {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(val))}`);
      }
    }
    const qs = parts.join("&");
    return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
  }

  destroy(): void {
    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
    }
    this._win = null;
    this._windowReady = false;
  }
}

// ─── Singleton Client ─────────────────────────────────────────────────────────

let _client: VintedClient | null = null;
let _activeProxy: string | null = null;

export function getClient(domain = "www.vinted.co.uk"): VintedClient {
  if (!_client || _client.domain !== domain) {
    if (_client) _client.destroy();
    _client = new VintedClient(domain, _activeProxy);
  }
  return _client;
}

export function configureClientProxy(proxyUrl: string | null): void {
  _activeProxy = proxyUrl || null;
  if (_client) {
    _client.destroy();
    _client = null;
  }
  console.log(_activeProxy ? `[vinted] Proxy configured: ${_activeProxy}` : "[vinted] Proxy cleared");
}
