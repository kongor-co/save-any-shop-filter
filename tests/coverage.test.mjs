import test from "node:test";
import assert from "node:assert/strict";
import { calculateCoverage } from "../src/shared/coverage.js";

const criterion = (role, bindings = [{ type: "URL_QUERY" }]) => ({ role, bindings });

test("search context alone cannot enable save", () => {
  const coverage = calculateCoverage({ criteria: [criterion("CONTEXT")] });
  assert.equal(coverage.saveEligible, false);
  assert.equal(coverage.supportLevel, "UNSUPPORTED");
});

test("non-default sort is meaningful state", () => {
  const coverage = calculateCoverage({ criteria: [criterion("CONTEXT"), criterion("PRESENTATION")] });
  assert.equal(coverage.saveEligible, true);
  assert.equal(coverage.meaningfulCaptured, 1);
  assert.equal(coverage.supportLevel, "COMPATIBLE");
});

test("omitted active controls force limited support", () => {
  const coverage = calculateCoverage({
    criteria: [criterion("FILTER", [{ type: "DOM" }])],
    unsupported: [{ label: "Price", reason: "Dual slider" }],
    adapterId: "verified-shop"
  });
  assert.equal(coverage.supportLevel, "LIMITED");
  assert.equal(coverage.unsupported, 1);
});

test("adapter evidence can qualify as verified", () => {
  const coverage = calculateCoverage({
    criteria: [criterion("FILTER", [{ type: "URL_PATH", verificationTexts: ["Samsung"] }])],
    adapterId: "idealo-de"
  });
  assert.equal(coverage.supportLevel, "VERIFIED");
});

test("schema-owned query evidence must be explicitly semantic to qualify as verified", () => {
  const verified = calculateCoverage({
    criteria: [criterion("FILTER", [{ type: "URL_QUERY", verificationTexts: ["0 €", "51 €"], semanticEvidence: true }])],
    adapterId: "decathlon-de"
  });
  const routeOnly = calculateCoverage({
    criteria: [criterion("FILTER", [{ type: "URL_QUERY", verificationTexts: ["raw-value"] }])],
    adapterId: "shop-adapter"
  });
  assert.equal(verified.supportLevel, "VERIFIED");
  assert.equal(routeOnly.supportLevel, "COMPATIBLE");
});

test("verified DOM adapters qualify without route evidence", () => {
  const coverage = calculateCoverage({ criteria: [criterion("FILTER", [{ type: "DOM" }])], adapterId: "shop-adapter" });
  assert.equal(coverage.supportLevel, "VERIFIED");
});

test("unsupported active state without criteria explains the safety boundary", () => {
  const coverage = calculateCoverage({ unsupported: [{ label: "Price", reason: "Slider" }] });
  assert.equal(coverage.saveEligible, false);
  assert.match(coverage.saveReason, /none can be replayed safely/);
});

test("empty pages report that no active state was detected", () => {
  const coverage = calculateCoverage();
  assert.equal(coverage.activeDetected, 0);
  assert.match(coverage.saveReason, /No active filter/);
});
