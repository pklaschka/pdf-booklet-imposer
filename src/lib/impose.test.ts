import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { buildCalibrationSheet } from "./calibration";
import { impose, sideMatrix } from "./impose";
import { DEFAULT_SETTINGS, mm, type Settings } from "./settings";
import { analyzePage } from "./source";

const set = (o: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...o });
const OUT = process.env.PDF_OUT;
const dump = (name: string, bytes: Uint8Array) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.pdf`, bytes);
};

/** A5 test document, optionally with 3 mm bleed declared via TrimBox. */
async function sample(pages: number, opts: { bleed?: boolean; rotate?: number } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const b = opts.bleed ? mm(3) : 0;
  const w = mm(148.5);
  const h = mm(210);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([w + 2 * b, h + 2 * b]);
    if (opts.bleed) {
      p.setTrimBox(b, b, w, h);
      p.setBleedBox(0, 0, w + 2 * b, h + 2 * b);
    }
    p.drawRectangle({
      x: 0,
      y: 0,
      width: w + 2 * b,
      height: h + 2 * b,
      color: rgb(0.75, 0.85 - (i % 4) * 0.1, 0.95),
    });
    p.drawRectangle({
      x: b + 20,
      y: b + 20,
      width: w - 40,
      height: h - 40,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
    });
    p.drawText(String(i + 1), { x: b + w / 2 - 30, y: b + h / 2 - 30, size: 90, font });
    p.drawText("outer >", { x: b + (i % 2 === 0 ? w - 90 : 30), y: b + 40, size: 14, font });
    if (opts.rotate) p.setRotation(degrees(opts.rotate));
  }
  return doc;
}

describe("impose", () => {
  it("produces two sides per sheet at the chosen paper size", async () => {
    const src = await sample(8);
    const r = await impose(src, set({}));
    dump("plain", r.bytes);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getPageCount()).toBe(4);
    expect(out.getPage(0).getWidth()).toBeCloseTo(mm(297), 3);
    expect(out.getPage(0).getHeight()).toBeCloseTo(mm(210), 3);
    expect(r.sides.map((s) => s.pages)).toEqual([
      [7, 0],
      [1, 6],
      [5, 2],
      [3, 4],
    ]);
  });

  it("pads with blanks and supports partial output", async () => {
    const src = await sample(6);
    const r = await impose(src, set({ blanks: "beforeLast", sides: "front" }), { sheets: [1] });
    expect(r.layout.blankCount).toBe(2);
    expect(r.sides).toEqual([{ sheet: 1, side: "front", pages: [null, 2] }]);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(1);
  });

  it("detects bleed from the TrimBox and draws crop marks", async () => {
    const src = await sample(12, { bleed: true });
    const g = analyzePage(src.getPage(0), { bleedMode: "auto", bleed: 0 });
    expect(g.trimW).toBeCloseTo(mm(148.5), 6);
    expect(g.bleed.left).toBeCloseTo(mm(3), 6);
    expect(g.declaresTrim).toBe(true);
    const r = await impose(
      src,
      set({ paper: "a3", cropMarks: true, creepMode: "manual", creep: 2 }),
    );
    dump("bleed-marks", r.bytes);
    expect(r.layout.bleed).toBeCloseTo(mm(3) * r.layout.scale, 6);
  });

  it("manual bleed insets the page", async () => {
    const src = await sample(4);
    const g = analyzePage(src.getPage(0), { bleedMode: "manual", bleed: 3 });
    expect(g.trimW).toBeCloseTo(mm(142.5), 6);
    expect(g.bleed.top).toBeCloseTo(mm(3), 6);
  });

  it("handles rotated source pages", async () => {
    const src = await sample(4, { rotate: 90 });
    const g = analyzePage(src.getPage(0), { bleedMode: "auto", bleed: 0 });
    expect(g.trimW).toBeCloseTo(mm(210), 6);
    expect(g.trimH).toBeCloseTo(mm(148.5), 6);
    dump("rotated", (await impose(src, set({}))).bytes);
  });

  it("rotates back sides for long-edge duplex and portrait output", async () => {
    const src = await sample(8);
    const s = set({ flip: "long", orientation: "portrait", offsetX: 1, offsetY: -2 });
    const r = await impose(src, s);
    dump("long-portrait", r.bytes);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getPage(0).getWidth()).toBeCloseTo(mm(210), 3);
    expect(out.getPage(0).getHeight()).toBeCloseTo(mm(297), 3);
  });

  it("applies duplex offset, then the 180° turn, to back sides only", () => {
    const W = 800;
    const H = 600;
    const at = (m: number[], x: number, y: number) => [
      m[0] * x + m[2] * y + m[4],
      m[1] * x + m[3] * y + m[5],
    ];
    const s = set({ flip: "short", offsetX: 1, offsetY: 2 });
    expect(sideMatrix(s, W, H, false)).toEqual([1, 0, 0, 1, 0, 0]);
    const short = at(sideMatrix(s, W, H, true), 100, 100);
    expect(short[0]).toBeCloseTo(100 - mm(1), 9);
    expect(short[1]).toBeCloseTo(100 - mm(2), 9);
    const long = at(sideMatrix({ ...s, flip: "long" }, W, H, true), 100, 100);
    expect(long[0]).toBeCloseTo(W - 100 + mm(1), 9);
    expect(long[1]).toBeCloseTo(H - 100 + mm(2), 9);
    const portrait = at(sideMatrix({ ...s, orientation: "portrait" }, W, H, false), 100, 50);
    expect(portrait).toEqual([H - 50, 100]);
  });

  it("builds a calibration sheet", async () => {
    const bytes = await buildCalibrationSheet(set({ offsetX: 0.5 }));
    dump("calibration", bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});
