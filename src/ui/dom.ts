import { toMm } from "../lib/settings";

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Escapes text for use inside HTML built as a string. */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Points formatted as millimetres. */
export const fmt = (ptValue: number, digits = 1) => toMm(ptValue).toFixed(digits);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function download(bytes: Uint8Array, name: string, type = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
