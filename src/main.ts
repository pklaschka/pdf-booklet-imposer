import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import { PDFDocument } from "pdf-lib";
import { buildCalibrationSheet } from "./lib/calibration";
import { impose, outputPageSize, sideMatrix, type OutputSide } from "./lib/impose";
import { marksDiagram, sheetDiagram } from "./diagrams";
import { computeLayout, type Layout, type RefPage } from "./lib/layout";
import { loadSettings, mergeSettings, saveSettings as persistSettings } from "./lib/persist";
import { renderPdf } from "./lib/preview";
import { buildSample } from "./lib/sample";
import { DEFAULT_SETTINGS, PAPER_SIZES, mm, toMm, type Settings } from "./lib/settings";
import { analyzePage } from "./lib/source";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>("settings");
const fileInput = $<HTMLInputElement>("file");
const fileInfo = $("fileInfo");
const sidesEl = $("sides");
const notesEl = $("notes");
const factsEl = $("facts");

let settings = loadSettings(localStorage);
let source: { doc: PDFDocument; name: string } | null = null;
let layout: Layout | null = null;
let sheet = 0;
let run = 0;
let timer: number | undefined;
let registerTurns = 0;
/** The header's register mark clicks a quarter turn whenever the imposition has been rebuilt. */
const register = (quarters = 1) => {
  registerTurns += quarters;
  $("reg").style.transform = `rotate(${registerTurns * 90}deg)`;
};
/** How the next rendered sheet arrives on the mat: '' = no entrance (plain settings change). */
let entrance: "" | "drop" | "forward" | "backward" = "";

// ---------- settings <-> form ----------

const saveSettings = () => persistSettings(localStorage, settings);

type Field = HTMLInputElement | HTMLSelectElement;
const fields = () => [...form.querySelectorAll<Field>("[name]")];

function fillForm() {
  for (const el of fields()) {
    const v = settings[el.name as keyof Settings];
    if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(v);
    else if (el instanceof HTMLInputElement && el.type === "radio")
      el.checked = el.value === String(v);
    else el.value = String(v);
  }
  updateVisibility();
}

function readField(el: Field) {
  const key = el.name as keyof Settings;
  const target = settings as unknown as Record<string, unknown>;
  if (el instanceof HTMLInputElement && el.type === "checkbox") target[key] = el.checked;
  else if (el instanceof HTMLInputElement && el.type === "radio") {
    if (!el.checked) return false;
    target[key] = el.value;
  } else if (el instanceof HTMLInputElement && el.type === "number") {
    if (Number.isNaN(el.valueAsNumber)) return false; // mid-edit, keep the old value
    target[key] = el.valueAsNumber;
  } else target[key] = el.value;
  return true;
}

function updateVisibility() {
  const matches = (rule: string) => {
    const [key, values] = rule.split("=");
    return values.split("|").includes(String(settings[key as keyof Settings]));
  };
  for (const el of form.querySelectorAll<HTMLElement>("[data-show]"))
    el.hidden = !matches(el.dataset.show!);
  for (const el of form.querySelectorAll<HTMLElement>("[data-hide]"))
    el.hidden = matches(el.dataset.hide!);
}

// ---------- helpers ----------

const fmt = (ptValue: number, digits = 1) => toMm(ptValue).toFixed(digits);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function download(bytes: Uint8Array, name: string, type = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function showNotes(warnings: string[], error?: string) {
  notesEl.innerHTML =
    (error ? `<p class="error">${esc(error)}</p>` : "") +
    warnings.map((w) => `<p>${esc(w)}</p>`).join("");
}

// ---------- loading ----------

async function openPdf(name: string, bytes: ArrayBuffer | Uint8Array) {
  fileInfo.textContent = "Reading…";
  try {
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() === 0) throw new Error("This PDF has no pages.");
    fileInfo.classList.remove("error");
    source = { doc, name };
    sheet = 0;
    entrance = "drop";
    bleedAnswered = false;
    browsed = false;
    $("empty").hidden = true;
    $("work").hidden = false;
    refresh(true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fileInfo.classList.add("error");
    fileInfo.textContent = /encrypt/i.test(msg)
      ? `${name} is password-protected. Remove the protection first.`
      : `Could not read ${name}: ${msg}`;
  }
}

const openFile = async (file: File) => openPdf(file.name, await file.arrayBuffer());

// ---------- onboarding ----------
// First value is seeing a booklet imposed, so everything here leads to that
// and then gets out of the way: tips tick themselves off and never return.

const ONBOARDING_KEY = "booklet-imposer.onboarding.v1";
const onboarding: { tipsDone: boolean; bleedConfirmed: boolean } = {
  tipsDone: false,
  bleedConfirmed: false,
};
try {
  Object.assign(onboarding, JSON.parse(localStorage.getItem(ONBOARDING_KEY) ?? "{}"));
} catch {
  // tips simply show again
}
const saveOnboarding = () => {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(onboarding));
  } catch {
    // not persisted
  }
};
let bleedAnswered = false;
let browsed = false;
let downloaded = false;

