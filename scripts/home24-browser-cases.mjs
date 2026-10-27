import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export async function runHome24BrowserCases({context,extension,call,smokeRoot}) {
  const fixture=await readFile(new URL("../tests/fixtures/home24.html",import.meta.url));
  await context.route("https://www.home24.de/**",(route)=>route.fulfill({status:200,contentType:"text/html",body:fixture}));
  const base="https://www.home24.de/aussenstrahler/";const url=new URL(base);
  for(const [key,value]of [["order","POPULARITY"],["width.max","14"],["average_rating","★★★★ und mehr"],["color","black|gray"]])url.searchParams.set(key,value);
  const page=await context.newPage();await page.goto(url.toString());
  const tabId=await extension.evaluate(async(href)=>(await chrome.tabs.query({})).find((tab)=>tab.url===href)?.id,page.url());
  async function terminal(){let latest;const deadline=Date.now()+15_000;while(Date.now()<deadline){latest=await call("GET_ACTIVE_REPLAY",{tabId});if(["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","INTERRUPTED","CANCELLED"].includes(latest?.status))return latest;await new Promise((resolve)=>setTimeout(resolve,50));}assert.fail(JSON.stringify(latest));}
  const preview=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(preview.coverage.meaningfulCaptured,4,JSON.stringify(preview));
  assert.equal(preview.unsupported.length,0);assert.equal(preview.unresolved.length,0);
  assert.deepEqual(preview.criteria.map((item)=>item.semanticType),["SORT","MAX_WIDTH","RATING","COLOR"]);
  assert.deepEqual(preview.criteria.find((item)=>item.semanticType==="COLOR").desiredValue,["black","gray"]);
  await extension.evaluate(async(id)=>chrome.tabs.update(id,{active:true}),tabId);await extension.reload();await extension.locator("#capture-content").waitFor();
  await extension.screenshot({path:`${smokeRoot}/home24-capture.png`,clip:{x:0,y:0,width:430,height:780}});
  const saved=await call("SAVE_CAPTURE",{tabId,preview,name:"Home24 width rating and two colors"});
  assert.equal(new URL(saved.metadata.captureUrl).searchParams.get("width.max"),"14");
  assert.equal(new URL(saved.metadata.captureUrl).searchParams.get("average_rating"),"★★★★ und mehr");
  assert.equal(new URL(saved.metadata.captureUrl).searchParams.get("color"),"black|gray");
  await page.goto(base);assert.equal((await call("GET_CAPTURE_PREVIEW",{tabId})).criteria.length,0);
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const restored=await terminal();assert.equal(restored.status,"COMPLETE",JSON.stringify(restored));assert.ok(restored.results.every((item)=>item.status==="VERIFIED"));
  assert.equal(await page.evaluate(()=>window.filterClicks()),0,"Evidence chips and group launchers must never be clicked by replay");
  await call("START_REPLAY",{stateId:saved.id,tabId});assert.equal((await terminal()).status,"COMPLETE");
  assert.equal(await page.evaluate(()=>window.filterClicks()),0);
  await page.evaluate(()=>{document.querySelector("select").value="PRICE_ASC";});
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const wrongSort=await terminal();assert.equal(wrongSort.status,"COMPLETE_WITH_WARNINGS");
  assert.equal(wrongSort.results.find((item)=>item.semanticType==="SORT").status,"ROUTE_ONLY","A route alone cannot confirm the selected sort option");
  await page.evaluate(()=>{document.querySelector("select").value="POPULARITY";});

  await page.evaluate(()=>{
    document.querySelector('[data-key="width.max"]').textContent="Breite: bis 140cm";
    document.querySelector('[data-key="average_rating"]').textContent="★★★★★ und mehr";
    document.querySelector('[data-value="gray"]').remove();
    const product=document.createElement("p");product.textContent="Breite: bis 14cm ★★★★ und mehr Grau";document.querySelector("main").append(product);
  });
  const missing=await call("GET_CAPTURE_PREVIEW",{tabId});assert.equal(missing.unresolved.length,3,"Missing or conflicting value chips must retain summary warnings");
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const rejected=await terminal();assert.equal(rejected.status,"PARTIAL",JSON.stringify(rejected));
  for(const type of ["MAX_WIDTH","RATING","COLOR"])assert.equal(rejected.results.find((item)=>item.semanticType===type).status,"ROUTE_ONLY","Product descriptions, 140cm, and five stars cannot verify missing selections");
  await page.goto(url.toString());
  await page.evaluate(()=>{const group=document.getElementById("dimensions");group.textContent="Maße (2)";group.setAttribute("aria-label","Filtern nach: Maße 2 ausgewählt");});
  assert.equal((await call("GET_CAPTURE_PREVIEW",{tabId})).unresolved.length,1,"An unrepresented active dimension remains unresolved");
  await page.goto(url.toString());
  await page.evaluate(()=>{const region=document.querySelector("#applied");region.after(region.cloneNode(true));});
  await call("START_REPLAY",{stateId:saved.id,tabId});
  assert.equal((await terminal()).status,"PARTIAL","Duplicate evidence regions cannot provide unambiguous verification");
  console.log("Home24 regressions passed: complete route capture, separate colors, scoped exact chip evidence, summary coverage, Save, reset, replay, and idempotency.");
}
