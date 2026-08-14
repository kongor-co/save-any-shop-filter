import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const errors = [];

if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
if (Number(manifest.minimum_chrome_version) < 106) errors.push("minimum_chrome_version must support documentId");
if (manifest.host_permissions?.length) errors.push("Persistent host access must remain optional");
for (const permission of ["activeTab", "scripting", "storage"]) {
  if (!manifest.permissions.includes(permission)) errors.push(`Missing permission: ${permission}`);
}

for (const relative of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  "src/popup/popup.css",
  "src/popup/popup.js",
  "src/content/executor.js"
]) {
  try { await readFile(resolve(root, relative)); } catch { errors.push(`Missing manifest/runtime file: ${relative}`); }
}

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await javascriptFiles(path));
    else if (/\.(?:js|mjs)$/.test(entry.name)) output.push(path);
  }
  return output;
}

for (const file of await javascriptFiles(resolve(root, "src"))) {
  try {
    const source = await readFile(file, "utf8");
    const parseable = source
      .replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, "")
      .replace(/^export\s+/gm, "");
    new vm.Script(parseable, { filename: file });
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Manifest, permissions, runtime files, and JavaScript syntax are valid.");
