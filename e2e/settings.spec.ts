import { expect, test } from "@playwright/test";
import { makePdf, openPdf, openSection } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("settings survive a reload", async ({ page }) => {
  await page.locator('select[name="paper"]').selectOption("a3");
  await page.locator('input[name="margin"]').fill("8");
  await openSection(page, 3);
  await page.locator('input[name="offsetX"]').fill("-3.45");
  await page.reload();
  await expect(page.locator('select[name="paper"]')).toHaveValue("a3");
  await expect(page.locator('input[name="margin"]')).toHaveValue("8");
  await expect(page.locator('input[name="offsetX"]')).toHaveValue("-3.45");
});

test("settings saved before versioning are adopted", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "booklet-imposer.settings.v4",
      JSON.stringify({ paper: "a3", offsetY: 0.5 }),
    );
  });
  await page.reload();
  await expect(page.locator('select[name="paper"]')).toHaveValue("a3");
  await expect(page.locator('input[name="offsetY"]')).toHaveValue("0.5");
});

test("templates can be saved, changed, re-applied and deleted", async ({ page }) => {
  const select = page.locator("#tplSelect");
  await page.locator('select[name="paper"]').selectOption("a3");
  await page.locator("#tplSave").click();
  await page.locator("#tplName").fill("Office A3");
  await page.locator("#tplName").press("Enter");
  await expect(select.locator("option:checked")).toHaveText("Office A3");
  await expect(page.locator("#tplUpdate")).toBeDisabled();

  await page.locator('select[name="paper"]').selectOption("a4");
  await expect(select.locator("option:checked")).toHaveText("Office A3 (changed)");
  await expect(page.locator("#tplUpdate")).toBeEnabled();

  await page.reload();
  await expect(select.locator("option:checked")).toHaveText("Office A3 (changed)");

  await select.selectOption("");
  await select.selectOption("Office A3");
  await expect(page.locator('select[name="paper"]')).toHaveValue("a3");
  await expect(page.locator("#tplInfo")).toHaveText('Applied "Office A3": 1 setting changed.');
  await expect(page.locator("#settings summary .badge")).toHaveText("1 changed");

  page.once("dialog", (d) => void d.accept());
  await page.locator("#tplDelete").click();
  await expect(select.locator("option:checked")).toHaveText("No templates saved yet");
});

test("only one sidebar section is open at a time", async ({ page }) => {
  const open = () =>
    page
      .locator("#settings details")
      .evaluateAll((ds) => ds.map((d) => (d as HTMLDetailsElement).open));
  expect(await open()).toEqual([true, false, false, false]);
  await openSection(page, 2);
  await expect.poll(open).toEqual([false, false, true, false]);
});

test("section headings stay pinned while a long section scrolls", async ({ page }) => {
  await openSection(page, 3);
  await page.locator(".panel").evaluate((p) => p.scrollTo(0, 5000));
  const tops = () =>
    page.locator("#settings summary").evaluateAll((els) => {
      const panelTop = document.querySelector(".panel")!.getBoundingClientRect().top;
      return els.map((el) => Math.round(el.getBoundingClientRect().top - panelTop));
    });
  // Each heading sits one tab height below the previous one, starting at the panel's top edge.
  await expect.poll(tops).toEqual([1, 50, 99, 147]);
  await expect(page.locator("#settings details").nth(3)).toHaveClass(/edge-top/);
});

test("crop marks leave room, so turning them off enlarges the booklet", async ({ page }) => {
  await openPdf(page, await makePdf(8, { bleed: true }));
  const scale = page.locator("#facts li", { hasText: "Scale" }).locator("b");
  await expect(scale).toHaveText("87.6 %");
  await openSection(page, 1);
  await page.locator('input[name="cropMarks"]').uncheck();
  await expect(scale).toHaveText("92.6 %");
});

test("switching the flip edge turns the back sides", async ({ page }) => {
  await openPdf(page, await makePdf(8, { bleed: true }));
  const back = page.locator("#sides figcaption").nth(1);
  await expect(back).toContainText("turned 180°");
  await openSection(page, 3);
  await page.locator('input[name="flip"][value="short"]').check({ force: true });
  await expect(back).not.toContainText("turned 180°");
});
