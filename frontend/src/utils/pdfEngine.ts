import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  PDFName,
  PDFArray,
  PDFString,
} from "pdf-lib";
import type { Edit, FontFamily, Matrix } from "../types";
import { point } from "./textExtractor";
export function standardFont(
  family: FontFamily,
  bold: boolean,
  italic: boolean,
): StandardFonts {
  if (family === "Times")
    return bold
      ? italic
        ? StandardFonts.TimesRomanBoldItalic
        : StandardFonts.TimesRomanBold
      : italic
        ? StandardFonts.TimesRomanItalic
        : StandardFonts.TimesRoman;
  if (family === "Courier")
    return bold
      ? italic
        ? StandardFonts.CourierBoldOblique
        : StandardFonts.CourierBold
      : italic
        ? StandardFonts.CourierOblique
        : StandardFonts.Courier;
  return bold
    ? italic
      ? StandardFonts.HelveticaBoldOblique
      : StandardFonts.HelveticaBold
    : italic
      ? StandardFonts.HelveticaOblique
      : StandardFonts.Helvetica;
}
export function pdfColor(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Choose a valid color.");
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}
export function safeLink(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error("Enter a full URL, such as https://example.com.");
  }
  if (!["https:", "http:", "mailto:"].includes(u.protocol))
    throw new Error("Links must use https, http, or mailto.");
  return u.href;
}
function bounds(m: Matrix, width: number, height: number) {
  const pts = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => point(m, x, y));
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export async function applyEdits(
  bytes: Uint8Array,
  edits: Edit[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  if (doc.isEncrypted)
    throw new Error(
      "Password-protected PDFs are not supported. Unlock your PDF first.",
    );
  const fonts = new Map<string, Awaited<ReturnType<typeof doc.embedFont>>>();
  // Validate every text before drawing anything. Never silently replace unsupported characters.
  for (const edit of edits) {
    if (
      !edit.matrix.every(Number.isFinite) ||
      ![edit.width, edit.height, edit.size].every(Number.isFinite)
    )
      throw new Error("An edit has invalid coordinates.");
    if (edit.page < 1 || edit.page > doc.getPageCount())
      throw new Error("An edit refers to a missing page.");
    if (edit.width <= 0 || edit.height <= 0 || edit.size < 4 || edit.size > 200)
      throw new Error("An edit has an invalid size.");
    if (["text", "signature", "form"].includes(edit.kind)) {
      const key = standardFont(edit.family, edit.bold, edit.italic);
      if (!fonts.has(key)) fonts.set(key, await doc.embedFont(key));
      try {
        for (const line of edit.text.split("\n"))
          fonts.get(key)!.encodeText(line);
      } catch {
        throw new Error(
          "This font cannot export one or more characters. Standard PDF fonts support Latin text; use an image for other scripts. Your edits are still here.",
        );
      }
    }
    if (edit.kind === "link") safeLink(edit.url || "");
  }
  for (const edit of edits) {
    const page = doc.getPage(edit.page - 1);
    if (edit.kind === "link") {
      const b = bounds(edit.matrix, edit.width, edit.height);
      const annotation = doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [b.x, b.y, b.x + b.width, b.y + b.height],
        Border: [0, 0, 0],
        A: {
          Type: "Action",
          S: "URI",
          URI: PDFString.of(safeLink(edit.url || "")),
        },
      });
      let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) {
        annots = doc.context.obj([]);
        page.node.set(PDFName.of("Annots"), annots);
      }
      annots.push(doc.context.register(annotation));
      continue;
    }
    if (edit.kind === "form") {
      const b = bounds(edit.matrix, edit.width, edit.height);
      const form = doc.getForm();
      const name =
        (edit.fieldName || "field") + "_" + edit.id.replace(/[^a-z0-9]/gi, "");
      const field = form.createTextField(name);
      field.setText(edit.text);
      field.addToPage(page, {
        ...b,
        textColor: pdfColor(edit.color),
        borderColor: rgb(0.62, 0.69, 0.66),
        backgroundColor: rgb(1, 1, 1),
        font: fonts.get(standardFont(edit.family, edit.bold, edit.italic)),
      });
      field.setFontSize(edit.size);
      continue;
    }
    if (edit.original) {
      const b = edit.original;
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(...b.matrix),
      );
      page.drawRectangle({
        x: -1.5,
        y: -b.descent - 1.5,
        width: b.width + 3,
        height: b.ascent + b.descent + 3,
        color: pdfColor(edit.background),
      });
      page.pushOperators(popGraphicsState());
    }
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...edit.matrix),
    );
    if (edit.kind === "text" || edit.kind === "signature") {
      page.drawText(edit.text, {
        x: 0,
        y: 0,
        size: edit.size,
        font: fonts.get(standardFont(edit.family, edit.bold, edit.italic))!,
        color: pdfColor(edit.color),
        lineHeight: edit.size * 1.2,
      });
    } else if (edit.kind === "image" && edit.dataUrl) {
      const img = edit.dataUrl.startsWith("data:image/png")
        ? await doc.embedPng(edit.dataUrl)
        : await doc.embedJpg(edit.dataUrl);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: edit.width,
        height: edit.height,
      });
    } else if (edit.kind === "ellipse") {
      page.drawEllipse({
        x: edit.width / 2,
        y: edit.height / 2,
        xScale: edit.width / 2,
        yScale: edit.height / 2,
        borderColor: pdfColor(edit.color),
        borderWidth: 1.5,
      });
    } else if (edit.kind === "whiteout") {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: edit.width,
        height: edit.height,
        color: pdfColor(edit.background),
      });
    } else if (edit.kind === "highlight") {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: edit.width,
        height: edit.height,
        color: pdfColor(edit.color),
        opacity: 0.3,
      });
    } else if (edit.kind === "rectangle") {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: edit.width,
        height: edit.height,
        borderColor: pdfColor(edit.color),
        borderWidth: 1.5,
      });
    }
    page.pushOperators(popGraphicsState());
  }
  return doc.save();
}
export function downloadPdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/\.[^.]+$/, "") + "-edited.pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
