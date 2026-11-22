import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mm } from "./settings";

/**
 * A 12-page A5 sample with 3 mm bleed (declared via TrimBox), so a first-time
 * visitor can see a real imposition, bleed and crop marks without a file.
 */
export async function buildSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Sample booklet");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const b = mm(3);
  const w = mm(148.5);
  const h = mm(210);
  const pages = 12;
  const ink = rgb(0.1, 0.16, 0.14);
  const tints = [
    rgb(0.86, 0.93, 0.9),
    rgb(0.98, 0.9, 0.84),
    rgb(0.93, 0.92, 0.84),
    rgb(0.86, 0.9, 0.95),
  ];

  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([w + 2 * b, h + 2 * b]);
    p.setTrimBox(b, b, w, h);
    p.setBleedBox(0, 0, w + 2 * b, h + 2 * b);
    const cover = i === 0 || i === pages - 1;
    const tint = cover ? rgb(0.78, 0.27, 0.15) : tints[i % tints.length];
    const text = cover ? rgb(0.95, 0.97, 0.95) : ink;
    // Background runs into the bleed on every edge.
    p.drawRectangle({ x: 0, y: 0, width: w + 2 * b, height: h + 2 * b, color: tint });

    if (i === 0) {
      p.drawText("Sample", { x: b + mm(16), y: b + h - mm(52), size: 46, font: bold, color: text });
      p.drawText("booklet", {
        x: b + mm(16),
        y: b + h - mm(70),
        size: 46,
        font: bold,
        color: text,
      });
      p.drawText("12 pages, A5, 3 mm bleed", {
        x: b + mm(16),
        y: b + mm(20),
        size: 11,
        font: regular,
        color: text,
      });
      continue;
    }
    if (i === pages - 1) {
      p.drawText("Back cover", {
        x: b + mm(16),
        y: b + mm(20),
        size: 11,
        font: regular,
        color: text,
      });
      continue;
    }
    const n = String(i + 1);
    p.drawText(n, {
      x: b + (w - bold.widthOfTextAtSize(n, 120)) / 2,
      y: b + h / 2 - 20,
      size: 120,
      font: bold,
      color: text,
    });
    for (let line = 0; line < 5; line++) {
      p.drawRectangle({
        x: b + mm(20),
        y: b + mm(58) - line * mm(7),
        width: w - mm(line === 4 ? 70 : 40),
        height: mm(2.2),
        color: text,
        opacity: 0.22,
      });
    }
    // Folio on the outer edge: right on odd pages, left on even ones.
    const folio = `Page ${n}`;
    const fx = i % 2 === 0 ? b + w - mm(12) - regular.widthOfTextAtSize(folio, 9) : b + mm(12);
    p.drawText(folio, { x: fx, y: b + mm(10), size: 9, font: regular, color: text });
  }
  return doc.save();
}
