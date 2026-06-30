export const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  EUR: "€",
  USD: "$",
  PLN: "zł",
  CZK: "Kč",
  SEK: "kr",
  DKK: "kr",
  NOK: "kr",
  HUF: "Ft",
  RON: "lei",
};

/** Vinted site codes (TLD suffix). Add a new entry to support a new locale. */
export const VINTED_SITES = ["fr", "co.uk", "de", "nl", "be", "es", "it", "pt", "pl", "cz", "lt", "se", "com"] as const;
export type Site = (typeof VINTED_SITES)[number];

export const DEFAULT_SITE: Site = "co.uk";
export const DEFAULT_DOMAIN = `www.vinted.${DEFAULT_SITE}`;

export function isSite(value: unknown): value is Site {
  return typeof value === "string" && VINTED_SITES.includes(value as Site);
}

export function normalizeSite(value: unknown): Site {
  return isSite(value) ? value : DEFAULT_SITE;
}

/** Resolve the Vinted domain for a given site code (TLD-style, e.g. "co.uk", "fr"). */
export function getDomain(site: Site | string): string {
  return `www.vinted.${normalizeSite(site)}`;
}
