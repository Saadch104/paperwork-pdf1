import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set([
  "node_modules",
  "dist",
  ".git",
  ".sites-runtime",
  ".openai",
  "uploads",
  "coverage",
  "test-results",
]);
const generated = new Set([
  "frontend/public/cmaps",
  "frontend/public/standard_fonts",
  "frontend/public/wasm",
  "frontend/public/paperwork-pdf-source.zip",
]);
const files = {};
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, e.name),
      name = relative(root, full).split("\\").join("/");
    if (
      excluded.has(e.name) ||
      generated.has(name) ||
      e.name.endsWith(".log") ||
      (e.name.startsWith(".env") && !e.name.endsWith(".example"))
    )
      continue;
    if (e.isDirectory()) await walk(full);
    else if (e.isFile())
      files["paperwork-pdf/" + name] = [
        new Uint8Array(await readFile(full)),
        { mtime: new Date("2026-01-01T00:00:00Z") },
      ];
  }
}
await walk(root);
await mkdir(resolve(root, "frontend/public"), { recursive: true });
await writeFile(
  resolve(root, "frontend/public/paperwork-pdf-source.zip"),
  zipSync(files, { level: 6 }),
);
console.log(`Packaged ${Object.keys(files).length} source files.`);
