import { it, expect } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractText, point } from "../frontend/src/utils/textExtractor";
import { applyEdits } from "../frontend/src/utils/pdfEngine";
it("reads actual exported PDF text, positions, rotated text, and multiline baselines", async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([595, 842]);
  const f = await d.embedFont(StandardFonts.HelveticaBold);
  p.drawText("Before", { x: 50, y: 700, size: 14, font: f });
  p.drawText("Rotated", {
    x: 200,
    y: 300,
    size: 16,
    font: f,
    rotate: degrees(35),
  });
  const original = await d.save();
  const reader = await getDocument({
    data: original.slice(),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const page = await reader.getPage(1);
  const { blocks } = await extractText(page);
  expect(blocks.length).toBe(2);
  expect(blocks[0].matrix[4]).toBeCloseTo(50);
  expect(blocks[0].matrix[5]).toBeCloseTo(700);
  expect(
    (Math.atan2(blocks[1].matrix[1], blocks[1].matrix[0]) * 180) / Math.PI,
  ).toBeCloseTo(35);
  const out = await applyEdits(original, [
    {
      ...blocks[0],
      text: "After\nSecond line",
      kind: "text",
      height: 40,
      background: "#ffffff",
      original: blocks[0],
    },
  ]);
  const verify = await getDocument({
    data: out.slice(),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const text = await (await verify.getPage(1)).getTextContent();
  const after = text.items.find((i) => "str" in i && i.str === "After");
  const second = text.items.find((i) => "str" in i && i.str === "Second line");
  expect(after).toBeDefined();
  expect(second).toBeDefined();
  if (after && "transform" in after && second && "transform" in second) {
    expect(after.transform[4]).toBeCloseTo(50);
    expect(after.transform[5]).toBeCloseTo(700);
    expect(second.transform[5]).toBeCloseTo(683.2);
  }
  // Whiteout is intentionally visual: original text still exists in the content stream.
  expect(text.items.some((i) => "str" in i && i.str === "Before")).toBe(true);
  await reader.destroy();
  await verify.destroy();
});
