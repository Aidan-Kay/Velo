/**
 * Canonical key used to match local items against listings, orders, and
 * bundle items by title. The de-facto join across the app is title-based;
 * centralise the normalisation so any later migration to a stable ID has
 * one site to update.
 */
export function titleKey(title: string): string {
  return title.toLowerCase().trim();
}
