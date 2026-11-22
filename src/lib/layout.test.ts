import { describe, expect, it } from "vite-plus/test";
import { computeLayout, paddedOrder, sheetSpreads, type RefPage } from "./layout";
import { DEFAULT_SETTINGS, mm, type Settings } from "./settings";

const a5: RefPage = {
  trimW: mm(148.5),
  trimH: mm(210),
  bleed: { left: 0, right: 0, bottom: 0, top: 0 },
};
const a5bleed: RefPage = { ...a5, bleed: { left: mm(3), right: mm(3), bottom: mm(3), top: mm(3) } };
const set = (o: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...o });

describe("page order", () => {
  it("pads to a multiple of four", () => {
    expect(paddedOrder(5, "end")).toEqual([0, 1, 2, 3, 4, null, null, null]);
    expect(paddedOrder(6, "beforeLast")).toEqual([0, 1, 2, 3, 4, null, null, 5]);
    expect(paddedOrder(8, "end")).toHaveLength(8);
  });

  it("produces saddle-stitch spreads", () => {
    const order = paddedOrder(8, "end");
    expect(sheetSpreads(order, 0)).toEqual({ front: [7, 0], back: [1, 6] });
    expect(sheetSpreads(order, 1)).toEqual({ front: [5, 2], back: [3, 4] });
  });

  it("puts consecutive pages back to back", () => {
    const order = paddedOrder(16, "end");
    for (let s = 0; s < 4; s++) {
      const { front, back } = sheetSpreads(order, s);
      // front-right is backed by back-left, front-left by back-right
      expect(back[0]).toBe(front[1]! + 1);
      expect(front[0]).toBe(back[1]! + 1);
    }
  });
});

describe("scaling and margins", () => {
  it("scales the booklet down to respect the margins", () => {
    const l = computeLayout(set({ margin: 10, creepMode: "off", cropMarks: false }), a5, 8);
    // A5 spreads have the sheet's proportions, so the height limits first.
    expect(l.scale).toBeCloseTo(190 / 210, 6);
    expect(l.cellH).toBeCloseTo(mm(190), 6);
    expect(2 * l.cellW).toBeLessThanOrEqual(mm(277));
  });

  it('keeps 100 % when shrink-only has room, and warns when "none" overflows', () => {
    const big = computeLayout(set({ paper: "a3", scaling: "shrink", creepMode: "off" }), a5, 8);
    expect(big.scale).toBe(1);
    const none = computeLayout(
      set({ scaling: "none", margin: 10, creepMode: "off", cropMarks: false }),
      a5,
      8,
    );
    expect(none.scale).toBe(1);
    expect(none.warnings).toHaveLength(1);
  });

  it("reserves room for bleed and crop marks", () => {
    const l = computeLayout(
      set({ paper: "a3", scaling: "fit", margin: 5, cropMarks: true, creepMode: "off" }),
      a5bleed,
      8,
    );
    const ext = l.markOffset + l.markLength;
    const w = 2 * l.cellW + 2 * ext;
    const h = l.cellH + 2 * ext;
    expect(w).toBeLessThanOrEqual(mm(410) + 1e-6);
    expect(h).toBeLessThanOrEqual(mm(287) + 1e-6);
    expect(Math.max(w / mm(410), h / mm(287))).toBeCloseTo(1, 6);
    expect(l.markOffset).toBeCloseTo(Math.max(mm(3), l.bleed), 9);
  });

  it("sizes an automatic sheet around the booklet", () => {
    const l = computeLayout(
      set({ paper: "auto", margin: 5, cropMarks: true, creepMode: "off" }),
      a5bleed,
      8,
    );
    expect(l.scale).toBe(1);
    expect(l.paperW).toBeCloseTo(mm(297 + 2 * 8 + 10), 6);
    expect(l.paperH).toBeCloseTo(mm(210 + 2 * 8 + 10), 6);
  });

  it("rejects impossible margins", () => {
    expect(() => computeLayout(set({ margin: 150 }), a5, 8)).toThrow();
  });
});

describe("creep and gutter", () => {
  it("derives creep from paper thickness and sheet count", () => {
    const l = computeLayout(set({ paperWeight: 80, paperType: "uncoated" }), a5, 20);
    expect(l.sheets).toHaveLength(5);
    expect(l.thickness).toBeCloseTo(mm(0.1), 9);
    expect(l.totalCreep).toBeCloseTo(mm(0.4), 9);
    expect(l.sheets.map((s) => s.creep / mm(0.1))).toEqual(
      [0, 1, 2, 3, 4].map((v) => expect.closeTo(v, 6)),
    );
  });

  it("auto gutter lets the innermost pages meet at the fold", () => {
    const l = computeLayout(set({}), a5, 20);
    expect(l.gutter).toBeCloseTo(2 * l.totalCreep, 9);
    expect(l.sheets[0].halfGutter).toBeCloseTo(l.totalCreep, 9);
    expect(l.sheets[4].halfGutter).toBeCloseTo(0, 9);
    expect(l.warnings).toHaveLength(0);
  });

  it("manual gutter with creep can overlap the fold and warns", () => {
    const l = computeLayout(
      set({ creepMode: "manual", creep: 1, gutterMode: "manual", gutter: 0 }),
      a5,
      16,
    );
    expect(l.sheets[3].halfGutter).toBeCloseTo(-mm(1), 9);
    expect(l.warnings).toHaveLength(1);
  });

  it("has no creep for a single sheet", () => {
    expect(computeLayout(set({ creepMode: "manual", creep: 2 }), a5, 4).totalCreep).toBe(0);
  });
});
