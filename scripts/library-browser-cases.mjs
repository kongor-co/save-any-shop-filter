import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function runLibraryBrowserCases({ context, extension, call, smokeRoot }) {
  const library = await call("LIST_STATES");
  const otto = library.filter((item) => item.site.hostname === "www.otto.de");
  const home24 = library.filter((item) => item.site.hostname === "www.home24.de");
  assert.ok(otto.length > 0);
  assert.ok(home24.length > 0);
  const page = await context.newPage();
  const initialUrl = new URL(otto[0].metadata.captureUrl);
  initialUrl.hash = "library-scope-test";
  await page.goto(initialUrl.href);
  const tabId = await extension.evaluate(async (href) => (await chrome.tabs.query({})).find((tab) => tab.url === href)?.id, page.url());
  await extension.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  await extension.reload();
  await extension.locator('[data-view="library"]').click();

  async function expectCount(count) {
    await extension.waitForFunction((expected) => document.querySelectorAll(".library-card").length === expected, count);
    assert.equal(await extension.locator("#library-count").innerText(), String(count));
  }
  await expectCount(otto.length);
  assert.equal(await extension.locator("#library-scope").inputValue(), "current");
  assert.deepEqual(await extension.locator(".shop-title").allTextContents(), ["www.otto.de"]);
  assert.match(await extension.locator("#library-summary").innerText(), /otto.de/);

  await extension.locator("#library-search").fill(home24[0].name);
  await expectCount(0);
  assert.equal(await extension.locator("#empty-library-title").innerText(), "No matching saved filters");
  await extension.locator("#library-scope").selectOption("all");
  await expectCount(home24.filter((item) => item.name.includes(home24[0].name)).length);
  await extension.locator("#library-search").fill("");
  await expectCount(library.length);
  await extension.locator("#library-scope").selectOption("current");
  await expectCount(otto.length);

  // Export remains a complete backup even when the list is scoped or searched.
  await extension.locator('[data-view="settings"]').click();
  const downloadPromise = extension.waitForEvent("download");
  await extension.locator("#export-all").click();
  const download = await downloadPromise;
  const exportPath = resolve(smokeRoot, "scoped-library-export.json");
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  assert.equal(exported.states.length, library.length);
  await extension.locator("#import-file").setInputFiles({ name: "mixed-shops.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...exported, states: [otto[0], home24[0]] })) });
  await extension.locator('[data-view="library"]').click();
  await expectCount(otto.length + 1);
  assert.deepEqual(await extension.locator(".shop-title").allTextContents(), ["www.otto.de"], "Import keeps other shops hidden without discarding their records");
  const originalIds = new Set(library.map((item) => item.id));
  const imported = (await call("LIST_STATES")).filter((item) => !originalIds.has(item.id));
  assert.equal(imported.length, 2);
  for (const item of imported) await call("DELETE_STATE", { stateId: item.id });
  await extension.reload();
  await extension.locator('[data-view="library"]').click();
  await expectCount(otto.length);

  // A navigation in the target tab updates the existing popup without reopening.
  await page.goto(home24[0].metadata.captureUrl);
  await extension.waitForFunction(() => document.querySelector("#library-summary").textContent.includes("home24.de"));
  await expectCount(home24.length);
  assert.deepEqual(await extension.locator(".shop-title").allTextContents(), ["www.home24.de"]);
  const card = extension.locator(`[data-state-id="${home24[0].id}"]`);
  await card.locator('[data-action="details"]').click();
  await extension.locator("#details-dialog").waitFor({ state: "visible" });
  assert.match(await extension.locator("#details-context").innerText(), /home24.de/);
  await extension.locator("#close-details").click();
  await card.locator('[data-action="more"]').click();
  await extension.locator('[data-library-action="duplicate"]').click();
  await expectCount(home24.length + 1);
  const copy = extension.locator(".library-card").filter({ hasText: `${home24[0].name} copy` });
  await copy.locator('[data-action="more"]').click();
  await extension.locator("#rename-value").fill("Scoped library copy");
  await extension.locator('[data-library-action="rename"]').click();
  const renamed = extension.locator(".library-card").filter({ hasText: "Scoped library copy" });
  await renamed.locator('[data-action="more"]').click();
  await extension.locator('[data-library-action="delete"]').click();
  await extension.locator("#confirm-delete").click();
  await expectCount(home24.length);
  assert.equal((await call("LIST_STATES")).length, library.length);

  await card.locator('[data-action="replay"]').click();
  await extension.locator("#replay-done").waitFor({ state: "visible", timeout: 20_000 });
  assert.match(await extension.locator("#replay-title").innerText(), /All 4 criteria restored/);
  await extension.locator("#replay-done").click();
  await expectCount(home24.length);

  await extension.locator("#library-scope").selectOption("all");
  await page.goto(otto[0].metadata.captureUrl);
  await expectCount(library.length);
  assert.equal(await extension.locator("#library-scope").inputValue(), "all", "Explicit All shops choice survives navigation in this popup");
  await extension.reload();
  await extension.locator('[data-view="library"]').click();
  await expectCount(otto.length);
  assert.equal(await extension.locator("#library-scope").inputValue(), "current", "Each popup opening defaults to the current shop");

  await context.route("https://empty-shop.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Welcome to a different shop</h1>" }));
  await page.goto("https://empty-shop.test/");
  await extension.waitForFunction(() => document.querySelector("#library-summary").textContent.includes("empty-shop.test"));
  await expectCount(0);
  assert.equal(await extension.locator("#empty-library-title").innerText(), "No saved filters for this shop yet");
  await extension.reload();
  await extension.locator("#capture-error").waitFor({ state: "visible" });
  await extension.locator('[data-view="library"]').click();
  await expectCount(0);
  assert.match(await extension.locator("#library-summary").innerText(), /empty-shop.test/, "Library scope does not depend on capture support");
  await extension.locator("#library-scope").selectOption("all");
  await expectCount(library.length);
  await extension.locator("#library-scope").selectOption("current");
  await page.goto("chrome://version");
  await expectCount(library.length);
  assert.equal(await extension.locator("#library-scope").inputValue(), "all");
  assert.equal(await extension.locator('#library-scope option[value="current"]').isDisabled(), true);
  await page.goto(otto[0].metadata.captureUrl);
  await extension.waitForFunction(() => document.querySelector("#library-summary").textContent.includes("otto.de"));
  await expectCount(otto.length);
  await extension.screenshot({ path: resolve(smokeRoot, "library-current-shop.png"), clip: { x: 0, y: 0, width: 430, height: 780 } });
  console.log("Library scope regressions passed: current shop, global override, search, counts, navigation, reopening, empty and restricted pages, export, saved actions, and replay.");
}
