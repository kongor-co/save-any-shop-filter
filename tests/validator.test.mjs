import test from "node:test";
import assert from "node:assert/strict";
import { migrateSavedState, validateImportPayload, validateSavedState } from "../src/shared/validator.js";

function validState() {
  return {
    schemaVersion: 4,
    id: "state-1",
    name: "Trail shoes",
    site: {
      origin: "https://shop.example",
      hostname: "shop.example",
      locale: "en-US",
      adapterId: "generic",
      adapterVersion: 1
    },
    context: {
      surface: "PRODUCT_LIST",
      category: "Running shoes",
      searchQuery: "trail",
      routeClass: "/search",
      compatibilityFingerprint: "example"
    },
    criteria: [{
      criterionId: "brand",
      role: "FILTER",
      semanticType: "BRAND",
      desiredValue: ["nike"],
      observedRepresentation: ["Nike"],
      dependencies: [],
      bindings: [{
        bindingId: "brand-query",
        type: "URL_QUERY",
        parameter: "brand",
        encoding: "SINGLE",
        values: ["nike"],
        applicability: {}
      }]
    }],
    metadata: {
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      captureUrl: "https://shop.example/search?brand=nike",
      routeSnapshot: "https://shop.example/search?brand=nike",
      supportLevel: "COMPATIBLE",
      unsupported: [],
      coverage: {
        activeDetected: 1,
        captured: 1,
        meaningfulCaptured: 1,
        unsupported: 0,
        unresolved: 0,
        defaultsIgnored: 0,
        saveEligible: true,
        saveReason: null,
        supportLevel: "COMPATIBLE"
      },
      lastReplayAt: null,
      lastSuccessfulReplayAt: null,
      health: "UNKNOWN"
    }
  };
}

test("valid state and export are accepted", () => {
  const state = validState();
  assert.equal(validateSavedState(state), state);
  const payload = { schemaVersion: 4, states: [state] };
  assert.equal(validateImportPayload(JSON.stringify(payload)).states.length, 1);
});

test("future schema versions are rejected", () => {
  const state = validState();
  state.schemaVersion = 5;
  assert.throws(() => validateSavedState(state), /Unsupported schema version/);
});

test("version 3 states migrate without inventing criteria", () => {
  const legacy = validState();
  legacy.schemaVersion = 3;
  delete legacy.metadata.coverage;
  delete legacy.metadata.routeSnapshot;
  const migrated = migrateSavedState(legacy);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.criteria.length, legacy.criteria.length);
  assert.equal(migrated.metadata.coverage.saveEligible, true);
  assert.equal(migrated.metadata.health, "UNKNOWN");
  assert.equal(validateSavedState(migrated), migrated);
});

test("version 3 exports migrate on import", () => {
  const legacy = validState();
  legacy.schemaVersion = 3;
  delete legacy.metadata.coverage;
  const imported = validateImportPayload({ schemaVersion: 3, states: [legacy] });
  assert.equal(imported.schemaVersion, 4);
  assert.equal(imported.states[0].schemaVersion, 4);
});

test("cross-origin binding modifications are rejected", () => {
  const state = validState();
  state.criteria[0].bindings[0].origin = "https://evil.example";
  assert.throws(() => validateSavedState(state), /Binding origin mismatch/);
});

test("executable import strings and unknown actions are rejected", () => {
  const state = validState();
  state.criteria[0].bindings = [{
    bindingId: "dom-1",
    type: "DOM",
    origin: "https://shop.example",
    mapping: {
      controlType: "BOOLEAN",
      filterContainer: { locatorChain: [{ type: "GROUP_ARIA_LABEL", value: "Brand" }] },
      option: { locatorChain: [{ type: "ARIA_LABEL", value: "Nike" }] },
      interactionPlan: [{ action: "RUN_SCRIPT", source: "eval(alert(1))" }]
    }
  }];
  assert.throws(() => validateSavedState(state), /Unknown interaction action/);
});

test("javascript URL values are rejected", () => {
  const state = validState();
  state.criteria[0].bindings[0].values = ["javascript:alert(1)"];
  assert.throws(() => validateSavedState(state), /Invalid query value/);
});

test("semantic evidence flags must be boolean", () => {
  const state = validState();
  state.criteria[0].bindings[0].semanticEvidence = "yes";
  assert.throws(() => validateSavedState(state), /Invalid semantic evidence flag/);
});

test("declarative Idealo path and adapter locators are accepted", () => {
  const state = validState();
  state.criteria[0].bindings = [
    {
      bindingId: "idealo-path",
      type: "URL_PATH",
      pathname: "/preisvergleich/ProductCategory/19116F123.html",
      verificationTexts: ["Samsung"]
    },
    {
      bindingId: "idealo-dom",
      type: "DOM",
      origin: "https://shop.example",
      mapping: {
        controlType: "BOOLEAN",
        filterContainer: { locatorChain: [{ type: "IDEALO_FILTER_GROUP", value: "Hersteller" }] },
        option: { locatorChain: [{ type: "IDEALO_OPTION", value: "Samsung" }] },
        interactionPlan: [{ action: "ACTIVATE_IF_NEEDED" }, { action: "VERIFY" }]
      }
    }
  ];
  assert.equal(validateSavedState(state), state);
});
