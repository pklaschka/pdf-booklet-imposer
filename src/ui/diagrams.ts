import { outputPageSize, sideMatrix, type OutputSide } from "../lib/impose";
import type { Layout } from "../lib/layout";
import { mm, toMm, type Settings } from "../lib/settings";

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

/**
 * Live picture of the back-side offset. Front and back each carry a register
 * cross; the back outline slides to where the print lands, so the two crosses
 * visibly part and, at 0 / 0, sit on top of each other again.
 */
export function drawOffsetDiagram(svg: Element, x: number, y: number) {
  // 8 px per mm, capped so large values stay inside the picture.
  const px = (v: number) => Math.max(-22, Math.min(22, v * 8));
  const dx = px(x);
  const dy = -px(y); // SVG y runs downwards
  const cx = 170;
  const cy = 58;
  const num = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)} mm`;
  const dir = (v: number, pos: string, neg: string) => (v > 0 ? pos : v < 0 ? neg : "none");
  if (!svg.childElementCount) {
    const outline =
      `<rect x="${cx - 60}" y="${cy - 30}" width="120" height="60"/><path d="M${cx} ${cy - 30}v60"/>` +
      `<circle cx="${cx}" cy="${cy}" r="5"/><path d="M${cx - 9} ${cy}h18M${cx} ${cy - 9}v18"/>`;
    svg.innerHTML =
      `<defs><marker id="offHead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path class="head" d="M1 1 7 4 1 7"/></marker></defs>` +
      `<g class="front">${outline}</g><g class="back">${outline}</g>` +
      `<path class="cut solid" data-part="ax" marker-end="url(#offHead)"/><path class="cut solid" data-part="ay" marker-end="url(#offHead)"/>` +
      `<text class="value" data-part="x" x="8" y="24"></text><text data-part="xd" x="8" y="36"></text>` +
      `<text class="value" data-part="y" x="8" y="64"></text><text data-part="yd" x="8" y="76"></text>` +
      `<text data-part="state" x="${cx}" y="14" text-anchor="middle"></text>`;
  }
  const part = (name: string) => svg.querySelector<SVGElement>(`[data-part="${name}"]`)!;
  svg.setAttribute("aria-label", `Back side offset: X ${num(x)}, Y ${num(y)}`);
  svg.querySelector<SVGElement>(".back")!.style.transform = `translate(${dx}px, ${dy}px)`;
  part("ax").setAttribute("d", dx ? `M${cx} ${cy}h${dx}` : "");
  part("ay").setAttribute("d", dy ? `M${cx + dx} ${cy}v${dy}` : "");
  part("x").textContent = `X ${num(x)}`;
  part("xd").textContent = dir(x, "to the right", "to the left");
  part("y").textContent = `Y ${num(y)}`;
  part("yd").textContent = dir(y, "upwards", "downwards");
  part("state").textContent =
    dx || dy ? "grey: front · red: back as printed" : "no correction entered";
}

/** SVG overlay marking margin, trim, bleed and fold on a previewed side. */
export function guidesOverlay(s: Settings, side: OutputSide, l: Layout): string {
  const back = side.side === "back";
  const [pw, ph] = outputPageSize(s, l.paperW, l.paperH);
  // Content guides move with the duplex offset; the margin belongs to the paper.
  const content = sideMatrix(s, l.paperW, l.paperH, back).join(" ");
  const paper = sideMatrix({ ...s, offsetX: 0, offsetY: 0 }, l.paperW, l.paperH, back).join(" ");
  const sh = l.sheets[side.sheet];
  const cx = l.paperW / 2;
  const y = (l.paperH - l.cellH) / 2;
  const m = mm(s.margin || 0);
  const rect = (cls: string, x: number, yy: number, w: number, h: number) =>
    w > 0 && h > 0 ? `<rect class="${cls}" x="${x}" y="${yy}" width="${w}" height="${h}"/>` : "";
  const cells = [cx - sh.halfGutter - l.cellW, cx + sh.halfGutter];
  const xl = cells[0] - l.bleed;
  const xr = cells[1] + l.cellW + l.bleed;
  return (
    `<svg class="guides" viewBox="0 0 ${pw} ${ph}" aria-hidden="true"><g transform="matrix(1 0 0 -1 0 ${ph})">` +
    `<g transform="matrix(${paper})">${rect("g-margin", m, m, l.paperW - 2 * m, l.paperH - 2 * m)}</g>` +
    `<g transform="matrix(${content})">` +
    (l.bleed > 0 ? rect("g-bleed", xl, y - l.bleed, xr - xl, l.cellH + 2 * l.bleed) : "") +
    cells.map((x) => rect("g-trim", x, y, l.cellW, l.cellH)).join("") +
    `<path class="g-fold" d="M${cx} ${y - l.bleed}V${y + l.cellH + l.bleed}"/>` +
    `</g></g></svg>`
  );
}
