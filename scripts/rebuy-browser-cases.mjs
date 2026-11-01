import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function runRebuyBrowserCases({context,extension,call,smokeRoot}) {
  const root=resolve(import.meta.dirname,"..");
  const catalog=JSON.parse(await readFile(resolve(root,"tests/fixtures/rebuy-catalog.json"),"utf8"));
  const source=(await readFile(resolve(root,"tests/fixtures/rebuy.html"),"utf8")).replace("__REBUY_CATALOG__",JSON.stringify(catalog));
  for(const origin of ["https://www.rebuy.de","https://rebuy.de"])await context.route(`${origin}/**`,route=>route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:source}));
  const page=await context.newPage();
  const reported=new URL("https://www.rebuy.de/kaufen/audio-und-hifi/kopfhoerer/sony");
  reported.searchParams.set("f_prop_position_earphonespeaker","ohrumschließend");reported.searchParams.set("sortBy","price_asc");
  await page.goto(reported.href);
  const tabId=await extension.evaluate(async href=>(await chrome.tabs.query({})).find(tab=>tab.url===href)?.id,page.url());
  assert.equal(Number.isInteger(tabId),true);
  const report={environment:"packaged-fixtures",observedOn:catalog.observedOn,fields:Object.keys(catalog.fields).length,cases:[]};
  const states=[];
  async function terminal(){
    const deadline=Date.now()+30_000;
    while(Date.now()<deadline){const replay=await call("GET_ACTIVE_REPLAY",{tabId});if(["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(replay?.status))return replay;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.fail("reBuy fixture replay did not complete");
  }
  async function roundTrip(url,name){
    await page.goto(url);
    const preview=await call("GET_CAPTURE_PREVIEW",{tabId});
    assert.equal(preview.site.adapterId,"rebuy-de");
    assert.equal(preview.coverage.saveEligible,true,JSON.stringify(preview));
    assert.deepEqual(preview.unresolved,[],JSON.stringify(preview.unresolved));
    assert.deepEqual(preview.unsupported,[]);
    assert.equal(await page.locator("aside").count(),0,"Capture restores the closed filter panel");
    assert.equal(await page.locator('button[aria-expanded="true"]').count(),0,"Capture restores sorting visibility");
    assert.equal(await page.evaluate(()=>window.metrics.filterClicks),0,"Reading controls never changes filters");
    const saved=await call("SAVE_CAPTURE",{tabId,preview,name});states.push(saved.id);
    assert.deepEqual((await call("LIST_STATES")).find(item=>item.id===saved.id).criteria,saved.criteria);
    const reset=new URL(url);reset.search="";
    await page.goto(reset.href);
    await call("START_REPLAY",{stateId:saved.id,tabId});
    const replay=await terminal();
    assert.equal(replay.status,"COMPLETE",JSON.stringify(replay));
    assert.equal(replay.results.every(item=>item.status==="VERIFIED"),true,JSON.stringify(replay));
    assert.equal(await page.evaluate(()=>window.metrics.filterClicks),0,"Replay restores the route without clicking filter options");
    assert.equal(await page.locator("aside").count(),0);
    assert.equal(await page.locator('details[open]').count(),0,"Breadcrumb inspection restores collapsed state");
    report.cases.push({url:new URL(url).href,criteria:saved.criteria.length,result:"CAPTURE_SAVE_RESET_REPLAY_VERIFIED"});
    return saved;
  }
  const saved=await roundTrip(reported.href,"reBuy Sony headphone regression");
  await extension.evaluate(async id=>chrome.tabs.update(id,{active:true}),tabId);
  await extension.reload();
  await extension.locator("#capture-content").waitFor();
  assert.equal(await extension.locator("#save-state").isEnabled(),true);
  await extension.screenshot({path:resolve(smokeRoot,"rebuy-capture.png"),clip:{x:0,y:0,width:430,height:650}});
  const before=await page.evaluate(()=>window.metrics.filterClicks);
  await call("START_REPLAY",{stateId:saved.id,tabId});
  assert.equal((await terminal()).status,"COMPLETE");
  assert.equal(await page.evaluate(()=>window.metrics.filterClicks),before,"Repeated replay is idempotent");

  for(const [index,category]of catalog.categories.entries()){
    if(category.landing)continue;
    const url=new URL(`https://${index%2?"www.rebuy.de":"rebuy.de"}${category.path}`);
    for(const [position,name]of category.fields.entries()){
      const key=name==="availability"?"f_variant_availability":`f_prop_${name}`;
      const values=catalog.fields[name][1];
      url.searchParams.append(position%3===1?key+"[]":key,values[0]);
      if(position%3!==0)url.searchParams.append(position%3===1?key+"[]":key,values[1]);
    }
    for(const name of category.numeric)url.searchParams.set(name,name.startsWith("price")?(name.endsWith("Min")?"1000":"50000"):(name.endsWith("Min")?"6.1":"6.5"));
    if(category.fields.length){url.searchParams.set("inStock","0");url.searchParams.set("inSale","1");}
    url.searchParams.set("sortBy",index%2?"price_desc":"variant_a0_price asc");
    url.searchParams.set("utm_source","discard");
    await roundTrip(url.href,`reBuy category ${index}`);
  }

  // Open and closed sort menus must produce the same stable capture.
  await page.setViewportSize({width:1440,height:900});
  await roundTrip(reported.href,"reBuy desktop native sort and selected links");
  await page.setViewportSize({width:1280,height:900});
  await page.goto(reported.href);
  const closed=await call("GET_CAPTURE_PREVIEW",{tabId});
  await page.getByRole("button",{name:"Sortiere nach",exact:true}).click();
  const open=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(open.captureFingerprint,closed.captureFingerprint);
  assert.equal(await page.locator('button[aria-expanded="true"]').count(),1);
  await page.getByRole("button",{name:"Sortiere nach",exact:true}).click();

  // A retained URL is not proof when the independent selected state contradicts it.
  await page.evaluate(()=>window.openAllFilters());
  await page.locator('a[data-cy="filter-f_prop_position_earphonespeaker-ohrumschließend"]').evaluate(link=>{link.classList.remove("select-item--selected");link.href=location.href;});
  const mismatch=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.ok(mismatch.unresolved.length>0);
  await call("START_REPLAY",{stateId:saved.id,tabId});
  assert.equal((await terminal()).status,"PARTIAL");
  assert.equal(await page.evaluate(()=>window.metrics.filterClicks),0);

  // Zero results remain a listing, and direct product/account/checkout pages stay excluded.
  await page.goto(reported.href);
  await page.locator("#products").evaluate(element=>element.replaceChildren());
  assert.equal((await call("GET_CAPTURE_PREVIEW",{tabId})).coverage.saveEligible,true);
  for(const [path,reason]of [["/i,123/kopfhoerer/sony","PRODUCT_DETAIL"],["/my/orders","ACCOUNT"],["/checkout/cart","CHECKOUT"],["/kaufen/apple","OTHER"],["/kaufen/categories","OTHER"]]){
    await page.goto(`https://www.rebuy.de${path}`);
    await assert.rejects(()=>call("GET_CAPTURE_PREVIEW",{tabId}),new RegExp(reason));
  }
  await page.goto("https://www.rebuy.de/kaufen/handy");
  assert.equal((await call("GET_CAPTURE_PREVIEW",{tabId})).coverage.saveEligible,false,"Default availability alone is not invented as an active filter");
  for(const id of states)await call("DELETE_STATE",{stateId:id});
  await writeFile(resolve(smokeRoot,"rebuy-report.json"),JSON.stringify(report,null,2));
  await page.close();
  console.log(`reBuy passed: ${report.cases.length} complete category combinations, ${report.fields} facet fields, both hosts, nested paths, plain/repeated/array values, prices, display sizes, boolean filters, sorts, save/reset/replay, idempotency, ambiguity and excluded pages.`);
}
