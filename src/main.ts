import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import type { PDFDocument } from "@cantoo/pdf-lib";
import type { OutputSide } from "./lib/impose";
import { computeLayout, type Layout, type RefPage } from "./lib/layout";
import { loadSettings, saveSettings } from "./lib/persist";
import { DEFAULT_SETTINGS, PAPER_SIZES, mm, type Settings } from "./lib/settings";
import { analyzePage } from "./lib/source";
import { drawOffsetDiagram, guidesOverlay, marksDiagram, sheetDiagram } from "./ui/diagrams";
import { $, download, esc, fmt, plural } from "./ui/dom";
import { initDropzone } from "./ui/dropzone";
import { initOnboarding } from "./ui/onboarding";
import { initSections, revealInSection } from "./ui/sections";
import { initTemplates } from "./ui/templates";

/*
 * Application shell: owns the state (settings, open PDF, current sheet),
 * binds the settings form, renders the preview and wires the feature modules
 * in src/ui together.
 */

/** The PDF libraries, fetched once on first use (and warmed up when the browser is idle). */
let pdfTools: Promise<typeof import("./lib/pdf-tools")> | undefined;
const loadPdfTools = () => (pdfTools ??= import("./lib/pdf-tools"));

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
/** How the next rendered sheet arrives on the mat: "" = no entrance (plain settings change). */
let entrance: "" | "drop" | "forward" | "backward" = "";

let registerTurns = 0;
/** The header's register mark clicks a quarter turn whenever the imposition has been rebuilt. */
const register = (quarters = 1) => {
  registerTurns += quarters;
  $("reg").style.transform = `rotate(${registerTurns * 90}deg)`;
};

// ---------- settings <-> form ----------

type Field = HTMLInputElement | HTMLSelectElement;

