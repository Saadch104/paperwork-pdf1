import path from "node:path";
import { readFile } from "node:fs/promises";
import yauzl from "yauzl";
import { SaxesParser } from "saxes";
import { HttpError } from "./errors.js";
export const extensions = new Set([
  ".docx",
  ".pptx",
  ".html",
  ".htm",
  ".md",
  ".txt",
  ".pdf",
]);
export const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_EXPANDED = 100 * 1024 * 1024;
export function validateOfficeXml(xml: string, relationships: boolean) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw new HttpError(
      415,
      "XML entities are not allowed in uploaded documents.",
    );
  });
  if (relationships)
    parser.on("opentag", (tag) => {
      if (tag.local !== "Relationship") return;
      const attrs = Object.values(tag.attributes);
      const mode = attrs.find((a) => a.local === "TargetMode")?.value;
      const type = attrs.find((a) => a.local === "Type")?.value;
      if (mode?.toLowerCase() === "external" && !type?.endsWith("/hyperlink"))
        throw new HttpError(
          415,
          "External linked resources are not allowed. Embed images in the document before uploading.",
        );
    });
  try {
    parser.write(xml).close();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      415,
      "The Office document contains invalid or unsupported XML.",
    );
  }
}
export async function validateOffice(
  filePath: string,
  ext: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(
            new HttpError(
              415,
              "The Office document is not a valid DOCX or PPTX file.",
            ),
          );
          return;
        }
        let size = 0,
          count = 0,
          main = false,
          types = false,
          done = false;
        const names = new Set<string>();
        const fail = (message: string) => {
          if (done) return;
          done = true;
          zip.close();
          reject(new HttpError(415, message));
        };
        zip.on("error", () => fail("The Office document is damaged."));
        zip.on("entry", (entry: yauzl.Entry) => {
          count++;
          size += entry.uncompressedSize;
          const name = entry.fileName;
          if (
            count > 5000 ||
            size > MAX_EXPANDED ||
            entry.uncompressedSize > MAX_EXPANDED ||
            entry.uncompressedSize / Math.max(1, entry.compressedSize) > 250
          ) {
            fail("The Office document exceeds safe decompression limits.");
            return;
          }
          if (
            names.has(name) ||
            name.includes("..") ||
            name.startsWith("/") ||
            name.includes("\\") ||
            entry.generalPurposeBitFlag & 1
          ) {
            fail("Encrypted or unsafe Office archives are not supported.");
            return;
          }
          names.add(name);
          if (/vbaProject|\/embeddings\/|activeX/i.test(name)) {
            fail(
              "Documents containing macros, embedded objects, or ActiveX are not supported.",
            );
            return;
          }
          if (name === "[Content_Types].xml") types = true;
          if (
            name ===
            (ext === ".docx" ? "word/document.xml" : "ppt/presentation.xml")
          )
            main = true;
          // Read XML relationship files before conversion to reject external resource fetches and entities.
          if (name.endsWith(".rels") || name.endsWith(".xml")) {
            if (entry.uncompressedSize > 20 * 1024 * 1024) {
              fail("An Office XML part is too large.");
              return;
            }
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) {
                fail("The Office document is damaged.");
                return;
              }
              const chunks: Buffer[] = [];
              let actual = 0;
              stream.on("data", (chunk: Buffer) => {
                actual += chunk.length;
                if (actual > 20 * 1024 * 1024) {
                  stream.destroy();
                  fail("An Office XML part is too large.");
                } else chunks.push(chunk);
              });
              stream.on("error", () => fail("The Office document is damaged."));
              stream.on("end", () => {
                if (done) return;
                const xml = Buffer.concat(chunks).toString("utf8");
                try {
                  validateOfficeXml(xml, name.endsWith(".rels"));
                } catch (e) {
                  fail(
                    e instanceof Error
                      ? e.message
                      : "The Office document contains invalid XML.",
                  );
                  return;
                }
                zip.readEntry();
              });
            });
          } else zip.readEntry();
        });
        zip.on("end", () => {
          if (done) return;
          done = true;
          if (!main || !types)
            reject(
              new HttpError(
                415,
                "The file contents do not match the Office extension.",
              ),
            );
          else resolve();
        });
        zip.readEntry();
      },
    );
  });
}
export async function validateFile(
  filePath: string,
  name: string,
  size: number,
) {
  const ext = path.extname(name).toLowerCase();
  if (!extensions.has(ext))
    throw new HttpError(
      415,
      "Unsupported file type. Use PDF, DOCX, PPTX, HTML, Markdown, or TXT.",
    );
  if (size === 0) throw new HttpError(400, "The uploaded file is empty.");
  if (size > MAX_UPLOAD)
    throw new HttpError(413, "Files must be 25 MB or smaller.");
  if (ext === ".docx" || ext === ".pptx") await validateOffice(filePath, ext);
  else {
    const bytes = await readFile(filePath);
    if (ext === ".pdf") {
      if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
        throw new HttpError(415, "This is not a valid PDF file.");
    } else {
      if (bytes.length > 5 * 1024 * 1024)
        throw new HttpError(
          413,
          "HTML, Markdown, and text files must be 5 MB or smaller.",
        );
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new HttpError(415, "Text documents must use UTF-8 encoding.");
      }
      if (bytes.includes(0))
        throw new HttpError(
          415,
          "Binary data is not allowed in a text document.",
        );
    }
  }
  return ext;
}