function showTips() {
  const tips = $("tips");
  tips.hidden = onboarding.tipsDone || !source;
  if (tips.hidden) return;
  const oneSheet = (layout?.sheets.length ?? 2) < 2;
  const steps: [boolean, string][] = [
    [true, "Open a PDF"],
    [
      browsed || oneSheet,
      oneSheet ? "Check the page order below" : "Step through the sheets to check the page order",
    ],
    [downloaded, "Download the booklet and print it double-sided"],
  ];
  const next = steps.findIndex(([done]) => !done);
  tips.innerHTML =
    `<b>Your first booklet</b><ol>` +
    steps
      .map(
        ([done, text], i) =>
          `<li class="${done ? "done" : i === next ? "next" : ""}"><i>${done ? "" : i + 1}</i>${text}</li>`,
      )
      .join("") +
    `</ol><button type="button" class="link" data-act="hide">Hide tips</button>`;
}

/** The risky default: 3 mm is trimmed as bleed even when the PDF has none. Ask once, where it matters. */
function showBleedQuestion() {
  const ask = $("bleedAsk");
  const relevant =
    Boolean(source) &&
    settings.bleedMode === "manual" &&
    settings.bleed > 0 &&
    !onboarding.bleedConfirmed &&
    !bleedAnswered &&
    !currentTemplate &&
    !analyzePage(source!.doc.getPage(0), { bleedMode: "auto", bleed: 0 }).declaresTrim;
  ask.hidden = !relevant;
  if (!relevant) return;
  ask.innerHTML =
    `<div><b>Does this PDF have bleed?</b> ${settings.bleed} mm is being trimmed off every edge of each page. ` +
    `If your pages have no bleed, that cuts into the content.</div>` +
    `<div class="ask-actions"><button type="button" class="btn small" data-act="none">No bleed, keep the full page</button>` +
    `<button type="button" class="btn small ghost" data-act="has">Yes, it has bleed</button></div>`;
}

function updateSourceInfo() {
  const bleedInfo = $("bleedInfo");
  if (!source) {
    bleedInfo.textContent = "";
    return;
  }
  const g = analyzePage(source.doc.getPage(0), settings);
  const n = source.doc.getPageCount();
  fileInfo.textContent = `${source.name}: ${n} page${n === 1 ? "" : "s"}, trim size ${fmt(g.trimW)} × ${fmt(g.trimH)} mm`;
  const b = Math.max(g.bleed.left, g.bleed.right, g.bleed.top, g.bleed.bottom);
  if (settings.bleedMode === "manual") {
    bleedInfo.textContent =
      settings.bleed > 0
        ? `${settings.bleed} mm on every edge of each page is treated as bleed, outside the finished page. Set 0 for PDFs without bleed.`
        : "";
  } else if (g.declaresTrim) bleedInfo.textContent = `Found ${fmt(b)} mm bleed around the TrimBox.`;
  else
    bleedInfo.textContent =
      "This PDF declares no bleed. If its pages include bleed anyway, enter it manually.";
}

/**
 * Live picture of the back-side offset. Front and back each carry a register
 * cross; the back outline slides to where the print lands, so the two crosses
 * visibly part and, at 0 / 0, sit on top of each other again.
 */
