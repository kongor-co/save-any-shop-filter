import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as constants from "../../src/shared/constants.js";
import * as route from "../../src/shared/route.js";
import * as coverage from "../../src/shared/coverage.js";
import * as planner from "../../src/shared/planner.js";
import * as policy from "../../src/shared/replay-policy.js";
import * as validator from "../../src/shared/validator.js";
import * as updates from "../../src/shared/saved-updates.js";
import * as storage from "../../src/background/storage.js";

const source = (await readFile(new URL("../../src/background/service-worker.js", import.meta.url), "utf8")).replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, "");

function area() {
  const data = new Map();
  return { data, failWrite: false,
    async get(keys) { const names = keys == null ? [...data.keys()] : typeof keys === "string" ? [keys] : keys; return Object.fromEntries(names.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))])); },
    async set(values) { if (this.failWrite) { this.failWrite = false; throw new Error("STORAGE_QUOTA_FAILURE"); } for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); }
  };
}

export async function harness() {
  const local = area(), session = area();
  const page = { url: "https://shop.example/catalog/shoes?brand=nike", title: "Shoes", locale: "en", pageType: "LISTING", contextLabel: "Shoes", domCriteria: [], unsupported: [], unresolved: [], defaultsIgnored: [] };
  const calls = [];
  const event = { addListener() {} };
  const chrome = {
    runtime: { id: "extension", getURL: (path) => `chrome-extension://extension/${path}`, onInstalled: event, onMessage: event },
    storage: { local, session }, permissions: { contains: async () => true },
    scripting: { executeScript: async () => [{ frameId: 0, documentId: "doc-1" }] },
    tabs: { onUpdated: event, onRemoved: event,
      get: async () => ({ id: 1, url: page.url, status: "complete" }),
      update: async () => { throw new Error("UPDATE_MUST_NOT_NAVIGATE"); },
      sendMessage: async (_tab, message) => {
        calls.push(message.type);
        if (message.type === "CAPTURE_PAGE") return { ok: true, snapshot: structuredClone(page) };
        throw new Error(`UNEXPECTED_BROWSER_ACTION:${message.type}`);
      }
    }
  };
  globalThis.chrome = chrome;
  const sandbox = { ...constants, ...route, ...coverage, ...planner, ...policy, ...validator, ...updates, ...storage, chrome, console, URL, Date, Map, Set, Promise, crypto, structuredClone, setTimeout, clearTimeout };
  vm.runInNewContext(`${source}\nglobalThis.api = { handleMessage, recovery, updateReplayMetadata };`, sandbox);
  await sandbox.api.recovery;
  const sender = { id: "extension", url: "chrome-extension://extension/src/popup/popup.html" };
  const send = async (type, fields = {}) => (await sandbox.api.handleMessage({ type, ...fields }, sender)).data;
  const capture = await send("GET_CAPTURE_PREVIEW", { tabId: 1 });
  const saved = await send("SAVE_CAPTURE", { tabId: 1, preview: capture, name: "Everyday shoes" });
  const prepare = () => send("PREVIEW_STATE_UPDATE", { stateId: saved.id, tabId: 1 });
  const apply = (preview) => send("APPLY_STATE_UPDATE", { stateId: saved.id, tabId: 1, expectedRevision: preview.expectedRevision, captureToken: preview.captureToken });
  return { page, saved, local, session, calls, send, prepare, apply, api: sandbox.api };
}
