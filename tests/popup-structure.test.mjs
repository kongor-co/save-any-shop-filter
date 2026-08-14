import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const script = await readFile(new URL("../src/popup/popup.js", import.meta.url), "utf8");
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

test("all popup ids are unique", () => {
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(all).size, all.length);
});

test("every statically referenced popup id exists", () => {
  const referenced = [...script.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
  for (const id of referenced) assert.equal(ids.has(id), true, `Missing #${id}`);
});

test("dialogs have accessible names and matching labels", () => {
  for (const match of html.matchAll(/<dialog\b([^>]*)>/g)) {
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(match[1])?.[1];
    assert.ok(labelledBy, "Every dialog must use aria-labelledby");
    assert.equal(ids.has(labelledBy), true, `Missing dialog label #${labelledBy}`);
  }
  for (const label of html.matchAll(/<label\b[^>]*for="([^"]+)"/g)) assert.equal(ids.has(label[1]), true, `Missing labelled control #${label[1]}`);
});

test("buttons declare their type to avoid accidental submission", () => {
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)];
  assert.ok(buttons.length > 0);
  for (const button of buttons) assert.match(button[1], /\btype="button"/);
});

test("live regions cover progress and user feedback", () => {
  assert.match(html, /id="coverage-summary"[^>]+aria-live="polite"/);
  assert.match(html, /id="toast"[^>]+role="status"[^>]+aria-live="polite"/);
});
