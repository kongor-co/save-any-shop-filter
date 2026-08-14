import test from "node:test";
import assert from "node:assert/strict";
import { calculateReplayBudget, topologicalSort } from "../src/shared/planner.js";

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

test("replay budgets scale with plans and remain bounded", () => {
  const simple = [{ criterionId: "brand", dependencies: [], bindings: [] }];
  const committed = [{
    criterionId: "brand",
    dependencies: [],
    bindings: [{ mapping: { interactionPlan: [{ action: "OPEN_FILTER_GROUP" }, { action: "ACTIVATE_OPTION" }, { action: "COMMIT" }] } }]
  }];
  assert.equal(calculateReplayBudget(simple), 30_000);
  assert.ok(calculateReplayBudget(committed) > calculateReplayBudget(simple));
  assert.equal(calculateReplayBudget(Array.from({ length: 100 }, (_, index) => ({ criterionId: String(index), bindings: [] }))), 90_000);
});
