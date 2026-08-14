import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildReplayUrl,
  captureRouteCriteria,
  cleanCaptureUrl,
  getRouteSchemaInfo,
  routeBindingMatches
} from "../src/shared/route.js";
import { calculateCoverage } from "../src/shared/coverage.js";

const cases = JSON.parse(await readFile(new URL("./fixtures/live-route-cases.json", import.meta.url), "utf8"));

for (const routeCase of cases) {
  test(`${routeCase.shop}: captures, sanitizes, and rebuilds tested route state`, () => {
    const criteria = captureRouteCriteria(routeCase.url, { includePresentation: true });
    assert.equal(getRouteSchemaInfo(routeCase.url).id, routeCase.schema);

    for (const [semanticType, values] of Object.entries(routeCase.expected)) {
      const criterion = criteria.find((item) => item.semanticType === semanticType);
      assert.ok(criterion, `${routeCase.shop} should capture ${semanticType}`);
      assert.deepEqual([...criterion.desiredValue].sort(), [...values].sort());
    }

    const cleaned = cleanCaptureUrl(routeCase.url, { includePresentation: true });
    for (const parameter of routeCase.removed || []) assert.equal(new URL(cleaned).searchParams.has(parameter), false, parameter);
    const replay = buildReplayUrl(cleaned, criteria);
    for (const criterion of criteria) {
      for (const binding of criterion.bindings) assert.equal(routeBindingMatches(replay, binding), true, binding.bindingId);
    }

    const coverage = calculateCoverage({ criteria, adapterId: routeCase.schema });
    assert.equal(coverage.saveEligible, true);
    assert.notEqual(coverage.supportLevel, "UNSUPPORTED");
  });
}

test("ambiguous short parameters remain ignored on unknown hosts", () => {
  const criteria = captureRouteCriteria("https://unknown.example/products?s=secret&dir=asc&shop=merchant", { includePresentation: true });
  assert.deepEqual(criteria, []);
});

test("context-only routes are not save-eligible", () => {
  const criteria = captureRouteCriteria("https://www.amazon.de/s?k=running+shoes", { includePresentation: true });
  const coverage = calculateCoverage({ criteria, adapterId: "amazon-de" });
  assert.equal(coverage.saveEligible, false);
  assert.match(coverage.saveReason, /Only search or page context/);
});
