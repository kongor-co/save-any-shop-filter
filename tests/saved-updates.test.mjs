import test from "node:test";
import assert from "node:assert/strict";
import { captureRouteCriteria } from "../src/shared/route.js";
import { assertUpdateContext, diffSavedCriteria, previewUpdateContent, replaceSavedCapture, restoreSavedCapture, savedUpdateContent, updateListingPath, updateRevision } from "../src/shared/saved-updates.js";
import { validateUiMessage } from "../src/shared/validator.js";

function preview(url = "https://shop.example/catalog/shoes?brand=nike") {
  const parsed = new URL(url);
  return { site: { origin: parsed.origin, hostname: parsed.hostname, locale: "en" }, context: { surface: "PRODUCT_LIST", category: "Shoes", searchQuery: parsed.searchParams.get("q"), routeClass: parsed.pathname, locale: "en" }, criteria: captureRouteCriteria(url), captureUrl: url, coverage: { saveEligible: true }, supportLevel: "COMPATIBLE", unsupported: [], unresolved: [], defaultsIgnored: [] };
}
function saved() {
  const original = preview();
  return { schemaVersion: 4, id: "saved", name: "My shoes", site: original.site, context: original.context, criteria: original.criteria, metadata: { ...original, createdAt: "2026-01-01", updatedAt: "2026-01-02", health: "HEALTHY", lastReplayAt: "yesterday", lastSuccessfulReplayAt: "yesterday", mappingHealthEvidence: [{ status: "VERIFIED" }] } };
}

test("revision tokens ignore object-key order but detect criteria, mapping and saved-record changes", async () => {
  assert.equal(await updateRevision({ b: [1, { z: true, a: null }], a: 2, absent: undefined }), await updateRevision({ a: 2, b: [1, { a: null, z: true }] }));
  assert.notEqual(await updateRevision([1, 2]), await updateRevision([2, 1]));
  const previous = saved();
  const renamed = structuredClone(previous); renamed.name = "New name";
  assert.notEqual(await updateRevision(previous), await updateRevision(renamed));
  assert.equal(await updateRevision(savedUpdateContent(previous)), await updateRevision(savedUpdateContent(renamed)));
  const changed = structuredClone(previous); changed.criteria[0].bindings[0].verificationTexts = ["Nike changed"];
  assert.notEqual(await updateRevision(savedUpdateContent(previous)), await updateRevision(savedUpdateContent(changed)));
});

test("change preview reports added, removed and changed groups without treating value order as a change", () => {
  const before = captureRouteCriteria("https://shop.example/catalog?brand=nike\u0026color=black\u0026color=gray\u0026size=M");
  const after = captureRouteCriteria("https://shop.example/catalog?brand=adidas\u0026color=gray\u0026color=black\u0026material=cotton");
  const changes = diffSavedCriteria(before, after);
  assert.deepEqual(changes.map((item) => [item.kind, item.semanticType]), [["CHANGED", "BRAND"], ["REMOVED", "SIZE"], ["ADDED", "MATERIAL"]]);
  assert.deepEqual(changes[0].before, ["nike"]);
  assert.deepEqual(changes[0].after, ["adidas"]);
  assert.deepEqual(diffSavedCriteria([], []), []);
  assert.deepEqual(diffSavedCriteria([{ role: "FILTER", semanticType: "BRAND", desiredValue: ["nike"] }], before.slice(0, 1)), []);
});

test("updates require the exact origin and a compatible listing, query, locale and context criteria", () => {
  assert.doesNotThrow(() => assertUpdateContext(saved(), preview("https://shop.example/catalog/shoes?brand=adidas")));
  for (const candidate of [preview("https://other.example/catalog/shoes?brand=nike"), preview("http://shop.example/catalog/shoes?brand=nike")]) {
    assert.throws(() => assertUpdateContext(saved(), candidate), /ORIGIN_MISMATCH/);
  }
  for (const candidate of [preview("https://shop.example/catalog/boots?brand=nike"), preview("https://shop.example/catalog/shoes?q=boots"), { ...preview(), context: { ...preview().context, surface: "SEARCH_RESULTS" } }, { ...preview(), site: { ...preview().site, locale: "de" } }, { ...preview(), context: { ...preview().context, category: "Televisions" } }]) {
    assert.throws(() => assertUpdateContext(saved(), candidate), /CONTEXT_MISMATCH/);
  }
  const previous = saved(); previous.criteria.push({ role: "CONTEXT", semanticType: "CATEGORY", desiredValue: ["shoes"] });
  assert.throws(() => assertUpdateContext(previous, preview()), /CONTEXT_MISMATCH/);
});

