import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  popGraphicsState,
  rgb,
} from "pdf-lib";
import { beginSide } from "./impose";
import { MM, PAPER_SIZES, mm, type Settings } from "./settings";

const RANGE = 8; // ruler covers ±RANGE mm
const RULER_AT = 22; // rulers sit this far (mm) from the sheet centre
const black = rgb(0, 0, 0);

/**
 * Two-page test sheet for measuring how far the printer shifts the back side
 * relative to the front. It is run through the same flip / orientation /
 * offset pipeline as the booklet, so a reprint with the measured values
 * applied should read 0 / 0.
 *
 * The front carries a cross through the sheet centre. The back carries two
 * rulers whose ticks are labelled with the negated position: if the back
 * image lands e mm off, the front line shows through at the tick labelled e.
 */
export async function buildCalibrationSheet(
  s: Settings,
  paper?: { w: number; h: number },
  info: { template?: string; date?: Date } = {},
): Promise<Uint8Array> {
  const size =
    paper ??
    (s.paper === "custom"
      ? { w: mm(s.customW), h: mm(s.customH) }
      : (() => {
          const p = PAPER_SIZES[s.paper] ?? PAPER_SIZES.a4;
          return { w: mm(p.w), h: mm(p.h) };
        })());
  const { w, h } = size;
  const cx = w / 2;
  const cy = h / 2;

  const out = await PDFDocument.create();
  out.setTitle("Duplex calibration sheet");
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const line = (p: PDFPage, x0: number, y0: number, x1: number, y1: number, t = 0.3) =>
    p.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: t, color: black });
  const text = (p: PDFPage, str: string, x: number, y: number, sz = 9, f: PDFFont = font) =>
    p.drawText(str, { x, y, size: sz, font: f, color: black });
  const left = cx - mm(60);

  // ---- front ----
  const front = beginSide(out, s, w, h, false);
  const arm = mm(RULER_AT + 12);
  line(front, cx, cy - arm, cx, cy + arm);
  line(front, cx - arm, cy, cx + arm, cy);
  text(front, "FRONT", left, cy + mm(62), 16, bold);
  [
    "Duplex calibration. Print this file double-sided with exactly the settings you use for booklets",
    '(same paper tray, same "flip on short/long edge" choice), at 100 % / "actual size".',
    "Then hold the sheet against a bright light and follow the instructions on the back.",
  ].forEach((t, i) => text(front, t, left, cy + mm(55) - i * 11, 8));
  // The settings this sheet was made with, so a printout can be matched to them later.
  const signed = (v: number) => `${v > 0 ? "+" : ""}${(v || 0).toFixed(2)} mm`;
  const sizeName =
    PAPER_SIZES[s.paper]?.label ?? (s.paper === "custom" ? "Custom" : "Booklet sheet");
  const used = [
    `Sheet: ${sizeName}, ${(w / MM).toFixed(0)} x ${(h / MM).toFixed(0)} mm, ${s.orientation}`,
    `Printer flips on: ${s.flip} edge${s.flip === "long" ? " (back side turned 180 degrees)" : ""}`,
    `Back-side offset applied: X ${signed(s.offsetX)}, Y ${signed(s.offsetY)}`,
  ];
  if (info.template) used.push(`Template: ${info.template.replace(/[^\x20-\x7e]/g, "?")}`);
  used.push(
    `Created: ${(info.date ?? new Date()).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  );
  text(front, "Settings used for this sheet", left, cy - mm(42), 9, bold);
  used.forEach((t, i) => text(front, t, left, cy - mm(47) - i * 11, 8));
  front.pushOperators(popGraphicsState());

  // ---- back ----
  const back = beginSide(out, s, w, h, true);
  const ticks = (horizontal: boolean) => {
    for (let i = -RANGE * 2; i <= RANGE * 2; i++) {
      const pos = (i / 2) * MM;
      const len = mm(i % 10 === 0 ? 4.5 : i % 2 === 0 ? 3 : 1.6);
      const label = String(-i / 2);
      if (horizontal) {
        const x = cx + pos;
        const y = cy + mm(RULER_AT);
        line(back, x, y - len, x, y + len, i === 0 ? 0.5 : 0.2);
        if (i % 4 === 0)
          text(back, label, x - font.widthOfTextAtSize(label, 5) / 2, y + mm(5.5), 5);
      } else {
        const x = cx + mm(RULER_AT);
        const y = cy + pos;
        line(back, x - len, y, x + len, y, i === 0 ? 0.5 : 0.2);
        if (i % 4 === 0) text(back, label, x + mm(5.5), y - 1.8, 5);
      }
    }
  };
  ticks(true);
  ticks(false);
  text(back, "X", cx - 3, cy + mm(RULER_AT + 9), 9, bold);
  text(back, "Y", cx + mm(RULER_AT + 11), cy - 3, 9, bold);

  text(back, "BACK", left, cy - mm(40), 16, bold);
  const fmt = (v: number) => (v || 0).toFixed(2);
  [
    "Look at this side with the light behind the sheet. The cross printed on the front shows through.",
    "X = number on the horizontal ruler where the vertical front line crosses it.",
    "Y = number on the vertical ruler where the horizontal front line crosses it.",
    "Ticks are 0.5 mm apart; estimate in between. ADD the readings to the values already entered.",
    `Correction applied to this print: X ${fmt(s.offsetX)} mm, Y ${fmt(s.offsetY)} mm` +
      ` (flip on ${s.flip} edge). Both lines on 0 = calibrated.`,
  ].forEach((t, i) => text(back, t, left, cy - mm(47) - i * 11, 8));
  back.pushOperators(popGraphicsState());

  return out.save();
}
