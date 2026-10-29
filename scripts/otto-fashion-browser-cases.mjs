import assert from "node:assert/strict";

export async function runOttoFashionBrowserCases({context, extension, call}) {
  const base = "https://www.otto.de/mode/waesche/";
  const url = new URL(base);
  for (const [name, value] of [["stil", "elegant,erotisch"], ["us-groessen", "s"], ["zielgruppe", "damen"]]) url.searchParams.set(name, value);
  const page = await context.newPage(); await page.goto(url.href);
  const tabId = await extension.evaluate(async (href) => (await chrome.tabs.query({})).find((tab) => tab.url === href)?.id, page.url());
  const capture = () => call("GET_CAPTURE_PREVIEW", {tabId});
  async function replay(saved) {
    await call("START_REPLAY", {stateId:saved.id, tabId});
    let latest; const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      latest = await call("GET_ACTIVE_REPLAY", {tabId});
      if (["COMPLETE", "COMPLETE_WITH_WARNINGS", "PARTIAL", "FAILED", "CANCELLED", "INTERRUPTED"].includes(latest?.status)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(JSON.stringify(latest));
  }
  const preview = await capture();
  assert.deepEqual(preview.criteria.map((item) => [item.semanticType, item.desiredValue]), [["STYLE", ["elegant", "erotisch"]], ["US_SIZE", ["s"]], ["TARGET_GROUP", ["damen"]]]);
  assert.equal(preview.coverage.saveEligible, true); assert.equal(preview.unresolved.length, 0); assert.equal(preview.unsupported.length, 0);
  assert.ok(preview.criteria.every((item) => item.bindings.every((binding) => binding.type === "URL_QUERY")));
  const saved = await call("SAVE_CAPTURE", {tabId, preview, name:"OTTO style size and audience"});
  await page.goto(base); assert.equal((await capture()).criteria.length, 0);
  const restored = await replay(saved); assert.equal(restored.status, "COMPLETE", JSON.stringify(restored));
  assert.ok(restored.results.every((item) => item.status === "VERIFIED"));
  assert.equal(await page.evaluate(() => window.filterClicks()), 0, "Replay must not click removal chips");
  assert.equal((await replay(saved)).status, "COMPLETE");
  await page.locator("#original-stil-elegant").evaluate((input) => { input.checked = false; });
  assert.ok((await capture()).unresolved.some((item) => item.label === "Stil"));
  assert.equal((await replay(saved)).results.find((item) => item.semanticType === "STYLE").status, "ROUTE_ONLY");
  await page.goto(saved.metadata.captureUrl);
  await page.locator('#chosen input[name="us-groessen"]').evaluate((input) => input.parentElement.remove());
  assert.equal((await replay(saved)).results.find((item) => item.semanticType === "US_SIZE").status, "ROUTE_ONLY");
  await page.goto(saved.metadata.captureUrl);
  await page.locator('#chosen input[name="zielgruppe"]').evaluate((input) => input.parentElement.querySelector("button").textContent = "Herren");
  assert.equal((await replay(saved)).results.find((item) => item.semanticType === "TARGET_GROUP").status, "ROUTE_ONLY");
  await page.goto(saved.metadata.captureUrl);
  await page.locator("#original-stil-casual").evaluate((input) => { input.checked = true; });
  assert.ok((await capture()).unresolved.some((item) => /not represented/.test(item.reason)));
  await call("DELETE_STATE", {stateId:saved.id}); await page.close();
  console.log("OTTO fashion regressions passed: style multi-select, US size, target group, Save, reset, replay, idempotency, and contradictory evidence.");
}
