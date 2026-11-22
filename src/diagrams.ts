import type { Layout } from "./lib/layout";
import { toMm, type Settings } from "./lib/settings";

const n = (v: number) => v.toFixed(2);
const mmText = (v: number) => `${Number(v.toFixed(1))} mm`;

/** Miniature of the outermost sheet: paper, margin, bleed, the two pages and the fold. */
export function sheetDiagram(l: Layout | null): string {
  if (!l)
    return `<text x="150" y="78" text-anchor="middle">The booklet does not fit this sheet.</text>`;
  const k = Math.min(280 / l.paperW, 116 / l.paperH);
  const px = 150 - (l.paperW * k) / 2;
  const py = 6 + (116 - l.paperH * k) / 2;
  const X = (v: number) => n(px + v * k);
  const Y = (v: number) => n(py + v * k);
  const rect = (cls: string, x: number, y: number, w: number, h: number) =>
    w > 0 && h > 0
      ? `<rect class="${cls}" x="${X(x)}" y="${Y(y)}" width="${n(w * k)}" height="${n(h * k)}"/>`
      : "";

  const cx = l.paperW / 2;
  const y0 = (l.paperH - l.cellH) / 2;
  const half = l.gutter / 2;
  const xl = cx - half - l.cellW;
  const xr = cx + half + l.cellW;
  // Margin is whatever the layout left free around an automatic sheet, too.
  const ext = l.marks ? l.markOffset + l.markLength : l.bleed;
  const margin = Math.max(0, Math.min(xl - ext, y0 - ext));

  let marks = "";
  if (l.marks) {
    const o = l.markOffset;
    const e = o + l.markLength;
    for (const x of [xl, xr]) {
      for (const [a, b] of [
        [y0 - e, y0 - o],
        [y0 + l.cellH + o, y0 + l.cellH + e],
      ]) {
        marks += `M${X(x)} ${Y(a)}V${Y(b)}`;
      }
    }
    for (const y of [y0, y0 + l.cellH]) {
      marks += `M${X(xl - e)} ${Y(y)}H${X(xl - o)}M${X(xr + o)} ${Y(y)}H${X(xr + e)}`;
    }
  }

  return (
    rect("paper", 0, 0, l.paperW, l.paperH) +
    rect("g-margin", margin, margin, l.paperW - 2 * margin, l.paperH - 2 * margin) +
    (l.bleed > 0
      ? rect("g-bleed", xl - l.bleed, y0 - l.bleed, xr - xl + 2 * l.bleed, l.cellH + 2 * l.bleed)
      : "") +
    rect("g-trim page", xl, y0, l.cellW, l.cellH) +
    rect("g-trim page", cx + half, y0, l.cellW, l.cellH) +
    `<path class="g-fold" d="M${X(cx)} ${Y(y0)}V${Y(y0 + l.cellH)}"/>` +
    (marks ? `<path class="ruler" d="${marks}"/>` : "") +
    `<text x="150" y="141" text-anchor="middle">Sheet ${mmText(toMm(l.paperW))} × ${mmText(toMm(l.paperH))}` +
    ` · page ${mmText(toMm(l.cellW))} × ${mmText(toMm(l.cellH))} · ${(l.scale * 100).toFixed(0)} %</text>`
  );
}

/** Close-up of one page corner: trim edge, bleed band and the crop marks. */
export function marksDiagram(s: Settings, l: Layout | null): string {
  const bleed = l ? toMm(l.bleed) : 0;
  const marks = s.cropMarks;
  const offset = l ? toMm(l.markOffset) : Math.max(s.markOffset, bleed);
  const length = Math.max(0, s.markLength);
  const ext = Math.max(1, marks ? offset + length : bleed);
  const q = Math.min(7, 130 / ext, 58 / ext); // px per mm
  const cx = 150;
  const cy = 72;
  const b = bleed * q;

  let out = "";
  if (b > 0) out += `<path class="bleed-fill g-bleed" d="M0 ${n(cy - b)}H${n(cx + b)}V120H0Z"/>`;
  out += `<path class="page" d="M0 ${cy}H${cx}V120H0Z"/><path class="g-trim" d="M0 ${cy}H${cx}V120"/>`;
  if (marks) {
    const o = offset * q;
    const e = (offset + length) * q;
    out += `<path class="ruler mark" d="M${n(cx + o)} ${cy}H${n(cx + e)}M${cx} ${n(cy - o)}V${n(cy - e)}"/>`;
  }
  out += `<text x="8" y="${cy + 28}">finished page</text>`;
  if (b >= 11) out += `<text x="8" y="${n(cy - b / 2 + 3.5)}">bleed ${mmText(bleed)}</text>`;

  const lines: string[] = [];
  if (b > 0 && b < 11) lines.push(`bleed ${mmText(bleed)}`);
  if (!marks) lines.push("no crop marks");
  else lines.push(`marks start ${mmText(offset)} from the trim`, `mark length ${mmText(length)}`);
  if (bleed === 0) lines.push(s.printBleed ? "no bleed" : "bleed not printed");
  out += lines.map((t, i) => `<text x="8" y="${14 + i * 11}">${t}</text>`).join("");
  return out;
}
