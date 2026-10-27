import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { checkCapture, resetDifferences, assessReplay, runAcceptanceScenario, acceptanceExitCode, scenarioDigest, runtimeIdentity, detectBlocker } from "../scripts/lib/live-acceptance.mjs";
import { loadAcceptanceInputs, validateAcceptanceRecord, renderSupportMatrix } from "../scripts/lib/support-evidence.mjs";

const root = resolve(import.meta.dirname,"..");
const source = {version:"0.3.0",runtimeSha256:"a".repeat(64)};
const criteria = [{criterionId:"brand",role:"FILTER",semanticType:"BRAND",desiredValue:["Nike"]}];
const scenario = {id:"brand-case",schemaId:"shop",filteredUrl:"https://shop.example/search?brand=nike",resetUrl:"https://shop.example/search",readySelector:"h1",expectedCriteria:[{semanticType:"BRAND",desiredValue:["Nike"]}]};
const replay = () => ({replayId:"replay",status:"COMPLETE",results:[{criterionId:"brand",status:"VERIFIED",evidence:"VISIBLE_STATE"}]});

function passCase() {
  return {scenarioId:scenario.id,scenario,scenarioSha256:scenarioDigest(scenario),schemaId:"shop",schemaVersion:1,status:"PASS",stage:"COMPLETE",reason:"CAPTURE_SAVE_RESET_REPLAY_VERIFIED",savedRoundTrip:true,capturedCriteria:structuredClone(criteria),resetCriteria:[],resetChanged:["brand"],omissions:0,replay:replay()};
}

function record() {
  return {formatVersion:1,environment:"live",checkedAt:"2026-10-27T10:00:00.000Z",permissionMode:"isolated-test-origins",source,cases:[passCase()],path:"acceptance/records/test.json"};
}

test("acceptance scenarios derive retailer routes from the existing contracts", async () => {
  const inputs = await loadAcceptanceInputs(root);
  assert.equal(inputs.catalog.length,12);
  assert.deepEqual(inputs.scenarios.map((item) => item.schemaId),["idealo-de","decathlon-de","mediamarkt-de","cyberport-de"]);
  for (const item of inputs.scenarios) {
    assert.equal(new URL(item.filteredUrl).origin,new URL(item.resetUrl).origin);
    assert.ok(item.expectedCriteria.length>0);
  }
  const identity = await runtimeIdentity(root);
  assert.match(identity.version,/^\d+\.\d+\.\d+$/);
  assert.match(identity.runtimeSha256,/^[a-f0-9]{64}$/);
});

test("capture and reset evidence cannot certify an unchanged or unrelated state", () => {
  checkCapture(criteria,scenario.expectedCriteria);
  checkCapture([{...criteria[0],desiredValue:["Nike","Adidas"]}],[{semanticType:"BRAND",desiredValue:["Adidas","Nike"]}]);
  assert.throws(() => checkCapture([],scenario.expectedCriteria),/NO_CAPTURED/);
  assert.throws(() => checkCapture(criteria,[]),/NO_EXPECTED/);
  assert.throws(() => checkCapture(criteria,[{semanticType:"SIZE",desiredValue:["42"]}]),/EXPECTED_CRITERION/);
  assert.throws(() => checkCapture([{...criteria[0],role:"CONTEXT"}],scenario.expectedCriteria),/EXPECTED_CRITERION/);
  assert.deepEqual(resetDifferences(criteria,criteria),[]);
  assert.deepEqual(resetDifferences(criteria,[]),["brand"]);
  assert.deepEqual(resetDifferences([{...criteria[0],role:"CONTEXT"}],[]),[]);
});

