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
