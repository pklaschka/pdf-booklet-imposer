import {
  PDFDocument,
  type PDFPage,
  clip,
  concatTransformationMatrix,
  drawObject,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setDashPattern,
  setLineWidth,
  setStrokingGrayscaleColor,
  stroke,
} from "pdf-lib";
import { computeLayout, type Layout, type SheetLayout, type Spread } from "./layout";
import { mm, type Settings } from "./settings";
import { analyzeDocument, compose, type Matrix, type PageGeom } from "./source";

export interface OutputSide {
  sheet: number;
  side: "front" | "back";
  pages: Spread;
}

export interface ImposeResult {
  bytes: Uint8Array;
  layout: Layout;
  sides: OutputSide[];
}

/** Output page size for a logical (landscape) sheet. */
export function outputPageSize(s: Settings, paperW: number, paperH: number): [number, number] {
  return s.orientation === "portrait" ? [paperH, paperW] : [paperW, paperH];
}

/**
 * Transform from logical sheet coordinates to output page coordinates.
 * Back sides are first shifted to compensate the measured duplex offset,
 * then turned by 180° when the printer flips on the long edge, and finally
 * everything is rotated by 90° for portrait output.
 */
export function sideMatrix(s: Settings, paperW: number, paperH: number, back: boolean): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  if (back) {
    m = [1, 0, 0, 1, -mm(s.offsetX || 0), -mm(s.offsetY || 0)];
    if (s.flip === "long") m = compose([-1, 0, 0, -1, paperW, paperH], m);
  }
  if (s.orientation === "portrait") m = compose([0, 1, -1, 0, paperH, 0], m);
  return m;
}

/** Opens a graphics state on a new output page set up for logical coordinates. */
export function beginSide(
  out: PDFDocument,
  s: Settings,
  paperW: number,
  paperH: number,
  back: boolean,
): PDFPage {
  const page = out.addPage(outputPageSize(s, paperW, paperH));
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...sideMatrix(s, paperW, paperH, back)),
  );
  return page;
}

export async function impose(
  src: PDFDocument,
  s: Settings,
  opts: { sheets?: number[] } = {},
): Promise<ImposeResult> {
  const geoms = analyzeDocument(src, s);
  if (geoms.length === 0) throw new Error("The document has no pages.");
  const layout = computeLayout(s, geoms[0], geoms.length);

  const sheets = (opts.sheets ?? layout.sheets.map((sh) => sh.index))
    .filter((i) => i >= 0 && i < layout.sheets.length)
    .map((i) => layout.sheets[i]);

  const sides: OutputSide[] = [];
  for (const sh of sheets) {
    if (s.sides !== "back") sides.push({ sheet: sh.index, side: "front", pages: sh.front });
    if (s.sides !== "front") sides.push({ sheet: sh.index, side: "back", pages: sh.back });
  }

  const out = await PDFDocument.create();
  out.setProducer("PDF Booklet Imposer");
  out.setCreator("PDF Booklet Imposer");

  // Embed every needed source page once, in a single call so that shared
  // resources (fonts, images) are copied only once.
  const needed = [...new Set(sides.flatMap((x) => x.pages))]
    .filter((i): i is number => i !== null && geoms[i].hasContent)
    .sort((a, b) => a - b);
  const embedded = needed.length
    ? await out.embedPages(
        needed.map((i) => src.getPage(i)),
        needed.map((i) => geoms[i].media),
        needed.map(() => [1, 0, 0, 1, 0, 0] as Matrix),
      )
    : [];
  const refs = new Map(needed.map((i, n) => [i, embedded[n].ref]));

  for (const side of sides) {
    const sh = layout.sheets[side.sheet];
    const page = beginSide(out, s, layout.paperW, layout.paperH, side.side === "back");
    side.pages.forEach((index, slot) => {
      const ref = index === null ? undefined : refs.get(index);
      if (index === null || !ref) return;
      const name = page.node.newXObject("Pg", ref);
      drawSourcePage(page, name, geoms[index], layout, sh, slot === 0);
    });
    if (layout.marks) drawMarks(page, layout, sh);
    page.pushOperators(popGraphicsState());
  }

  return { bytes: await out.save(), layout, sides };
}

function drawSourcePage(
  page: PDFPage,
  name: Parameters<typeof drawObject>[0],
  g: PageGeom,
  l: Layout,
  sh: SheetLayout,
  isLeft: boolean,
) {
  const cx = l.paperW / 2;
  const cellX = isLeft ? cx - sh.halfGutter - l.cellW : cx + sh.halfGutter;
  const cellY = (l.paperH - l.cellH) / 2;

  // Fit the page into its cell (identity for documents with uniform pages).
  const k = Math.min(l.cellW / g.trimW, l.cellH / g.trimH);
  const x = cellX + (l.cellW - k * g.trimW) / 2;
  const y = cellY + (l.cellH - k * g.trimH) / 2;

  // Clip to trim plus bleed; nothing may cross the fold into the facing page.
  const b = (v: number) => Math.min(k * v, l.bleed);
  let x0 = x - b(g.bleed.left);
  let x1 = x + k * g.trimW + b(g.bleed.right);
  const y0 = y - b(g.bleed.bottom);
  const y1 = y + k * g.trimH + b(g.bleed.top);
  if (isLeft) x1 = Math.min(x1, cx);
  else x0 = Math.max(x0, cx);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return;

  const m = compose([k, 0, 0, k, x, y], g.matrix);
  page.pushOperators(
    pushGraphicsState(),
    rectangle(x0, y0, x1 - x0, y1 - y0),
    clip(),
    endPath(),
    concatTransformationMatrix(...m),
    drawObject(name),
    popGraphicsState(),
  );
}

function drawMarks(page: PDFPage, l: Layout, sh: SheetLayout) {
  const cx = l.paperW / 2;
  // The corner marks follow the creep-shifted pages: that is where the
  // fore-edge cut actually lands on this sheet.
  const xl = cx - sh.halfGutter - l.cellW;
  const xr = cx + sh.halfGutter + l.cellW;
  const yb = (l.paperH - l.cellH) / 2;
  const yt = yb + l.cellH;
  const o = l.markOffset;
  const n = l.markLength;

  const line = (ax: number, ay: number, bx: number, by: number) => [
    moveTo(ax, ay),
    lineTo(bx, by),
    stroke(),
  ];
  const ops = [pushGraphicsState(), setStrokingGrayscaleColor(0), setLineWidth(0.25)];
  for (const y of [yb, yt]) {
    ops.push(...line(xl - o - n, y, xl - o, y), ...line(xr + o, y, xr + o + n, y));
  }
  for (const x of [xl, xr]) {
    ops.push(...line(x, yt + o, x, yt + o + n), ...line(x, yb - o - n, x, yb - o));
  }
  if (l.foldMarks) {
    ops.push(
      setDashPattern([2, 1.5], 0),
      ...line(cx, yt + o, cx, yt + o + n),
      ...line(cx, yb - o - n, cx, yb - o),
    );
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}
