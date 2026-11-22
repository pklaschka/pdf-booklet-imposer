import { expect, test } from "@playwright/test";
import { downloadPdf, makePdf, openPdf, openSection, watchForErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("first visit: the sample booklet leads to an imposed preview", async ({ page }) => {
  const problems = watchForErrors(page);
  await expect(page.locator("#empty")).toBeVisible();
  await page.locator("#sample").click();

  await expect(page.locator("#sheetLabel")).toHaveText("Sheet 1 of 3");
  await expect(page.locator("#sides canvas")).toHaveCount(2);
  await expect(page.locator("#fileInfo")).toContainText("12 pages, trim size 148.5 × 210.0 mm");
  // Outermost sheet: last and first page on the front, 2 and 11 on the back.
  await expect(page.locator("#strip .tile").first().locator(".face").first()).toHaveText("121");
  await expect(page.locator("#strip .tile").first().locator(".face.back")).toHaveText("211");
  await expect(page.locator("#tips")).toContainText("Your first booklet");
  // The sample declares its bleed, so the bleed question stays away.
  await expect(page.locator("#bleedAsk")).toBeHidden();
  expect(problems).toEqual([]);
});

test("sheets can be stepped through by button, tile and keyboard", async ({ page }) => {
  await openPdf(page, await makePdf(20, { bleed: true }));
  await expect(page.locator("#sheetLabel")).toHaveText("Sheet 1 of 5");
  await expect(page.locator("#sides figcaption").first()).toContainText("pages 20 | 1");

  await page.locator("#next").click();
  await expect(page.locator("#sheetLabel")).toHaveText("Sheet 2 of 5");
  await expect(page.locator("#sides figcaption").first()).toContainText("pages 18 | 3");

  await page.locator('#strip [data-sheet="4"]').click();
  await expect(page.locator("#sheetLabel")).toHaveText("Sheet 5 of 5");
  await expect(page.locator("#sides figcaption").nth(1)).toContainText("pages 10 | 11");
  await expect(page.locator("#next")).toBeDisabled();

  await page.locator("#sheetLabel").click(); // move focus off the tile
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#sheetLabel")).toHaveText("Sheet 4 of 5");
});

test("pages are padded to a multiple of four", async ({ page }) => {
  await openPdf(page, await makePdf(6, { bleed: true }));
  await expect(page.locator("#sheetLabel")).toHaveText("Sheet 1 of 2");
  await expect(page.locator("#facts")).toContainText("2 (6 pages + 2 blank)");
  await expect(page.locator("#sides figcaption").first()).toContainText("pages blank | 1");
});

test("a PDF without bleed prompts once and can keep its full page", async ({ page }) => {
  await openPdf(page, await makePdf(8));
  const ask = page.locator("#bleedAsk");
  await expect(ask).toContainText("Does this PDF have bleed?");
  await expect(page.locator("#fileInfo")).toContainText("trim size 142.5 × 204.0 mm");

  await ask.getByRole("button", { name: "No bleed, keep the full page" }).click();
  await expect(ask).toBeHidden();
  await expect(page.locator("#fileInfo")).toContainText("trim size 148.5 × 210.0 mm");
  await openSection(page, 1);
  await expect(page.locator('input[name="bleed"]')).toHaveValue("0");
});

test("download produces two sides per sheet and a print recipe", async ({ page }) => {
  await openPdf(page, await makePdf(12, { bleed: true }));
  const pdf = await downloadPdf(page, "#download");
  expect(pdf.getPageCount()).toBe(6);
  // A4 landscape by default
  expect(Math.round(pdf.getPage(0).getWidth())).toBe(842);
  expect(Math.round(pdf.getPage(0).getHeight())).toBe(595);

  const recipe = page.locator("#recipe");
  await expect(recipe).toContainText("Booklet ready: 3 sheets.");
  await expect(recipe).toContainText("flip on the long edge");
  await expect(page.locator("#tips")).toBeHidden();

  // The recipe describes that download only: it goes away when settings change.
  await page.locator('select[name="paper"]').selectOption("a3");
  await expect(recipe).toBeHidden();
});

test("output options change the downloaded file", async ({ page }) => {
  await openPdf(page, await makePdf(8, { bleed: true }));
  await openSection(page, 3);
  await page.locator('input[name="orientation"][value="portrait"]').check({ force: true });
  await page.locator('input[name="sides"][value="front"]').check({ force: true });
  await expect(page.locator("#sides canvas")).toHaveCount(1);

  const pdf = await downloadPdf(page, "#download");
  expect(pdf.getPageCount()).toBe(2); // fronts of two sheets
  expect(Math.round(pdf.getPage(0).getWidth())).toBe(595); // portrait A4
});

test("the calibration sheet has a front and a back", async ({ page }) => {
  await openSection(page, 3);
  const pdf = await downloadPdf(page, "#calibration");
  expect(pdf.getPageCount()).toBe(2);
});
