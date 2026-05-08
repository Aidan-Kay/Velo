import type { CategoryAttribute, CategoryNode, Condition, PackageSize } from "../../shared/types";
import { DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";

const VINTED_API = "/api/v2";

// ─── In-memory TTL cache ─────────────────────────────────────────────────────
// Catalog data (categories, conditions, package sizes, attributes) changes very
// rarely. Cache responses for an hour, keyed by domain + arguments.
const CATALOG_TTL_MS = 60 * 60 * 1000;
const _cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await fn();
  _cache.set(key, { value, expiresAt: Date.now() + CATALOG_TTL_MS });
  return value;
}

// ─── Catalog / Category Helpers ─────────────────────────────────────────────

export async function getCategories(domain?: string): Promise<CategoryNode[]> {
  const d = domain || DEFAULT_DOMAIN;
  return cached(`categories:${d}`, async () => {
    const client = getClient(d);
    const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/catalogs`;
    console.log("[vinted] Fetching categories...");
    const response = await client.get<{ catalogs?: CategoryNode[] }>(apiUrl);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch categories (status ${response.status})`);
    }
    return response.data?.catalogs || [];
  });
}

export async function getCategoryAttributes(categoryId: number, domain?: string): Promise<CategoryAttribute[]> {
  const d = domain || DEFAULT_DOMAIN;
  return cached(`category-attrs:${d}:${categoryId}`, async () => {
    const client = getClient(d);
    const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/attributes`;
    const payload = { attributes: [{ code: "category", value: [categoryId] }] };

    console.log(`[vinted] Fetching attributes for category ${categoryId}...`);
    const response = await client.post<{ attributes?: CategoryAttribute[] }>(apiUrl, payload);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch category attributes (status ${response.status})`);
    }
    return response.data?.attributes || [];
  });
}

export async function getConditions(catalogId: number, domain?: string): Promise<Condition[]> {
  const d = domain || DEFAULT_DOMAIN;
  return cached(`conditions:${d}:${catalogId}`, async () => {
    const client = getClient(d);
    const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/conditions`;
    const params = { catalog_id: catalogId };

    console.log(`[vinted] Fetching conditions for catalog ${catalogId}...`);
    const response = await client.get<{ conditions?: Condition[] }>(apiUrl, params);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch conditions (status ${response.status})`);
    }
    return response.data?.conditions || [];
  });
}

export async function getPackageSizes(catalogId: number, domain?: string): Promise<PackageSize[]> {
  const d = domain || DEFAULT_DOMAIN;
  return cached(`package-sizes:${d}:${catalogId}`, async () => {
    const client = getClient(d);
    const apiUrl = `https://${client.domain}${VINTED_API}/catalogs/${catalogId}/package_sizes`;

    console.log(`[vinted] Fetching package sizes for catalog ${catalogId}...`);
    const response = await client.get<{ package_sizes?: PackageSize[] }>(apiUrl);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch package sizes (status ${response.status})`);
    }
    return response.data?.package_sizes || [];
  });
}

/** Clear the catalog cache (e.g. on logout or site change). */
export function clearCatalogCache(): void {
  _cache.clear();
}
