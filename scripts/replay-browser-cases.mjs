import assert from "node:assert/strict";

const terminal = new Set(["COMPLETE", "COMPLETE_WITH_WARNINGS", "PARTIAL", "FAILED", "CANCELLED", "INTERRUPTED"]);

export async function runReplayBrowserCases({ context, extension, call, port, shop, saved, smokeRoot }) {
  const origin = `http://127.0.0.1:${port}`;
  async function waitReplay(tabId, condition = (item) => terminal.has(item?.status)) {
    const deadline = Date.now() + 15_000;
    let latest;
    while (Date.now() < deadline) {
      latest = await call("GET_ACTIVE_REPLAY", {tabId});
      if (condition(latest)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Replay did not settle: ${JSON.stringify(latest)}`);
  }
  async function tabIdFor(page) {
    return extension.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  }
  async function activate(tabId) {
    await extension.evaluate(async (id) => chrome.tabs.update(id, {active:true}), tabId);
    await extension.reload({waitUntil:"domcontentloaded"});
  }

  const confirmation = structuredClone(saved);
  confirmation.id = "context-confirmation";
  confirmation.name = "Confirm changed category";
  confirmation.context.category = "Winter boots";
  await call("IMPORT_LIBRARY", {payload:{schemaVersion:4,states:[confirmation]}});
  await shop.goto(saved.metadata.routeSnapshot);
  const shopTabId = await tabIdFor(shop);
  await shop.evaluate(() => { document.querySelector("#brand-nike").checked = false; });
  const confirmStarted = await call("START_REPLAY", {stateId:confirmation.id,tabId:shopTabId});
  await waitReplay(shopTabId, (item) => item?.status === "AWAITING_CONFIRMATION");
  assert.equal(await shop.locator("#brand-nike").isChecked(),false,"Uncertain context must not mutate filters");
  await activate(shopTabId);
  await extension.locator("#confirm-replay-context").waitFor({state:"visible"});
  assert.match(await extension.locator("#replay-message").innerText(),/category differs/);
  await extension.screenshot({path:`${smokeRoot}/replay-confirmation.png`,clip:{x:0,y:0,width:430,height:650}});
  await extension.locator("#confirm-replay-context").click();
  const confirmed = await waitReplay(shopTabId);
  assert.equal(confirmed.replayId,confirmStarted.replayId);
  assert.equal(confirmed.status,"PARTIAL");
  await extension.waitForFunction(() => document.querySelector("#replay-spinner").hidden);
  assert.match(await extension.locator("#replay-message").innerText(),/unverified/);
  assert.equal((await call("LIST_STATES")).find((item) => item.id === confirmation.id).metadata.health,"DEGRADED");

  const incompatible = structuredClone(saved);
  incompatible.id = "incompatible-context";
  incompatible.context.searchQuery = "unrelated search";
  await call("IMPORT_LIBRARY", {payload:{schemaVersion:4,states:[incompatible]}});
  await call("START_REPLAY", {stateId:incompatible.id,tabId:shopTabId});
  const failed = await waitReplay(shopTabId);
  assert.equal(failed.status,"FAILED");
  assert.equal(failed.error,"INCOMPATIBLE_CONTEXT");
  const hostile = structuredClone(saved);
  hostile.metadata.routeSnapshot = "https://unauthorized.example/search";
  const beforeUrl = shop.url();
  await assert.rejects(() => call("IMPORT_LIBRARY", {payload:{schemaVersion:4,states:[hostile]}}),/origin mismatch/);
  assert.equal(shop.url(),beforeUrl);

  const page = await context.newPage();
  await page.goto(`${origin}/lifecycle/search`);
  const tabId = await tabIdFor(page);
  const state = {
    schemaVersion:4,id:"lifecycle-plan",name:"Bounded commit plan",
    site:{origin,hostname:"127.0.0.1",locale:"en",adapterId:"generic",adapterVersion:1},
    context:{surface:"SEARCH_RESULTS",category:"Shoes",searchQuery:null,routeClass:"/lifecycle/search",locale:"en"},
    criteria:[{criterionId:"brand",role:"FILTER",semanticType:"BRAND",desiredValue:["Nike"],observedRepresentation:["Nike"],dependencies:[],bindings:[{
      bindingId:"brand-dom",type:"DOM",origin,applicability:{},mapping:{
        mappingVersion:2,controlType:"BOOLEAN",desiredValue:["Nike"],
        filterContainer:{locatorChain:[{type:"FIELDSET_LEGEND",value:"Brand"}]},
        option:{locatorChain:[{type:"ID",value:"brand-nike"}]},
        interactionPlan:[{action:"ACTIVATE_IF_NEEDED",timeoutMs:1000},{action:"WAIT_ROUTE_STABLE",timeoutMs:8000},{action:"COMMIT",timeoutMs:1000,locatorChain:[{type:"ID",value:"apply"}]},{action:"VERIFY",timeoutMs:1000}],
        verificationRule:{type:"OPTION_SELECTED",desiredValue:["Nike"]}
      }
    }]}],
    metadata:{captureUrl:page.url(),routeSnapshot:page.url(),coverage:{saveEligible:true},health:"UNKNOWN"}
  };
  await call("IMPORT_LIBRARY", {payload:{schemaVersion:4,states:[state]}});
  const cancelled = await call("START_REPLAY", {stateId:state.id,tabId});
  await page.waitForFunction(() => document.querySelector("#brand-nike").checked);
  await assert.rejects(() => call("START_REPLAY", {stateId:state.id,tabId}),/REPLAY_ALREADY_ACTIVE/);
  await call("CANCEL_REPLAY", {replayId:cancelled.replayId});
  await page.evaluate(() => window.stopUpdates());
  await new Promise((resolve) => setTimeout(resolve,500));
  assert.equal((await waitReplay(tabId)).status,"CANCELLED");
  assert.equal(await page.evaluate(() => window.commits),0,"Cancellation during a wait must prevent the later commit");
  await extension.reload();
  assert.equal((await call("GET_ACTIVE_REPLAY", {tabId})).status,"CANCELLED","Popup reload must not resume cancelled execution");

  await page.reload();
  const restarted = await call("START_REPLAY", {stateId:state.id,tabId});
  await page.waitForFunction(() => document.querySelector("#brand-nike").checked);
  await waitReplay(tabId,(item) => item?.status === "APPLYING");
  const cdp = await context.newCDPSession(extension);
  const targets = await cdp.send("Target.getTargets");
  const worker = targets.targetInfos.find((item) => item.type === "service_worker" ? item.url.includes("/src/background/service-worker.js") : false);
  assert.ok(worker,"The extension service worker must be available for termination testing");
  await cdp.send("Target.closeTarget", {targetId:worker.targetId});
  await cdp.detach();
  const reconnected = await call("GET_ACTIVE_REPLAY", {tabId});
  assert.equal(reconnected.replayId,restarted.replayId);
  assert.equal(reconnected.status,"APPLYING","Worker restart must reconnect to the active executor");
  await page.evaluate(() => window.stopUpdates());
  const recovered = await waitReplay(tabId);
  assert.equal(recovered.status,"COMPLETE",JSON.stringify(recovered));
  assert.equal(await page.evaluate(() => window.commits),1,"Recovery must preserve exactly one commit");

  await page.reload();
  await call("START_REPLAY", {stateId:state.id,tabId});
  await page.waitForFunction(() => document.querySelector("#brand-nike").checked);
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set("q","user changed search");
    history.pushState({},"",url);
    window.stopUpdates();
  });
  const divergence = await waitReplay(tabId);
  assert.equal(divergence.status,"FAILED",JSON.stringify(divergence));
  assert.equal(divergence.results.some((item) => /CONTEXT_CHANGED_DURING_REPLAY/.test(item.message)),true);
  assert.equal(await page.evaluate(() => window.commits),0);
  const presentation = structuredClone(state);
  presentation.id = "optional-presentation";
  presentation.criteria = [{criterionId:"sort",role:"PRESENTATION",semanticType:"SORT",desiredValue:["price"],dependencies:[],bindings:[{bindingId:"sort-route",type:"URL_QUERY",parameter:"sort",values:["price"]}]}];
  await call("IMPORT_LIBRARY",{payload:{schemaVersion:4,states:[presentation]}});
  await call("START_REPLAY",{stateId:presentation.id,tabId});
  const optionalWarning = await waitReplay(tabId);
  assert.equal(optionalWarning.status,"COMPLETE_WITH_WARNINGS");
  assert.equal(optionalWarning.results[0].status,"ROUTE_ONLY");
  await page.goto(`${origin}/lifecycle/search`);
  await page.evaluate(() => window.stopUpdates());
  const wrongType = structuredClone(state);
  wrongType.id = "changed-control-type";
  const mapping = wrongType.criteria[0].bindings[0].mapping;
  mapping.controlType = "NUMERIC_VALUE";
  mapping.desiredValue = ["50"];
  mapping.verificationRule = {type:"INPUT_VALUE",desiredValue:["50"]};
  await call("IMPORT_LIBRARY",{payload:{schemaVersion:4,states:[wrongType]}});
  await call("START_REPLAY",{stateId:wrongType.id,tabId});
  const mismatch = await waitReplay(tabId);
  assert.equal(mismatch.results[0].status,"UNSUPPORTED_CONTROL");
  assert.equal(await page.locator("#brand-nike").isChecked(),false,"A mismatched control must never be changed or verified");
  const unsafeCommit = structuredClone(state);
  unsafeCommit.id = "unsafe-commit";
  unsafeCommit.criteria[0].bindings[0].mapping.interactionPlan[2].locatorChain = [{type:"ID",value:"purchase"}];
  await call("IMPORT_LIBRARY",{payload:{schemaVersion:4,states:[unsafeCommit]}});
  await call("START_REPLAY",{stateId:unsafeCommit.id,tabId});
  assert.equal((await waitReplay(tabId)).results[0].status,"UNSUPPORTED_INTERACTION");
  assert.equal(await page.evaluate(() => window.purchases),0,"Commit must not activate a purchase control");
  console.log("Replay browser regressions passed: context confirmation, origin rejection, cancellation, worker termination, and user navigation.");
}
