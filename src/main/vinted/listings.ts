import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { LocalItem, Pagination, VintedListing } from "../../shared/types";
import { DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";
import { mapItemUploadToVintedListing, mapRawToVintedListing, type RawItem } from "./mappers";

const VINTED_API = "/api/v2";

// ─── My Listings ────────────────────────────────────────────────────────────

interface GetMyListingsOptions {
  domain?: string;
  page?: number;
  perPage?: number;
  status?: string;
}

export async function getMyListings(options: GetMyListingsOptions = {}): Promise<{ items: VintedListing[]; pagination: Pagination }> {
  const { domain, page = 1, perPage = 50 } = options;
  const client = getClient(domain || DEFAULT_DOMAIN);
  if (!client.isLoggedIn || !client.userId) {
    throw new Error("Not logged in");
  }

  const apiUrl = `https://${client.domain}${VINTED_API}/wardrobe/${client.userId}/items`;
  const params: Record<string, unknown> = { page, per_page: perPage, order: "relevance" };

  console.log(`[vinted] Fetching my listings (page ${page})...`);
  const response = await client.get<{ items?: RawItem[]; pagination?: Pagination }>(apiUrl, params);

  if (response.status !== 200) {
    throw new Error(`Vinted API returned status ${response.status}`);
  }

  const rawItems = response.data?.items || [];
  const pagination = response.data?.pagination || {};
  const listings = rawItems.map((raw) => mapRawToVintedListing(raw, client.domain));

  return { items: listings, pagination };
}

// ─── Listing Detail ─────────────────────────────────────────────────────────

export async function getListingDetails(listingId: number, domain?: string): Promise<unknown> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/items/${listingId}`;
  const response = await client.get<{ item?: unknown }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to get listing ${listingId}`);
  }
  return response.data?.item || response.data;
}

/** Fetch a single listing via item_upload detail API and return it in our normalised VintedListing shape. */
export async function getListingAsVintedListing(listingId: number, domain?: string): Promise<VintedListing> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/items/${listingId}`;
  const response = await client.get<{ item?: Record<string, unknown> }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to get listing ${listingId}`);
  }
  const detail = response.data?.item;
  if (!detail) throw new Error(`Listing ${listingId} not found`);
  return mapItemUploadToVintedListing(detail, listingId, client.domain);
}

// ─── Item Upload Detail ─────────────────────────────────────────────────────

export async function getItemUploadDetail(itemId: number, domain?: string): Promise<Record<string, unknown>> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/items/${itemId}`;

  console.log(`[vinted] Fetching item upload detail for ${itemId}...`);
  const response = await client.get<{ item?: Record<string, unknown> }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch item upload detail ${itemId} (status ${response.status})`);
  }
  return response.data?.item || (response.data as unknown as Record<string, unknown>);
}

// ─── Photo Upload ───────────────────────────────────────────────────────────

/**
 * Upload a single photo to Vinted's photo API.
 * Returns the photo ID from the response.
 */
