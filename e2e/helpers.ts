import { expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const mm = (v: number) => (v * 72) / 25.4;

/** A plain numbered A5 test document, optionally with 3 mm bleed declared via TrimBox. */
export async function makePdf(pages: number, opts: { bleed?: boolean } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const b = opts.bleed ? mm(3) : 0;
  const w = mm(148.5);
  const h = mm(210);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([w + 2 * b, h + 2 * b]);
    if (opts.bleed) {
      p.setTrimBox(b, b, w, h);
      p.setBleedBox(0, 0, w + 2 * b, h + 2 * b);
    }
    p.drawText(String(i + 1), { x: b + w / 2 - 25, y: b + h / 2, size: 80, font });
  }
  return Buffer.from(await doc.save());
}

/** Fails the test on any page error or console error (which includes CSP violations). */
export function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`);
  });
  return problems;
}

export async function openPdf(page: Page, pdf: Buffer, name = "test.pdf") {
  await page.locator("#file").setInputFiles({ name, mimeType: "application/pdf", buffer: pdf });
  await expect(page.locator("#sides canvas").first()).toBeVisible();
}

/** Clicks something that triggers a download and returns the parsed PDF. */
export async function downloadPdf(page: Page, selector: string): Promise<PDFDocument> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(selector).click(),
  ]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return PDFDocument.load(Buffer.concat(chunks));
}

/** Opens one of the four sidebar sections by index. */
export async function openSection(page: Page, index: number) {
  const section = page.locator("#settings details").nth(index);
  if (!(await section.evaluate((d: HTMLDetailsElement) => d.open)))
    await section.locator("summary").click();
  await expect(section).toHaveAttribute("open", "");
}
