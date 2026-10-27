import test from "node:test";
import assert from "node:assert/strict";
import { ROUTE_SCHEMA_IDS, findRouteSchema, schemaPathCriteria } from "../src/adapters/route-schemas.js";
import { buildReplayUrl, cleanCaptureUrl, captureRouteCriteria, getRouteSchemaInfo, getRouteCaptureHints, mergeCriteria } from "../src/shared/route.js";

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

test("Decathlon path filters and modern query state are decoded semantically", () => {
  const url = "https://www.decathlon.de/herren/t-shirts-hemden/f-zustand_neu/f-partner_decathlon/f-sg_37-l-19_37-m?price=from_0_to_51&Ns=priceAscending";
  const criteria = captureRouteCriteria(url, { includePresentation: true });
  const byType = Object.fromEntries(criteria.map((criterion) => [criterion.semanticType, criterion]));

  assert.deepEqual(byType.CONDITION.desiredValue, ["Neu"]);
  assert.deepEqual(byType.SELLER.desiredValue, ["Decathlon"]);
  assert.deepEqual(byType.SIZE.desiredValue, ["L", "M"]);
  assert.deepEqual(byType.PRICE_RANGE.observedRepresentation, ["0 € – 51 €"]);
  assert.deepEqual(byType.PRICE_RANGE.bindings[0].verificationTexts, ["0 €", "51 €"]);
  assert.deepEqual(byType.SORT.observedRepresentation, ["Preis aufsteigend"]);
  assert.equal(getRouteSchemaInfo(url).version, 2);
});

test("Decathlon default sorting is not invented when Ns is absent", () => {
  const url = "https://www.decathlon.de/herren/t-shirts-hemden/f-zustand_neu?price=from_0_to_51";
  const criteria = captureRouteCriteria(url, { includePresentation: true });
  assert.equal(criteria.some((criterion) => criterion.semanticType === "SORT"), false);
});

test("MediaMarkt seller and refurbished selections survive sanitation and replay", () => {
  const url=new URL("https://www.mediamarkt.de/de/category/nintendo-switch-2-konsolen-6238.html");
  url.searchParams.set("marketplace","MediaMarkt");
  url.searchParams.set("refurbished_new_array","Nein");
  url.searchParams.set("queryMeta[queryHash]","secret");
  const criteria=captureRouteCriteria(url);
  assert.deepEqual(criteria.map((item) => [item.semanticType,item.desiredValue]),[["SELLER",["MediaMarkt"]],["REFURBISHED",["Nein"]]]);
  const clean=new URL(cleanCaptureUrl(url));
  assert.equal(clean.searchParams.has("queryMeta[queryHash]"),false);
  assert.equal(clean.searchParams.get("marketplace"),"MediaMarkt");
  assert.equal(clean.searchParams.get("refurbished_new_array"),"Nein");
  assert.equal(buildReplayUrl(clean,criteria),clean.toString());
  assert.equal(getRouteSchemaInfo(url).version,2);
  assert.deepEqual(getRouteCaptureHints(url),[{labels:["Verkäufer"],semanticType:"SELLER"},{labels:["Refurbished"],semanticType:"REFURBISHED"}]);
  url.hostname="unknown.example";
  assert.equal(captureRouteCriteria(url).length,0,"Retailer parameters must not leak into unknown shops");
  assert.deepEqual(getRouteCaptureHints(url),[]);
  assert.deepEqual(getRouteCaptureHints("https://www.amazon.de/s"),[]);
});

test("MediaMarkt retains its search aliases and sorting contract", () => {
  const url=new URL("https://www.mediamarkt.de/de/category/laptops-notebooks-362.html");
  url.searchParams.set("query","laptop");
  url.searchParams.set("queryInitial","laptop");
  url.searchParams.set("sort","currentprice asc");
  assert.deepEqual(captureRouteCriteria(url,{includePresentation:true}).map((item) => [item.semanticType,item.desiredValue]),[["SEARCH_QUERY",["laptop"]],["SORT",["currentprice asc"]]]);
});