function drawOffsetDiagram() {
  const x = settings.offsetX || 0;
  const y = settings.offsetY || 0;
  // 8 px per mm, capped so large values stay inside the picture.
  const px = (v: number) => Math.max(-22, Math.min(22, v * 8));
  const dx = px(x);
  const dy = -px(y); // SVG y runs downwards
  const cx = 170;
  const cy = 58;
  const num = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)} mm`;
  const dir = (v: number, pos: string, neg: string) => (v > 0 ? pos : v < 0 ? neg : "none");
  const svg = $("offsetDiagram");
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

/** Layout for the settings diagrams: the loaded PDF, or an A5 stand-in before one is opened. */
function diagramLayout(): Layout | null {
  try {
    if (source)
      return computeLayout(
        settings,
        analyzePage(source.doc.getPage(0), settings),
        source.doc.getPageCount(),
      );
    const b = settings.bleedMode === "manual" ? mm(Math.max(0, settings.bleed)) : 0;
    const ref: RefPage = {
      trimW: mm(148.5),
      trimH: mm(210),
      bleed: { left: b, right: b, bottom: b, top: b },
    };
    return computeLayout(settings, ref, 16);
  } catch {
    return null;
  }
}

function drawDiagrams() {
  drawOffsetDiagram();
  const l = diagramLayout();
  $("sheetDiagram").innerHTML = sheetDiagram(l);
  $("marksDiagram").innerHTML = marksDiagram(settings, l);
}

// ---------- templates ----------

const TEMPLATES_KEY = "booklet-imposer.templates.v1";
const tplSelect = $<HTMLSelectElement>("tplSelect");
const tplName = $<HTMLInputElement>("tplName");
let templates: Record<string, Settings> = {};
let currentTemplate = "";

function parseTemplates(raw: unknown): Record<string, Settings> {
  const out: Record<string, Settings> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      const key = name.trim().slice(0, 60);
      if (key && value && typeof value === "object") out[key] = mergeSettings(value);
    }
  }
  return out;
}

function loadTemplates() {
  try {
    const stored = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "{}") as {
      templates?: unknown;
      current?: unknown;
    };
    templates = parseTemplates(stored.templates);
    currentTemplate =
      typeof stored.current === "string" && stored.current in templates ? stored.current : "";
  } catch {
    templates = {};
  }
}

function saveTemplates() {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify({ templates, current: currentTemplate }));
  } catch {
    $("tplInfo").textContent =
      "This browser blocks storage, so templates cannot be saved. Export them to a file instead.";
  }
}

const templateModified = () =>
  Boolean(currentTemplate) &&
  JSON.stringify(templates[currentTemplate]) !== JSON.stringify(settings);

function showTemplates() {
  const names = Object.keys(templates).sort((a, b) => a.localeCompare(b));
  const modified = templateModified();
  tplSelect.replaceChildren(
    new Option(names.length ? "No template" : "No templates saved yet", ""),
    ...names.map(
      (name) => new Option(name === currentTemplate && modified ? `${name} (changed)` : name, name),
    ),
  );
  tplSelect.value = currentTemplate;
  $<HTMLButtonElement>("tplUpdate").disabled = !modified;
  $<HTMLButtonElement>("tplDelete").disabled = !currentTemplate;
  $<HTMLButtonElement>("tplExport").disabled = names.length === 0;
}

function applyTemplate(name: string) {
  currentTemplate = name in templates ? name : "";
  if (currentTemplate) {
    const before = settings;
    settings = { ...templates[currentTemplate] };
    fillForm();
    const changed = (Object.keys(settings) as (keyof Settings)[]).filter(
      (k) => before[k] !== settings[k],
    );
    markChanged(changed);
    $("tplInfo").textContent = changed.length
      ? `Applied "${currentTemplate}": ${changed.length} setting${changed.length === 1 ? "" : "s"} changed.`
      : `Applied "${currentTemplate}": it matches the current settings.`;
  }
  saveTemplates();
  refresh(true);
}

/** Briefly highlights the fields a template changed and counts them on each section heading. */
function markChanged(keys: (keyof Settings)[]) {
  form.querySelectorAll(".badge").forEach((b) => b.remove());
  const perSection = new Map<HTMLElement, number>();
  for (const key of keys) {
    const field = form.querySelector<HTMLElement>(`[name="${key}"]`);
    if (!field) continue;
    const row = field.closest<HTMLElement>(".row, .check, .choice");
    if (row) {
      row.classList.remove("changed");
      void row.offsetWidth; // restart the highlight if it is still running
      row.classList.add("changed");
      row.addEventListener("animationend", () => row.classList.remove("changed"), { once: true });
    }
    const section = field.closest<HTMLElement>("details");
    if (section) perSection.set(section, (perSection.get(section) ?? 0) + 1);
  }
  for (const [section, count] of perSection) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${count} changed`;
    section.querySelector("summary")!.append(badge);
    setTimeout(() => badge.remove(), 6000);
  }
}

