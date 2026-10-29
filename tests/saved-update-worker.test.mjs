import test from "node:test";
import assert from "node:assert/strict";
import * as constants from "../src/shared/constants.js";
import * as updates from "../src/shared/saved-updates.js";
import * as storage from "../src/background/storage.js";
import { harness } from "./helpers/saved-update-harness.mjs";

test("preview is read-only; update preserves the Library entry and Undo restores its settings", async () => {
  const h = await harness(); const original = structuredClone(h.saved);
  h.page.url = "https://shop.example/catalog/shoes?brand=adidas\u0026color=black";
  const before = structuredClone([...h.local.data]);
  const preview = await h.prepare();
  assert.deepEqual([...h.local.data], before);
  assert.equal(preview.canApply, true);
  assert.deepEqual(Array.from(preview.changes, (item) => item.kind), ["CHANGED", "ADDED"]);
  const updated = await h.apply(preview);
  assert.equal(updated.id, original.id); assert.equal(updated.name, original.name);
  assert.equal(updated.metadata.createdAt, original.metadata.createdAt);
  assert.equal(updated.metadata.health, "UNKNOWN"); assert.equal(updated.metadata.lastReplayAt, null);
  assert.equal((await h.send("LIST_STATES")).length, 1);
  assert.equal((await h.send("GET_STATE_UPDATE_INFO", { stateId: updated.id })).undoAvailable, true);
  assert.ok(h.calls.every((type) => type === "CAPTURE_PAGE"), "Updating saved data must not navigate or replay controls");
  await h.send("RENAME_STATE", { stateId: updated.id, name: "Renamed shoes" });
  const undo = await h.send("PREVIEW_STATE_UNDO", { stateId: updated.id });
  assert.equal(undo.mode, "undo"); assert.equal(undo.canApply, true);
  const restored = await h.send("UNDO_STATE_UPDATE", { stateId: updated.id, expectedRevision: undo.expectedRevision });
  assert.equal(restored.name, "Renamed shoes"); assert.deepEqual(restored.criteria, original.criteria);
  assert.equal(restored.metadata.captureUrl, original.metadata.captureUrl);
  assert.equal(restored.metadata.health, "UNKNOWN");
  assert.equal((await h.send("GET_STATE_UPDATE_INFO", { stateId: updated.id })).undoAvailable, false);
  await assert.rejects(() => h.send("PREVIEW_STATE_UNDO", { stateId: updated.id }), /NO_STATE_UPDATE_TO_UNDO/);
});

