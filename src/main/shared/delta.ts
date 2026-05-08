/**
 * Generic delta computation between two arrays of items.
 *
 * Used by polling callbacks to derive `{ upserted, removedIds }` from a fresh
 * fetch and the previously cached array, so the renderer only receives the
 * minimum changeset rather than the full list.
 *
 * @param prev      Previously cached items.
 * @param next      Freshly fetched items.
 * @param keyFn     Returns the stable identity for an item (e.g. transactionId).
 *                  Items with null/undefined keys are treated as opaque and
 *                  always upserted, never removed.
 * @param changedFn Compares two items with the same key and returns true if
 *                  the next version differs in any tracked field.
 */
export function computeDelta<T, K>(
  prev: T[],
  next: T[],
  keyFn: (item: T) => K | null | undefined,
  changedFn: (prev: T, next: T) => boolean,
): { upserted: T[]; removedIds: K[] } {
  const prevMap = new Map<K, T>();
  for (const item of prev) {
    const k = keyFn(item);
    if (k != null) prevMap.set(k, item);
  }

  const upserted: T[] = [];
  for (const item of next) {
    const k = keyFn(item);
    if (k == null) {
      upserted.push(item);
      continue;
    }
    const cached = prevMap.get(k);
    if (!cached || changedFn(cached, item)) {
      upserted.push(item);
    }
  }

  const nextKeys = new Set<K>();
  for (const item of next) {
    const k = keyFn(item);
    if (k != null) nextKeys.add(k);
  }
  const removedIds: K[] = [];
  for (const item of prev) {
    const k = keyFn(item);
    if (k != null && !nextKeys.has(k)) removedIds.push(k);
  }

  return { upserted, removedIds };
}
