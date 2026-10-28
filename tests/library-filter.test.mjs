import test from "node:test";
import assert from "node:assert/strict";
import { filterLibrary, shopHostname } from "../src/popup/library.js";

const saved = (name, origin, context = {}) => ({ name, site: { origin, hostname: new URL(origin).hostname }, context });
const library = [
  saved("Trail shoes", "https://www.decathlon.de", { category: "Running" }),
  saved("Training shirts", "http://decathlon.de", { searchQuery: "Fitness" }),
  saved("Kitchen", "https://www.otto.de"),
  saved("Separate storefront", "https://outlet.decathlon.de"),
  saved("Similar name", "https://decathlon.de.example.com")
];

test("current shop is the default across categories, protocols and www aliases", () => {
  const before = structuredClone(library);
  assert.deepEqual(filterLibrary(library, { activeUrl: "https://decathlon.de/new-category/" }), library.slice(0, 2));
  assert.equal(shopHostname("https://WWW.DECATHLON.DE./"), "decathlon.de");
  assert.deepEqual(library, before, "Filtering must not mutate or remove stored configurations");
});

test("shop filtering uses whole hostnames and keeps distinct subdomains and country stores apart", () => {
  for (const activeUrl of ["https://outlet.decathlon.de/", "https://decathlon.de.example.com/"]) {
    const expected = library.filter((item) => item.site.origin === new URL(activeUrl).origin);
    assert.deepEqual(filterLibrary(library, { activeUrl }), expected);
  }
  assert.deepEqual(filterLibrary(library, { activeUrl: "https://decathlon.fr/" }), []);
});

test("search intersects the selected shop scope while all shops preserves global search", () => {
  assert.deepEqual(filterLibrary(library, { activeUrl: "https://decathlon.de", query: "  RUNNING  " }), [library[0]]);
  assert.deepEqual(filterLibrary(library, { activeUrl: "https://decathlon.de", query: "fitness" }), [library[1]]);
  assert.deepEqual(filterLibrary(library, { activeUrl: "https://decathlon.de", query: "Kitchen" }), []);
  assert.deepEqual(filterLibrary(library, { activeUrl: "https://decathlon.de", scope: "all", query: "Kitchen" }), [library[2]]);
  assert.deepEqual(filterLibrary(library, { activeUrl: "https://decathlon.de", scope: "all" }), library);
});

test("unavailable or restricted pages fall back to the full library", () => {
  for (const activeUrl of [undefined, null, "", "bad URL", "chrome://extensions", "file:///shop.html", "chrome-extension://test/popup.html", "about:blank", "javascript:alert(1)"]) {
    assert.equal(shopHostname(activeUrl), null);
    assert.deepEqual(filterLibrary(library, { activeUrl }), library);
    assert.deepEqual(filterLibrary(library, { activeUrl, query: "Kitchen" }), [library[2]]);
  }
  assert.deepEqual(filterLibrary([], { activeUrl: "https://decathlon.de" }), []);
});
