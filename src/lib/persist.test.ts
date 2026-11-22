import { describe, expect, it } from "vite-plus/test";
import { SETTINGS_KEY, loadSettings, parseStoredSettings, saveSettings } from "./persist";
import { DEFAULT_SETTINGS } from "./settings";

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  };
};

describe("saved settings", () => {
  it("round-trips through storage", () => {
    const store = memory();
    saveSettings(store, { ...DEFAULT_SETTINGS, offsetX: -3.45, paper: "a3" });
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, offsetX: -3.45, paper: "a3" });
  });

  it("keeps saved values when defaults or fields change", () => {
    // An older save: lacks newer fields and still carries one that no longer exists.
    const old = JSON.stringify({
      version: 1,
      values: { offsetY: 0.5, flip: "short", removedField: 1 },
    });
    const s = parseStoredSettings(old)!;
    expect(s.offsetY).toBe(0.5);
    expect(s.flip).toBe("short"); // not overwritten by the current default
    expect(s.margin).toBe(DEFAULT_SETTINGS.margin);
    expect("removedField" in s).toBe(false);
  });

  it("ignores ill-typed values and broken JSON", () => {
    expect(parseStoredSettings('{"version":1,"values":{"margin":"wide"}}')!.margin).toBe(
      DEFAULT_SETTINGS.margin,
    );
    expect(parseStoredSettings("{nope")).toBeNull();
    expect(loadSettings(memory({ [SETTINGS_KEY]: "{nope" }))).toEqual(DEFAULT_SETTINGS);
  });

  it("adopts settings saved before versioning", () => {
    const store = memory({
      "booklet-imposer.settings.v4": JSON.stringify({ offsetX: 1.2, cropMarks: false }),
    });
    const s = loadSettings(store);
    expect(s.offsetX).toBe(1.2);
    expect(s.cropMarks).toBe(false);
  });
});