test("listing identity strips only registered path facets and preserves exact category identifiers", () => {
  const pairs = [
    ["https://www.decathlon.de/herren/t-shirts/f-zustand_neu/f-sg_37-m", "https://www.decathlon.de/herren/t-shirts"],
    ["https://www.idealo.de/preisvergleich/ProductCategory/123F456-789.html", "https://www.idealo.de/preisvergleich/ProductCategory/123.html"],
    ["https://www.zalando.de/mens-shoes/nike.adidas/", "https://www.zalando.de/mens-shoes/"],
    ["https://www.rebuy.de/kaufen/handy/samsung/galaxy", "https://www.rebuy.de/kaufen/handy"],
    ["https://www.kleinanzeigen.de/s-notebooks/laptop/k0c278+notebooks.brand_s:apple+notebooks.ram_s:16gb", "https://www.kleinanzeigen.de/s-notebooks/laptop/k0c278"]
  ];
  for (const [left, right] of pairs) assert.equal(updateListingPath(left), updateListingPath(right));
  assert.notEqual(updateListingPath("https://www.idealo.de/preisvergleich/ProductCategory/123.html"), updateListingPath("https://www.idealo.de/preisvergleich/ProductCategory/456.html"));
  assert.notEqual(updateListingPath("https://unknown.example/shoes/f-brand_nike"), updateListingPath("https://unknown.example/shoes"));
  assert.equal(updateListingPath("https://www.zalando.de/mens-shoes/nike.adidas/sale/"), "/mens-shoes/sale");
  assert.equal(updateListingPath("https://shop.example/"), "/");
});

test("replacement and Undo preserve identity and name while resetting verification evidence", () => {
  const previous = saved(); const original = structuredClone(previous);
  const replacement = preview("https://shop.example/catalog/shoes?brand=adidas");
  const updated = replaceSavedCapture(previous, replacement, "2026-10-29");
  assert.equal(updated.id, previous.id); assert.equal(updated.name, previous.name);
  assert.equal(updated.metadata.createdAt, previous.metadata.createdAt);
  assert.equal(updated.metadata.health, "UNKNOWN"); assert.equal(updated.metadata.lastReplayAt, null);
  assert.equal(updated.metadata.lastSuccessfulReplayAt, null); assert.deepEqual(updated.metadata.mappingHealthEvidence, []);
  assert.deepEqual(savedUpdateContent(updated), previewUpdateContent(replacement));
  updated.name = "Renamed after update";
  previous.metadata.routeSnapshot = "https://shop.example/catalog/shoes?brand=nike\u0026sort=price";
  const restored = restoreSavedCapture(updated, previous, "2026-10-30");
  assert.equal(restored.name, "Renamed after update"); assert.deepEqual(restored.criteria, original.criteria);
  assert.equal(restored.metadata.routeSnapshot, previous.metadata.routeSnapshot);
  assert.equal(restored.metadata.health, "UNKNOWN");
  assert.deepEqual(original.criteria, previous.criteria);
  const legacy = saved(); delete legacy.metadata.routeSnapshot; delete legacy.metadata.unsupported; delete legacy.metadata.unresolved; delete legacy.metadata.defaultsIgnored;
  assert.equal(savedUpdateContent(legacy).routeSnapshot, legacy.metadata.captureUrl);
  assert.deepEqual(savedUpdateContent(legacy).unresolved, []);
  assert.equal(restoreSavedCapture(updated, legacy, "now").metadata.routeSnapshot, legacy.metadata.captureUrl);
});

test("update messages require bounded tokens and cannot carry replacement criteria or executable data", () => {
  const token = "a".repeat(64);
  const messages = [{ type: "PREVIEW_STATE_UPDATE", stateId: "saved", tabId: 1 }, { type: "APPLY_STATE_UPDATE", stateId: "saved", tabId: 1, expectedRevision: token, captureToken: token }, { type: "PREVIEW_STATE_UNDO", stateId: "saved" }, { type: "UNDO_STATE_UPDATE", stateId: "saved", expectedRevision: token }, { type: "GET_STATE_UPDATE_INFO", stateId: "saved" }];
  for (const message of messages) {
    assert.doesNotThrow(() => validateUiMessage(message));
    assert.throws(() => validateUiMessage(message, "content"), /Unauthorized/);
    assert.throws(() => validateUiMessage({ ...message, criteria: [] }), /Unexpected/);
  }
  for (const changes of [{ tabId: -1 }, { stateId: "" }, { expectedRevision: "stale" }, { captureToken: null }, { captureToken: 42 }, { captureToken: "a".repeat(65) }]) {
    assert.throws(() => validateUiMessage({ ...messages[1], ...changes }), /Invalid/);
  }
});
