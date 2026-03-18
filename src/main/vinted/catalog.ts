import type { CategoryAttribute, CategoryNode, Condition, PackageSize } from "../../shared/types";
import { DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";

const VINTED_API = "/api/v2";

// ─── Catalog / Category Helpers ─────────────────────────────────────────────

export async function getCategories(domain?: string): Promise<CategoryNode[]> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/catalogs`;
  console.log("[vinted] Fetching categories...");
  const response = await client.get<{ catalogs?: CategoryNode[] }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch categories (status ${response.status})`);
  }
  return response.data?.catalogs || [];
}

export async function getCategoryAttributes(categoryId: number, domain?: string): Promise<CategoryAttribute[]> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/attributes`;
  const payload = { attributes: [{ code: "category", value: [categoryId] }] };

  console.log(`[vinted] Fetching attributes for category ${categoryId}...`);
  const response = await client.post<{ attributes?: CategoryAttribute[] }>(apiUrl, payload);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch category attributes (status ${response.status})`);
  }
  return response.data?.attributes || [];
}

export async function getConditions(catalogId: number, domain?: string): Promise<Condition[]> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/conditions`;
  const params = { catalog_id: catalogId };

  console.log(`[vinted] Fetching conditions for catalog ${catalogId}...`);
  const response = await client.get<{ conditions?: Condition[] }>(apiUrl, params);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch conditions (status ${response.status})`);
  }
  return response.data?.conditions || [];
}

export async function getPackageSizes(catalogId: number, domain?: string): Promise<PackageSize[]> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/catalogs/${catalogId}/package_sizes`;

  console.log(`[vinted] Fetching package sizes for catalog ${catalogId}...`);
  const response = await client.get<{ package_sizes?: PackageSize[] }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch package sizes (status ${response.status})`);
  }
  return response.data?.package_sizes || [];
}