function storeTemplate(name: string) {
  templates[name] = { ...settings };
  currentTemplate = name;
  $("tplInfo").textContent = `Saved "${name}".`;
  saveTemplates();
  showTemplates();
}

function askTemplateName(show: boolean) {
  $("tplNameRow").hidden = !show;
  $("tplActions").hidden = show;
  if (show) {
    tplName.value = currentTemplate;
    tplName.focus();
    tplName.select();
  }
}

function confirmTemplateName() {
  const name = tplName.value.trim();
  if (!name) return tplName.focus();
  storeTemplate(name);
  askTemplateName(false);
}

// ---------- preview ----------

function refresh(immediate = false) {
  $("recipe").hidden = true; // the print recipe describes the last download only
  updateVisibility();
  saveSettings();
  drawDiagrams();
  showTemplates();
  if (!source) return;
  updateSourceInfo();
  showBleedQuestion();
  sidesEl.classList.add("busy");
  clearTimeout(timer);
  timer = window.setTimeout(render, immediate ? 0 : 200);
}

async function render() {
  if (!source) return;
  const id = ++run;
  try {
    let result = await impose(source.doc, settings, { sheets: [sheet] });
    if (sheet >= result.layout.sheets.length) {
      sheet = result.layout.sheets.length - 1;
      result = await impose(source.doc, settings, { sheets: [sheet] });
    }
    if (id !== run) return;
    layout = result.layout;
    const twoUp = result.sides.length > 1 && sidesEl.clientWidth >= 902;
    const width = twoUp ? (sidesEl.clientWidth - 22) / 2 : sidesEl.clientWidth;
    const canvases = await renderPdf(
      result.bytes,
      settings.orientation === "portrait" ? Math.min(width, 420) : width,
    );
    if (id !== run) return;
    sidesEl.classList.remove("enter", "forward", "backward");
    if (entrance) sidesEl.classList.add("enter", entrance);
    entrance = "";
    sidesEl.replaceChildren(...canvases.map((c, i) => figure(c, result.sides[i], result.layout)));
    showFacts(layout);
    showNotes(layout.warnings);
    register();
  } catch (e) {
    if (id !== run) return;
    layout = null;
    sidesEl.replaceChildren();
    factsEl.replaceChildren();
    showNotes([], e instanceof Error ? e.message : String(e));
  } finally {
    if (id === run) {
      sidesEl.classList.remove("busy");
      $<HTMLButtonElement>("download").disabled = !layout;
      updateNav();
      showTips();
    }
  }
}

