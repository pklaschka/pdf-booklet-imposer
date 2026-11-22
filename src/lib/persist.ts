import { DEFAULT_SETTINGS, type Settings } from "./settings";

/**
 * Saved settings are stored under one stable key as `{ version, values }`.
 * Changing a default never discards what a user saved: unknown or ill-typed
 * fields fall back to the default, everything else is kept. When a field's
 * meaning changes, bump SETTINGS_VERSION and convert old values in `migrate`.
 */
export const SETTINGS_KEY = "booklet-imposer.settings";
export const SETTINGS_VERSION = 1;
/** Bare settings objects written before versioning; the newest that exists is adopted once. */
const LEGACY_KEYS = ["booklet-imposer.settings.v4"];

/** Defaults overlaid with every well-typed value from untrusted stored data. */
export function mergeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === "object") {
    const stored = raw as Record<string, unknown>;
    for (const key of Object.keys(s) as (keyof Settings)[]) {
      if (typeof stored[key] === typeof s[key])
        (s as unknown as Record<string, unknown>)[key] = stored[key];
    }
  }
  return s;
}

/** Brings stored values of an older version up to the current shape. */
function migrate(_version: number, values: unknown): unknown {
  // Version 1 is the first versioned shape; nothing to convert yet.
  return values;
}

export function parseStoredSettings(json: string | null): Settings | null {
  if (!json) return null;
  try {
    const data = JSON.parse(json) as { version?: unknown; values?: unknown };
    if (!data || typeof data !== "object") return null;
    // Legacy entries are the bare settings object.
    if (typeof data.version !== "number") return mergeSettings(data);
    return mergeSettings(migrate(data.version, data.values));
  } catch {
    return null;
  }
}

export const serializeSettings = (values: Settings) =>
  JSON.stringify({ version: SETTINGS_VERSION, values });

type Store = Pick<Storage, "getItem" | "setItem">;

export function loadSettings(store: Store): Settings {
  try {
    for (const key of [SETTINGS_KEY, ...LEGACY_KEYS]) {
      const found = parseStoredSettings(store.getItem(key));
      if (found) return found;
    }
  } catch {
    // unreadable or blocked storage
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(store: Store, values: Settings) {
  try {
    store.setItem(SETTINGS_KEY, serializeSettings(values));
  } catch {
    // settings simply won't persist
  }
}
