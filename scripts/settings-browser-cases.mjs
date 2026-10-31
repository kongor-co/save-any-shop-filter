import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function runSettingsBrowserCases({ context, extension, call, smokeRoot }) {
  // Earlier cases delete fixtures through the worker API. Start with a fresh
  // popup so its cached library reflects those completed background changes.
  await extension.reload();
  await extension.locator("#settings-info strong").first().waitFor({ state: "attached" });
  await extension.locator("#capture-loading").waitFor({ state: "hidden" });
  const library = await call("LIST_STATES");
  await extension.locator('[data-view="capture"]').click();
  const captureName = await extension.locator("#state-name").inputValue();
  await extension.locator('[data-view="library"]').click();
  await extension.locator("#library-scope").selectOption("all");
  await extension.locator("#library-search").fill("no matching saved filter for settings check");
  await extension.locator('[data-view="settings"]').click();
  await extension.locator("#settings-view").waitFor({ state: "visible" });
  assert.equal(await extension.locator(".tab").count(), 3);
  assert.equal(await extension.locator('[data-view="settings"]').getAttribute("aria-selected"), "true");
  assert.equal(await extension.locator("#capture-view").isVisible(), false);
  assert.equal(await extension.locator("#library-view").isVisible(), false);
  assert.equal(await extension.locator("#replay-view").isVisible(), false);
  assert.equal(await extension.locator("#settings-view #export-all").isVisible(), true);
  assert.equal(await extension.locator("#settings-view #import-trigger").isVisible(), true);
  assert.equal(await extension.locator(".topbar .privacy-pill").count(), 0);
  assert.equal(await extension.locator("#capture-view .privacy-note").count(), 0);
  assert.equal(await extension.locator("#settings-view .privacy-pill").textContent(), "Local only");
  const values = await extension.locator("#settings-info strong").allTextContents();
  assert.equal(values[0], String(library.length), "Settings reports the complete library despite search and shop scope");
  assert.equal(values[2], await extension.evaluate(() => chrome.runtime.getManifest().version));
  assert.equal(values[3], "JSON v4");
  assert.match(await extension.locator("#settings-import-help").innerText(), /1 MB and 250 configurations/);
  await extension.screenshot({ path: resolve(smokeRoot, "settings-tab.png"), clip: { x: 0, y: 0, width: 430, height: 650 } });

  await extension.locator('[data-view="library"]').click();
  assert.equal(await extension.locator("#library-search").inputValue(), "no matching saved filter for settings check");
  assert.equal(await extension.locator("#library-scope").inputValue(), "all");
  await extension.locator("#library-search").fill("");
  await extension.locator('[data-view="capture"]').click();
  assert.equal(await extension.locator("#state-name").inputValue(), captureName, "Settings does not replace the capture or its name");

  const restricted = await context.newPage();
  await restricted.goto("chrome://version");
  await restricted.bringToFront();
  await extension.reload();
  await extension.locator('[data-view="settings"]').click();
  await extension.locator("#settings-info strong").first().waitFor();
  assert.equal(await extension.locator("#settings-view").isVisible(), true, "Settings remains available on restricted pages");
  assert.equal(await extension.locator("#settings-info strong").first().innerText(), String(library.length));
  assert.equal((await call("LIST_STATES")).length, library.length);
  await restricted.close();
  console.log("Settings tab passed: existing tab styling, relocated backup and privacy controls, app information, preserved capture and Library inputs, and restricted pages.");
}
