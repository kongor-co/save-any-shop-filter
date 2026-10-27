import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export async function runOttoBrowserCases({context,extension,call,smokeRoot}){
  const fixture=await readFile(new URL("../tests/fixtures/otto.html",import.meta.url));
  await context.route("https://www.otto.de/**",(route)=>route.fulfill({status:200,contentType:"text/html",body:fixture}));
  const base="https://www.otto.de/haushalt/kuechengeraete/reiskocher/";const url=new URL(base);for(const [key,value]of [["farbe","grau,lila"],["hoehe-in-cm~bis","24"],["tiefe-in-cm~bis","25"],["verkaeufer","otto"]])url.searchParams.set(key,value);
  const page=await context.newPage();await page.goto(url.toString());const tabId=await extension.evaluate(async(href)=>(await chrome.tabs.query({})).find((tab)=>tab.url===href)?.id,page.url());
  async function terminal(){let latest;const deadline=Date.now()+15_000;while(Date.now()<deadline){latest=await call("GET_ACTIVE_REPLAY",{tabId});if(["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(latest?.status))return latest;await new Promise((resolve)=>setTimeout(resolve,50));}assert.fail(JSON.stringify(latest));}
  const preview=await call("GET_CAPTURE_PREVIEW",{tabId});assert.equal(preview.criteria.length,4,JSON.stringify(preview));assert.equal(preview.unsupported.length,0);assert.equal(preview.unresolved.length,0);
  assert.deepEqual(preview.criteria.map((item)=>[item.semanticType,item.desiredValue]),[["COLOR",["grau","lila"]],["MAX_HEIGHT",["24"]],["MAX_DEPTH",["25"]],["SELLER",["otto"]]]);
  assert.equal(preview.criteria.every((item)=>item.bindings.every((binding)=>binding.type==="URL_QUERY")),true,"Composite removal chips are not stored as clickable DOM filters");
  await extension.evaluate(async(id)=>chrome.tabs.update(id,{active:true}),tabId);await extension.reload();await extension.locator("#capture-content").waitFor();await extension.screenshot({path:`${smokeRoot}/otto-capture.png`,clip:{x:0,y:0,width:430,height:780}});
  const saved=await call("SAVE_CAPTURE",{tabId,preview,name:"OTTO seller two colors height and depth"});assert.ok(saved.metadata.captureUrl.includes("farbe=grau,lila"));assert.ok(saved.metadata.captureUrl.includes("hoehe-in-cm~bis=24"));
  await page.goto(base);const reset=await call("GET_CAPTURE_PREVIEW",{tabId});assert.equal(reset.criteria.length,0);assert.equal(reset.unsupported.length,0);assert.equal(reset.unresolved.length,0);
  await call("START_REPLAY",{stateId:saved.id,tabId});const replay=await terminal();assert.equal(replay.status,"COMPLETE",JSON.stringify(replay));assert.ok(replay.results.every((item)=>item.status==="VERIFIED"));assert.equal(await page.evaluate(()=>window.filterClicks()),0);
  await call("START_REPLAY",{stateId:saved.id,tabId});assert.equal((await terminal()).status,"COMPLETE");assert.equal(await page.evaluate(()=>window.filterClicks()),0);

  await page.locator("#color-grau").evaluate((input)=>{input.checked=false;});
  assert.ok((await call("GET_CAPTURE_PREVIEW",{tabId})).unresolved.some((item)=>item.label==="Farbe"));
  await call("START_REPLAY",{stateId:saved.id,tabId});const contradictory=await terminal();assert.equal(contradictory.status,"PARTIAL");assert.equal(contradictory.results.find((item)=>item.semanticType==="COLOR").status,"ROUTE_ONLY","A checked removal chip cannot override an unchecked original control");
  await page.goto(saved.metadata.captureUrl);
  await page.locator("#primary-hoehe-in-cm").evaluate((input)=>{input.value="_,240";});
  await call("START_REPLAY",{stateId:saved.id,tabId});const wrongBound=await terminal();assert.equal(wrongBound.results.find((item)=>item.semanticType==="MAX_HEIGHT").status,"ROUTE_ONLY","24 cannot be verified by a 240 input with an outdated chip label");
  await page.goto(saved.metadata.captureUrl);
  await page.locator('fieldset[name="hoehe-in-cm"] input[type="range"]').last().evaluate((input)=>{input.value="23";});
  assert.ok((await call("GET_CAPTURE_PREVIEW",{tabId})).unsupported.length>0,"A changed range is not hidden as a duplicate of saved state");
  await page.goto(saved.metadata.captureUrl);
  await page.locator("#chosen li").first().evaluate((item)=>item.remove());
  await call("START_REPLAY",{stateId:saved.id,tabId});assert.equal((await terminal()).results.find((item)=>item.semanticType==="COLOR").status,"ROUTE_ONLY","Missing value chips cannot be replaced by the original checkbox alone");
  await page.goto(saved.metadata.captureUrl);
  await page.locator("#color-weiss").evaluate((input)=>{input.checked=true;});
  assert.ok((await call("GET_CAPTURE_PREVIEW",{tabId})).unresolved.some((item)=>/not represented/.test(item.reason)));
  await page.goto(saved.metadata.captureUrl);
  await page.evaluate(()=>{const fieldset=document.createElement("fieldset");fieldset.innerHTML='<legend>Unmapped range</legend><input type="range" min="0" max="10" value="3">';document.querySelector("main").append(fieldset);});
  assert.ok((await call("GET_CAPTURE_PREVIEW",{tabId})).unsupported.length>0,"Unrelated sliders remain explicit omissions");
  await page.goto(saved.metadata.captureUrl);
  await page.evaluate(()=>{const chip=document.createElement("demo-chip");chip.setAttribute("icon-right","close");chip.innerHTML='<input type="checkbox" name="unmapped" value="metal" checked aria-label="Material: Metall"><button slot="content">Material: Metall</button>';document.querySelector("#chosen").append(chip);});
  const unknownChip=await call("GET_CAPTURE_PREVIEW",{tabId});assert.equal(unknownChip.criteria.length,4);assert.ok(unknownChip.unresolved.some((item)=>/not a replay action target/.test(item.reason)),"An unknown removal chip is reported instead of becoming a destructive DOM mapping");
  console.log("OTTO regressions passed: four filters, native and removal-chip evidence, shadow fields, interval duplicates, literal query syntax, Save, reset, replay, and mismatch rejection.");
}
