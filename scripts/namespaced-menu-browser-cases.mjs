import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export async function runNamespacedMenuBrowserCases({context,extension,call,port}) {
  const fixture=await readFile(new URL("../tests/fixtures/namespaced-menus.html",import.meta.url),"utf8");
  await context.route(`http://127.0.0.1:${port}/namespace/**`,(route)=>{
    const path=new URL(route.request().url()).pathname;
    const body=path.includes("/named/") ? fixture.replace('data-native-names="false"','data-native-names="true"')
      : path.includes("/plain/") ? fixture.replace('data-query-prefix="f~"','data-query-prefix=""') : fixture;
    return route.fulfill({status:200,contentType:"text/html",body});
  });
  for(const mode of ["id","named","plain"]) {
    const base=`http://127.0.0.1:${port}/namespace/${mode}/scanners`;const url=new URL(base);
    const prefix=mode==="plain"?"":"f~";
    url.searchParams.set(prefix+"stregkodelaesere_forbindelse","kabling");url.searchParams.set(prefix+"stregkodelaesere_type","haandmodel");
    const page=await context.newPage();await page.goto(url.href);
    const tabId=await extension.evaluate(async(href)=>(await chrome.tabs.query({})).find((tab)=>tab.url===href)?.id,page.url());
    const preview=await call("GET_CAPTURE_PREVIEW",{tabId});
    assert.equal(preview.site.adapterId,"generic");assert.equal(preview.criteria.length,2,JSON.stringify(preview));
    assert.equal(preview.coverage.saveEligible,true);assert.equal(preview.unresolved.length,0);assert.equal(preview.unsupported.length,0);
    assert.deepEqual(preview.criteria.map((item)=>item.observedRepresentation),[["Kabel"],["Hand Modell"]]);
    assert.ok(preview.criteria.every((item)=>item.bindings.some((binding)=>binding.type==="DOM")));
    assert.equal(await page.locator('button[aria-expanded="true"]').count(),0);assert.equal(await page.evaluate(()=>window.filterClicks()),0);
    await page.getByRole("button",{name:"Verbindung",exact:true}).click();
    const open=await call("GET_CAPTURE_PREVIEW",{tabId});assert.equal(open.captureFingerprint,preview.captureFingerprint);
    assert.equal(await page.getByRole("button",{name:"Verbindung",exact:true}).getAttribute("aria-expanded"),"true");
    const saved=await call("SAVE_CAPTURE",{tabId,preview,name:"Generic lazy menu "+mode});
    await page.goto(base);assert.equal((await call("GET_CAPTURE_PREVIEW",{tabId})).criteria.length,0);
    await call("START_REPLAY",{stateId:saved.id,tabId});let latest;const deadline=Date.now()+15000;
    do {latest=await call("GET_ACTIVE_REPLAY",{tabId});if(["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(latest?.status))break;await new Promise((resolve)=>setTimeout(resolve,50));}while(Date.now()<deadline);
    assert.equal(latest.status,"COMPLETE",JSON.stringify(latest));assert.ok(latest.results.every((item)=>item.status==="VERIFIED"));assert.equal(await page.evaluate(()=>window.filterClicks()),mode==="plain"?2:0);
    await page.goto(url.href);
    await page.evaluate(()=>{document.documentElement.dataset.unchecked="stregkodelaesere_forbindelse";});
    await page.getByRole("button",{name:"Verbindung",exact:true}).click();
    const mismatch=await call("GET_CAPTURE_PREVIEW",{tabId});assert.ok(mismatch.unresolved.length>0);
    assert.equal(mismatch.criteria.find((item)=>item.semanticType==="STREGKODELAESERE_FORBINDELSE")?.bindings.some((binding)=>binding.type==="DOM")||false,false);
    await page.goto(url.href);
    await page.evaluate(()=>{const group=document.querySelector(".filters li");group.after(group.cloneNode(true));});
    assert.ok((await call("GET_CAPTURE_PREVIEW",{tabId})).unresolved.length>0,"Ambiguous menu labels cannot create mappings");
    await call("DELETE_STATE",{stateId:saved.id});await page.close();
  }
  console.log("Generic filters passed on an unregistered origin: namespaces and unfamiliar plain keys, lazy menus, ID and named native options, translated labels, unchanged capture, Save, reset, verified replay, and ambiguity rejection.");
}