function figure(canvas: HTMLCanvasElement, side: OutputSide, l: Layout) {
  const fig = document.createElement("figure");
  if (settings.orientation === "portrait") fig.className = "portrait";
  const cap = document.createElement("figcaption");
  const page = (p: number | null) => (p === null ? "blank" : String(p + 1));
  const turned = side.side === "back" && settings.flip === "long" ? ", turned 180°" : "";
  cap.innerHTML = `<b>${side.side === "front" ? "Front" : "Back"}</b> · pages ${page(side.pages[0])} | ${page(side.pages[1])}${turned}`;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Sheet ${side.sheet + 1} ${side.side}`);
  const sheetEl = document.createElement("div");
  sheetEl.className = "sheet";
  sheetEl.append(canvas);
  sheetEl.insertAdjacentHTML("beforeend", guides(side, l));
  fig.append(cap, sheetEl);
  return fig;
}

/** SVG overlay marking margin, trim, bleed and fold on a previewed side. */
function guides(side: OutputSide, l: Layout): string {
  const back = side.side === "back";
  const [pw, ph] = outputPageSize(settings, l.paperW, l.paperH);
  // Content guides move with the duplex offset; the margin belongs to the paper.
  const content = sideMatrix(settings, l.paperW, l.paperH, back).join(" ");
  const paper = sideMatrix({ ...settings, offsetX: 0, offsetY: 0 }, l.paperW, l.paperH, back).join(
    " ",
  );
  const sh = l.sheets[side.sheet];
  const cx = l.paperW / 2;
  const y = (l.paperH - l.cellH) / 2;
  const m = (settings.margin || 0) * (72 / 25.4);
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

function showFacts(l: Layout) {
  const facts: [string, string][] = [
    [
      "Sheets",
      `${l.sheets.length} (${l.pageCount} pages${l.blankCount ? ` + ${l.blankCount} blank` : ""})`,
    ],
    ["Sheet size", `${fmt(l.paperW)} × ${fmt(l.paperH)} mm`],
    ["Page size", `${fmt(l.cellW)} × ${fmt(l.cellH)} mm`],
    ["Scale", `${(l.scale * 100).toFixed(1)} %`],
  ];
  if (l.bleed > 0) facts.push(["Bleed", `${fmt(l.bleed)} mm`]);
  if (l.totalCreep > 0) facts.push(["Creep", `${fmt(l.totalCreep, 2)} mm`]);
  if (l.gutter > 0) facts.push(["Gutter", `${fmt(l.gutter, 2)} mm`]);
  factsEl.innerHTML = facts.map(([k, v]) => `<li><span>${k}</span> <b>${esc(v)}</b></li>`).join("");

  const info = $("creepInfo");
  if (settings.creepMode === "off" && l.gutter === 0) info.textContent = "";
  else if (l.sheets.length < 2) info.textContent = "A single sheet has no creep.";
  else {
    const perSheet = l.totalCreep / (l.sheets.length - 1);
    info.textContent =
      `Now: ${fmt(perSheet, 2)} mm per sheet, ${fmt(l.totalCreep, 2)} mm on the innermost of ` +
      `${l.sheets.length} sheets; gutter ${fmt(l.gutter, 2)} mm on the outermost.`;
  }
}

/** One tile per sheet showing which pages sit on its front and back. */
function showStrip() {
  const strip = $("strip");
  if (!layout) return strip.replaceChildren();
  const page = (p: number | null) => `<i>${p === null ? "·" : p + 1}</i>`;
  strip.innerHTML = layout.sheets
    .map(
      (sh) =>
        `<button type="button" class="tile" data-sheet="${sh.index}"${sh.index === sheet ? ' aria-current="true"' : ""}` +
        ` title="Sheet ${sh.index + 1}"><span class="face">${page(sh.front[0])}${page(sh.front[1])}</span>` +
        `<span class="face back">${page(sh.back[0])}${page(sh.back[1])}</span><b>${sh.index + 1}</b></button>`,
    )
    .join("");
  strip.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** After a download: the print-dialog settings this particular booklet needs. */
function showRecipe(l: Layout) {
  const n = l.sheets.length;
  const steps = [
    `Paper: ${fmt(l.paperW, 0)} × ${fmt(l.paperH, 0)} mm, ${settings.orientation}.`,
    'Scale: 100 % or "actual size", never "fit to page".',
  ];
  if (settings.sides === "both") steps.push(`Two-sided, flip on the ${settings.flip} edge.`);
  else if (settings.sides === "front")
    steps.push("One-sided. Then put the stack back in the tray and print the back sides.");
  else steps.push("One-sided, onto the back of the fronts you already printed.");
  if (l.marks) steps.push("Fold, staple, then cut at the crop marks.");
  else steps.push(n > 1 ? `Nest the ${n} sheets in order, fold and staple.` : "Fold once.");
  const recipe = $("recipe");
  recipe.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg><div><b>Booklet ready: ${n} sheet${n === 1 ? "" : "s"}.</b>` +
    ` In the print dialog:<ol>${steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` +
    (settings.sides === "both"
      ? `<button type="button" class="link" data-act="calibrate">Front and back not lined up after printing? Calibrate the printer.</button>`
      : "") +
    `</div>`;
  recipe.hidden = false;
}

function updateNav() {
  const count = layout?.sheets.length ?? 1;
  showStrip();
  $("sheetLabel").textContent = `Sheet ${sheet + 1} of ${count}`;
  $<HTMLButtonElement>("prev").disabled = sheet <= 0;
  $<HTMLButtonElement>("next").disabled = sheet >= count - 1;
}

