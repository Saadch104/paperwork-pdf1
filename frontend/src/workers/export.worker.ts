import { applyEdits } from "../utils/pdfEngine";
import type { Edit } from "../types";
self.onmessage = async (
  event: MessageEvent<{ bytes: Uint8Array; edits: Edit[] }>,
) => {
  try {
    const bytes = await applyEdits(event.data.bytes, event.data.edits);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Could not export this PDF.",
    });
  }
};
