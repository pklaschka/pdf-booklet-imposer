import { mergeSettings } from "../lib/persist";
import type { Settings } from "../lib/settings";
import { $, download, plural } from "./dom";

const TEMPLATES_KEY = "booklet-imposer.templates.v1";

export interface TemplateHost {
  form: HTMLElement;
  settings(): Settings;
  /** Replaces the current settings and refills the form. */
  replace(next: Settings): void;
  /** Called after anything that should re-render the app. */
  changed(): void;
}

export interface Templates {
  /** Name of the applied template, or "" when none is. */
  current(): string;
  isModified(): boolean;
  /** Forgets which template is applied (the templates themselves stay). */
  detach(): void;
  /** Re-renders the picker; call whenever settings change. */
  show(): void;
}

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

/** Briefly highlights the fields a template changed and counts them on each section heading. */
function markChanged(form: HTMLElement, keys: (keyof Settings)[]) {
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

export function initTemplates(host: TemplateHost): Templates {
  const select = $<HTMLSelectElement>("tplSelect");
  const nameInput = $<HTMLInputElement>("tplName");
  const fileInput = $<HTMLInputElement>("tplFile");
  const info = $("tplInfo");
  let templates: Record<string, Settings> = {};
  let current = "";

  try {
    const stored = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "{}") as {
      templates?: unknown;
      current?: unknown;
    };
    templates = parseTemplates(stored.templates);
    if (typeof stored.current === "string" && stored.current in templates) current = stored.current;
  } catch {
    // unreadable storage: start without templates
  }

  const save = () => {
    try {
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify({ templates, current }));
    } catch {
      info.textContent =
        "This browser blocks storage, so templates cannot be saved. Export them to a file instead.";
    }
  };

  const isModified = () =>
    Boolean(current) && JSON.stringify(templates[current]) !== JSON.stringify(host.settings());

  const show = () => {
    const names = Object.keys(templates).sort((a, b) => a.localeCompare(b));
    const modified = isModified();
    select.replaceChildren(
      new Option(names.length ? "No template" : "No templates saved yet", ""),
      ...names.map(
        (name) => new Option(name === current && modified ? `${name} (changed)` : name, name),
      ),
    );
    select.value = current;
    $<HTMLButtonElement>("tplUpdate").disabled = !modified;
    $<HTMLButtonElement>("tplDelete").disabled = !current;
    $<HTMLButtonElement>("tplExport").disabled = names.length === 0;
  };

  const store = (name: string) => {
    templates[name] = { ...host.settings() };
    current = name;
    info.textContent = `Saved "${name}".`;
    save();
    show();
  };

  const askName = (asking: boolean) => {
    $("tplNameRow").hidden = !asking;
    $("tplActions").hidden = asking;
    if (asking) {
      nameInput.value = current;
      nameInput.focus();
      nameInput.select();
    }
  };

  const confirmName = () => {
    const name = nameInput.value.trim();
    if (!name) return nameInput.focus();
    store(name);
    askName(false);
  };

  select.addEventListener("change", () => {
    current = select.value in templates ? select.value : "";
    if (current) {
      const before = host.settings();
      const next = { ...templates[current] };
      host.replace(next);
      const changed = (Object.keys(next) as (keyof Settings)[]).filter(
        (k) => before[k] !== next[k],
      );
      markChanged(host.form, changed);
      info.textContent = changed.length
        ? `Applied "${current}": ${plural(changed.length, "setting")} changed.`
        : `Applied "${current}": it matches the current settings.`;
    }
    save();
    host.changed();
  });
  $("tplSave").addEventListener("click", () => askName(true));
  $("tplCancel").addEventListener("click", () => askName(false));
  $("tplConfirm").addEventListener("click", confirmName);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmName();
    if (e.key === "Escape") askName(false);
  });
  $("tplUpdate").addEventListener("click", () => current && store(current));
  $("tplDelete").addEventListener("click", () => {
    if (!current || !confirm(`Delete the template "${current}"?`)) return;
    delete templates[current];
    current = "";
    save();
    show();
  });
  $("tplExport").addEventListener("click", () => {
    const json = JSON.stringify({ app: "booklet-imposer", templates }, null, 2);
    download(new TextEncoder().encode(json), "booklet-templates.json", "application/json");
  });
  $("tplImport").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { templates?: unknown };
      const imported = parseTemplates(data.templates);
      const count = Object.keys(imported).length;
      if (!count) throw new Error("no templates");
      templates = { ...templates, ...imported };
      save();
      show();
      info.textContent = `Imported ${plural(count, "template")} from ${file.name}.`;
    } catch {
      info.textContent = `${file.name} does not contain booklet templates.`;
    }
  });

  show();
  return {
    current: () => current,
    isModified,
    detach: () => {
      current = "";
      save();
    },
    show,
  };
}
