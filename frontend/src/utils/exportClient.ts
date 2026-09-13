import type { Edit } from "../types";
import { applyEdits } from "./pdfEngine";
/** Export in an isolated worker so large PDF operations do not freeze the controls. */
export async function exportPdf(
  bytes: Uint8Array,
  edits: Edit[],
): Promise<Uint8Array> {
  if (typeof Worker === "undefined") return applyEdits(bytes, edits);
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/export.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          "PDF export timed out. Your edits are still here; try a smaller document.",
        ),
      );
    }, 90000);
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = (
      event: MessageEvent<{ bytes?: Uint8Array; error?: string }>,
    ) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.bytes) resolve(event.data.bytes);
      else reject(new Error("The PDF export worker returned no file."));
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error(
          "The PDF export worker stopped unexpectedly. Your edits are still here.",
        ),
      );
    };
    const copy = bytes.slice();
    worker.postMessage({ bytes: copy, edits }, [copy.buffer]);
  });
}
