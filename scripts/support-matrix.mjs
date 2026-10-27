import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runtimeIdentity } from "./lib/live-acceptance.mjs";
import { loadAcceptanceInputs, loadAcceptanceRecords, renderSupportMatrix } from "./lib/support-evidence.mjs";

const root = resolve(import.meta.dirname,"..");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((item) => item !== "--check")) throw new Error("Only --check is supported");
const inputs = await loadAcceptanceInputs(root);
const records = await loadAcceptanceRecords(root,inputs.scenarios);
const source = await runtimeIdentity(root);
const output = renderSupportMatrix({...inputs,records,source});
const path = resolve(root,"docs/SUPPORT.md");
if (check) {
  const existing = await readFile(path,"utf8").catch(() => "");
  if (existing.replaceAll("\r\n","\n") !== output) {
    console.error("Support matrix is stale. Run npm run support:update and review the evidence.");
    process.exitCode=1;
  } else console.log("Support matrix matches route schemas, scenarios, runtime source, and acceptance records.");
} else {
  await writeFile(path,output);
  console.log("Updated docs/SUPPORT.md from route schemas and acceptance records.");
}
