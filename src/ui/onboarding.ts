import type { Settings } from "../lib/settings";
import { $ } from "./dom";

/**
 * First value is seeing a booklet imposed, so everything here leads to that
 * and then gets out of the way: the tips tick themselves off and never
 * return, and the bleed question is asked only where it matters.
 */

const ONBOARDING_KEY = "booklet-imposer.onboarding.v1";

export interface OnboardingHost {
  settings(): Settings;
  hasSource(): boolean;
  /** Whether the open PDF itself declares bleed (TrimBox smaller than the page). */
  sourceDeclaresBleed(): boolean;
  templateActive(): boolean;
  /** Number of sheets in the current booklet, if one is laid out. */
  sheetCount(): number | null;
  /** The user says the PDF has no bleed: stop trimming it. */
  keepFullPage(): void;
  changed(): void;
}

export interface Onboarding {
  /** A new PDF was opened. */
  newFile(): void;
  /** The user looked at another sheet. */
  browsed(): void;
  /** The user downloaded a booklet. */
  downloaded(): void;
  showTips(): void;
  showBleedQuestion(): void;
}

export function initOnboarding(host: OnboardingHost): Onboarding {
  const saved = { tipsDone: false, bleedConfirmed: false };
  try {
    Object.assign(saved, JSON.parse(localStorage.getItem(ONBOARDING_KEY) ?? "{}"));
  } catch {
    // tips simply show again
  }
  const save = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify(saved));
    } catch {
      // not persisted
    }
  };
  const tips = $("tips");
  const ask = $("bleedAsk");
  let bleedAnswered = false;
  let hasBrowsed = false;
  let hasDownloaded = false;

  const showTips = () => {
    tips.hidden = saved.tipsDone || !host.hasSource();
    if (tips.hidden) return;
    const oneSheet = (host.sheetCount() ?? 2) < 2;
    const steps: [boolean, string][] = [
      [true, "Open a PDF"],
      [
        hasBrowsed || oneSheet,
        oneSheet ? "Check the page order below" : "Step through the sheets to check the page order",
      ],
      [hasDownloaded, "Download the booklet and print it double-sided"],
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
  };

  /** The risky default: 3 mm is trimmed as bleed even when the PDF has none. */
  const showBleedQuestion = () => {
    const s = host.settings();
    const relevant =
      host.hasSource() &&
      s.bleedMode === "manual" &&
      s.bleed > 0 &&
      !saved.bleedConfirmed &&
      !bleedAnswered &&
      !host.templateActive() &&
      !host.sourceDeclaresBleed();
    ask.hidden = !relevant;
    if (!relevant) return;
    ask.innerHTML =
      `<div><b>Does this PDF have bleed?</b> ${s.bleed} mm is being trimmed off every edge of each page. ` +
      `If your pages have no bleed, that cuts into the content.</div>` +
      `<div class="ask-actions"><button type="button" class="btn small" data-act="none">No bleed, keep the full page</button>` +
      `<button type="button" class="btn small ghost" data-act="has">Yes, it has bleed</button></div>`;
  };

  tips.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).dataset.act !== "hide") return;
    saved.tipsDone = true;
    save();
    showTips();
  });
  ask.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (!act) return;
    bleedAnswered = true;
    if (act === "none") host.keepFullPage();
    else {
      saved.bleedConfirmed = true; // they work with bleed PDFs: do not ask again
      save();
    }
    host.changed();
  });

  return {
    newFile: () => {
      bleedAnswered = false;
      hasBrowsed = false;
    },
    browsed: () => {
      hasBrowsed = true;
    },
    downloaded: () => {
      hasDownloaded = true;
      if (!saved.tipsDone) {
        saved.tipsDone = true; // the print recipe takes over from here
        save();
      }
      showTips();
    },
    showTips,
    showBleedQuestion,
  };
}
