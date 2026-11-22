import { PAPER_SIZES, mm, paperThicknessMm, type Settings } from "./settings";

export interface Sides {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Trim size and available bleed of the reference (first) page, in points. */
export interface RefPage {
  trimW: number;
  trimH: number;
  bleed: Sides;
}

/** [left, right] source page indices of one printed side; null = blank. */
export type Spread = [number | null, number | null];

export interface SheetLayout {
  index: number;
  /** Shift of this sheet's pages towards the spine (pt). */
  creep: number;
  /** Distance from the fold to each page's inner trim edge (pt, may be < 0). */
  halfGutter: number;
  front: Spread;
  back: Spread;
}

/**
 * Complete geometry of the imposed booklet. All lengths are points in the
 * "logical" sheet: landscape, fold running vertically through the centre.
 */
export interface Layout {
  paperW: number;
  paperH: number;
  /** Scale applied to the source pages. */
  scale: number;
  /** Trim size of one booklet page on the sheet. */
  cellW: number;
  cellH: number;
  /** Bleed printed around the trim. */
  bleed: number;
  /** Distance from trim to the start of the crop marks. */
  markOffset: number;
  markLength: number;
  marks: boolean;
  foldMarks: boolean;
  /** Paper thickness used for automatic creep (pt). */
  thickness: number;
  /** Creep of the innermost sheet (pt). */
  totalCreep: number;
  /** Space between the two pages on the outermost sheet (pt). */
  gutter: number;
  pageCount: number;
  blankCount: number;
  sheets: SheetLayout[];
  warnings: string[];
}

/** Reading order of the booklet, padded with blanks to a multiple of four. */
export function paddedOrder(pageCount: number, blanks: Settings["blanks"]): (number | null)[] {
  const order: (number | null)[] = Array.from({ length: pageCount }, (_, i) => i);
  const missing = (4 - (pageCount % 4)) % 4;
  const pad = Array.from({ length: missing }, () => null);
  if (blanks === "beforeLast" && pageCount > 1) order.splice(pageCount - 1, 0, ...pad);
  else order.push(...pad);
  return order;
}

/** Saddle-stitch spreads for sheet `s` (0 = outermost) of a padded order. */
export function sheetSpreads(order: (number | null)[], s: number): { front: Spread; back: Spread } {
  const n = order.length;
  return {
    front: [order[n - 1 - 2 * s], order[2 * s]],
    back: [order[2 * s + 1], order[n - 2 - 2 * s]],
  };
}

export function computeLayout(s: Settings, ref: RefPage, pageCount: number): Layout {
  if (pageCount < 1) throw new Error("The document has no pages.");
  const warnings: string[] = [];
  const order = paddedOrder(pageCount, s.blanks);
  const sheetCount = order.length / 4;

  // Creep: every sheet nested inside another sits one paper thickness further
  // out at the fold, so its pages are pushed towards the spine by that much.
  const thickness = mm(paperThicknessMm(s));
  let totalCreep = 0;
  if (s.creepMode === "auto") totalCreep = thickness * (sheetCount - 1);
  else if (s.creepMode === "manual") totalCreep = mm(Math.max(0, s.creep));
  if (sheetCount < 2) totalCreep = 0;

  // Automatic gutter opens the outer sheets just far enough that the
  // innermost pages meet exactly at the fold and nothing is lost in the spine.
  const gutter = s.gutterMode === "auto" ? 2 * totalCreep : mm(Math.max(0, s.gutter));

  const marks = s.cropMarks;
  const markLength = mm(Math.max(0, s.markLength));
  const srcBleed = s.printBleed
    ? Math.max(ref.bleed.left, ref.bleed.right, ref.bleed.bottom, ref.bleed.top, 0)
    : 0;
  const markOffsetAt = (k: number) => Math.max(mm(Math.max(0, s.markOffset)), k * srcBleed);
  /** Space needed outside the trim for bleed and marks at scale k. */
  const extentAt = (k: number) => (marks ? markOffsetAt(k) + markLength : k * srcBleed);

  const margin = mm(Math.max(0, s.margin));
  let paperW: number;
  let paperH: number;
  let scale = 1;

  if (s.paper === "auto") {
    const e = extentAt(1);
    paperW = 2 * ref.trimW + gutter + 2 * e + 2 * margin;
    paperH = ref.trimH + 2 * e + 2 * margin;
  } else {
    const size =
      s.paper === "custom"
        ? { w: s.customW, h: s.customH }
        : (PAPER_SIZES[s.paper] ?? PAPER_SIZES.a4);
    paperW = mm(size.w);
    paperH = mm(size.h);
    if (!(paperW > 0 && paperH > 0)) throw new Error("The sheet size must be larger than zero.");

    const availW = paperW - 2 * margin;
    const availH = paperH - 2 * margin;
    // The extent depends (weakly) on the scale through the bleed, so iterate.
    let fit = 1;
    for (let i = 0; i < 30; i++) {
      const e = extentAt(fit);
      fit = Math.min((availW - gutter - 2 * e) / (2 * ref.trimW), (availH - 2 * e) / ref.trimH);
      if (!(fit > 0)) break;
    }
    if (!(fit > 0)) {
      throw new Error("Margins, gutter and marks leave no room for the pages on this sheet size.");
    }
    if (s.scaling === "fit") scale = fit;
    else if (s.scaling === "shrink") scale = Math.min(1, fit);
    else if (fit < 1 - 1e-6) {
      warnings.push(
        `At 100 % the booklet does not fit inside the margins (it would fit at ${(fit * 100).toFixed(1)} %).`,
      );
    }
  }

  const sheets: SheetLayout[] = [];
  for (let i = 0; i < sheetCount; i++) {
    const creep = sheetCount > 1 ? (totalCreep * i) / (sheetCount - 1) : 0;
    sheets.push({ index: i, creep, halfGutter: gutter / 2 - creep, ...sheetSpreads(order, i) });
  }
  if (totalCreep > gutter / 2 + 1e-6) {
    warnings.push(
      "Creep is larger than half the gutter: inner sheets lose a sliver of the page at the spine.",
    );
  }

  return {
    paperW,
    paperH,
    scale,
    cellW: ref.trimW * scale,
    cellH: ref.trimH * scale,
    bleed: srcBleed * scale,
    markOffset: markOffsetAt(scale),
    markLength,
    marks,
    foldMarks: marks && s.foldMarks,
    thickness,
    totalCreep,
    gutter,
    pageCount,
    blankCount: order.length - pageCount,
    sheets,
    warnings,
  };
}