function go(delta: number) {
  const count = layout?.sheets.length ?? 1;
  const next = Math.min(count - 1, Math.max(0, sheet + delta));
  if (next === sheet) return;
  entrance = next > sheet ? "forward" : "backward";
  browsed = true;
  sheet = next;
  updateNav();
  refresh(true);
}

// ---------- wiring ----------

const paperSelect = $<HTMLSelectElement>("paper");
paperSelect.append(
  new Option("Automatic (sized to the booklet)", "auto"),
  ...Object.entries(PAPER_SIZES).map(
    ([key, p]) => new Option(`${p.label} (${p.w} × ${p.h} mm)`, key),
  ),
  new Option("Custom…", "custom"),
);
fillForm();
loadTemplates();
drawDiagrams();
showTemplates();

tplSelect.addEventListener("change", () => applyTemplate(tplSelect.value));
$("tplSave").addEventListener("click", () => askTemplateName(true));
$("tplCancel").addEventListener("click", () => askTemplateName(false));
$("tplConfirm").addEventListener("click", confirmTemplateName);
tplName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") confirmTemplateName();
  if (e.key === "Escape") askTemplateName(false);
});
$("tplUpdate").addEventListener("click", () => currentTemplate && storeTemplate(currentTemplate));
$("tplDelete").addEventListener("click", () => {
  if (!currentTemplate || !confirm(`Delete the template "${currentTemplate}"?`)) return;
  delete templates[currentTemplate];
  currentTemplate = "";
  saveTemplates();
  showTemplates();
});
$("tplExport").addEventListener("click", () => {
  const json = JSON.stringify({ app: "booklet-imposer", templates }, null, 2);
  download(new TextEncoder().encode(json), "booklet-templates.json", "application/json");
});
const tplFile = $<HTMLInputElement>("tplFile");
$("tplImport").addEventListener("click", () => tplFile.click());
tplFile.addEventListener("change", async () => {
  const file = tplFile.files?.[0];
  tplFile.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as { templates?: unknown };
    const imported = parseTemplates(data.templates);
    const count = Object.keys(imported).length;
    if (!count) throw new Error("no templates");
    templates = { ...templates, ...imported };
    saveTemplates();
    showTemplates();
    $("tplInfo").textContent =
      `Imported ${count} template${count === 1 ? "" : "s"} from ${file.name}.`;
  } catch {
    $("tplInfo").textContent = `${file.name} does not contain booklet templates.`;
  }
});

$("strip").addEventListener("click", (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-sheet]");
  if (tile) go(Number(tile.dataset.sheet) - sheet);
});

form.addEventListener("input", (e) => {
  const el = e.target as Field;
  if (el.name && readField(el)) refresh();
});
form.addEventListener("submit", (e) => e.preventDefault());

// Closed sections stick like tabs, but only once they have finished collapsing.
const sections = [...form.querySelectorAll<HTMLDetailsElement>("details")];
for (const d of sections) d.classList.toggle("settled", !d.open);
form.addEventListener(
  "toggle",
  (e) => {
    const d = e.target as HTMLDetailsElement;
    if (d.open) d.classList.remove("settled");
    else setTimeout(() => d.classList.toggle("settled", !d.open), 300);
  },
  true,
);

// Mark the heading at the edge of each pinned stack so it can cast a shadow
// over the content scrolling beneath it.
const panel = document.querySelector<HTMLElement>(".panel")!;
function markStuckHeadings() {
  const box = panel.getBoundingClientRect();
  const tab = sections[0].querySelector("summary")!.offsetHeight + 1;
  const moreBelow = panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1;
  let lastTop = -1;
  let firstBottom = -1;
  sections.forEach((d, i) => {
    const r = d.querySelector("summary")!.getBoundingClientRect();
    if (panel.scrollTop > 0 && r.top - box.top <= i * tab + 1.5) lastTop = i;
    if (
      moreBelow &&
      firstBottom < 0 &&
      box.bottom - r.bottom <= (sections.length - 1 - i) * tab + 1.5
    )
      firstBottom = i;
  });
  sections.forEach((d, i) => {
    d.classList.toggle("edge-top", i === lastTop);
    d.classList.toggle("edge-bottom", i === firstBottom && i !== lastTop);
  });
}
let stuckFrame = 0;
const queueStuck = () => {
  cancelAnimationFrame(stuckFrame);
  stuckFrame = requestAnimationFrame(markStuckHeadings);
};
panel.addEventListener("scroll", queueStuck, { passive: true });
window.addEventListener("resize", queueStuck);
new ResizeObserver(queueStuck).observe(form); // sections opening, closing, animating
queueStuck();

