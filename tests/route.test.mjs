import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReplayUrl,
  captureRouteCriteria,
  classifyRouteParameter,
  cleanCaptureUrl,
  mergeCriteria,
  routeBindingMatches
} from "../src/shared/route.js";

test("route classification excludes pagination and tracking", () => {
  assert.equal(classifyRouteParameter("brand"), "FILTER");
  assert.equal(classifyRouteParameter("q"), "CONTEXT");
  assert.equal(classifyRouteParameter("sort"), "PRESENTATION");
  assert.equal(classifyRouteParameter("page"), "PAGINATION");
  assert.equal(classifyRouteParameter("utm_source"), "EPHEMERAL");
});

test("capture keeps semantic route state and drops presentation by default", () => {
  const criteria = captureRouteCriteria("https://shop.example/search?q=trail&brand=nike&brand=adidas&page=7&sort=price&utm_source=x");
  assert.deepEqual(criteria.map((item) => item.semanticType), ["Q", "BRAND"]);
  assert.deepEqual(criteria[1].desiredValue, ["nike", "adidas"]);
  assert.equal(criteria[1].bindings[0].encoding, "REPEATED");
});

test("capture URL strips ephemeral, pagination, and unknown parameters", () => {
  const cleaned = new URL(cleanCaptureUrl("https://shop.example/search?brand=nike&page=3&utm_campaign=x&mystery=1"));
  assert.equal(cleaned.searchParams.get("brand"), "nike");
  assert.equal(cleaned.searchParams.has("page"), false);
  assert.equal(cleaned.searchParams.has("utm_campaign"), false);
  assert.equal(cleaned.searchParams.has("mystery"), false);
});

test("replay URL restores repeated route bindings without pagination", () => {
  const criteria = captureRouteCriteria("https://shop.example/search?brand=nike&brand=adidas&color=black");
  const replay = buildReplayUrl("https://shop.example/search?page=9&utm_source=x", criteria);
  assert.deepEqual(new URL(replay).searchParams.getAll("brand"), ["nike", "adidas"]);
  assert.equal(new URL(replay).searchParams.get("color"), "black");
  assert.equal(new URL(replay).searchParams.has("page"), false);
  assert.equal(routeBindingMatches(replay, criteria[0].bindings[0]), true);
});

test("route and DOM representations merge only when semantic value agrees", () => {
  const route = captureRouteCriteria("https://shop.example/search?brand=nike");
  const dom = [{
    criterionId: "dom-brand",
    role: "FILTER",
    semanticType: "BRAND",
    desiredValue: ["nike"],
    observedRepresentation: ["Nike"],
    dependencies: [],
    bindings: [{ type: "DOM", bindingId: "dom-binding" }]
  }];
  const merged = mergeCriteria(route, dom);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].bindings.map((binding) => binding.type), ["URL_QUERY", "DOM"]);
});

test("path bindings restore and verify retailer route state", () => {
  const criteria = [{ bindings: [{ type: "URL_PATH", pathname: "/preisvergleich/ProductCategory/19116F123.html" }] }];
  const replay = buildReplayUrl("https://www.idealo.de/preisvergleich/ProductCategory/19116.html?page=4", criteria);
  assert.equal(new URL(replay).pathname, "/preisvergleich/ProductCategory/19116F123.html");
  assert.equal(routeBindingMatches(replay, criteria[0].bindings[0]), true);
});