test("changed page or saved entry invalidates confirmation without modifying either saved version", async () => {
  const h = await harness(); h.page.url = "https://shop.example/catalog/shoes?brand=adidas";
  const preview = await h.prepare();
  h.page.url = "https://shop.example/catalog/shoes?brand=puma";
  await assert.rejects(() => h.apply(preview), /CAPTURE_STATE_CHANGED/);
  assert.equal((await storage.getState(h.saved.id)).criteria[0].desiredValue[0], "nike");
  assert.equal(await storage.getStateUndo(h.saved.id), null);
  const refreshed = await h.prepare();
  await h.send("RENAME_STATE", { stateId: h.saved.id, name: "New name" });
  await assert.rejects(() => h.apply(refreshed), /SAVED_STATE_CHANGED/);
  assert.equal((await storage.getState(h.saved.id)).name, "New name");
  const fresh = await h.prepare();
  const outcomes = await Promise.allSettled([h.apply(fresh), h.apply(fresh)]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.match(outcomes.find((item) => item.status === "rejected").reason.message, /SAVED_STATE_CHANGED/);
});

test("foreign shops, different categories and searches, and empty captures cannot replace saved filters", async () => {
  const h = await harness();
  for (const [url, error] of [["https://other.example/catalog/shoes?brand=nike", /UPDATE_ORIGIN_MISMATCH/], ["https://shop.example/catalog/boots?brand=nike", /UPDATE_CONTEXT_MISMATCH/], ["https://shop.example/catalog/shoes?q=other\u0026brand=nike", /UPDATE_CONTEXT_MISMATCH/]]) {
    h.page.url = url; await assert.rejects(h.prepare, error);
  }
  h.page.url = "https://shop.example/catalog/shoes";
  const empty = await h.prepare(); assert.equal(empty.canApply, false);
  await assert.rejects(() => h.apply(empty), /NO_MEANINGFUL_CRITERIA/);
  h.page.url = h.saved.metadata.captureUrl;
  const unchanged = await h.prepare(); assert.equal(unchanged.canApply, false);
  await assert.rejects(() => h.apply(unchanged), /NO_UPDATE_CHANGES/);
  assert.deepEqual((await storage.getState(h.saved.id)).criteria, h.saved.criteria);
});

test("updates and Undo are blocked while the saved configuration is used by replay in any tab", async () => {
  const h = await harness(); h.page.url = "https://shop.example/catalog/shoes?brand=adidas";
  const preview = await h.prepare();
  const replay = { replayId: "other-tab", savedStateId: h.saved.id, tabId: 99, status: "APPLYING" };
  await storage.putReplay(replay);
  await assert.rejects(h.prepare, /SAVED_STATE_IN_USE/);
  await assert.rejects(() => h.apply(preview), /SAVED_STATE_IN_USE/);
  await storage.putReplay({ ...replay, status: "COMPLETE" });
  await h.apply(preview);
  const undo = await h.send("PREVIEW_STATE_UNDO", { stateId: h.saved.id });
  await storage.putReplay({ ...replay, status: "AWAITING_CONFIRMATION" });
  await assert.rejects(() => h.send("PREVIEW_STATE_UNDO", { stateId: h.saved.id }), /SAVED_STATE_IN_USE/);
  await assert.rejects(() => h.send("UNDO_STATE_UPDATE", { stateId: h.saved.id, expectedRevision: undo.expectedRevision }), /SAVED_STATE_IN_USE/);
});

test("one Undo version is kept; old replay metadata cannot verify replacement criteria", async () => {
  const h = await harness();
  const originalRevision = await updates.updateRevision(updates.savedUpdateContent(h.saved));
  h.page.url = "https://shop.example/catalog/shoes?brand=adidas"; await h.apply(await h.prepare());
  const first = await storage.getState(h.saved.id);
  h.page.url = "https://shop.example/catalog/shoes?brand=puma"; await h.apply(await h.prepare());
  assert.deepEqual((await storage.getStateUndo(h.saved.id)).previous.criteria, first.criteria);
  await h.api.updateReplayMetadata({ savedStateId: h.saved.id, savedContentRevision: originalRevision, status: "COMPLETE", results: [{ criterionId: "old", status: "VERIFIED" }] });
  assert.equal((await storage.getState(h.saved.id)).metadata.health, "UNKNOWN");
  const current = await storage.getState(h.saved.id);
  await h.api.updateReplayMetadata({ savedStateId: h.saved.id, savedContentRevision: await updates.updateRevision(updates.savedUpdateContent(current)), status: "COMPLETE", results: current.criteria.map((item) => ({ criterionId: item.criterionId, status: "VERIFIED" })) });
  assert.equal((await storage.getState(h.saved.id)).metadata.health, "HEALTHY");
  assert.equal((await h.send("GET_STATE_UPDATE_INFO", { stateId: h.saved.id })).undoAvailable, true);
});

test("failed writes preserve the previous entry; backup records stay outside exports and copies", async () => {
  const h = await harness(); h.page.url = "https://shop.example/catalog/shoes?brand=adidas";
  const preview = await h.prepare(); h.local.failWrite = true;
  await assert.rejects(() => h.apply(preview), /STORAGE_QUOTA_FAILURE/);
  assert.deepEqual((await storage.getState(h.saved.id)).criteria, h.saved.criteria);
  assert.equal(await storage.getStateUndo(h.saved.id), null);
  await h.apply(preview);
  const exported = await h.send("EXPORT_LIBRARY");
  assert.equal(exported.schemaVersion, 4); assert.equal(exported.states.length, 1);
  assert.equal(JSON.stringify(exported).includes("previous"), false);
  const copy = await h.send("DUPLICATE_STATE", { stateId: h.saved.id });
  assert.equal((await h.send("GET_STATE_UPDATE_INFO", { stateId: copy.id })).undoAvailable, false);
  await h.send("IMPORT_LIBRARY", { payload: exported });
  assert.equal((await h.send("LIST_STATES")).length, 3);
  await h.send("DELETE_STATE", { stateId: h.saved.id });
  assert.equal(await storage.getStateUndo(h.saved.id), null);
  assert.equal(h.local.data.has(`${constants.UPDATE_UNDO_PREFIX}${h.saved.id}`), false);
});

test("invalid backup data cannot be exposed or restored and cannot corrupt the current record", async () => {
  const h = await harness(); const key = `${constants.UPDATE_UNDO_PREFIX}${h.saved.id}`;
  const base = { formatVersion: 1, stateId: h.saved.id, contentRevision: await updates.updateRevision(updates.savedUpdateContent(h.saved)), previous: h.saved };
  for (const invalid of [{ ...base, formatVersion: 2 }, { ...base, stateId: "foreign" }, { ...base, contentRevision: "bad" }, { ...base, previous: {} }, { ...base, previous: { ...h.saved, id: "foreign" } }, { ...base, contentRevision: "f".repeat(64) }, { ...base, previous: { ...h.saved, site: { ...h.saved.site, origin: "https://foreign.example" }, metadata: { ...h.saved.metadata, captureUrl: "https://foreign.example/catalog/shoes" } } }]) {
    h.local.data.set(key, structuredClone(invalid));
    assert.equal((await h.send("GET_STATE_UPDATE_INFO", { stateId: h.saved.id })).undoAvailable, false);
    await assert.rejects(() => h.send("PREVIEW_STATE_UNDO", { stateId: h.saved.id }), /NO_STATE_UPDATE_TO_UNDO/);
  }
  assert.deepEqual((await storage.getState(h.saved.id)).criteria, h.saved.criteria);
});

test("Undo rechecks the current revision and preserves its backup after a storage failure", async () => {
  const h = await harness(); h.page.url = "https://shop.example/catalog/shoes?brand=adidas";
  await h.apply(await h.prepare());
  const first = await h.send("PREVIEW_STATE_UNDO", { stateId: h.saved.id });
  await h.send("RENAME_STATE", { stateId: h.saved.id, name: "Updated name" });
  await assert.rejects(() => h.send("UNDO_STATE_UPDATE", { stateId: h.saved.id, expectedRevision: first.expectedRevision }), /SAVED_STATE_CHANGED/);
  const fresh = await h.send("PREVIEW_STATE_UNDO", { stateId: h.saved.id });
  h.local.failWrite = true;
  await assert.rejects(() => h.send("UNDO_STATE_UPDATE", { stateId: h.saved.id, expectedRevision: fresh.expectedRevision }), /STORAGE_QUOTA_FAILURE/);
  assert.equal((await storage.getState(h.saved.id)).criteria[0].desiredValue[0], "adidas");
  assert.equal((await h.send("GET_STATE_UPDATE_INFO", { stateId: h.saved.id })).undoAvailable, true);
  const restored = await h.send("UNDO_STATE_UPDATE", { stateId: h.saved.id, expectedRevision: fresh.expectedRevision });
  assert.equal(restored.criteria[0].desiredValue[0], "nike");
  await assert.rejects(async () => h.send("UNDO_STATE_UPDATE", { stateId: h.saved.id, expectedRevision: await updates.updateRevision(restored) }), /NO_STATE_UPDATE_TO_UNDO/);
});

test("legacy saved configurations can be updated without changing their identity", async () => {
  const h = await harness(); const legacy = structuredClone(h.saved);
  legacy.schemaVersion = 3; delete legacy.metadata.coverage; delete legacy.metadata.routeSnapshot;
  h.local.data.set(`${constants.STATE_KEY_PREFIX}${legacy.id}`, legacy);
  h.page.url = "https://shop.example/catalog/shoes?brand=adidas";
  const updated = await h.apply(await h.prepare());
  assert.equal(updated.schemaVersion, 4); assert.equal(updated.id, legacy.id);
  assert.equal((await storage.getStateUndo(legacy.id)).previous.schemaVersion, 4);
});
