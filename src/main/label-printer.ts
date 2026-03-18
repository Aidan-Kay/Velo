import { net, session } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { degrees, PDFDocument } from "pdf-lib";
import { getPrinters as fetchPrinters, print } from "pdf-to-printer";
import type { PrinterInfo } from "../shared/types";

const SESSION_PARTITION = "persist:vinted";

// ─── PDF Download ─────────────────────────────────────────────────────────────

/** Download a PDF from a URL using the Vinted session cookies. */
async function downloadPdf(labelUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition(SESSION_PARTITION);
    const request = net.request({ url: labelUrl, session: ses });

    const chunks: Buffer[] = [];
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download label PDF (status ${response.statusCode})`));
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

// ─── Courier-Specific Crop Coordinates ────────────────────────────────────────

interface CropConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // degrees, e.g. -90
}

/** Courier crop configs — derived from reference cropped PDFs. */
const COURIER_CROPS: Record<string, CropConfig> = {
  "inpost-locker": { x: 102, y: 10.89, width: 417, height: 295, rotation: -90 },
  "inpost-home": { x: 150, y: 10, width: 297, height: 421 },
  evri: { x: 17.15, y: 394.64, width: 290, height: 425.25 },
};

/** Normalise a courier name to a crop config key. */
function normaliseCourier(courier: string): string {
  const lower = courier.toLowerCase().trim();
  console.log(`[label-printer] Normalising courier name: "${courier}" -> "${lower}"`);
  if (lower.includes("inpost") && lower.includes("home")) return "inpost-home";
  if (lower.includes("inpost")) return "inpost-locker";
  if (lower.includes("evri") || lower.includes("hermes")) return "evri";
  if (lower.includes("dpd")) return "dpd";
  if (lower.includes("royal mail")) return "royal_mail";
  if (lower.includes("yodel")) return "yodel";
  return lower.replace(/[^a-z0-9]/g, "_");
}

// ─── PDF Cropping ─────────────────────────────────────────────────────────────

/**
 * Crop a shipping label PDF using courier-specific coordinates.
 * Falls back to top-half crop for unknown couriers.
 */
async function cropLabelPdf(pdfBytes: Buffer, courier: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const courierKey = normaliseCourier(courier);
  const crop = COURIER_CROPS[courierKey];

  for (const page of pages) {
    if (crop) {
      page.setMediaBox(crop.x, crop.y, crop.width, crop.height);
      page.setCropBox(crop.x, crop.y, crop.width, crop.height);
      if (crop.rotation) {
        page.setRotation(degrees(crop.rotation));
      }
    } else {
      // Fallback: crop to top half of A4 page
      const { width, height } = page.getSize();
      page.setMediaBox(0, height / 2, width, height / 2);
      page.setCropBox(0, height / 2, width, height / 2);
    }
  }

  return pdfDoc.save();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Download, crop, and open a shipping label in an in-app browser window.
 * Automatically triggers the print dialog once the PDF has loaded.
 */

// ─── Printer Discovery ────────────────────────────────────────────────────────

/** Return all available printers on the system. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const printers = await fetchPrinters();
  return printers.map((p) => ({
    deviceId: p.deviceId,
    name: p.name,
    paperSizes: p.paperSizes ?? [],
  }));
}

/** Return paper sizes supported by a specific printer. */
export async function getPaperSizesForPrinter(printerName: string): Promise<string[]> {
  const printers = await fetchPrinters();
  const printer = printers.find((p) => p.name === printerName);
  return printer?.paperSizes ?? [];
}

// ─── Print ────────────────────────────────────────────────────────────────────

/**
 * https://github.com/artiebits/pdf-to-printer
 */

async function printDocument(filePath: string, printerName?: string, paperSize?: string): Promise<void> {
  const options: Record<string, unknown> = {};
  if (printerName) options.printer = printerName;
  if (paperSize) options.paperSize = paperSize;

  await print(filePath, options as any);
  console.log("[label-printer] Print successful");
}

export async function printShippingLabel(
  labelUrl: string,
  courier: string,
  printerName?: string,
  paperSize?: string,
): Promise<{ success: boolean }> {
  console.log(`[label-printer] Downloading label PDF from: ${labelUrl} (courier: ${courier})`);
  const pdfBytes = await downloadPdf(labelUrl);
  console.log(`[label-printer] Downloaded ${pdfBytes.length} bytes, cropping for ${courier}...`);

  const croppedPdf = await cropLabelPdf(pdfBytes, courier);
  console.log(`[label-printer] Cropped to ${croppedPdf.length} bytes`);

  // Write to a temp file for printing, then clean up
  const tempDir = os.tmpdir();
  const fileName = `vinted-label-${Date.now()}.pdf`;
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(croppedPdf));

  try {
    await printDocument(filePath, printerName, paperSize);
    console.log("[label-printer] Label sent to printer");
    return { success: true };
  } catch (err) {
    console.error("[label-printer] Print failed:", err);
    return { success: false };
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