test("route evidence, missing results and omissions cannot become live passes", () => {
  assert.equal(assessReplay(criteria,replay()).status,"PASS");
  const routeOnly = replay();
  routeOnly.results[0].status="ROUTE_ONLY";
  routeOnly.status="PARTIAL";
  assert.equal(assessReplay(criteria,routeOnly).status,"PARTIAL");
  const noEvidence = replay();
  delete noEvidence.results[0].evidence;
  assert.equal(assessReplay(criteria,noEvidence).status,"PARTIAL");
  assert.equal(assessReplay(criteria,replay(),1).status,"PARTIAL");
  assert.equal(assessReplay(criteria,null).status,"FAIL");
  assert.equal(assessReplay(criteria,{status:"COMPLETE",results:[]}).status,"FAIL");
  assert.equal(assessReplay(criteria,{...replay(),results:[...replay().results,...replay().results]}).status,"FAIL");
  assert.equal(assessReplay(criteria,{...replay(),results:[{criterionId:"other",status:"VERIFIED"}]}).status,"FAIL");
  assert.equal(assessReplay(criteria,{...replay(),status:"FAILED"}).status,"FAIL");
  assert.equal(assessReplay(criteria,{...replay(),status:"PARTIAL"}).status,"PARTIAL");
  const optional = [...criteria,{criterionId:"sort",role:"PRESENTATION",semanticType:"SORT",desiredValue:["price"]}];
  const warning = {...replay(),status:"COMPLETE_WITH_WARNINGS",results:[...replay().results,{criterionId:"sort",status:"ROUTE_ONLY"}]};
  assert.equal(assessReplay(optional,warning).status,"PASS");
});

test("records reject fabricated passes and retain old scenario evidence as stale", () => {
  assert.equal(validateAcceptanceRecord(record(),[scenario]).cases[0].status,"PASS");
  for (const change of [
    (r) => {r.environment="fixture";},
    (r) => {r.source={...source,runtimeSha256:"unknown"};},
    (r) => {r.checkedAt="invalid";},
    (r) => {r.cases[0].savedRoundTrip=false;},
    (r) => {r.cases[0].stage="CAPTURE";},
    (r) => {r.cases[0].resetCriteria=structuredClone(criteria);},
    (r) => {r.cases[0].resetChanged=[];},
    (r) => {delete r.cases[0].resetCriteria;},
    (r) => {r.cases[0].replay.results[0].status="ROUTE_ONLY";},
    (r) => {r.cases[0].omissions=1;},
    (r) => {delete r.cases[0].omissions;},
    (r) => {r.cases[0].scenarioSha256="b".repeat(64);},
    (r) => {r.cases.push(structuredClone(r.cases[0]));}
  ]) {
    const invalid=structuredClone(record());
    change(invalid);
    assert.throws(() => validateAcceptanceRecord(invalid,[scenario]));
  }
  const updated = {...scenario,readySelector:"main h1"};
  assert.equal(validateAcceptanceRecord(record(),[updated]).cases[0].status,"PASS");
  const matrix=renderSupportMatrix({catalog:[{id:"shop",version:1}],routes:[{shop:"Shop",schema:"shop"}],scenarios:[updated],records:[record()],source});
  assert.match(matrix,/STALE/);
});

test("support matrix distinguishes current, blocked, missing, and stale evidence", () => {
  const inputs={catalog:[{id:"shop",version:1}],routes:[{shop:"Shop",schema:"shop"}],scenarios:[scenario],records:[],source};
  assert.match(renderSupportMatrix(inputs),/Scenario ready, not run/);
  assert.match(renderSupportMatrix({...inputs,scenarios:[]}),/Not run/);
  assert.match(renderSupportMatrix({...inputs,records:[record()]}),/PASS, 2026-10-27/);
  assert.match(renderSupportMatrix({...inputs,records:[record()],source:{...source,runtimeSha256:"b".repeat(64)}}),/STALE/);
  assert.match(renderSupportMatrix({...inputs,records:[record()],catalog:[{id:"shop",version:2}]}),/STALE/);
  assert.match(renderSupportMatrix({...inputs,records:[record()],source:{...source,version:"0.4.0"}}),/STALE/);
  const blocked=record();
  blocked.checkedAt="2026-10-28T10:00:00.000Z";
  Object.assign(blocked.cases[0],{status:"BLOCKED",reason:"CONSENT_REQUIRED"});
  const rendered=renderSupportMatrix({...inputs,records:[record(),blocked]});
  assert.match(rendered,/BLOCKED, 2026-10-28/);
  assert.doesNotMatch(rendered,/PASS, 2026-10-27/);
  assert.equal(acceptanceExitCode([passCase()]),0);
  assert.equal(acceptanceExitCode([]),1);
  assert.equal(acceptanceExitCode([{status:"FAIL"}]),1);
  assert.equal(acceptanceExitCode([{status:"BLOCKED"}]),2);
  assert.equal(acceptanceExitCode([{status:"PARTIAL"}]),2);
});

