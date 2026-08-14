import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, rm, cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const smokeRoot = resolve(root, ".browser-smoke");
if (!smokeRoot.startsWith(`${root}\\`) && !smokeRoot.startsWith(`${root}/`)) throw new Error("Unsafe smoke-test path");
await rm(smokeRoot, { recursive: true, force: true });
await mkdir(smokeRoot, { recursive: true });

const extensionDir = resolve(smokeRoot, "extension");
await mkdir(extensionDir, { recursive: true });
await cp(resolve(root, "src"), resolve(extensionDir, "src"), { recursive: true });
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const liveIdealoUrl = process.env.FILTERVAULT_LIVE_IDEALO_URL || "";
manifest.host_permissions = ["http://127.0.0.1/*", ...(liveIdealoUrl ? ["https://www.idealo.de/*"] : [])];
await writeFile(resolve(extensionDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const playwrightSpecifier = process.env.FILTERVAULT_PLAYWRIGHT_MODULE || "playwright";
const playwrightUrl = /^(?:file|https?):/i.test(playwrightSpecifier) ? playwrightSpecifier : pathToFileURL(playwrightSpecifier).href;
const { chromium } = await import(playwrightUrl).catch(async () => import("playwright"));

const fixture = await readFile(resolve(root, "tests", "fixtures", "shop.html"));
const idealoFixture = await readFile(resolve(root, "tests", "fixtures", "idealo.html"));
const server = createServer((request, response) => {
  if (request.url?.startsWith("/search")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture);
    return;
  }
  if (request.url?.startsWith("/idealo/")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(idealoFixture);
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const port = server.address().port;

let context;
try {
  context = await chromium.launchPersistentContext(resolve(smokeRoot, "profile"), {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--disable-crash-reporter",
      "--disable-features=Crashpad"
    ]
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).hostname;

  const shop = await context.newPage();
  await shop.goto(`http://127.0.0.1:${port}/search?q=trail&brand=nike&preset=1`, { waitUntil: "domcontentloaded" });
  const extension = await context.newPage();
  await extension.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  const tabId = await extension.evaluate(async (portNumber) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes(`127.0.0.1:${portNumber}/search`))?.id;
  }, port);
  assert.equal(Number.isInteger(tabId), true, "Shop tab should be visible to the extension");

  const call = (type, payload = {}) => extension.evaluate(async ({ type, payload }) => {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "Extension call failed");
    return response.data;
  }, { type, payload });

  const preview = await call("GET_CAPTURE_PREVIEW", { tabId });
  assert.equal(preview.criteria.some((criterion) => criterion.semanticType === "BRAND"), true);
  assert.equal(preview.criteria.some((criterion) => criterion.semanticType === "SIZE"), true);
  assert.equal(preview.criteria.some((criterion) => criterion.semanticType === "COLOR"), true);
  assert.equal(preview.unsupported.some((item) => /slider/i.test(item.reason)), true);

  const saved = await call("SAVE_CAPTURE", { tabId, preview, name: "Smoke test trail shoes" });
  assert.equal(saved.name, "Smoke test trail shoes");

  await shop.evaluate(() => {
    history.replaceState({}, "", "/search");
    document.querySelector("#brand-nike").checked = false;
    document.querySelector("#size").value = "40";
    document.querySelector("#color-black").setAttribute("aria-checked", "false");
    document.querySelector("#min-price").value = "";
  });

  const started = await call("START_REPLAY", { stateId: saved.id, tabId });
  assert.equal(typeof started.replayId, "string");

  let replay;
  const deadline = Date.now() + 20_000;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    replay = await call("GET_ACTIVE_REPLAY", { tabId });
  } while (replay && !["COMPLETE", "COMPLETE_WITH_WARNINGS", "PARTIAL", "FAILED", "CANCELLED", "INTERRUPTED"].includes(replay.status) && Date.now() < deadline);

  assert.equal(replay?.status, "COMPLETE", JSON.stringify(replay));
  await shop.waitForLoadState("domcontentloaded");
  const restored = await shop.evaluate(() => ({
    brand: document.querySelector("#brand-nike").checked,
    size: document.querySelector("#size").value,
    color: document.querySelector("#color-black").getAttribute("aria-checked"),
    price: document.querySelector("#min-price").value,
    routeBrand: new URL(location.href).searchParams.get("brand")
  }));
  assert.deepEqual(restored, { brand: true, size: "42", color: "true", price: "50", routeBrand: "nike" });

  const idealo = await context.newPage();
  await idealo.goto(`http://127.0.0.1:${port}/idealo/preisvergleich/ProductCategory/19116F1820730-7777739.html`, { waitUntil: "domcontentloaded" });
  const idealoTabId = await extension.evaluate(async (portNumber) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes(`127.0.0.1:${portNumber}/idealo/`))?.id;
  }, port);
  const idealoPreview = await call("GET_CAPTURE_PREVIEW", { tabId: idealoTabId });
  assert.equal(idealoPreview.site.adapterId, "idealo-de");
  assert.equal(idealoPreview.supportLevel, "VERIFIED");
  assert.equal(idealoPreview.criteria.some((criterion) => criterion.semanticType === "HERSTELLER" && criterion.desiredValue.includes("Samsung")), true);
  assert.equal(idealoPreview.criteria.some((criterion) => criterion.semanticType === "RAM" && criterion.desiredValue.includes("12 GB") && criterion.desiredValue.includes("8 GB")), true);
  assert.equal(idealoPreview.criteria.some((criterion) => criterion.semanticType === "GEBRAUCHTE_PRODUKTE_ANZEIGEN" && criterion.desiredValue.includes("Nein")), true);
  assert.equal(idealoPreview.criteria.every((criterion) => criterion.bindings.some((binding) => binding.type === "URL_PATH")), true);
  assert.equal(idealoPreview.unsupported.length, 0, "Default Idealo price bounds must not be reported as active unsupported filters");
  await call("SAVE_CAPTURE", { tabId: idealoTabId, preview: idealoPreview, name: "Idealo Samsung phones" });

  if (liveIdealoUrl) {
    const liveIdealo = await context.newPage();
    await liveIdealo.goto(liveIdealoUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await liveIdealo.locator('button[class*="sr-filterTag_"]').first().waitFor({ timeout: 30_000 });
    const liveIdealoTabId = await extension.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url?.startsWith("https://www.idealo.de/preisvergleich/ProductCategory/"))?.id;
    });
    const livePreview = await call("GET_CAPTURE_PREVIEW", { tabId: liveIdealoTabId });
    console.log("Live Idealo criteria:", livePreview.criteria.map((criterion) => `${criterion.semanticType}=${criterion.desiredValue.join("|")}`).join(", "));
    assert.equal(livePreview.site.adapterId, "idealo-de");
    assert.equal(livePreview.criteria.some((criterion) => criterion.semanticType === "HERSTELLER" && criterion.desiredValue.includes("Samsung")), true);
    assert.equal(livePreview.criteria.some((criterion) => criterion.semanticType === "RAM" && criterion.desiredValue.includes("12 GB") && criterion.desiredValue.includes("8 GB")), true);
    assert.equal(livePreview.criteria.some((criterion) => criterion.semanticType === "GEBRAUCHTE_PRODUKTE_ANZEIGEN"), true);
  }

  await extension.reload({ waitUntil: "domcontentloaded" });
  await extension.locator('[data-view="library"]').click();
  await extension.locator(".library-card").first().waitFor();
  await extension.screenshot({
    path: resolve(smokeRoot, "library.png"),
    clip: { x: 0, y: 0, width: 430, height: 650 }
  });
  console.log(`Browser smoke passed: generic replay completed and Idealo captured ${idealoPreview.criteria.length} verified criteria.`);
} finally {
  await context?.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