function fillForm() {
  for (const el of form.querySelectorAll<Field>("[name]")) {
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

/** Shows or hides rows that depend on another setting (data-show / data-hide="key=a|b"). */
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

function replaceSettings(next: Settings) {
  settings = next;
  fillForm();
}

// ---------- feature modules ----------

const templates = initTemplates({
  form,
  settings: () => settings,
  replace: replaceSettings,
  changed: () => refresh(true),
});

const onboarding = initOnboarding({
  settings: () => settings,
  hasSource: () => Boolean(source),
  sourceDeclaresBleed: () =>
    Boolean(source) &&
    analyzePage(source!.doc.getPage(0), { bleedMode: "auto", bleed: 0 }).declaresTrim,
  templateActive: () => Boolean(templates.current()),
  sheetCount: () => layout?.sheets.length ?? null,
  keepFullPage: () => replaceSettings({ ...settings, bleed: 0 }),
  changed: () => refresh(true),
});

// ---------- loading ----------

function showFileError(message: string) {
  fileInfo.classList.add("error");
  fileInfo.textContent = message;
}

async function openPdf(name: string, bytes: ArrayBuffer | Uint8Array) {
  fileInfo.textContent = "Reading…";
  try {
    const { PDFDocument } = await loadPdfTools();
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() === 0) throw new Error("This PDF has no pages.");
    fileInfo.classList.remove("error");
    source = { doc, name };
    sheet = 0;
    entrance = "drop";
    onboarding.newFile();
    $("empty").hidden = true;
    $("work").hidden = false;
    refresh(true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showFileError(
      /encrypt/i.test(msg)
        ? `${name} is password-protected. Remove the protection first.`
        : `Could not read ${name}: ${msg}`,
    );
  }
}

const openFile = async (file: File) => openPdf(file.name, await file.arrayBuffer());

function showSourceInfo() {
  const bleedInfo = $("bleedInfo");
  if (!source) {
    bleedInfo.textContent = "";
    return;
  }
  const g = analyzePage(source.doc.getPage(0), settings);
  fileInfo.textContent = `${source.name}: ${plural(source.doc.getPageCount(), "page")}, trim size ${fmt(g.trimW)} × ${fmt(g.trimH)} mm`;
  if (settings.bleedMode === "manual") {
    bleedInfo.textContent =
      settings.bleed > 0
        ? `${settings.bleed} mm on every edge of each page is treated as bleed, outside the finished page. Set 0 for PDFs without bleed.`
        : "";
  } else if (g.declaresTrim) {
    const b = Math.max(g.bleed.left, g.bleed.right, g.bleed.top, g.bleed.bottom);
    bleedInfo.textContent = `Found ${fmt(b)} mm bleed around the TrimBox.`;
  } else {
    bleedInfo.textContent =
      "This PDF declares no bleed. If its pages include bleed anyway, enter it manually.";
  }
}

// ---------- sidebar diagrams ----------

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
  drawOffsetDiagram($("offsetDiagram"), settings.offsetX || 0, settings.offsetY || 0);
  const l = diagramLayout();
  $("sheetDiagram").innerHTML = sheetDiagram(l);
  $("marksDiagram").innerHTML = marksDiagram(settings, l);
}

// ---------- preview ----------

/** Everything that follows a change: persist, redraw the sidebar, re-impose the current sheet. */
function refresh(immediate = false) {
  $("recipe").hidden = true; // the print recipe describes the last download only
  updateVisibility();
  saveSettings(localStorage, settings);
  drawDiagrams();
  templates.show();
  if (!source) return;
  showSourceInfo();
  onboarding.showBleedQuestion();
  sidesEl.classList.add("busy");
  clearTimeout(timer);
  timer = window.setTimeout(render, immediate ? 0 : 200);
}

async function render() {
  if (!source) return;
  const id = ++run;
  try {
    const { impose, renderPdf } = await loadPdfTools();
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
      showNav();
      onboarding.showTips();
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
  sheetEl.insertAdjacentHTML("beforeend", guidesOverlay(settings, side, l));
  fig.append(cap, sheetEl);
  return fig;
}

function showNotes(warnings: string[], error?: string) {
  notesEl.innerHTML =
    (error ? `<p class="error">${esc(error)}</p>` : "") +
    warnings.map((w) => `<p>${esc(w)}</p>`).join("");
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

/** Sheet counter, previous/next buttons and one tile per sheet showing its pages. */
function showNav() {
  const count = layout?.sheets.length ?? 1;
  $("sheetLabel").textContent = `Sheet ${sheet + 1} of ${count}`;
  $<HTMLButtonElement>("prev").disabled = sheet <= 0;
  $<HTMLButtonElement>("next").disabled = sheet >= count - 1;

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

function go(delta: number) {
  const count = layout?.sheets.length ?? 1;
  const next = Math.min(count - 1, Math.max(0, sheet + delta));
  if (next === sheet) return;
  entrance = next > sheet ? "forward" : "backward";
  onboarding.browsed();
  sheet = next;
  showNav();
  refresh(true);
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
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg><div><b>Booklet ready: ${plural(n, "sheet")}.</b>` +
    ` In the print dialog:<ol>${steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` +
    (settings.sides === "both"
      ? `<button type="button" class="link" data-act="calibrate">Front and back not lined up after printing? Calibrate the printer.</button>`
      : "") +
    `</div>`;
  recipe.hidden = false;
}

async function downloadBooklet(btn: HTMLButtonElement) {
  if (!source) return;
  const label = "Download booklet PDF";
  const count = layout?.sheets.length ?? 0;
  btn.disabled = true;
  btn.textContent = count ? `Building ${plural(count, "sheet")}…` : "Building…";
  let done = false;
  try {
    const { impose } = await loadPdfTools();
    const { bytes, layout: made } = await impose(source.doc, settings);
    const suffix = settings.sides === "both" ? "" : `-${settings.sides}s`;
    download(bytes, `${source.name.replace(/\.pdf$/i, "")}-booklet${suffix}.pdf`);
    showRecipe(made);
    register(2);
    onboarding.downloaded();
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
}

// ---------- wiring ----------

$<HTMLSelectElement>("paper").append(
  new Option("Automatic (sized to the booklet)", "auto"),
  ...Object.entries(PAPER_SIZES).map(
    ([key, p]) => new Option(`${p.label} (${p.w} × ${p.h} mm)`, key),
  ),
  new Option("Custom…", "custom"),
);
fillForm();
drawDiagrams();
templates.show();
initSections(form, document.querySelector<HTMLElement>(".panel")!);

form.addEventListener("input", (e) => {
  const el = e.target as Field;
  if (el.name && readField(el)) refresh();
});
form.addEventListener("submit", (e) => e.preventDefault());

$("reset").addEventListener("click", () => {
  templates.detach();
  replaceSettings({ ...DEFAULT_SETTINGS });
  refresh(true);
});

// Opening a PDF: file picker, sample, or drop anywhere
$("pick").addEventListener("click", () => fileInput.click());
$("pick2").addEventListener("click", () => fileInput.click());
$("sample").addEventListener("click", async () =>
  openPdf("sample-booklet.pdf", await (await loadPdfTools()).buildSample()),
);
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void openFile(f);
  fileInput.value = "";
});
initDropzone(
  $("overlay"),
  (file) => void openFile(file),
  () => showFileError("That is not a PDF. Drop a .pdf file instead."),
);

// Sheet navigation
$("prev").addEventListener("click", () => go(-1));
$("next").addEventListener("click", () => go(1));
$("strip").addEventListener("click", (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-sheet]");
  if (tile) go(Number(tile.dataset.sheet) - sheet);
});
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input:not([type=radio]), select, textarea")) return;
  if (e.key === "ArrowLeft") go(-1);
  if (e.key === "ArrowRight") go(1);
});

const guidesToggle = $<HTMLInputElement>("guides");
const applyGuides = () => {
  sidesEl.classList.toggle("no-guides", !guidesToggle.checked);
  $("legend").hidden = !guidesToggle.checked;
};
guidesToggle.addEventListener("change", applyGuides);
applyGuides();

// Output
$("download").addEventListener(
  "click",
  (e) => void downloadBooklet(e.currentTarget as HTMLButtonElement),
);
$("recipe").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).dataset.act === "calibrate") revealInSection($("offsetDiagram"));
});
$("calibration").addEventListener("click", async () => {
  // Use the booklet's sheet when one is loaded so the test matches the job.
  const paper =
    layout && settings.paper === "auto" ? { w: layout.paperW, h: layout.paperH } : undefined;
  const template = templates.current() && !templates.isModified() ? templates.current() : undefined;
  const { buildCalibrationSheet } = await loadPdfTools();
  download(await buildCalibrationSheet(settings, paper, { template }), "duplex-calibration.pdf");
});

let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => source && refresh(true), 250);
});

// Fetch the PDF libraries in the background so the first file opens without a wait.
if ("requestIdleCallback" in window) requestIdleCallback(() => void loadPdfTools());
else setTimeout(() => void loadPdfTools(), 1500);