$("reset").addEventListener("click", () => {
  settings = { ...DEFAULT_SETTINGS };
  currentTemplate = "";
  saveTemplates();
  fillForm();
  refresh(true);
});

$("pick").addEventListener("click", () => fileInput.click());
$("pick2").addEventListener("click", () => fileInput.click());
$("sample").addEventListener("click", async () =>
  openPdf("sample-booklet.pdf", await buildSample()),
);

$("tips").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).dataset.act !== "hide") return;
  onboarding.tipsDone = true;
  saveOnboarding();
  showTips();
});
$("bleedAsk").addEventListener("click", (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  if (!act) return;
  bleedAnswered = true;
  if (act === "none") {
    settings.bleed = 0;
    fillForm();
  } else {
    onboarding.bleedConfirmed = true; // they work with bleed PDFs: do not ask again
    saveOnboarding();
  }
  refresh(true);
});
$("recipe").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).dataset.act !== "calibrate") return;
  const section = $("calibration").closest("details")!;
  section.open = true;
  setTimeout(() => $("offsetDiagram").scrollIntoView({ behavior: "smooth", block: "center" }), 320);
});
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void openFile(f);
  fileInput.value = "";
});

const guidesToggle = $<HTMLInputElement>("guides");
const applyGuides = () => {
  sidesEl.classList.toggle("no-guides", !guidesToggle.checked);
  $("legend").hidden = !guidesToggle.checked;
};
guidesToggle.addEventListener("change", applyGuides);
applyGuides();

$("prev").addEventListener("click", () => go(-1));
$("next").addEventListener("click", () => go(1));
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input:not([type=radio]), select, textarea")) return;
  if (e.key === "ArrowLeft") go(-1);
  if (e.key === "ArrowRight") go(1);
});

$("download").addEventListener("click", async (e) => {
  if (!source) return;
  const btn = e.currentTarget as HTMLButtonElement;
  const label = "Download booklet PDF";
  const count = layout?.sheets.length ?? 0;
  btn.disabled = true;
  btn.textContent = count ? `Building ${count} sheet${count === 1 ? "" : "s"}…` : "Building…";
  let done = false;
  try {
    const { bytes, layout: made } = await impose(source.doc, settings);
    const suffix = settings.sides === "both" ? "" : `-${settings.sides}s`;
    download(bytes, `${source.name.replace(/\.pdf$/i, "")}-booklet${suffix}.pdf`);
    showRecipe(made);
    register(2);
    downloaded = true;
    if (!onboarding.tipsDone) {
      onboarding.tipsDone = true; // the print recipe takes over from here
      saveOnboarding();
    }
    showTips();
    done = true;
  } catch (err) {
    showNotes(layout?.warnings ?? [], err instanceof Error ? err.message : String(err));
  } finally {
    btn.disabled = false;
    if (done) {
      btn.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.5 3.5L13 4.5"/></svg>Booklet ready';
      setTimeout(() => (btn.textContent = label), 2200);
    } else btn.textContent = label;
  }
});

$("calibration").addEventListener("click", async () => {
  // Use the booklet's sheet when one is loaded so the test matches the job.
  const paper =
    layout && settings.paper === "auto" ? { w: layout.paperW, h: layout.paperH } : undefined;
  const template = currentTemplate && !templateModified() ? currentTemplate : undefined;
  download(await buildCalibrationSheet(settings, paper, { template }), "duplex-calibration.pdf");
});

// Drag & drop anywhere
const overlay = $("overlay");
let dragDepth = 0;
const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) overlay.hidden = true;
});
window.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  const f = [...(e.dataTransfer?.files ?? [])].find(
    (x) => x.type === "application/pdf" || /\.pdf$/i.test(x.name),
  );
  if (f) void openFile(f);
  else {
    fileInfo.classList.add("error");
    fileInfo.textContent = "That is not a PDF. Drop a .pdf file instead.";
  }
});

let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => source && refresh(true), 250);
});
