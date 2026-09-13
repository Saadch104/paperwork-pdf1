import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url),
  root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdf = dirname(require.resolve("pdfjs-dist/package.json"));
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  await mkdir(resolve(root, "frontend/public", folder), { recursive: true });
  await cp(resolve(pdf, folder), resolve(root, "frontend/public", folder), {
    recursive: true,
  });
}
