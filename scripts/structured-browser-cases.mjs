import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export async function runStructuredBrowserCases({context,extension,call,port,smokeRoot}) {
  const fixture=await readFile(new URL("../tests/fixtures/cyberport.html",import.meta.url));
  await context.route("https://www.cyberport.de/**",(route)=>route.fulfill({status:200,contentType:"text/html",body:fixture}));
  const base="https://www.cyberport.de/gaming/gaming-maeuse.html";
  const filtered=new URL(base);
  filtered.searchParams.set("refinementList[manufacturer][0]","ASUS");
  filtered.searchParams.set("refinementList[facets.Stromversorgungsart.values][0]","Akku");
  filtered.searchParams.set("ratingMenu[ratingsBucket]","5");
  const page=await context.newPage();
  await page.goto(filtered.toString());
  async function tabIdFor(target) {
    return extension.evaluate(async(url)=>(await chrome.tabs.query({})).find((tab)=>tab.url===url)?.id,target.url());
  }
  async function terminal(tabId) {
    const deadline=Date.now()+20_000;
    let latest;
    while (Date.now()<deadline) {
      latest=await call("GET_ACTIVE_REPLAY",{tabId});
      if (["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(latest?.status)) return latest;
      await new Promise((resolve)=>setTimeout(resolve,75));
    }
    assert.fail(JSON.stringify(latest));
  }
  const tabId=await tabIdFor(page);
  const preview=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(preview.coverage.meaningfulCaptured,3,JSON.stringify(preview));
  assert.equal(preview.unsupported.length,0);
  assert.equal(preview.unresolved.length,0);
  assert.ok(preview.defaultsIgnored.length>=2);
  assert.deepEqual(preview.criteria.map((item)=>item.semanticType),["BRAND","STROMVERSORGUNGSART","RATING"]);
  await extension.evaluate(async(id)=>chrome.tabs.update(id,{active:true}),tabId);
  await extension.reload();
  await extension.locator("#capture-content").waitFor();
  assert.equal(await extension.locator("#save-state").isEnabled(),true);
  await extension.screenshot({path:`${smokeRoot}/cyberport-capture.png`,clip:{x:0,y:0,width:430,height:700}});
  const saved=await call("SAVE_CAPTURE",{tabId,preview,name:"Cyberport three filters"});
  await page.goto(base);
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const result=await terminal(tabId);
  assert.equal(result.status,"COMPLETE",JSON.stringify(result));
  assert.ok(result.results.every((item)=>item.status==="VERIFIED"));
  assert.equal(await page.locator("#rating-5").isChecked(),true);
  // An unchecked option label alone cannot count as selected evidence.
  await page.evaluate(()=>{for(const input of document.querySelectorAll("input:checked")) input.checked=false;});
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const unverified=await terminal(tabId);
  assert.ok(unverified.results.every((item)=>item.status==="ROUTE_ONLY"),JSON.stringify(unverified));
  // A real autocomplete and a changed ARIA slider must remain visible omissions.
  await page.evaluate(()=>{
    document.querySelector('[role="combobox"]').value="Preis aufsteigend";
    const handles=document.querySelectorAll('[role="slider"]');
    for(const handle of handles) handle.setAttribute("aria-valuemax","200");
  });
  const active=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(active.unsupported.length,2);

  const nativeFixture=await readFile(new URL("../tests/fixtures/native-range.html",import.meta.url));
  await context.route(`http://127.0.0.1:${port}/native/search`,(route)=>route.fulfill({status:200,contentType:"text/html",body:nativeFixture}));
  const native=await context.newPage();
  await native.goto(`http://127.0.0.1:${port}/native/search`);
  const nativeId=await tabIdFor(native);
  const nativePreview=await call("GET_CAPTURE_PREVIEW",{tabId:nativeId});
  assert.equal(nativePreview.unsupported.length,0);
  assert.deepEqual(nativePreview.criteria[0].desiredValue,["20","80"]);
  const nativeSaved=await call("SAVE_CAPTURE",{tabId:nativeId,preview:nativePreview,name:"Native paired price"});
  await native.evaluate(()=>{
    const inputs=document.querySelectorAll('input[type="range"]');
    inputs[0].value="0";inputs[1].value="100";
    inputs[0].setAttribute("aria-label","0 euros");inputs[1].setAttribute("aria-label","100 euros");
    document.querySelector("output").value="0:100";
  });
  await call("START_REPLAY",{stateId:nativeSaved.id,tabId:nativeId});
  const nativeResult=await terminal(nativeId);
  assert.equal(nativeResult.status,"COMPLETE",JSON.stringify(nativeResult));
  assert.equal(await native.locator("output").textContent(),"20:80");
  const commits=await native.evaluate(()=>window.commits());
  assert.equal(commits,2);
  await call("START_REPLAY",{stateId:nativeSaved.id,tabId:nativeId});
  assert.equal((await terminal(nativeId)).status,"COMPLETE");
  assert.equal(await native.evaluate(()=>window.commits()),commits);
  await native.evaluate(()=>{
    const group=document.createElement("fieldset");
    group.innerHTML='<legend>Dimensions</legend><input type="range" min="0" max="100" value="0" aria-label="Weight"><input type="range" min="0" max="100" value="100" aria-label="Height">';
    document.querySelector("main").append(group);
  });
  const independent=await call("GET_CAPTURE_PREVIEW",{tabId:nativeId});
  assert.equal(independent.unsupported.length,2,"Independent sliders cannot be ignored as one full-range filter");
  await native.evaluate(()=>document.querySelectorAll('input[type="range"]')[1].remove());
  await call("START_REPLAY",{stateId:nativeSaved.id,tabId:nativeId});
  assert.equal((await terminal(nativeId)).status,"FAILED","Changed range structure must not receive a guessed action");
  console.log("Structured facet regressions passed: Cyberport rating, hidden native selection evidence, defaults, generic structured routes, and native paired range replay.");
}