async function uploadPhoto(photoPath: string, domain: string): Promise<number> {
  const client = getClient(domain);
  if (!client.isLoggedIn) throw new Error("Not logged in");

  // Resolve local file:// URLs to absolute paths
  let filePath = photoPath;
  if (filePath.startsWith("file://")) {
    filePath = decodeURIComponent(filePath.replace("file:///", "").replace("file://", ""));
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Photo file not found: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileBase64 = fileBuffer.toString("base64");
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mimeType = mimeMap[ext] || "image/jpeg";
  const fileName = path.basename(filePath);

  const apiUrl = `https://${client.domain}${VINTED_API}/photos`;
  console.log(`[vinted] Uploading photo: ${fileName} (${fileBuffer.length} bytes)`);

  const tempUuid = randomUUID();
  const response = await client.postFile<{ id?: number }>(apiUrl, "photo[file]", fileBase64, fileName, mimeType, {
    "photo[type]": "item",
    "photo[temp_uuid]": tempUuid,
  });

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Photo upload failed (status ${response.status})`);
  }

  const photoId = response.data?.id;
  if (!photoId) {
    throw new Error("Photo upload response missing id");
  }

  console.log(`[vinted] Photo uploaded — id: ${photoId}`);
  return photoId;
}

// ─── Create / Publish / Delete ──────────────────────────────────────────────

interface CreateListingOptions {
  asDraft?: boolean;
  domain?: string;
  /** Called during each step of listing creation (photo uploads, draft, publish). */
  onProgress?: (step: string, current: number, total: number) => void;
}

/**
 * Create a listing on Vinted.
 * Flow: upload each photo → create draft → optionally publish.
 */
export async function createListing(itemData: Partial<LocalItem>, options: CreateListingOptions = {}): Promise<unknown> {
  const { asDraft = false, domain, onProgress } = options;
  const clientDomain = domain || DEFAULT_DOMAIN;
  const client = getClient(clientDomain);
  if (!client.isLoggedIn) throw new Error("Not logged in");

  const photoCount = itemData.photos?.length ?? 0;
  // Total steps: each photo + 1 draft + 1 publish (if not draft)
  const totalSteps = photoCount + 1 + (asDraft ? 0 : 1);

  // Step 1: Upload photos
  const assignedPhotos: Array<{ id: number; orientation: number }> = [];
  if (itemData.photos && itemData.photos.length > 0) {
    for (let i = 0; i < itemData.photos.length; i++) {
      const photo = itemData.photos[i];
      onProgress?.(`Uploading photo ${i + 1}/${photoCount}`, i + 1, totalSteps);
      try {
        const photoId = await uploadPhoto(photo, clientDomain);
        assignedPhotos.push({ id: photoId, orientation: 0 });
      } catch (err) {
        console.warn(`[vinted] Failed to upload photo: ${(err as Error).message}`);
      }
    }
  }

  if (assignedPhotos.length === 0 && itemData.photos && itemData.photos.length > 0) {
    throw new Error("All photo uploads failed");
  }

  if (assignedPhotos.length < (itemData.photos?.length ?? 0)) {
    const failed = (itemData.photos?.length ?? 0) - assignedPhotos.length;
    console.warn(`[vinted] ${failed} of ${itemData.photos?.length} photo(s) failed to upload`);
  }

  // Build color_ids array
  const colorIds: number[] = [];
  if (itemData.color1Id) colorIds.push(itemData.color1Id);
  if (itemData.color2Id) colorIds.push(itemData.color2Id);

  // Build item_attributes from categoryAttributes
  const itemAttributes: Array<{ code: string; ids: number[] }> = [];
  if (itemData.categoryAttributes) {
    for (const [code, value] of Object.entries(itemData.categoryAttributes)) {
      const ids = Array.isArray(value) ? value : [value];
      itemAttributes.push({ code, ids });
    }
  }

  // Step 2: Create draft
  const payload = {
    draft: {
      id: null,
      temp_uuid: randomUUID(),
      title: itemData.title,
      currency: itemData.currency || "GBP",
      description: itemData.description || "",
      brand_id: itemData.brandId || null,
      size_id: itemData.sizeId || null,
      catalog_id: itemData.categoryId,
      isbn: itemData.isbn ?? null,
      is_unisex: 0,
      status_id: 6,
      video_game_rating_id: itemData.videoGameRatingId ?? null,
      price: itemData.price,
      package_size_id: itemData.packageSizeId,
      shipment_prices: {
        domestic: itemData.domesticShipmentPrice ?? null,
        international: itemData.internationalShipmentPrice ?? null,
      },
      color_ids: colorIds,
      assigned_photos: assignedPhotos,
      measurement_length: itemData.measurementLength ?? null,
      measurement_width: itemData.measurementWidth ?? null,
      item_attributes: itemAttributes,
      manufacturer: itemData.manufacturer ?? null,
      manufacturer_labelling: itemData.manufacturerLabelling ?? null,
      model: itemData.model ?? null,
    },
    feedback_id: null,
    parcel: null,
    upload_session_id: randomUUID(),
  };

  console.log(`[vinted] Creating draft listing: "${itemData.title}" (photos: ${assignedPhotos.length})`);
  onProgress?.("Creating draft listing", photoCount + 1, totalSteps);

  const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/drafts`;
  const response = await client.post<{ draft?: { id: number }; code?: number }>(apiUrl, payload);

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Failed to create draft (status ${response.status}): ${JSON.stringify(response.data)}`);
  }

  const draftId = response.data?.draft?.id;
  if (!draftId) {
    throw new Error("Draft creation response missing draft id");
  }

  console.log(`[vinted] Draft created — id: ${draftId}`);

  // Step 3: Publish if not draft
  if (!asDraft) {
    onProgress?.("Publishing listing", totalSteps, totalSteps);
    console.log(`[vinted] Publishing draft ${draftId}...`);
    await publishListing(draftId, clientDomain);
    console.log(`[vinted] Draft ${draftId} published`);
  }

  return { item: { id: draftId }, ...response.data };
}

export async function publishListing(listingId: number, domain?: string): Promise<unknown> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  if (!client.isLoggedIn) throw new Error("Not logged in");

  // Fetch the item upload detail to build the draft completion payload
  const detail = await getItemUploadDetail(listingId, domain);

  // Build color_ids from color1_id / color2_id
  const colorIds: number[] = [];
  if (detail.color1_id) colorIds.push(detail.color1_id as number);
  if (detail.color2_id) colorIds.push(detail.color2_id as number);

  // Build assigned_photos from photos array
  const rawPhotos = (detail.photos as Array<{ id: number; high_resolution?: { orientation: number } }>) || [];
  const assignedPhotos = rawPhotos.map((p) => ({
    id: p.id,
    orientation: p.high_resolution?.orientation ?? 0,
  }));

  // Extract numeric price from the price object
  const priceObj = detail.price as { amount?: string } | undefined;
  const priceNum = priceObj?.amount ? parseFloat(priceObj.amount) : (detail.price as number) || 0;

  // Use the actual condition status_id from the draft detail
  const conditionStatusId = (detail.status_id as number) || 6;

  const payload = {
    draft: {
      id: listingId,
      title: detail.title,
      currency: detail.currency,
      description: detail.description,
      brand_id: detail.brand_id || null,
      size_id: detail.size_id || null,
      catalog_id: detail.catalog_id,
      isbn: detail.isbn || null,
      is_unisex: detail.is_unisex ?? 0,
      status_id: conditionStatusId,
      video_game_rating_id: detail.video_game_rating_id || null,
      price: priceNum,
      package_size_id: detail.package_size_id,
      shipment_prices: detail.shipment_prices || { domestic: null, international: null },
      color_ids: colorIds,
      assigned_photos: assignedPhotos,
      measurement_length: detail.measurement_length || null,
      measurement_width: detail.measurement_width || null,
      item_attributes: detail.item_attributes || [],
      manufacturer: detail.manufacturer || null,
      manufacturer_labelling: detail.manufacturer_labelling || null,
      model: detail.model || null,
    },
    feedback_id: null,
    parcel: detail.parcel || null,
    push_up: false,
    upload_session_id: randomUUID(),
  };

  // Set referrer to the member page to match browser behaviour
  const referrer = client.userId ? `https://${client.domain}/member/${client.userId}` : undefined;

  const apiUrl = `https://${client.domain}${VINTED_API}/item_upload/drafts/${listingId}/completion`;
  console.log(`[vinted] Publishing draft ${listingId}...`);
  const response = await client.post(apiUrl, payload, { "X-Money-Object": "true" }, referrer);

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Failed to publish draft ${listingId} (status ${response.status}): ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

export async function deleteListing(listingId: number, isDraft: boolean, domain?: string): Promise<{ success: boolean }> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  if (!client.isLoggedIn) throw new Error("Not logged in");

  if (isDraft) {
    const apiUrl = `https://${client.domain}/api/v2/item_upload/drafts/${listingId}`;
    console.log(`[vinted] Deleting draft listing ${listingId} via item_upload/drafts...`);
    const response = await client.delete(apiUrl);
    return { success: response.status === 200 };
  } else {
    const apiUrl = `https://${client.domain}${VINTED_API}/items/${listingId}/delete`;
    console.log(`[vinted] Deleting listing ${listingId} via items/delete...`);
    const response = await client.post(apiUrl);
    return { success: response.status === 200 };
  }
}
