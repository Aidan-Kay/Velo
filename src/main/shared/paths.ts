import * as path from "path";

/**
 * Resolve a `local-file://` or `file://` URL to an absolute filesystem path.
 * Pass-through for any other input (already absolute or relative).
 */
export function resolveLocalPath(p: string): string {
  if (p.startsWith("local-file://")) {
    return decodeURIComponent(p.replace(/^local-file:\/\/\/?/, ""));
  }
  if (p.startsWith("file://")) {
    return decodeURIComponent(p.replace("file:///", "").replace("file://", ""));
  }
  return p;
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Map a file path's extension to a MIME type. Defaults to `image/jpeg`. */
export function mimeFromPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "image/jpeg";
}
