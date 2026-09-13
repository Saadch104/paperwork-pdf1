import { describe, it, expect } from "vitest";
import {
  multiply,
  inverse,
  point,
  screenMatrix,
  matrixAt,
  fontStyle,
  characterPositions,
} from "../frontend/src/utils/textExtractor";
import type { Matrix, TextBlock, Edit } from "../frontend/src/types";
import { historyReducer, emptyHistory } from "../frontend/src/utils/history";
describe("PDF and CSS transforms", () => {
  const matrices: Matrix[] = [
    [1, 0, 0, -1, 0, 842],
    [0, 1, 1, 0, -30, -10],
    [-2, 0, 0, 2, 1200, -20],
    [1.2, 0.3, -0.2, 2.1, 50, 800],
  ];
  it.each(matrices)("round-trips full affine transforms %#", (...values) => {
    const m = values as Matrix;
    const p = point(m, 37, 91);
    const r = point(inverse(m), ...p);
    expect(r[0]).toBeCloseTo(37, 8);
    expect(r[1]).toBeCloseTo(91, 8);
  });
  it.each(matrices)(
    "new objects align with displayed page at any rotation %#",
    (...values) => {
      const transform = values as Matrix;
      const m = matrixAt(
        { width: 595, height: 842, transform, rotation: 0 },
        35,
        160,
      );
      const origin = point(multiply(transform, m), 0, 0);
      expect(origin[0]).toBeCloseTo(35);
      expect(origin[1]).toBeCloseTo(160);
      expect(point(multiply(transform, m), 20, 10)[0]).toBeCloseTo(55);
      expect(point(multiply(transform, m), 20, 10)[1]).toBeCloseTo(150);
    },
  );
  it("positions a rotated glyph box from the baseline and ascent", () => {
    const m: Matrix = [0, 1, -1, 0, 120, 400];
    expect(screenMatrix(m, [1, 0, 0, -1, 0, 842], 10)).toEqual([
      0, -1, 1, 0, 110, 442,
    ]);
  });
  it("rejects singular transforms", () =>
    expect(() => inverse([1, 1, 1, 1, 0, 0])).toThrow("singular"));
  it("maps font variants without treating sans-serif as Times", () => {
    expect(fontStyle("ABCDEF+TimesNewRomanPS-BoldItalicMT")).toEqual({
      family: "Times",
      bold: true,
      italic: true,
    });
    expect(fontStyle("sans-serif")).toEqual({
      family: "Helvetica",
      bold: false,
      italic: false,
    });
    expect(fontStyle("Courier-Oblique")).toEqual({
      family: "Courier",
      bold: false,
      italic: true,
    });
  });
  it("returns estimated character positions with rotation", () => {
    const b = {
      text: "ab",
      width: 20,
      matrix: [0, 1, -1, 0, 50, 60],
    } as TextBlock;
    const p = characterPositions(b, (s) => s.length * 10);
    expect(p[1].position).toEqual([50, 70]);
    expect(p[1].rotation).toBeCloseTo(Math.PI / 2);
  });
});
describe("edit transactions", () => {
  const e = { id: "a", text: "First" } as Edit;
  it("undoes and redoes complete edits", () => {
    const a = historyReducer(emptyHistory, { type: "commit", edits: [e] });
    const b = historyReducer(a, { type: "undo" });
    expect(b.present).toEqual([]);
    expect(historyReducer(b, { type: "redo" }).present).toEqual([e]);
  });
  it("clears the redo branch after a new edit", () => {
    let h = historyReducer(emptyHistory, { type: "commit", edits: [e] });
    h = historyReducer(h, { type: "undo" });
    h = historyReducer(h, {
      type: "commit",
      edits: [{ ...e, text: "Different" }],
    });
    expect(h.future).toEqual([]);
  });
  it("bounds undo history to 100 transactions", () => {
    let h = emptyHistory;
    for (let i = 0; i < 110; i++)
      h = historyReducer(h, {
        type: "commit",
        edits: [{ ...e, text: String(i) }],
      });
    expect(h.past.length).toBe(100);
    expect(historyReducer(h, { type: "reset" })).toEqual(emptyHistory);
  });
});
