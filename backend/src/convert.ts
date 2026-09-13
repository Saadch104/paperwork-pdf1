import { readFile } from "node:fs/promises";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { HttpError } from "./errors.js";

export function cleanHtml(source: string): string {
  const cleaned = sanitizeHtml(source, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "del",
      "span",
      "div",
      "section",
      "article",
      "blockquote",
      "pre",
      "code",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "caption",
      "a",
      "img",
      "sup",
      "sub",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "title"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i, /^rgb\([\d\s,]+\)$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i],
        "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "font-style": [/^(normal|italic|oblique)$/],
        "text-align": [/^(left|right|center|justify)$/],
        "text-decoration": [/^(none|underline|line-through)$/],
        "white-space": [/^(normal|pre|pre-wrap)$/],
        width: [/^\d+(\.\d+)?(px|pt|%)$/],
        height: [/^\d+(\.\d+)?(px|pt|%)$/],
      },
    },
    exclusiveFilter: (frame) =>
      frame.tag === "img" &&
      !/^data:image\/(png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(
        frame.attribs.src || "",
      ),
  });
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>@page{size:A4;margin:20mm}body{font:11pt Arial,sans-serif;color:#202824;line-height:1.5;overflow-wrap:anywhere}h1,h2,h3{line-height:1.2;break-after:avoid}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:10pt monospace;background:#f5f5f5;padding:12px}blockquote{border-left:3px solid #bbb;padding-left:12px}a{color:#156d4b}</style></head><body>' +
    cleaned +
    "</body></html>"
  );
}
export function escapeText(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export async function convert(
  filePath: string,
  ext: string,
  signal: AbortSignal,
  gotenbergUrl: string,
): Promise<Buffer> {
  const input = await readFile(filePath);
  if (ext === ".pdf") return input;
  const form = new FormData();
  let route = "";
  if (ext === ".docx" || ext === ".pptx") {
    form.append("files", new Blob([input]), `document${ext}`);
    route = "/forms/libreoffice/convert";
  } else {
    const source = input.toString("utf8");
    const html =
      ext === ".md"
        ? await marked(source, { async: false })
        : ext === ".txt"
          ? "<pre>" + escapeText(source) + "</pre>"
          : source;
    form.append(
      "files",
      new Blob([cleanHtml(html)], { type: "text/html" }),
      "index.html",
    );
    form.append("printBackground", "true");
    form.append("preferCssPageSize", "true");
    route = "/forms/chromium/convert/html";
  }
  let response: Response;
  try {
    response = await fetch(gotenbergUrl.replace(/\/$/, "") + route, {
      method: "POST",
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(85000)]),
      redirect: "error",
    });
  } catch (error) {
    if (signal.aborted)
      throw new HttpError(499, "The conversion was cancelled.");
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      throw new HttpError(504, "Conversion timed out. Try a smaller document.");
    throw new HttpError(
      503,
      "The conversion service is unavailable. Start Gotenberg and try again.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(
      response.status === 429 || response.status === 503 ? 503 : 422,
      "The document could not be converted. Check that the file opens correctly in its original application.",
    );
  }
  if (!response.headers.get("content-type")?.includes("application/pdf")) {
    await response.body?.cancel();
    throw new HttpError(
      502,
      "The conversion service returned an invalid file.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new HttpError(502, "The conversion service returned an empty file.");
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 50 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpError(
          413,
          "The converted PDF exceeds the 50 MB output limit.",
        );
      }
      parts.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (signal.aborted)
      throw new HttpError(499, "The conversion was cancelled.");
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new HttpError(504, "Conversion timed out. Try a smaller document.");
    throw new HttpError(
      502,
      "The conversion service interrupted the PDF response.",
    );
  } finally {
    reader.releaseLock();
  }
  const pdf = Buffer.concat(parts);
  if (!pdf.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new HttpError(502, "The conversion service did not return a PDF.");
  return pdf;
}
