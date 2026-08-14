import test from "node:test";
import assert from "node:assert/strict";
import { buildReplayUrl, captureRouteCriteria, cleanCaptureUrl, routeBindingMatches } from "../src/shared/route.js";

const volatileKeys = ["utm_source", "utm_campaign", "gclid", "fbclid", "session", "token", "qid", "page", "cursor", "mystery"];

test("route sanitation is idempotent and never retains volatile metadata", () => {
  for (let index = 0; index < 100; index += 1) {
    const url = new URL("https://shop.example/search");
    url.searchParams.append("brand", `brand-${index % 7}`);
    url.searchParams.append("color", `color-${index % 5}`);
    url.searchParams.append("sort", index % 2 ? "price_asc" : "relevance");
    for (const key of volatileKeys) url.searchParams.append(key, `secret-${index}`);

    const once = cleanCaptureUrl(url, { includePresentation: true });
    const twice = cleanCaptureUrl(once, { includePresentation: true });
    assert.equal(twice, once);
    for (const key of volatileKeys) assert.equal(new URL(once).searchParams.has(key), false, key);
  }
});

test("capture to replay is a stable round trip for repeated values", () => {
  const original = "https://shop.example/search?brand=nike&brand=adidas&color=black&sort=price_asc&page=99&utm_source=private";
  const criteria = captureRouteCriteria(original, { includePresentation: true });
  const replay = buildReplayUrl(original, criteria);
  const recaptured = captureRouteCriteria(replay, { includePresentation: true });

  assert.deepEqual(
    recaptured.map(({ role, semanticType, desiredValue }) => ({ role, semanticType, desiredValue })),
    criteria.map(({ role, semanticType, desiredValue }) => ({ role, semanticType, desiredValue }))
  );
  for (const criterion of criteria) {
    for (const binding of criterion.bindings) assert.equal(routeBindingMatches(replay, binding), true);
  }
});

test("path bindings cannot change origin or protocol", () => {
  const criteria = [{ bindings: [{ type: "URL_PATH", pathname: "/safe/results" }] }];
  const replay = new URL(buildReplayUrl("https://shop.example/search?brand=nike", criteria));
  assert.equal(replay.origin, "https://shop.example");
  assert.equal(replay.pathname, "/safe/results");
});

test("host-specific meanings do not leak between retailers", () => {
  const amazon = captureRouteCriteria("https://www.amazon.de/s?s=price-asc-rank&shop=merchant", { includePresentation: true });
  const home24 = captureRouteCriteria("https://www.home24.de/sofa/?s=price-asc-rank&shop=home24", { includePresentation: true });
  assert.equal(amazon.some((criterion) => criterion.semanticType === "SORT"), true);
  assert.equal(amazon.some((criterion) => criterion.semanticType === "SELLER"), false);
  assert.equal(home24.some((criterion) => criterion.semanticType === "SORT"), false);
  assert.equal(home24.some((criterion) => criterion.semanticType === "SELLER"), true);
});
