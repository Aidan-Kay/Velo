import { net, session } from "electron";
import * as fs from "fs";
import * as path from "path";
import { userDataPath } from "./persistence";

const SESSION_PARTITION = "persist:vinted";
const PHOTO_DIR = path.join(userDataPath, "item-photos");

/** Ensure the item photos directory exists. */
function ensurePhotoDir(itemId: string): string {
  const dir = path.join(PHOTO_DIR, itemId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Download a single image from a URL using the Vinted session. */
function downloadImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition(SESSION_PARTITION);
    const request = net.request({ url, session: ses });

    const chunks: Buffer[] = [];
    request.on("response", (response) => {
      // Follow redirects are handled automatically by net.request
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image (status ${response.statusCode}): ${url}`));
        return;
      }
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", (err: Error) => reject(err));
    });

    request.on("error", (err) => reject(err));
    request.end();
  });
}

/** Extract a file extension from a URL. */
function getExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return ext;
  } catch {
    // URL parsing failed
  }
  return ".jpg"; // default
}

/** Check if a photo path is a remote URL that needs downloading. */
function isRemoteUrl(photo: string): boolean {
  return photo.startsWith("http://") || photo.startsWith("https://");
}

/** In-flight downloads keyed by itemId to prevent concurrent races on the same item. */
const _inFlightDownloads = new Map<string, Promise<string[]>>();

/**
 * Download all remote photos for an item and save them locally.
 * Returns an updated array of photo paths (local local-file:// URLs for downloaded photos,
 * original paths for photos that are already local).
 * @param forceRedownload If true, re-download even if a local file already exists.
 *
 * If a download for the given itemId is already in flight, the existing promise is returned
 * so concurrent callers don't write the same files in parallel.
 */
export function downloadItemPhotos(itemId: string, photos: string[], forceRedownload = false): Promise<string[]> {
  const existing = _inFlightDownloads.get(itemId);
  if (existing) {
    console.log(`[photo-download] Reusing in-flight download for item ${itemId}`);
    return existing;
  }
  const promise = _downloadItemPhotosImpl(itemId, photos, forceRedownload).finally(() => {
    _inFlightDownloads.delete(itemId);
  });
  _inFlightDownloads.set(itemId, promise);
  return promise;
}

async function _downloadItemPhotosImpl(itemId: string, photos: string[], forceRedownload: boolean): Promise<string[]> {
  if (!photos || photos.length === 0) return photos;

  const remotePhotos = photos.filter(isRemoteUrl);
  if (remotePhotos.length === 0) return photos; // all already local

  const dir = ensurePhotoDir(itemId);
  const updatedPhotos: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (!isRemoteUrl(photo)) {
      updatedPhotos.push(photo);
      continue;
    }

    try {
      const ext = getExtension(photo);
      const filename = `photo-${i}${ext}`;
      const filePath = path.join(dir, filename);

      // Skip if already downloaded (same index and file exists) unless forced
      if (!forceRedownload && fs.existsSync(filePath)) {
        updatedPhotos.push(`local-file:///${filePath.replace(/\\/g, "/")}`);
        console.log(`[photo-download] Skipping already downloaded photo ${i} for item ${itemId}`);
        continue;
      }

      console.log(`[photo-download] Downloading photo ${i + 1}/${photos.length} for item ${itemId}...`);
      const buffer = await downloadImage(photo);
      fs.writeFileSync(filePath, buffer);
      updatedPhotos.push(`local-file:///${filePath.replace(/\\/g, "/")}`);
      console.log(`[photo-download] Saved: ${filePath} (${buffer.length} bytes)`);
    } catch (err) {
      console.warn(`[photo-download] Failed to download photo ${i}: ${(err as Error).message}`);
      // Keep the original URL as fallback
      updatedPhotos.push(photo);
    }
  }

  return updatedPhotos;
}

/**
 * Delete all locally stored photos for an item.
 */
export function deleteItemPhotos(itemId: string): void {
  const dir = path.join(PHOTO_DIR, itemId);
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[photo-download] Deleted photo directory for item ${itemId}`);
    } catch (err) {
      console.warn(`[photo-download] Failed to delete photos for item ${itemId}:`, (err as Error).message);
    }
  }
}
