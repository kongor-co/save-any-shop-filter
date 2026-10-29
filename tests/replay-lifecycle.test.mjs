import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as constants from "../src/shared/constants.js";
import * as planner from "../src/shared/planner.js";
import * as coverage from "../src/shared/coverage.js";
import * as route from "../src/shared/route.js";
import * as validator from "../src/shared/validator.js";
import * as policy from "../src/shared/replay-policy.js";
import * as updates from "../src/shared/saved-updates.js";

const source = (await readFile(new URL("../src/background/service-worker.js", import.meta.url), "utf8"))
  .replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, "");

function savedState() {
  return {
    schemaVersion:4, id:"saved", name:"Shoes", site:{origin:"https://shop.example",hostname:"shop.example",locale:"en"},
    context:{surface:"SEARCH_RESULTS",category:"Shoes",searchQuery:null,routeClass:"/search",locale:"en"},
    criteria:[{criterionId:"brand",role:"FILTER",semanticType:"BRAND",desiredValue:["Nike"],dependencies:[],bindings:[{bindingId:"brand",type:"URL_QUERY",parameter:"brand",values:["nike"]}]}],
    metadata:{captureUrl:"https://shop.example/search?brand=nike",routeSnapshot:"https://shop.example/search?brand=nike",coverage:{saveEligible:true},health:"UNKNOWN"}
  };
}

