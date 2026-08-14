import test from "node:test";
import assert from "node:assert/strict";
import { LIBRARY_INDEX_KEY } from "../src/shared/constants.js";

function storageArea(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(keys) {
      if (keys == null) return Object.fromEntries(data);
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))]));
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) data.delete(key);
    }
  };
}

function state(id, updatedAt, schemaVersion = 4) {
  const value = {
    schemaVersion,
    id,
    name: `State ${id}`,
    site: { origin: "https://shop.example", hostname: "shop.example", locale: "en", adapterId: "generic", adapterVersion: 1 },
    context: { surface: "PRODUCT_LIST", category: null, searchQuery: null, routeClass: "/search", compatibilityFingerprint: "test" },
    criteria: [{ criterionId: "brand", role: "FILTER", semanticType: "BRAND", desiredValue: ["nike"], observedRepresentation: ["Nike"], dependencies: [], bindings: [{ bindingId: "brand-query", type: "URL_QUERY", parameter: "brand", values: ["nike"], applicability: {} }] }],
    metadata: { createdAt: updatedAt, updatedAt, captureUrl: "https://shop.example/search?brand=nike", routeSnapshot: "https://shop.example/search?brand=nike", supportLevel: "COMPATIBLE", unsupported: [], coverage: { activeDetected: 1, captured: 1, meaningfulCaptured: 1, unsupported: 0, unresolved: 0, defaultsIgnored: 0, saveEligible: true, saveReason: null, supportLevel: "COMPATIBLE" }, lastReplayAt: null, lastSuccessfulReplayAt: null, health: "UNKNOWN" }
  };
  if (schemaVersion === 3) {
    delete value.metadata.coverage;
    delete value.metadata.routeSnapshot;
  }
  return value;
}

const local = storageArea();
const session = storageArea();
globalThis.chrome = { storage: { local, session } };
const storage = await import(`../src/background/storage.js?test=${Date.now()}`);

test("library writes, sorts, retrieves, and removes states", async () => {
  local.data.clear();
  await storage.putState(state("older", "2026-08-13T00:00:00.000Z"));
  await storage.putState(state("newer", "2026-08-14T00:00:00.000Z"));
  assert.deepEqual((await storage.listStates()).map((item) => item.id), ["newer", "older"]);
  assert.equal((await storage.getState("older")).name, "State older");
  await storage.removeState("older");
  assert.deepEqual((await storage.listStates()).map((item) => item.id), ["newer"]);
});

test("library migrates v3 entries and isolates corrupt entries", async () => {
  local.data.clear();
  local.data.set(LIBRARY_INDEX_KEY, ["legacy", "corrupt"]);
  local.data.set("fv:state:legacy", state("legacy", "2026-08-14T00:00:00.000Z", 3));
  local.data.set("fv:state:corrupt", { schemaVersion: 4, id: "corrupt" });

  const states = await storage.listStates();
  assert.equal(states.length, 1);
  assert.equal(states[0].schemaVersion, 4);
  assert.equal(states[0].metadata.coverage.saveEligible, true);
  assert.deepEqual(local.data.get(LIBRARY_INDEX_KEY), ["legacy"]);
  assert.equal(local.data.get("fv:state:legacy").schemaVersion, 4);
});

test("replay checkpoints round-trip through session storage", async () => {
  session.data.clear();
  const checkpoint = { replayId: "replay-1", tabId: 42, status: "APPLYING", results: [] };
  await storage.putReplay(checkpoint);
  assert.deepEqual(await storage.getReplay("replay-1"), checkpoint);
  assert.deepEqual(await storage.getActiveReplay(42), checkpoint);
  await storage.clearActiveReplay(42);
  assert.equal(await storage.getActiveReplay(42), null);
});
