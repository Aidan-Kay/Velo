import { execFile } from "child_process";
import { net, session } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getPrinters as fetchPrinters, print } from "pdf-to-printer";
import { Worker } from "worker_threads";
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

// ─── PDF Cropping (Worker Thread) ─────────────────────────────────────────────

/**
 * Crop a shipping label PDF in a worker thread to avoid blocking the main
 * process event loop. Falls back to top-half crop for unknown couriers.
 */
async function cropLabelPdf(pdfBytes: Buffer, courier: string): Promise<Uint8Array> {
  const courierKey = normaliseCourier(courier);
  const crop = COURIER_CROPS[courierKey] ?? null;

  const workerPath = path.join(__dirname, "label-worker.js");
  const buffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);

  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { pdfBuffer: buffer, crop },
      transferList: [buffer as ArrayBuffer],
    });

    worker.on("message", (result: Uint8Array | { error: string }) => {
      if (result && typeof result === "object" && "error" in result) {
        reject(new Error(result.error));
      } else {
        resolve(new Uint8Array(result as unknown as ArrayBuffer));
      }
      worker.terminate();
    });

    worker.on("error", (err) => {
      reject(err);
      worker.terminate();
    });
  });
}

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

/**
 * Return paper sizes supported by a specific printer using .NET PrinterSettings
 * (Win32_Printer.PrinterPaperNames used by pdf-to-printer returns incomplete results).
 */
export async function getPaperSizesForPrinter(printerName: string): Promise<string[]> {
  const psScript = `
Add-Type -AssemblyName System.Drawing
$ps = New-Object System.Drawing.Printing.PrinterSettings
$ps.PrinterName = '${printerName.replace(/'/g, "''")}'
if ($ps.IsValid) { $ps.PaperSizes | ForEach-Object { $_.PaperName } }
`.trim();

  return new Promise<string[]>((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], { timeout: 10000 }, (err, stdout) => {
      if (err) {
        console.warn("[label-printer] Failed to get paper sizes via .NET, falling back to pdf-to-printer:", err.message);
        fetchPrinters()
          .then((printers) => {
            const printer = printers.find((p) => p.name === printerName);
            resolve(printer?.paperSizes ?? []);
          })
          .catch(() => resolve([]));
        return;
      }
      const sizes = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      resolve(sizes);
    });
  });
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
