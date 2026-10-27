import test from "node:test";
import assert from "node:assert/strict";
import { REPLAY_STATUS } from "../src/shared/constants.js";
import { buildRuntimeContext, routeClassForUrl, surfaceForPageType, classifyContextCompatibility, bindingApplies, selectApplicableCriteria, deriveMappingHealth, recoveryDecision } from "../src/shared/replay-policy.js";

const base = () => buildRuntimeContext({ url: "https://shop.example/search", pageType: "SEARCH", category: "Shoes", searchQuery: "trail", locale: "en_US" });

test("runtime contexts normalize identity without volatile page hashes", () => {
  assert.equal(routeClassForUrl("https://shop.example/category/123/"), "/category/:id");
  assert.equal(routeClassForUrl("https://shop.example/"), "/");
  assert.equal(surfaceForPageType("LISTING"), "PRODUCT_LIST");
  assert.equal(surfaceForPageType("OTHER"), "UNSUPPORTED");
  assert.equal(base().locale, "en-us");
  const minimal = buildRuntimeContext({ url: "https://shop.example/", pageType: "LISTING", viewport: "compact" });
  assert.equal(minimal.locale, "und");
  assert.equal(minimal.category, null);
  assert.equal(minimal.viewport, "compact");
});

test("context compatibility requires identity and exposes uncertainty", () => {
  assert.equal(classifyContextCompatibility(base(), base()).level, "EXACT");
  for (const incomplete of [null, {}, { origin: base().origin }]) {
    assert.equal(classifyContextCompatibility(base(), incomplete).level, "INCOMPATIBLE");
    assert.equal(classifyContextCompatibility(incomplete, base()).level, "INCOMPATIBLE");
  }
  for (const change of [{origin:"https://other.example"}, {surface:"PRODUCT_LIST"}, {searchQuery:"boots"}]) {
    assert.equal(classifyContextCompatibility(base(), {...base(), ...change}).level, "INCOMPATIBLE");
  }
  for (const change of [{searchQuery:null}, {routeClass:"/new"}, {category:"Hats"}, {category:null}, {locale:"de"}, {locale:"und"}]) {
    assert.equal(classifyContextCompatibility(base(), {...base(), ...change}).level, "UNCERTAIN");
  }
  assert.equal(classifyContextCompatibility({...base(), compatibilityFingerprint:null}, {...base(), category:"Running shoes"}).level, "COMPATIBLE");
  assert.equal(classifyContextCompatibility({...base(), category:"Running shoes", locale:"und"}, {...base(), category:"Shoes"}).level, "EXACT");
  assert.equal(classifyContextCompatibility({...base(), category:null, searchQuery:null}, base()).level, "EXACT");
});

test("bindings fail closed when applicability evidence is missing", () => {
  assert.equal(bindingApplies(null), true);
  assert.equal(bindingApplies({applicability:"invalid"}), true);
  const context = {...base(), viewport:"desktop", adapterVersion:2};
  for (const key of ["viewport", "locale", "surface", "routeClass", "adapterVersion"]) {
    const binding = {applicability:{[key]:context[key]}};
    assert.equal(bindingApplies(binding, context), true);
    assert.equal(bindingApplies(binding, {}), false);
    assert.equal(bindingApplies(binding, {...context, [key]:key === "adapterVersion" ? 1 : "different"}), false);
  }
  assert.equal(bindingApplies({applicability:{locale:"en"}}, {locale:"und"}), false);
  const selected = selectApplicableCriteria([{criterionId:"brand", bindings:[{applicability:{viewport:"compact"}}]}, {criterionId:"empty"}], context);
  assert.equal(selected[0].applicabilityUnavailable, true);
  assert.equal(selected[1].applicabilityUnavailable, false);
});

test("health reflects verification strength without blaming unavailable inventory", () => {
  for (const results of [null, [], [{}], [{status:"VALUE_UNAVAILABLE"}], [{status:"NOT_ATTEMPTED"}]]) {
    assert.equal(deriveMappingHealth(results), "UNKNOWN");
    assert.equal(deriveMappingHealth(results, "BROKEN"), "BROKEN");
  }
  for (const status of ["ROUTE_ONLY", "VERIFY_FAILED", "RESOLUTION_INCONCLUSIVE", "FILTER_UNAVAILABLE", "UNSUPPORTED_INTERACTION"]) {
    assert.equal(deriveMappingHealth([{status}]), "DEGRADED");
  }
  assert.equal(deriveMappingHealth([{status:"MAPPING_BROKEN"}, {status:"VERIFIED"}]), "BROKEN");
  for (const status of ["VERIFIED", "APPLIED", "ALREADY_APPLIED"]) assert.equal(deriveMappingHealth([{status}]), "HEALTHY");
});

test("worker recovery reconnects running documents and rejects old checkpoints", () => {
  assert.equal(recoveryDecision(null), "IGNORE");
  assert.equal(recoveryDecision({cancelRequested:true}), "IGNORE");
  for (const status of Object.values(REPLAY_STATUS)) {
    const expected = ["PLANNING", "WAITING_NAVIGATION"].includes(status) ? "RESUME"
      : status === "PREFLIGHT" ? "PREFLIGHT"
      : ["APPLYING", "VERIFYING"].includes(status) ? "RECONNECT" : "IGNORE";
    assert.equal(recoveryDecision({checkpointVersion:3, status}), expected);
  }
  assert.equal(recoveryDecision({checkpointVersion:2, status:"APPLYING"}), "INTERRUPT");
  assert.equal(recoveryDecision({checkpointVersion:3, status:"UNKNOWN"}), "INTERRUPT");
});
