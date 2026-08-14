import test from "node:test";
import assert from "node:assert/strict";
import { validateSavedState } from "../src/shared/validator.js";

function domState() {
  return {
    schemaVersion: 4,
    id: "dom-state",
    name: "Committed filters",
    site: { origin: "https://shop.example", hostname: "shop.example", locale: "en", adapterId: "shop", adapterVersion: 2 },
    context: { surface: "PRODUCT_LIST", category: "Shoes", searchQuery: null, routeClass: "/shoes", compatibilityFingerprint: "shop" },
    criteria: [{
      criterionId: "brand",
      role: "FILTER",
      semanticType: "BRAND",
      desiredValue: ["Nike"],
      observedRepresentation: ["Nike"],
      dependencies: [],
      bindings: [{
        bindingId: "brand-dom",
        type: "DOM",
        origin: "https://shop.example",
        mapping: {
          mappingVersion: 2,
          controlType: "BOOLEAN",
          desiredValue: ["Nike"],
          filterContainer: { locatorChain: [{ type: "FIELDSET_LEGEND", value: "Brand" }] },
          option: { locatorChain: [{ type: "LABEL_TEXT", value: "Nike" }] },
          interactionPlan: [
            { action: "OPEN_FILTER_GROUP", timeoutMs: 1000 },
            { action: "ACTIVATE_OPTION", timeoutMs: 1000 },
            { action: "COMMIT", timeoutMs: 3000, locatorChain: [{ type: "BUTTON_TEXT", value: "Apply" }] },
            { action: "VERIFY_RESULT", timeoutMs: 3000 }
          ],
          verificationRule: { type: "OPTION_SELECTED", desiredValue: ["Nike"] }
        }
      }]
    }],
    metadata: {
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      captureUrl: "https://shop.example/shoes",
      routeSnapshot: "https://shop.example/shoes",
      supportLevel: "VERIFIED",
      unsupported: [],
      coverage: { activeDetected: 1, captured: 1, meaningfulCaptured: 1, unsupported: 0, unresolved: 0, defaultsIgnored: 0, saveEligible: true, saveReason: null, supportLevel: "VERIFIED" },
      lastReplayAt: null,
      lastSuccessfulReplayAt: null,
      health: "UNKNOWN"
    }
  };
}

test("validated plans accept bounded declarative commit workflows", () => {
  const state = domState();
  assert.equal(validateSavedState(state), state);
});

test("action locator chains reject unknown locator types", () => {
  const state = domState();
  state.criteria[0].bindings[0].mapping.interactionPlan[2].locatorChain = [{ type: "CSS_SELECTOR", value: "button" }];
  assert.throws(() => validateSavedState(state), /Unknown locator type/);
});

test("DOM bindings cannot target a different origin", () => {
  const state = domState();
  state.criteria[0].bindings[0].origin = "https://evil.example";
  assert.throws(() => validateSavedState(state), /Binding origin mismatch/);
});

test("URL path and query bindings enforce shape limits", () => {
  const path = domState();
  path.criteria[0].bindings = [{ bindingId: "bad-path", type: "URL_PATH", pathname: "relative/path" }];
  assert.throws(() => validateSavedState(path), /Invalid URL pathname/);

  const query = domState();
  query.criteria[0].bindings = [{ bindingId: "bad-query", type: "URL_QUERY", parameter: "brand", values: "nike" }];
  assert.throws(() => validateSavedState(query), /Invalid query values/);
});
