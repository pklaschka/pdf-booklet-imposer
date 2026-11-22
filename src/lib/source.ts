import type { PDFDocument, PDFPage } from "@cantoo/pdf-lib";
import type { Matrix } from "./geometry";
import type { RefPage, Sides } from "./layout";
import { mm, type Settings } from "./settings";

export interface PageGeom extends RefPage {
  /** Maps source user space to upright page space with the trim box at (0,0). */
  matrix: Matrix;
  /** MediaBox, used as the bounding box of the embedded page. */
  media: { left: number; bottom: number; right: number; top: number };
  /** False for pages without a content stream (nothing to draw). */
  hasContent: boolean;
  /** True when the PDF itself declares a TrimBox smaller than the page. */
  declaresTrim: boolean;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const toBox = (r: { x: number; y: number; width: number; height: number }): Box => ({
  x0: Math.min(r.x, r.x + r.width),
  y0: Math.min(r.y, r.y + r.height),
  x1: Math.max(r.x, r.x + r.width),
  y1: Math.max(r.y, r.y + r.height),
});

const intersect = (a: Box, b: Box): Box => {
  const r = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : a;
};

export function analyzePage(page: PDFPage, s: Pick<Settings, "bleedMode" | "bleed">): PageGeom {
  const media = toBox(page.getMediaBox());
  const crop = intersect(toBox(page.getCropBox()), media);

  let trim: Box;
  let bleedBox: Box;
  const hasTrimBox = page.node.TrimBox() !== undefined;
  const declared = hasTrimBox ? intersect(toBox(page.getTrimBox()), media) : crop;
  const declaredBleed = intersect(toBox(page.getBleedBox()), media);
  const declaresTrim =
    hasTrimBox &&
    (declared.x0 - declaredBleed.x0 > 0.01 ||
      declared.y0 - declaredBleed.y0 > 0.01 ||
      declaredBleed.x1 - declared.x1 > 0.01 ||
      declaredBleed.y1 - declared.y1 > 0.01);

  if (s.bleedMode === "auto") {
    trim = declared;
    bleedBox = declaredBleed;
  } else {
    const b = mm(Math.max(0, s.bleed));
    bleedBox = crop;
    // Never inset so far that the page disappears.
    const bx = Math.min(b, (crop.x1 - crop.x0) / 2 - 1);
    const by = Math.min(b, (crop.y1 - crop.y0) / 2 - 1);
    const i = Math.max(0, Math.min(bx, by));
    trim = { x0: crop.x0 + i, y0: crop.y0 + i, x1: crop.x1 - i, y1: crop.y1 - i };
  }

  const w = trim.x1 - trim.x0;
  const h = trim.y1 - trim.y0;
  const src: Sides = {
    left: Math.max(0, trim.x0 - bleedBox.x0),
    right: Math.max(0, bleedBox.x1 - trim.x1),
    bottom: Math.max(0, trim.y0 - bleedBox.y0),
    top: Math.max(0, bleedBox.y1 - trim.y1),
  };

  const rotation = (((page.getRotation().angle % 360) + 360) % 360) as number;
  let matrix: Matrix;
  let bleed: Sides;
  let trimW = w;
  let trimH = h;
  switch (rotation) {
    case 90: // displayed rotated clockwise: source bottom edge becomes the left edge
      matrix = [0, -1, 1, 0, -trim.y0, trim.x1];
      bleed = { left: src.bottom, top: src.left, right: src.top, bottom: src.right };
      trimW = h;
      trimH = w;
      break;
    case 180:
      matrix = [-1, 0, 0, -1, trim.x1, trim.y1];
      bleed = { left: src.right, right: src.left, top: src.bottom, bottom: src.top };
      break;
    case 270:
      matrix = [0, 1, -1, 0, trim.y1, -trim.x0];
      bleed = { right: src.bottom, top: src.right, left: src.top, bottom: src.left };
      trimW = h;
      trimH = w;
      break;
    default:
      matrix = [1, 0, 0, 1, -trim.x0, -trim.y0];
      bleed = src;
  }

  return {
    matrix,
    trimW,
    trimH,
    bleed,
    media: { left: media.x0, bottom: media.y0, right: media.x1, top: media.y1 },
    hasContent: page.node.Contents() !== undefined,
    declaresTrim,
  };
}

export function analyzeDocument(
  doc: PDFDocument,
  s: Pick<Settings, "bleedMode" | "bleed">,
): PageGeom[] {
  return doc.getPages().map((p) => analyzePage(p, s));
}
