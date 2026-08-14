import test from "node:test";
import assert from "node:assert/strict";
import { topologicalSort } from "../src/shared/planner.js";

test("dependency planning is deterministic", () => {
  const criteria = [
    { criterionId: "size", dependencies: ["brand"] },
    { criterionId: "category", dependencies: [] },
    { criterionId: "brand", dependencies: ["category"] }
  ];
  assert.deepEqual(topologicalSort(criteria).map((item) => item.criterionId), ["category", "brand", "size"]);
});

test("dependency cycles are rejected", () => {
  assert.throws(() => topologicalSort([
    { criterionId: "a", dependencies: ["b"] },
    { criterionId: "b", dependencies: ["a"] }
  ]), /DEPENDENCY_CYCLE/);
});

test("unknown dependencies are rejected", () => {
  assert.throws(() => topologicalSort([{ criterionId: "a", dependencies: ["missing"] }]), /Unknown dependency/);
});