function simulatedRun(options = {}) {
  let url="https://shop.example/";
  let captures=0;
  let polls=0;
  const calls=[];
  const page={
    url:() => url,
    goto:async (value) => {
      url=value;
      if (options.networkFailure) throw new Error("net::ERR_CONNECTION_RESET");
      return {status:() => options.httpStatus || 200};
    },
    locator:() => ({first:() => ({waitFor:async () => {}})})
  };
  const call=async (type,payload) => {
    calls.push({type,payload});
    if (type === "GET_CAPTURE_PREVIEW") return {criteria:captures++ === 0 ? structuredClone(criteria) : options.unchangedReset ? structuredClone(criteria) : [],unsupported:[],unresolved:[]};
    if (type === "SAVE_CAPTURE") return {id:"saved"};
    if (type === "LIST_STATES") return options.failedSave ? [] : [{id:"saved",criteria:structuredClone(criteria)}];
    if (type === "START_REPLAY") return {replayId:"replay"};
    if (type === "GET_ACTIVE_REPLAY") {
      polls+=1;
      if (options.transitionalNavigation ? polls === 1 : false) return {...replay(),status:"WAITING_NAVIGATION",results:[]};
      if (options.pollFailure) throw new Error("POLL_FAILED");
      if (options.foreignReplay) return {...replay(),replayId:"foreign",status:"APPLYING"};
      return options.awaiting ? {...replay(),status:"AWAITING_CONFIRMATION"} : options.blockAfterReplay ? {...replay(),status:"APPLYING"} : replay();
    }
    if (["DELETE_STATE","CANCEL_REPLAY"].includes(type)) return true;
    throw new Error(type);
  };
  let blockerCalls=0;
  const blocker=async () => {
    blockerCalls+=1;
    if (options.blocked) return "BOT_CHALLENGE";
    if (options.transitionalNavigation ? polls === 1 : false) return "EMPTY_DOCUMENT";
    if (options.hydrating ? blockerCalls === 1 : false) return "EMPTY_DOCUMENT";
    if (options.blockAfterReplay ? blockerCalls>4 : false) return "CONSENT_REQUIRED";
    return null;
  };
  return {run:() => runAcceptanceScenario({page,call,tabId:1,scenario,schemaVersion:1,blocker}),calls};
}

test("live workflow proves save and reset and cleans up only its own state", async () => {
  const success=simulatedRun();
  const result=await success.run();
  assert.equal(result.status,"PASS");
  assert.equal(result.savedRoundTrip,true);
  assert.deepEqual(result.resetChanged,["brand"]);
  assert.deepEqual(success.calls.at(-1),{type:"DELETE_STATE",payload:{stateId:"saved"}});
  for (const [options,reason] of [[{failedSave:true},"SAVE_ROUND_TRIP_MISMATCH"],[{unchangedReset:true},"RESET_DID_NOT_CHANGE_FILTERS"]]) {
    const attempt=simulatedRun(options);
    const failed=await attempt.run();
    assert.equal(failed.status,"FAIL");
    assert.equal(failed.reason,reason);
    assert.equal(attempt.calls.some((item) => item.type === "START_REPLAY"),false);
    assert.equal(attempt.calls.at(-1).type,"DELETE_STATE");
  }
});

