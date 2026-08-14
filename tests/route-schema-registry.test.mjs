import test from "node:test";
import assert from "node:assert/strict";
import { ROUTE_SCHEMA_IDS, findRouteSchema, schemaPathCriteria } from "../src/adapters/route-schemas.js";
import { captureRouteCriteria, getRouteSchemaInfo, mergeCriteria } from "../src/shared/route.js";

test("route schema ids are unique and cover the approved storefront set", () => {
  assert.equal(new Set(ROUTE_SCHEMA_IDS).size, ROUTE_SCHEMA_IDS.length);
  assert.deepEqual([...ROUTE_SCHEMA_IDS].sort(), [
    "amazon-de", "autohero-de", "cyberport-de", "decathlon-de", "home24-de", "idealo-de",
    "kleinanzeigen-de", "mediamarkt-de", "otto-de", "rebuy-de", "shop-apotheke-de", "zalando-de"
  ]);
});

test("www, bare, and localized storefront hosts resolve intentionally", () => {
  assert.equal(getRouteSchemaInfo("https://amazon.de/s?k=x").id, "amazon-de");
  assert.equal(getRouteSchemaInfo("https://www.amazon.de/s?k=x").id, "amazon-de");
  assert.equal(getRouteSchemaInfo("https://en.zalando.de/men-home/").id, "zalando-de");
  assert.equal(getRouteSchemaInfo("https://unknown.example/").id, "generic");
});

test("Autohero indexed brand parameters coalesce without losing physical bindings", () => {
  const criteria = captureRouteCriteria("https://www.autohero.com/de/search/?brand0=bmw&brand1=audi", { includePresentation: true });
  const brand = criteria.find((criterion) => criterion.semanticType === "BRAND");
  assert.deepEqual(brand.desiredValue, ["bmw", "audi"]);
  assert.deepEqual(brand.bindings.map((binding) => binding.parameter), ["brand0", "brand1"]);
});

test("unknown Kleinanzeigen path facets are decoded conservatively", () => {
  const url = new URL("https://www.kleinanzeigen.de/s-test/k0+items.special_feature_s:water-proof");
  const criteria = schemaPathCriteria(findRouteSchema(url), url);
  assert.equal(criteria[0].semanticType, "SPECIAL_FEATURE");
  assert.deepEqual(criteria[0].desiredValue, ["water proof"]);
});

test("Idealo path summary is removed when DOM-backed tags cover the pathname", () => {
  const url = "https://www.idealo.de/preisvergleich/ProductCategory/19116F123-456.html";
  const route = captureRouteCriteria(url, { includePresentation: true });
  assert.equal(route.some((criterion) => criterion.pathSummary), true);
  const dom = [{
    criterionId: "dom-brand",
    role: "FILTER",
    semanticType: "BRAND",
    desiredValue: ["Samsung"],
    observedRepresentation: ["Samsung"],
    dependencies: [],
    bindings: [
      { bindingId: "brand-path", type: "URL_PATH", pathname: new URL(url).pathname, verificationTexts: ["Samsung"] },
      { bindingId: "brand-dom", type: "DOM" }
    ]
  }];
  const merged = mergeCriteria(route, dom);
  assert.equal(merged.some((criterion) => criterion.pathSummary), false);
  assert.equal(merged.some((criterion) => criterion.semanticType === "BRAND"), true);
});