async function harness(options = {}) {
  const states = new Map([["saved",savedState()]]);
  const checkpoints = new Map((options.checkpoints || []).map((item) => [item.replayId,structuredClone(item)]));
  const active = new Map((options.checkpoints || []).map((item) => [item.tabId,item.replayId]));
  const messages = [];
  const navigation = [];
  const listeners = {};
  let finishExecution;
  const sender = {id:"extension",url:"https://shop.example/search?brand=nike",origin:"https://shop.example",tab:{id:1},frameId:0,documentId:"doc-1"};
  let runtimeContext = {origin:"https://shop.example",surface:"SEARCH_RESULTS",category:"Shoes",searchQuery:null,routeClass:"/search",locale:"en",viewport:"desktop"};
  const event = (key) => ({addListener(fn) { listeners[key] = fn; }});
  const storage = {
    getState:async (id) => { if (!states.has(id)) throw new Error("STATE_NOT_FOUND"); return structuredClone(states.get(id)); },
    putState:async (state) => {states.set(state.id, structuredClone(state));return state;},
    getReplay:async (id) => structuredClone(checkpoints.get(id) || null),
    getActiveReplay:async (tabId) => structuredClone(checkpoints.get(active.get(tabId)) || null),
    putReplay:async (checkpoint) => {checkpoints.set(checkpoint.replayId,structuredClone(checkpoint));active.set(checkpoint.tabId,checkpoint.replayId);},
    listActiveReplays:async () => [...active.values()].map((id) => structuredClone(checkpoints.get(id))),
    clearActiveReplay:async (id) => active.delete(id)
  };
  const sandbox = {
    ...constants,...planner,...coverage,...route,...validator,...policy,...updates,...storage,
    console,URL,Date,Map,Set,Promise,crypto,structuredClone,setTimeout,clearTimeout,
    chrome:{
      runtime:{id:"extension",getURL:(path) => `chrome-extension://extension/${path}`,onInstalled:event("installed"),onMessage:event("message")},
      storage:{local:{set:async () => {},setAccessLevel:async () => {}},session:{setAccessLevel:async () => {}}},
      permissions:{contains:async () => false},
      scripting:{executeScript:async () => sandbox.api.handleMessage({type:"CONTENT_READY",href:sender.url},sender)},
      tabs:{
        onUpdated:event("updated"),onRemoved:event("removed"),
        get:async () => ({id:1,url:sender.url,status:"complete"}),
        update:async (_id, value) => {
          navigation.push(value.url);sender.url=value.url;
          if (options.completeDuringNavigation) await sandbox.api.executeReplay(await storage.getActiveReplay(1), await storage.getState("saved"));
        },
        sendMessage:async (_id,message,target) => {
          messages.push({message,target});
          if (target?.documentId !== sender.documentId) throw new Error("STALE_DOCUMENT");
          if (message.type === "INSPECT_PAGE_CONTEXT") return options.inspectFailure ? {ok:false,error:"CONTEXT_INSPECTION_FAILED"} : {ok:true,context:structuredClone(runtimeContext)};
          if (message.type === "GET_REPLAY_EXECUTOR") return {ok:true,snapshot:options.snapshot || null};
          if (message.type === "CANCEL_REPLAY_EXECUTOR") {
            finishExecution?.();
            return {ok:true};
          }
          if (message.type === "EXECUTE_REPLAY") {
            if (options.holdExecution) return new Promise((resolve) => {
              finishExecution = () => resolve({ok:true,result:{replayId:message.replayId,status:"CANCELLED",results:message.criteria.map((item) => ({criterionId:item.criterionId,status:"NOT_ATTEMPTED"}))}});
            });
            return {ok:true,result:{replayId:message.replayId,status:"COMPLETE",results:message.criteria.map((item) => ({criterionId:item.criterionId,status:"VERIFIED"}))}};
          }
          throw new Error("UNEXPECTED_MESSAGE");
        }
      }
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.api = {handleMessage, startReplay, executeReplay, confirmReplayContext, cancelReplay, recoverActiveReplays, updateReplayFromContent, getReplayStatus, failReplay, recovery};`,sandbox);
  await sandbox.api.recovery;
  return {...sandbox.api,states,checkpoints,active,messages,navigation,sender,listeners,setContext:(value) => {runtimeContext={...runtimeContext,...value};},storage};
}

async function settled(read, condition) {
  const deadline = Date.now()+1000;
  while (Date.now()<deadline) {
    const value = await read();
    if (condition(value)) return value;
    await new Promise((resolve) => setTimeout(resolve,5));
  }
  assert.fail("Replay transition did not settle");
}

test("replay finishes and racing starts cannot install two controllers", async () => {
  const h = await harness({holdExecution:true});
  const starts = await Promise.allSettled([h.startReplay("saved",1),h.startReplay("saved",1)]);
  assert.equal(starts.filter((item) => item.status === "fulfilled").length,1);
  assert.match(starts.find((item) => item.status === "rejected").reason.message,/REPLAY_ALREADY_ACTIVE/);
  const replay = starts.find((item) => item.status === "fulfilled").value;
  await settled(() => h.storage.getReplay(replay.replayId),(item) => item.status === "APPLYING");
  await h.cancelReplay(replay.replayId);
  assert.equal((await h.storage.getReplay(replay.replayId)).results[0].status,"NOT_ATTEMPTED");
  const complete = await harness();
  const started = await complete.startReplay("saved",1);
  await settled(() => complete.storage.getReplay(started.replayId),(item) => item.status === "COMPLETE");
  await complete.failReplay(started,new Error("late failure"));
  assert.equal((await complete.storage.getReplay(started.replayId)).status,"COMPLETE");
});

test("fast replay completion during navigation cannot deadlock saved-state update coordination", async () => {
  const h = await harness({ completeDuringNavigation: true });
  h.sender.url = "https://shop.example/search";
  let timer;
  try {
    const replay = await Promise.race([h.startReplay("saved", 1), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error("REPLAY_DEADLOCK")), 1000); })]);
    assert.equal(replay.status, "COMPLETE");
    assert.equal(h.states.get("saved").metadata.health, "HEALTHY");
  } finally { clearTimeout(timer); }
});

test("context failures become terminal and uncertainty requires fresh document confirmation", async () => {
  const broken = await harness({inspectFailure:true});
  const started = await broken.startReplay("saved",1);
  const failed = await settled(() => broken.storage.getReplay(started.replayId),(item) => item.status === "FAILED");
  assert.equal(failed.error,"CONTEXT_INSPECTION_FAILED");
  const h = await harness();
  h.setContext({category:"Boots"});
  const replay = await h.startReplay("saved",1);
  await settled(() => h.storage.getReplay(replay.replayId),(item) => item.status === "AWAITING_CONFIRMATION");
  assert.equal(h.messages.some((item) => item.message.type === "EXECUTE_REPLAY"),false);
  h.sender.documentId = "doc-2";
  await h.confirmReplayContext(replay.replayId);
  const again = await settled(() => h.storage.getReplay(replay.replayId),(item) => item.status === "AWAITING_CONFIRMATION");
  assert.equal(again.documentId,"doc-2");
  const stored = h.checkpoints.get(replay.replayId);
  stored.runtimeContext = Object.fromEntries(Object.entries(stored.runtimeContext).reverse());
  await h.confirmReplayContext(replay.replayId);
  await settled(() => h.storage.getReplay(replay.replayId),(item) => item.status === "COMPLETE");
});

test("origin modifications fail before navigation or injection", async () => {
  const h = await harness();
  h.states.get("saved").metadata.routeSnapshot="https://other.example/search";
  await assert.rejects(() => h.startReplay("saved",1),/origin mismatch/);
  assert.equal(h.navigation.length,0);
  assert.equal(h.messages.length,0);
});

const runningCheckpoint = () => ({checkpointVersion:3,replayId:"running",savedStateId:"saved",tabId:1,frameId:0,documentId:"doc-1",expectedOrigin:"https://shop.example",expectedUrl:"https://shop.example/search?brand=nike",status:"APPLYING",results:[],deadlineAt:Date.now()+5000});

test("worker recovery reconnects active execution without redispatching it", async () => {
  const checkpoint = runningCheckpoint();
  const snapshot = {replayId:"running",status:"VERIFYING",activeCriterion:null,results:[{criterionId:"brand",status:"VERIFIED"}],result:null};
  const h = await harness({checkpoints:[checkpoint],snapshot});
  assert.equal(h.checkpoints.get("running").status,"VERIFYING");
  assert.equal(h.messages.some((item) => item.message.type === "EXECUTE_REPLAY"),false);
  const completion = {type:"REPLAY_COMPLETE",replayId:"running",result:{replayId:"running",status:"COMPLETE",results:snapshot.results}};
  await assert.rejects(() => h.updateReplayFromContent(completion,{...h.sender,documentId:"obsolete"},1),/STALE_DOCUMENT/);
  await h.updateReplayFromContent(completion,h.sender,1);
  assert.equal(h.checkpoints.get("running").status,"COMPLETE");
  const finished = await harness({checkpoints:[runningCheckpoint()],snapshot:{...snapshot,result:completion.result}});
  assert.equal(finished.checkpoints.get("running").status,"COMPLETE");
});

test("lost executors are stopped and expired navigation cannot wait indefinitely", async () => {
  const h = await harness({checkpoints:[runningCheckpoint()]});
  assert.equal(h.checkpoints.get("running").status,"INTERRUPTED");
  assert.equal(h.messages.some((item) => item.message.type === "CANCEL_REPLAY_EXECUTOR"),true);
  const expired = {...runningCheckpoint(),deadlineAt:Date.now()-1,status:"WAITING_NAVIGATION"};
  const other = await harness({checkpoints:[expired]});
  assert.equal(other.checkpoints.get("running").status,"INTERRUPTED");
  const polling = await harness();
  await polling.storage.putReplay(expired);
  assert.equal((await polling.getReplayStatus(1)).status,"FAILED");
});

test("recovery can finish preflight and navigation checkpoints without replaying completed work", async () => {
  for (const status of ["PLANNING","PREFLIGHT","WAITING_NAVIGATION"]) {
    const checkpoint = {...runningCheckpoint(),status};
    const h = await harness({checkpoints:[checkpoint]});
    const completed = await settled(() => h.storage.getReplay("running"),(item) => item.status === "COMPLETE");
    assert.equal(completed.results[0].status,"VERIFIED");
    assert.equal(h.messages.filter((item) => item.message.type === "EXECUTE_REPLAY").length,1);
  }
  const old = await harness({checkpoints:[{...runningCheckpoint(),checkpointVersion:2}]});
  assert.equal(old.checkpoints.get("running").status,"INTERRUPTED");
  assert.equal(old.messages.some((item) => item.message.type === "EXECUTE_REPLAY"),false);
});

test("forged content messages cannot initiate privileged replay", async () => {
  const h = await harness();
  await assert.rejects(() => h.handleMessage({type:"START_REPLAY",stateId:"saved",tabId:1},h.sender),/Unauthorized content message/);
  const checkpoint = runningCheckpoint();
  await h.storage.putReplay(checkpoint);
  const completion = {type:"REPLAY_COMPLETE",replayId:"running",result:{replayId:"different",status:"COMPLETE",results:[{criterionId:"brand",status:"VERIFIED"}]}};
  await assert.rejects(() => h.updateReplayFromContent(completion,h.sender,1),/STALE_REPLAY_ID/);
  completion.result.replayId="running";
  completion.result.results[0].criterionId="unknown";
  await assert.rejects(() => h.updateReplayFromContent(completion,h.sender,1),/UNKNOWN_RESULT_CRITERION/);
});

test("replacing the active document interrupts its controller", async () => {
  const checkpoint = runningCheckpoint();
  const h = await harness({checkpoints:[checkpoint],snapshot:{replayId:"running",status:"APPLYING",activeCriterion:"brand",results:[],result:null}});
  h.sender.documentId = "replacement";
  h.listeners.updated(1,{status:"complete"});
  const interrupted = await settled(() => h.storage.getReplay("running"),(item) => item.status === "INTERRUPTED");
  assert.equal(interrupted.error,"DOCUMENT_REPLACED");
  assert.equal(h.messages.some((item) => item.message.type === "EXECUTE_REPLAY"),false);
});
