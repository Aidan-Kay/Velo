import { degrees, PDFDocument } from "pdf-lib";
import { parentPort, workerData } from "worker_threads";

interface CropConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

interface WorkerInput {
  pdfBuffer: ArrayBuffer;
  crop: CropConfig | null;
}

async function cropPdf(input: WorkerInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(new Uint8Array(input.pdfBuffer));
  const pages = pdfDoc.getPages();

  for (const page of pages) {
    if (input.crop) {
      page.setMediaBox(input.crop.x, input.crop.y, input.crop.width, input.crop.height);
      page.setCropBox(input.crop.x, input.crop.y, input.crop.width, input.crop.height);
      if (input.crop.rotation) {
        page.setRotation(degrees(input.crop.rotation));
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

// Run immediately with workerData
cropPdf(workerData as WorkerInput)
  .then((result) => {
    parentPort?.postMessage(result, [result.buffer as ArrayBuffer]);
  })
  .catch((err) => {
    parentPort?.postMessage({ error: (err as Error).message });
  });
