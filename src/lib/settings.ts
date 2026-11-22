export const MM = 72 / 25.4; // points per millimetre

export const mm = (v: number) => v * MM;
export const toMm = (pt: number) => pt / MM;

/** Paper sizes in mm, long side first (sheets are always used in landscape). */
export const PAPER_SIZES: Record<string, { label: string; w: number; h: number }> = {
  a5: { label: "A5", w: 210, h: 148 },
  a4: { label: "A4", w: 297, h: 210 },
  a3: { label: "A3", w: 420, h: 297 },
  sra4: { label: "SRA4", w: 320, h: 225 },
  sra3: { label: "SRA3", w: 450, h: 320 },
  letter: { label: "US Letter", w: 279.4, h: 215.9 },
  legal: { label: "US Legal", w: 355.6, h: 215.9 },
  tabloid: { label: "US Tabloid", w: 431.8, h: 279.4 },
};

/** Bulk (cm³/g) per paper type: caliper in mm = gsm × bulk / 1000. */
export const PAPER_BULK: Record<string, number> = {
  uncoated: 1.25,
  silk: 0.95,
  gloss: 0.8,
  bulky: 1.5,
};

export interface Settings {
  /** Key of PAPER_SIZES, 'auto' (sheet sized to fit the booklet) or 'custom'. */
  paper: string;
  customW: number;
  customH: number;
  /** Blank border kept free on every edge of the sheet (mm). */
  margin: number;
  scaling: "fit" | "shrink" | "none";

  /** 'auto' reads TrimBox/BleedBox, 'manual' insets every page by `bleed`. */
  bleedMode: "auto" | "manual";
  bleed: number;
  printBleed: boolean;
  cropMarks: boolean;
  foldMarks: boolean;
  markLength: number;
  markOffset: number;

  creepMode: "off" | "auto" | "manual";
  paperWeight: number;
  /** Key of PAPER_BULK or 'custom' (then `paperThickness` is used). */
  paperType: string;
  paperThickness: number;
  /** Manual total creep: shift of the innermost sheet's pages (mm). */
  creep: number;
  gutterMode: "auto" | "manual";
  gutter: number;

  /** Which edge the printer flips on. 'long' rotates back sides by 180°. */
  flip: "short" | "long";
  orientation: "landscape" | "portrait";
  sides: "both" | "front" | "back";
  /** Measured shift of the back side relative to the front (mm). */
  offsetX: number;
  offsetY: number;

  blanks: "end" | "beforeLast";
}

export const DEFAULT_SETTINGS: Settings = {
  paper: "a4",
  customW: 297,
  customH: 210,
  margin: 5,
  scaling: "shrink",
  bleedMode: "manual",
  bleed: 3,
  printBleed: true,
  cropMarks: true,
  foldMarks: true,
  markLength: 5,
  markOffset: 3,
  creepMode: "auto",
  paperWeight: 80,
  paperType: "uncoated",
  paperThickness: 0.1,
  creep: 0.5,
  gutterMode: "auto",
  gutter: 0,
  flip: "long",
  orientation: "landscape",
  sides: "both",
  offsetX: 0,
  offsetY: 0,
  blanks: "end",
};

/** Paper thickness (caliper) in mm from the creep settings. */
export function paperThicknessMm(s: Settings): number {
  if (s.paperType === "custom") return Math.max(0, s.paperThickness);
  const bulk = PAPER_BULK[s.paperType] ?? PAPER_BULK.uncoated;
  return (Math.max(0, s.paperWeight) * bulk) / 1000;
}
