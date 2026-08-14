import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeName, validateImportPayload, validateSavedState } from "../src/shared/validator.js";

const root = new URL("../", import.meta.url);

function validState() {
  return {
    schemaVersion: 4,
    id: "security-state",
    name: "Safe filters",
    site: { origin: "https://shop.example", hostname: "shop.example", locale: "en", adapterId: "generic", adapterVersion: 1 },
    context: { surface: "PRODUCT_LIST", category: null, searchQuery: null, routeClass: "/search", compatibilityFingerprint: "safe" },
    criteria: [{
      criterionId: "brand",
      role: "FILTER",
      semanticType: "BRAND",
      desiredValue: ["nike"],
      observedRepresentation: ["Nike"],
      dependencies: [],
      bindings: [{ bindingId: "brand-query", type: "URL_QUERY", parameter: "brand", values: ["nike"], applicability: {} }]
    }],
    metadata: {
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      captureUrl: "https://shop.example/search?brand=nike",
      routeSnapshot: "https://shop.example/search?brand=nike",
      supportLevel: "COMPATIBLE",
      unsupported: [],
      coverage: { activeDetected: 1, captured: 1, meaningfulCaptured: 1, unsupported: 0, unresolved: 0, defaultsIgnored: 0, saveEligible: true, saveReason: null, supportLevel: "COMPATIBLE" },
      lastReplayAt: null,
      lastSuccessfulReplayAt: null,
      health: "UNKNOWN"
    }
  };
}

test("manifest keeps least-privilege install permissions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.match(manifest.content_security_policy.extension_pages, /^script-src 'self'; object-src 'self'$/);
});

test("runtime source contains no prompt dialogs, eval, or remotely loaded scripts", async () => {
  const popup = await readFile(new URL("../src/popup/popup.js", import.meta.url), "utf8");
  const executor = await readFile(new URL("../src/content/executor.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
  assert.doesNotMatch(popup, /\b(?:prompt|confirm)\s*\(/);
  assert.doesNotMatch(`${popup}\n${executor}`, /\beval\s*\(|\bnew\s+Function\s*\(/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("names are normalized without control characters", () => {
  assert.equal(sanitizeName("  Trail\u0000\n shoes   "), "Trail shoes");
  assert.equal(sanitizeName("\u0000", "Fallback"), "Fallback");
  assert.equal(sanitizeName("x".repeat(300)).length, 160);
});

test("sensitive or executable values are rejected throughout imports", () => {
  const cases = ["javascript:alert(1)", "<script>alert(1)</script>", "eval(alert(1))", "Function('return 1')"];
  for (const hostile of cases) {
    const state = validState();
    state.criteria[0].desiredValue = [hostile];
    assert.throws(() => validateSavedState(state), /Invalid desired value item/);
  }
});

test("imports enforce byte, state-count, protocol, and future-version limits", () => {
  const state = validState();
  const tooMany = { schemaVersion: 4, states: Array.from({ length: 251 }, () => state) };
  assert.throws(() => validateImportPayload(tooMany), /Invalid import state count/);

  const oversized = JSON.stringify({ schemaVersion: 4, states: [], padding: "x".repeat(1_000_001) });
  assert.throws(() => validateImportPayload(oversized), /Import exceeds size limit/);

  const insecure = validState();
  insecure.site.origin = "file:///tmp";
  assert.throws(() => validateSavedState(insecure), /Unsupported site protocol/);

  assert.throws(() => validateImportPayload({ schemaVersion: 99, states: [] }), /Unsupported export schema version/);
});
