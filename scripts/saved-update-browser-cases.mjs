import assert from "node:assert/strict";

export async function runSavedUpdateBrowserCases({ context, extension, call, port }) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/search?brand=nike#saved-update-case`);
  await page.locator("#min-price").fill("25");
  const tabId = await extension.evaluate(async (href) => (await chrome.tabs.query({})).find((tab) => tab.url === href)?.id, page.url());
  const preview = await call("GET_CAPTURE_PREVIEW", { tabId });
  const saved = await call("SAVE_CAPTURE", { tabId, preview, name: "Update regression shoes" });
  const librarySize = (await call("LIST_STATES")).length;
  const read = async () => (await call("LIST_STATES")).find((item) => item.id === saved.id);
  await extension.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  await extension.reload();
  await extension.locator('[data-view="library"]').click();
  const card = extension.locator(`[data-state-id="${saved.id}"]`);
  await card.waitFor();
  await page.locator("#min-price").fill("60");
  await page.locator("#size").selectOption("42");

  await card.locator('[data-action="update"]').click();
  await extension.locator("#confirm-update:enabled").waitFor();
  const changes = await extension.locator("#update-changes").innerText();
  assert.match(changes, /Before: Minimum price: 25/);
  assert.match(changes, /After: Minimum price: 60/);
  assert.equal(await extension.locator("#update-omissions").isVisible(), true);
  await extension.locator("#cancel-update").click();
  assert.deepEqual((await read()).criteria, saved.criteria, "Cancel leaves the saved criteria untouched");
  assert.equal((await call("GET_STATE_UPDATE_INFO", { stateId: saved.id })).undoAvailable, false);

  await card.locator('[data-action="update"]').click();
  await extension.locator("#confirm-update:enabled").waitFor();
  await extension.locator("#confirm-update").click();
  await extension.locator("#update-dialog").waitFor({ state: "hidden" });
  const updated = await read();
  assert.equal(updated.name, saved.name);
  assert.equal(updated.metadata.createdAt, saved.metadata.createdAt);
  assert.equal(updated.metadata.health, "UNKNOWN");
  assert.equal((await call("LIST_STATES")).length, librarySize);
  assert.ok(updated.criteria.some((item) => item.desiredValue.includes("60")));

  await page.locator("#min-price").fill("");
  await page.locator("#size").selectOption("40");
  await card.locator('[data-action="replay"]').click();
  await extension.locator("#replay-done").waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(await page.locator("#min-price").inputValue(), "60");
  assert.equal(await page.locator("#size").inputValue(), "42");
  await extension.locator("#replay-done").click();

  await card.locator('[data-action="more"]').click();
  await extension.locator("#undo-state-update:enabled").waitFor();
  await extension.locator("#undo-state-update").click();
  await extension.locator("#confirm-update:enabled").waitFor();
  const undoChanges = await extension.locator("#update-changes").innerText();
  assert.match(undoChanges, /Before: Minimum price: 60/);
  assert.match(undoChanges, /After: Minimum price: 25/);
  await extension.locator("#confirm-update").click();
  await extension.locator("#update-dialog").waitFor({ state: "hidden" });
  assert.deepEqual((await read()).criteria, saved.criteria);
  assert.equal((await read()).metadata.health, "UNKNOWN");
  assert.equal((await call("GET_STATE_UPDATE_INFO", { stateId: saved.id })).undoAvailable, false);

  await card.locator('[data-action="update"]').click();
  await extension.locator("#confirm-update:enabled").waitFor();
  await page.locator("#min-price").fill("70");
  await extension.locator("#confirm-update").click();
  await extension.waitForFunction(() => document.querySelector("#update-status").textContent.includes("Close this preview"));
  assert.equal(await extension.locator("#confirm-update").isDisabled(), true);
  assert.deepEqual((await read()).criteria, saved.criteria, "A stale preview cannot replace the saved filters");
  await extension.locator("#cancel-update").click();
  await call("DELETE_STATE", { stateId: saved.id });
  await page.close();
  console.log("Saved filter update regressions passed: preview, cancellation, omissions, identity, replay, Undo, and stale confirmation.");
}
