import { readFile, mkdir, cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeIdentity, runAcceptanceScenario, acceptanceExitCode } from "./lib/live-acceptance.mjs";
import { loadAcceptanceInputs, validateAcceptanceRecord } from "./lib/support-evidence.mjs";

const root = resolve(import.meta.dirname,"..");
const args = process.argv.slice(2);
let shop = "all";
let record = false;
for (let index=0; index<args.length; index+=1) {
  if (args[index] === "--record") record=true;
  else if (args[index] === "--shop") shop=args[++index];
  else throw new Error(`Unknown argument: ${args[index]}`);
}
const inputs = await loadAcceptanceInputs(root);
const scenarios = inputs.scenarios.filter((item) => shop === "all" || item.schemaId === shop);
if (!scenarios.length) throw new Error("Choose all, idealo-de, decathlon-de, mediamarkt-de, cyberport-de, or shop-apotheke-de with --shop");
const checkedAt = new Date().toISOString();
const runId = checkedAt.replace(/[:.]/g,"-");
const output = resolve(root,".live-acceptance",runId);
await mkdir(output,{recursive:true});
const extensionDir = resolve(output,"extension");
await mkdir(extensionDir);
await cp(resolve(root,"src"),resolve(extensionDir,"src"),{recursive:true});
const manifest = JSON.parse(await readFile(resolve(root,"manifest.json"),"utf8"));
const origins = [...new Set(scenarios.map((item) => new URL(item.filteredUrl).origin))];
manifest.host_permissions=origins.map((origin) => `${origin}/*`);
await writeFile(resolve(extensionDir,"manifest.json"),JSON.stringify(manifest,null,2));
const report = {formatVersion:1,environment:"live",checkedAt,runId,source:await runtimeIdentity(root),permissionMode:"isolated-test-origins",testOrigins:origins,browserVersion:null,cases:[]};
const playwrightSpecifier = process.env.FILTERVAULT_PLAYWRIGHT_MODULE || "playwright";
const playwrightUrl = /^(?:file|https?):/i.test(playwrightSpecifier) ? playwrightSpecifier : pathToFileURL(playwrightSpecifier).href;
const {chromium} = await import(playwrightUrl).catch(async () => import("playwright"));
let context;
try {
  context = await chromium.launchPersistentContext(resolve(output,"profile"),{
    channel:"chromium",headless:true,
    args:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,"--disable-crash-reporter","--disable-features=Crashpad"]
  });
  report.browserVersion=context.browser()?.version() || "unavailable";
  let [worker] = context.serviceWorkers();
  if (!worker) worker=await context.waitForEvent("serviceworker",{timeout:15_000});
  const extensionId = new URL(worker.url()).hostname;
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const call = (type,payload={}) => ui.evaluate(async ({type,payload}) => {
    const response = await chrome.runtime.sendMessage({type,...payload});
    if (!response?.ok) throw new Error(response?.error || "EXTENSION_CALL_FAILED");
    return response.data;
  },{type,payload});
  for (const scenario of scenarios) {
    console.log(`${scenario.schemaId}: starting live acceptance`);
    const [page,tab] = await Promise.all([
      context.waitForEvent("page"),
      ui.evaluate(async (url) => chrome.tabs.create({url,active:false}),scenario.resetUrl)
    ]);
    const tabId = tab.id;
    if (!Number.isInteger(tabId)) throw new Error("LIVE_TAB_NOT_FOUND");
    const schemaVersion = inputs.catalog.find((item) => item.id === scenario.schemaId).version;
    const result = await runAcceptanceScenario({page,call,tabId,scenario,schemaVersion,onStage:(stage) => console.log(`${scenario.schemaId}: ${stage.toLowerCase()}`)});
    report.cases.push(result);
    await page.screenshot({path:resolve(output,`${scenario.schemaId}.png`),timeout:5000}).catch(() => undefined);
    console.log(`${scenario.schemaId}: ${result.status} (${result.reason})`);
    await page.close();
  }
} catch (error) {
  report.harnessError = String(error.message || error).slice(0,500);
  console.error(`Live harness failed: ${report.harnessError}`);
  process.exitCode=1;
} finally {
  await context?.close();
  await writeFile(resolve(output,"report.json"),`${JSON.stringify(report,null,2)}\n`);
  const summary = ["# Live acceptance run","",`Run: ${checkedAt}`,`Runtime: ${report.source.runtimeSha256}`,"","Isolated test origins were granted in a temporary extension copy. Production permissions were not changed. Consent and bot challenges were not bypassed.","","| Scenario | Result | Stage | Reason |","|---|---|---|---|",...report.cases.map((item) => `| ${item.scenarioId} | ${item.status} | ${item.stage} | ${item.reason.replaceAll("|","/").replace(/[\r\n]/g," ")} |`),"",report.harnessError ? `Harness error: ${report.harnessError}` : "Pass requires capture, persisted Save, a demonstrated filter reset, and visible verification after replay.",""];
  await writeFile(resolve(output,"report.md"),summary.join("\n"));
  console.log(`Acceptance report: ${resolve(output,"report.json")}`);
}
if (!report.harnessError) {
  validateAcceptanceRecord(report,inputs.scenarios);
  if (record) {
    const directory = resolve(root,"docs/acceptance/records");
    await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,`${runId}.json`),`${JSON.stringify(report,null,2)}\n`);
    console.log("Recorded acceptance evidence. Run npm run support:update to regenerate the matrix.");
  }
  process.exitCode=acceptanceExitCode(report.cases);
}
