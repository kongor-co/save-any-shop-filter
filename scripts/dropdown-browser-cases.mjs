import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export async function runDropdownBrowserCases({context,extension,call,port,smokeRoot}) {
  const fixture=await readFile(new URL("../tests/fixtures/pharmacy-dropdowns.html",import.meta.url));
  await context.route("https://www.shop-apotheke.com/**",(route)=>route.fulfill({status:200,contentType:"text/html",body:fixture}));
  const base="https://www.shop-apotheke.com/blasensteine-nierensteine/";
  const url=new URL(base);
  const category="shop-apotheke.com/Ernährung "+String.fromCharCode(38)+" Abnehmen";
  url.searchParams.set("category",category);
  url.searchParams.set("refinementList[variants.packSize][0]","15 St");
  url.searchParams.set("refinementList[variants.packSize][1]","20x1,4 g");
  const page=await context.newPage();
  await page.goto(url.toString());
  async function tabIdFor(target) {return extension.evaluate(async(href)=>(await chrome.tabs.query({})).find((tab)=>tab.url===href)?.id,target.url());}
  async function terminal(tabId) {
    const deadline=Date.now()+20_000;
    let latest;
    while(Date.now()<deadline){
      latest=await call("GET_ACTIVE_REPLAY",{tabId});
      if(["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(latest?.status))return latest;
      await new Promise((resolve)=>setTimeout(resolve,50));
    }
    assert.fail(JSON.stringify(latest));
  }
  const tabId=await tabIdFor(page);
  const preview=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(preview.coverage.meaningfulCaptured,2,JSON.stringify(preview));
  assert.equal(preview.unsupported.length,0,JSON.stringify(preview.unsupported));
  assert.equal(preview.unresolved.length,0,JSON.stringify(preview.unresolved));
  assert.deepEqual(preview.criteria.map((item)=>[item.semanticType,item.desiredValue]),[["CATEGORY",[category.split("/").at(-1)]],["PACK_SIZE",["15 St","20x1,4 g"]]]);
  assert.equal(preview.criteria[1].bindings.filter((binding)=>binding.type==="DOM").length,2);
  assert.equal(await page.locator('[role="combobox"][aria-expanded="true"]').count(),0,"Capture restores closed menus");
  assert.equal(await page.getByRole("button",{name:"Mehr Filter",exact:true}).count(),1,"Capture restores the collapsed filter surface");
  assert.equal(await page.evaluate(()=>window.filterClicks()),0,"Capture does not change selections");
  await extension.evaluate(async(id)=>chrome.tabs.update(id,{active:true}),tabId);
  await extension.reload();await extension.locator("#capture-content").waitFor();
  await extension.screenshot({path:`${smokeRoot}/pharmacy-capture.png`,clip:{x:0,y:0,width:430,height:700}});
  await page.evaluate(()=>window.changeCounts());
  const saved=await call("SAVE_CAPTURE",{tabId,preview,name:"Pharmacy category and two pack sizes"});
  assert.equal(new URL(saved.metadata.captureUrl).searchParams.get("category"),category);
  await page.getByRole("combobox",{name:"Sortieren nach",exact:true}).click();
  const defaultSort=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(defaultSort.captureFingerprint,preview.captureFingerprint,"An open default sort menu is not a new filter");
  await page.getByRole("combobox",{name:"Sortieren nach",exact:true}).click();
  await page.getByRole("button",{name:"Mehr Filter",exact:true}).click();
  await page.getByRole("combobox",{name:"Menge",exact:true}).click();
  const openPreview=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(openPreview.captureFingerprint,preview.captureFingerprint,"Open state, result counts, and generated IDs are not semantic state");
  assert.equal(await page.getByRole("combobox",{name:"Menge",exact:true}).getAttribute("aria-expanded"),"true","Capture restores the originally open menu");
  await page.goto(base);
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const replay=await terminal(tabId);
  assert.equal(replay.status,"COMPLETE",JSON.stringify(replay));
  assert.ok(replay.results.every((result)=>result.status==="VERIFIED"));
  assert.equal(new URL(page.url()).searchParams.get("refinementList[variants.packSize][1]"),"20x1,4 g");
  assert.equal(await page.evaluate(()=>window.filterClicks()),0,"Restored route selections are verified without toggling");
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const secondReplay=await terminal(tabId);
  assert.equal(secondReplay.status,"COMPLETE",JSON.stringify(secondReplay));
  assert.equal(await page.evaluate(()=>window.filterClicks()),0);

  const domOnly=structuredClone(saved);domOnly.id="pharmacy-dom-only";domOnly.metadata.captureUrl=base;domOnly.metadata.routeSnapshot=base;
  for(const criterion of domOnly.criteria)criterion.bindings=criterion.bindings.filter((binding)=>binding.type==="DOM");
  await call("IMPORT_LIBRARY",{payload:{schemaVersion:4,states:[domOnly]}});
  await page.goto(base);
  await call("START_REPLAY",{stateId:domOnly.id,tabId});
  const domReplay=await terminal(tabId);
  assert.equal(domReplay.status,"COMPLETE",JSON.stringify(domReplay));
  assert.equal(await page.evaluate(()=>window.filterClicks()),3,"DOM-only replay restores the category and both pack sizes once");

  const genericUrl=new URL(`http://127.0.0.1:${port}/dropdown/search`);
  genericUrl.searchParams.set("refinementList[variants.packSize][0]","15 St");
  genericUrl.searchParams.set("refinementList[variants.packSize][1]","20x1,4 g");
  await context.route(`http://127.0.0.1:${port}/dropdown/**`,(route)=>route.fulfill({status:200,contentType:"text/html",body:fixture}));
  const generic=await context.newPage();await generic.goto(genericUrl.toString());
  const genericId=await tabIdFor(generic);
  const genericPreview=await call("GET_CAPTURE_PREVIEW",{tabId:genericId});
  assert.equal(genericPreview.coverage.meaningfulCaptured,1,JSON.stringify(genericPreview));
  assert.equal(genericPreview.criteria[0].bindings.filter((binding)=>binding.type==="DOM").length,2);
  assert.equal(genericPreview.unsupported.length,0);
  await generic.getByRole("button",{name:"Mehr Filter",exact:true}).click();
  await generic.evaluate(()=>{
    const trigger=[...document.querySelectorAll('[role="combobox"]')].find((element)=>element.getAttribute("aria-label")==="Hersteller");
    trigger.textContent="Hersteller 1";
    const field=document.createElement("input");field.setAttribute("role","combobox");field.setAttribute("aria-autocomplete","list");field.setAttribute("aria-label","Search filter");document.querySelector("main").append(field);
  });
  const unknown=await call("GET_CAPTURE_PREVIEW",{tabId:genericId});
  assert.equal(unknown.unsupported.length,2,"Unknown active dropdowns and genuine autocompletes still warn");

  await page.goto(url.toString());
  await page.getByRole("button",{name:"Mehr Filter",exact:true}).click();
  await page.evaluate(()=>{
    const trigger=[...document.querySelectorAll('[role="combobox"]')].find((element)=>element.getAttribute("aria-label")==="Menge");
    trigger.parentElement.after(trigger.parentElement.cloneNode(true));
  });
  const ambiguous=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.ok(ambiguous.unresolved.length>0);
  assert.equal(await page.evaluate(()=>window.filterClicks()),0);
  console.log("Dropdown regressions passed: Shop Apotheke category and two pack sizes, portal identity, counts, closed menus, DOM-only replay, generic reuse, and ambiguity.");
}
