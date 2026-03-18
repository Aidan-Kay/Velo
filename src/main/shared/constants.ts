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

export const DEFAULT_DOMAIN = "www.vinted.co.uk";

/** Resolve the Vinted domain for a given site code (TLD-style, e.g. "co.uk", "fr"). */
export function getDomain(site: string): string {
  return `www.vinted.${site}`;
}
