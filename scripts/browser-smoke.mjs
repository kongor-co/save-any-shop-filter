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
const liveDecathlonUrl = process.env.FILTERVAULT_LIVE_DECATHLON_URL || "";
manifest.host_permissions = [
  "http://127.0.0.1/*",
  ...(liveIdealoUrl ? ["https://www.idealo.de/*"] : []),
  ...(liveDecathlonUrl ? ["https://www.decathlon.de/*"] : [])
];
await writeFile(resolve(extensionDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const playwrightSpecifier = process.env.FILTERVAULT_PLAYWRIGHT_MODULE || "playwright";
const playwrightUrl = /^(?:file|https?):/i.test(playwrightSpecifier) ? playwrightSpecifier : pathToFileURL(playwrightSpecifier).href;
const { chromium } = await import(playwrightUrl).catch(async () => import("playwright"));

const fixture = await readFile(resolve(root, "tests", "fixtures", "shop.html"));
const idealoFixture = await readFile(resolve(root, "tests", "fixtures", "idealo.html"));
const decathlonFixture = await readFile(resolve(root, "tests", "fixtures", "decathlon.html"));
const edgeFixture = await readFile(resolve(root, "tests", "fixtures", "edge-cases.html"));
const server = createServer((request, response) => {
  if (request.url?.startsWith("/delayed/search")) {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixture);
    }, 500);
    return;
  }
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
  if (request.url?.startsWith("/decathlon/")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(decathlonFixture);
    return;
  }
  if (request.url?.startsWith("/edge/")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(edgeFixture);
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

  await extension.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  await extension.reload({ waitUntil: "domcontentloaded" });
  await extension.locator("#capture-content").waitFor();
  await extension.locator("#state-name").fill("Smoke test trail shoes");
  await extension.locator("#save-state").click();
  await extension.locator(".library-card").first().waitFor();
  const saved = (await call("LIST_STATES")).find((item) => item.name === "Smoke test trail shoes");
  assert.ok(saved, "Popup Save action should persist the configuration");
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

  assert.equal(replay?.status, "COMPLETE_WITH_WARNINGS", JSON.stringify(replay));
  assert.equal(replay.results.some((result) => result.status === "ROUTE_ONLY" && result.semanticType === "Q"), true);
  await shop.waitForLoadState("domcontentloaded");
  const restored = await shop.evaluate(() => ({
    brand: document.querySelector("#brand-nike").checked,
    size: document.querySelector("#size").value,
    color: document.querySelector("#color-black").getAttribute("aria-checked"),
    price: document.querySelector("#min-price").value,
    routeBrand: new URL(location.href).searchParams.get("brand")
  }));
  assert.deepEqual(restored, { brand: true, size: "42", color: "true", price: "50", routeBrand: "nike" });

  const cancellationPage = await context.newPage();
  await cancellationPage.goto(`http://127.0.0.1:${port}/delayed/search?q=trail&brand=nike&preset=1`, { waitUntil: "domcontentloaded" });
  const cancellationTabId = await extension.evaluate(async (portNumber) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes(`127.0.0.1:${portNumber}/delayed/search`))?.id;
  }, port);
  const cancellationPreview = await call("GET_CAPTURE_PREVIEW", { tabId: cancellationTabId });
  const cancellationState = await call("SAVE_CAPTURE", { tabId: cancellationTabId, preview: cancellationPreview, name: "Cancellation fixture" });
  for (let cancelAttempt = 1; cancelAttempt <= 5; cancelAttempt += 1) {
    await cancellationPage.goto(`http://127.0.0.1:${port}/search?cancel-test=${cancelAttempt}`, { waitUntil: "domcontentloaded" });
    const cancelStarted = await call("START_REPLAY", { stateId: cancellationState.id, tabId: cancellationTabId });
    await call("CANCEL_REPLAY", { replayId: cancelStarted.replayId });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const cancelled = await call("GET_ACTIVE_REPLAY", { tabId: cancellationTabId });
    assert.equal(cancelled.status, "CANCELLED", `Cancellation attempt ${cancelAttempt} was overwritten`);
  }

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

  const decathlon = await context.newPage();
  const decathlonFixturePath = "/decathlon/herren/t-shirts-hemden/f-zustand_neu/f-partner_decathlon/f-sg_37-l-19_37-m";
  await decathlon.goto(`http://127.0.0.1:${port}${decathlonFixturePath}?price=from_0_to_51`, { waitUntil: "domcontentloaded" });
  const decathlonTabId = await extension.evaluate(async (portNumber) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes(`127.0.0.1:${portNumber}/decathlon/`))?.id;
  }, port);
  const decathlonFixturePreview = await call("GET_CAPTURE_PREVIEW", { tabId: decathlonTabId });
  assert.equal(decathlonFixturePreview.site.adapterId, "decathlon-de");
  assert.equal(decathlonFixturePreview.site.adapterVersion, 2);
  assert.equal(decathlonFixturePreview.unsupported.length, 0, "Decathlon sort and paired price controls must not be reported as unsupported");
  assert.equal(decathlonFixturePreview.unresolved.length, 0, "Decathlon filter-panel chrome must not be reported as active state");
  assert.equal(decathlonFixturePreview.criteria.some((criterion) => criterion.bindings.some((binding) => binding.type === "DOM")), false);
  const decathlonExecutorResult = await extension.evaluate(async ({ id, origin, pathname }) => {
    const pathCriterion = (criterionId, semanticType, values) => ({
      criterionId,
      role: "FILTER",
      semanticType,
      desiredValue: values,
      observedRepresentation: values,
      dependencies: [],
      bindings: [{ bindingId: `${criterionId}-path`, type: "URL_PATH", pathname, verificationTexts: values, applicability: {} }]
    });
    const criteria = [
      pathCriterion("dec-condition", "CONDITION", ["Neu"]),
      pathCriterion("dec-seller", "SELLER", ["Decathlon"]),
      pathCriterion("dec-size", "SIZE", ["L", "M"]),
      {
        criterionId: "dec-price",
        role: "FILTER",
        semanticType: "PRICE_RANGE",
        desiredValue: ["from_0_to_51"],
        observedRepresentation: ["0 € – 51 €"],
        dependencies: [],
        bindings: [{ bindingId: "dec-price-query", type: "URL_QUERY", parameter: "price", values: ["from_0_to_51"], verificationTexts: ["0 €", "51 €"], applicability: {} }]
      }
    ];
    const response = await chrome.tabs.sendMessage(id, {
      type: "EXECUTE_REPLAY",
      replayId: "decathlon-fixture-replay",
      expectedOrigin: origin,
      deadlineAt: Date.now() + 10_000,
      criteria
    });
    return response.result;
  }, { id: decathlonTabId, origin: `http://127.0.0.1:${port}`, pathname: decathlonFixturePath });
  assert.equal(decathlonExecutorResult.status, "COMPLETE", JSON.stringify(decathlonExecutorResult));
  assert.equal(decathlonExecutorResult.results.every((result) => result.status === "VERIFIED"), true);

  const edge = await context.newPage();
  await edge.goto(`http://127.0.0.1:${port}/edge/search?q=trail&mode=context`, { waitUntil: "domcontentloaded" });
  const edgeTabId = await extension.evaluate(async (portNumber) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes(`127.0.0.1:${portNumber}/edge/`))?.id;
  }, port);
  const contextOnly = await call("GET_CAPTURE_PREVIEW", { tabId: edgeTabId });
  assert.equal(contextOnly.coverage.saveEligible, false);
  assert.equal(contextOnly.coverage.defaultsIgnored >= 1, true, "Default selects must be ignored");
  assert.equal(contextOnly.unsupported.some((item) => /slider/i.test(item.reason)), true);
  assert.equal(contextOnly.criteria.some((criterion) => criterion.desiredValue.includes("private@example.com")), false, "Sensitive fields must not be captured");

  await extension.evaluate(async (id) => chrome.tabs.update(id, { active: true }), edgeTabId);
  await extension.reload({ waitUntil: "domcontentloaded" });
  await extension.locator("#capture-content").waitFor();
  assert.equal(await extension.locator("#save-state").isDisabled(), true);
  assert.match(await extension.locator("#save-reason").innerText(), /Only search or page context/);
  assert.equal(await extension.locator("#copy-route").isVisible(), true);

  await edge.goto(`http://127.0.0.1:${port}/edge/search?q=trail&mode=orphan`, { waitUntil: "domcontentloaded" });
  const unresolved = await call("GET_CAPTURE_PREVIEW", { tabId: edgeTabId });
  assert.equal(unresolved.coverage.unresolved >= 1, true, "Unscoped active controls must be reported, not guessed");

  await edge.goto(`http://127.0.0.1:${port}/edge/search?q=trail&mode=link`, { waitUntil: "domcontentloaded" });
  const linkPreview = await call("GET_CAPTURE_PREVIEW", { tabId: edgeTabId });
  assert.equal(linkPreview.criteria.some((criterion) => criterion.semanticType === "FEATURE" && criterion.desiredValue.includes("Waterproof")), true);
  assert.equal(linkPreview.coverage.saveEligible, true);

  await edge.goto(`http://127.0.0.1:${port}/edge/search?q=trail&mode=unstable`, { waitUntil: "domcontentloaded" });
  await assert.rejects(() => call("GET_CAPTURE_PREVIEW", { tabId: edgeTabId }), /CAPTURE_UNSTABLE/);

  await edge.goto(`http://127.0.0.1:${port}/edge/checkout?q=trail`, { waitUntil: "domcontentloaded" });
  await assert.rejects(() => call("GET_CAPTURE_PREVIEW", { tabId: edgeTabId }), /UNSUPPORTED_PAGE_TYPE:CHECKOUT/);

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

  if (liveDecathlonUrl) {
    const liveDecathlon = await context.newPage();
    await liveDecathlon.goto(liveDecathlonUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await liveDecathlon.locator("main h1").waitFor({ timeout: 30_000 });
    const liveDecathlonTabId = await extension.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url?.startsWith("https://www.decathlon.de/herren/t-shirts-hemden/"))?.id;
    });
    const decathlonPreview = await call("GET_CAPTURE_PREVIEW", { tabId: liveDecathlonTabId });
    assert.equal(decathlonPreview.site.adapterId, "decathlon-de");
    assert.equal(decathlonPreview.site.adapterVersion, 2);
    assert.equal(decathlonPreview.supportLevel, "VERIFIED");
    assert.deepEqual(decathlonPreview.criteria.filter((criterion) => criterion.role !== "CONTEXT").map((criterion) => criterion.semanticType).sort(), ["CONDITION", "PRICE_RANGE", "SELLER", "SIZE"]);
    assert.deepEqual(decathlonPreview.criteria.find((criterion) => criterion.semanticType === "SIZE")?.desiredValue, ["L", "M"]);
    assert.equal(decathlonPreview.unsupported.length, 0);
    assert.equal(decathlonPreview.unresolved.length, 0);

    const decathlonState = await call("SAVE_CAPTURE", { tabId: liveDecathlonTabId, preview: decathlonPreview, name: "Decathlon route regression" });
    await liveDecathlon.goto("https://www.decathlon.de/herren/t-shirts-hemden", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await call("START_REPLAY", { stateId: decathlonState.id, tabId: liveDecathlonTabId });
    let decathlonReplay;
    const decathlonDeadline = Date.now() + 30_000;
    do {
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      decathlonReplay = await call("GET_ACTIVE_REPLAY", { tabId: liveDecathlonTabId });
    } while (decathlonReplay && !["COMPLETE", "COMPLETE_WITH_WARNINGS", "PARTIAL", "FAILED", "CANCELLED", "INTERRUPTED"].includes(decathlonReplay.status) && Date.now() < decathlonDeadline);
    assert.equal(decathlonReplay?.status, "COMPLETE", JSON.stringify(decathlonReplay));
    const replayedUrl = new URL(liveDecathlon.url());
    assert.equal(replayedUrl.pathname.includes("/f-zustand_neu/f-partner_decathlon/f-sg_37-l-19_37-m"), true);
    assert.equal(replayedUrl.searchParams.get("price"), "from_0_to_51");
  }

  await extension.evaluate(async (id) => chrome.tabs.update(id, { active: true }), idealoTabId);
  await extension.reload({ waitUntil: "domcontentloaded" });
  await extension.locator('[data-view="library"]').click();
  await extension.locator(".library-card").first().waitFor();

  let smokeCard = extension.locator(".library-card").filter({ hasText: "Smoke test trail shoes" });
  await smokeCard.locator('[data-action="more"]').click();
  await extension.locator("#actions-dialog").waitFor({ state: "visible" });
  assert.equal(await extension.locator("#actions-dialog").evaluate((dialog) => dialog.contains(document.activeElement)), true);
  await extension.locator("#actions-dialog").press("Escape");
  await extension.locator("#actions-dialog").waitFor({ state: "hidden" });
  await smokeCard.locator('[data-action="more"]').click();
  await extension.locator("#rename-value").fill("Renamed trail shoes");
  await extension.locator('[data-library-action="rename"]').click();
  smokeCard = extension.locator(".library-card").filter({ hasText: "Renamed trail shoes" });
  await smokeCard.waitFor();

  await smokeCard.locator('[data-action="more"]').click();
  await extension.locator('[data-library-action="duplicate"]').click();
  const copyCard = extension.locator(".library-card").filter({ hasText: "Renamed trail shoes copy" });
  await copyCard.waitFor();
  await copyCard.locator('[data-action="more"]').click();
  await extension.locator('[data-library-action="delete"]').click();
  await extension.locator("#confirm-dialog").waitFor({ state: "visible" });
  await extension.locator("#confirm-delete").click();
  await copyCard.waitFor({ state: "detached" });

  await smokeCard.locator('[data-action="details"]').click();
  await extension.locator("#details-dialog").waitFor({ state: "visible" });
  assert.match(await extension.locator("#details-coverage").innerText(), /captured/);
  await extension.locator("#close-details").click();

  const beforeImport = Number(await extension.locator("#library-count").innerText());
  const downloadPromise = extension.waitForEvent("download");
  await extension.locator("#export-all").click();
  const download = await downloadPromise;
  const exportPath = resolve(smokeRoot, "filtervault-export.json");
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  assert.equal(exported.schemaVersion, 4);
  assert.equal(exported.states.length, beforeImport);
  await extension.locator("#import-file").setInputFiles(exportPath);
  await extension.waitForFunction((expected) => Number(document.querySelector("#library-count")?.textContent) === expected, beforeImport * 2);
  assert.equal(Number(await extension.locator("#library-count").innerText()), beforeImport * 2);

  const restrictedPage = await context.newPage();
  await restrictedPage.goto("chrome://version", { waitUntil: "domcontentloaded" });
  await restrictedPage.bringToFront();
  const restrictedTabId = await extension.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  });
  assert.equal(Number.isInteger(restrictedTabId), true);
  await assert.rejects(() => call("GET_CAPTURE_PREVIEW", { tabId: restrictedTabId }), /(?:RESTRICTED_PAGE|NO_ACTIVE_PAGE)/);
  await extension.screenshot({
    path: resolve(smokeRoot, "library.png"),
    clip: { x: 0, y: 0, width: 430, height: 650 }
  });
  console.log(`Browser smoke passed: generic replay completed, Idealo captured ${idealoPreview.criteria.length} verified criteria, and Decathlon route evidence verified.`);
} finally {
  await context?.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
