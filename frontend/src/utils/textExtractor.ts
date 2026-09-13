import type { PDFPageProxy } from "pdfjs-dist";
import type { Matrix, TextBlock, PageInfo, FontFamily } from "../types";

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverse(m: Matrix): Matrix {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) < 1e-10)
    throw new Error("Unsupported singular page transform.");
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
export function point(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
export function screenMatrix(
  matrix: Matrix,
  viewport: Matrix,
  ascent: number,
): Matrix {
  return multiply(multiply(viewport, matrix), [1, 0, 0, -1, 0, ascent]);
}
export function matrixAt(info: PageInfo, x: number, y: number): Matrix {
  return multiply(inverse(info.transform), [1, 0, 0, -1, x, y]);
}
export function fontStyle(name: string): {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
} {
  return {
    family: /courier|mono|consolas/i.test(name)
      ? "Courier"
      : /times|serif|georgia|cambria/i.test(name) && !/sans/i.test(name)
        ? "Times"
        : "Helvetica",
    bold: /bold|black|heavy|demi|semibold/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
}
export function cssFamily(family: FontFamily) {
  return family === "Times"
    ? '"Times New Roman", serif'
    : family === "Courier"
      ? '"Courier New", monospace'
      : "Arial, Helvetica, sans-serif";
}

export async function extractText(
  page: PDFPageProxy,
): Promise<{ blocks: TextBlock[]; info: PageInfo }> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const blocks: TextBlock[] = [];
  for (const [i, item] of content.items.entries()) {
    if (!("str" in item) || !item.str.trim()) continue;
    const t = item.transform as Matrix;
    const size = Math.hypot(t[2], t[3]);
    if (size < 0.1 || !t.every(Number.isFinite)) continue;
    const style = content.styles[item.fontName];
    if (style?.vertical) continue; // Vertical writing needs a different shaping/layout engine.
    const matrix: Matrix = [
      t[0] / size,
      t[1] / size,
      t[2] / size,
      t[3] / size,
      t[4],
      t[5],
    ];
    if (Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-10)
      continue;
    let resolvedName = item.fontName;
    try {
      const font = page.commonObjs.get(item.fontName);
      if (font?.name) resolvedName = font.name;
    } catch {
      /* The renderer may not have loaded the font yet. */
    }
    const format = fontStyle(resolvedName + " " + (style?.fontFamily || ""));
    const horizontalScale = Math.hypot(matrix[0], matrix[1]);
    blocks.push({
      id: `p${page.pageNumber}-t${i}`,
      page: page.pageNumber,
      text: item.str,
      matrix,
      width: item.width / horizontalScale,
      size,
      ascent: (style?.ascent ?? 0.85) * size,
      descent: Math.abs(style?.descent ?? -0.2) * size,
      ...format,
      color: "#202824",
    });
  }
  // Keep PDF.js runs separate: unsafe cross-column/rotation grouping corrupts layouts.
  return {
    blocks,
    info: {
      width: viewport.width,
      height: viewport.height,
      transform: viewport.transform as Matrix,
      rotation: viewport.rotation,
    },
  };
}

/** Estimated advances, not exact PDF glyph metrics. Ligatures/kerning require original font data. */
export function characterPositions(
  block: TextBlock,
  measure: (text: string) => number,
) {
  const chars = Array.from(block.text),
    total = measure(block.text) || 1;
  return chars.map((char, i) => {
    const before = (measure(chars.slice(0, i).join("")) / total) * block.width;
    const after =
      (measure(chars.slice(0, i + 1).join("")) / total) * block.width;
    return {
      char,
      position: point(block.matrix, before, 0),
      width: after - before,
      rotation: Math.atan2(block.matrix[1], block.matrix[0]),
    };
  });
}