test("live workflow stops for challenges and context review without confirming them", async () => {
  const blocked=simulatedRun({blocked:true});
  assert.equal((await blocked.run()).status,"BLOCKED");
  assert.equal(blocked.calls.length,0);
  for (const options of [{awaiting:true},{blockAfterReplay:true}]) {
    const attempt=simulatedRun(options);
    const result=await attempt.run();
    assert.equal(result.status,"BLOCKED");
    assert.equal(attempt.calls.some((item) => item.type === "CANCEL_REPLAY"),true);
    assert.equal(attempt.calls.some((item) => item.type === "CONFIRM_REPLAY_CONTEXT"),false);
  }
});

test("access denials are blocked, missing routes fail, and hydration may finish", async () => {
  for (const httpStatus of [401,403,429]) {
    const attempt=simulatedRun({httpStatus});
    const result=await attempt.run();
    assert.equal(result.status,"BLOCKED");
    assert.equal(result.reason,`HTTP_${httpStatus}`);
    assert.equal(attempt.calls.length,0);
  }
  assert.equal((await simulatedRun({httpStatus:404}).run()).status,"FAIL");
  assert.equal((await simulatedRun({hydrating:true}).run()).status,"PASS");
  assert.equal((await simulatedRun({networkFailure:true}).run()).status,"BLOCKED");
});

test("polling failures cancel only the replay created by this acceptance run", async () => {
  for (const options of [{pollFailure:true},{foreignReplay:true}]) {
    const attempt=simulatedRun(options);
    assert.equal((await attempt.run()).status,"FAIL");
    assert.deepEqual(attempt.calls.find((item) => item.type === "CANCEL_REPLAY").payload,{replayId:"replay"});
  }
});

test("read-only blocker checks tolerate document replacement without swallowing other failures", async () => {
  const page={url:()=>"https://shop.example/search",evaluate:async()=>{throw new Error("Execution context was destroyed, most likely because of a navigation");}};
  assert.equal(await detectBlocker(page,"https://shop.example"),null);
  assert.equal(await detectBlocker(page,"https://other.example"),"UNEXPECTED_ORIGIN");
  page.evaluate=async()=>{throw new Error("Unexpected detector failure");};
  await assert.rejects(()=>detectBlocker(page,"https://shop.example"),/Unexpected detector failure/);
});

test("expected navigation does not become an empty-page failure or repeat a replay command", async () => {
  const attempt=simulatedRun({transitionalNavigation:true});
  assert.equal((await attempt.run()).status,"PASS");
  assert.equal(attempt.calls.filter((item)=>item.type === "START_REPLAY").length,1);
});

test("runtime fingerprints survive checkout line endings and detect behavior changes", async () => {
  const directory=await mkdtemp(join(tmpdir(),"filtervault-runtime-"));
  try {
    await mkdir(join(directory,"src"));
    const manifest=`${JSON.stringify({version:"1.2.3"},null,2)}\n`;
    const script="export const value = 1;\n";
    await writeFile(join(directory,"manifest.json"),manifest);
    await writeFile(join(directory,"src","index.js"),script);
    const first=await runtimeIdentity(directory);
    await writeFile(join(directory,"manifest.json"),manifest.replaceAll("\n","\r\n"));
    await writeFile(join(directory,"src","index.js"),script.replaceAll("\n","\r\n"));
    assert.deepEqual(await runtimeIdentity(directory),first);
    await writeFile(join(directory,"src","index.js"),"export const value = 2;\n");
    assert.notEqual((await runtimeIdentity(directory)).runtimeSha256,first.runtimeSha256);
  } finally {
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("Unsafe temporary cleanup path");
    await rm(directory,{recursive:true,force:true});
  }
});
