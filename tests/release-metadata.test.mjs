import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const liveCases = JSON.parse(await readFile(new URL("./fixtures/live-route-cases.json", import.meta.url), "utf8"));

test("manifest and package release versions stay aligned", () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.version, manifest.version);
});

test("release scripts expose deterministic, security, integration, coverage, and browser gates", () => {
  for (const name of ["test:unit", "test:security", "test:integration", "test:coverage", "smoke:browser", "test:release"]) {
    assert.equal(typeof packageJson.scripts[name], "string", `Missing ${name}`);
  }
  assert.match(packageJson.scripts["test:release"], /test:coverage/);
  assert.match(packageJson.scripts["test:release"], /smoke:browser/);
});

test("the cross-shop regression fixture retains all twelve storefronts", () => {
  assert.equal(liveCases.length, 12);
  assert.equal(new Set(liveCases.map((item) => item.shop)).size, 12);
});
