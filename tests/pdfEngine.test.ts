import { describe, it, expect } from "vitest";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  PDFName,
  PDFArray,
  PDFDict,
} from "pdf-lib";
import {
  applyEdits,
  standardFont,
  safeLink,
  pdfColor,
} from "../frontend/src/utils/pdfEngine";
import { createSamplePdf } from "../frontend/src/utils/samplePdf";
import type { Edit } from "../frontend/src/types";
const base: Edit = {
  id: "test1",
  page: 1,
  kind: "text",
  matrix: [1, 0, 0, 1, 50, 700],
  text: "Changed text",
  width: 150,
  height: 20,
  size: 14,
  color: "#123456",
  background: "#ffffff",
  family: "Helvetica",
  bold: false,
  italic: false,
};
async function fixture() {
  const d = await PDFDocument.create();
  const p = d.addPage([595, 842]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  p.drawText("Original text", { x: 50, y: 700, size: 14, font: f });
  const p2 = d.addPage([595, 842]);
  p2.setRotation(degrees(90));
  p2.setCropBox(20, 30, 500, 700);
  return d.save();
}
describe("real PDF export", () => {
  it("preserves original bytes and page dimensions while exporting edits", async () => {
    const input = await fixture(),
      copy = input.slice();
    const result = await applyEdits(input, [base]);
    expect(input).toEqual(copy);
    expect(result).not.toEqual(input);
    const d = await PDFDocument.load(result);
    expect(d.getPageCount()).toBe(2);
    expect(d.getPage(1).getRotation().angle).toBe(90);
    expect(d.getPage(1).getCropBox()).toEqual({
      x: 20,
      y: 30,
      width: 500,
      height: 700,
    });
  });
  it("exports a multiline replacement and rotated/skewed text", async () => {
    const original = {
      id: base.id,
      page: 1,
      text: "Original text",
      matrix: base.matrix,
      width: 90,
      size: 14,
      ascent: 12,
      descent: 3,
      family: "Helvetica" as const,
      bold: false,
      italic: false,
      color: base.color,
    };
    const input = await fixture();
    const result = await applyEdits(input, [
      { ...base, text: "First line\nSecond line", original },
      {
        ...base,
        id: "rotated",
        page: 2,
        matrix: [0, 1, -1, 0.2, 200, 300],
        text: "Rotated",
      },
    ]);
    expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
  });
  it("exports all 12 standard font variants", async () => {
    const edits: Edit[] = [];
    for (const family of ["Helvetica", "Times", "Courier"] as const)
      for (const bold of [false, true])
        for (const italic of [false, true])
          edits.push({
            ...base,
            id: `${family}${bold}${italic}`,
            family,
            bold,
            italic,
          });
    expect(
      new Set(edits.map((e) => standardFont(e.family, e.bold, e.italic))).size,
    ).toBe(12);
    await expect(applyEdits(await fixture(), edits)).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });
  it("creates actual clickable link annotations and fillable form fields", async () => {
    const result = await applyEdits(await fixture(), [
      { ...base, kind: "link", url: "https://example.com/notes" },
      { ...base, id: "form1", kind: "form", fieldName: "Name", text: "Alex" },
    ]);
    const d = await PDFDocument.load(result);
    expect(d.getForm().getTextField("Name_form1").getText()).toBe("Alex");
    const annots = d.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const link = d.context.lookup(annots.get(0), PDFDict);
    expect(link.get(PDFName.of("Subtype"))?.toString()).toBe("/Link");
    expect(
      link.lookup(PDFName.of("A"), PDFDict).get(PDFName.of("S"))?.toString(),
    ).toBe("/URI");
  });
  it("exports whiteout, highlight, rectangle, ellipse, image and signature", async () => {
    const edits = [
      "whiteout",
      "highlight",
      "rectangle",
      "ellipse",
      "signature",
    ].map((kind, i) => ({ ...base, id: String(i), kind }) as Edit);
    edits.push({
      ...base,
      id: "image",
      kind: "image",
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    });
    const out = await applyEdits(await fixture(), edits);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
  it("rejects unsupported Unicode without mutating the document", async () => {
    const b = await fixture(),
      copy = b.slice();
    await expect(
      applyEdits(b, [{ ...base, text: "hello 世界" }]),
    ).rejects.toThrow("cannot export");
    expect(b).toEqual(copy);
  });
  it("rejects invalid page, coordinates, dimensions and unsafe links", async () => {
    const b = await fixture();
    await expect(applyEdits(b, [{ ...base, page: 7 }])).rejects.toThrow(
      "missing page",
    );
    await expect(applyEdits(b, [{ ...base, width: NaN }])).rejects.toThrow(
      "invalid coordinates",
    );
    await expect(applyEdits(b, [{ ...base, width: -10 }])).rejects.toThrow(
      "invalid size",
    );
    await expect(
      applyEdits(b, [{ ...base, kind: "link", url: "javascript:alert(1)" }]),
    ).rejects.toThrow("https");
  });
  it("generates the three-page interactive sample", async () =>
    expect(
      (await PDFDocument.load(await createSamplePdf())).getPageCount(),
    ).toBe(3));
  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "//example.com",
  ])("rejects dangerous URL %s", (url) =>
    expect(() => safeLink(url)).toThrow(),
  );
  it.each([
    "https://example.com",
    "http://example.com",
    "mailto:hello@example.com",
  ])("accepts safe link %s", (url) => expect(safeLink(url)).toBeTruthy());
  it("validates color input", () => {
    expect(() => pdfColor("red")).toThrow("valid color");
    expect(pdfColor("#ff0000").red).toBe(1);
  });
});
