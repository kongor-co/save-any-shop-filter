import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function runFacetBrowserCases({context,extension,call,port,smokeRoot}) {
  const fixture = await readFile(new URL("../tests/fixtures/mediamarkt.html",import.meta.url));
  await context.route("https://www.mediamarkt.de/**",(route) => route.fulfill({status:200,contentType:"text/html",body:fixture}));
  const base="https://www.mediamarkt.de/de/category/nintendo-switch-2-konsolen-6238.html";
  const filtered=new URL(base);
  filtered.searchParams.set("marketplace","MediaMarkt");
  filtered.searchParams.set("refurbished_new_array","Nein");
  const media=await context.newPage();
  await media.goto(filtered.toString());
  const tabId=await tabIdFor(media);
  async function tabIdFor(page) {
    return extension.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,page.url());
  }
  async function terminal(id) {
    const deadline=Date.now()+15_000;
    let latest;
    while (Date.now()<deadline) {
      latest=await call("GET_ACTIVE_REPLAY",{tabId:id});
      if (["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(latest?.status)) return latest;
      await new Promise((resolve) => setTimeout(resolve,50));
    }
    assert.fail(JSON.stringify(latest));
  }
  const preview=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(preview.coverage.meaningfulCaptured,2,JSON.stringify(preview));
  assert.equal(preview.coverage.saveEligible,true);
  assert.equal(preview.unsupported.length,0);
  assert.equal(preview.unresolved.length,0);
  assert.ok(preview.defaultsIgnored.length>=9);
  assert.deepEqual(preview.criteria.map((item) => [item.semanticType,item.desiredValue]),[["SELLER",["MediaMarkt"]],["REFURBISHED",["Nein"]]]);
  for (const criterion of preview.criteria) {
    assert.ok(criterion.bindings.some((item) => item.type === "URL_QUERY"));
    assert.ok(criterion.bindings.some((item) => item.type === "DOM"));
  }
  await extension.evaluate(async (id) => chrome.tabs.update(id,{active:true}),tabId);
  await extension.reload();
  await extension.locator("#capture-content").waitFor();
  assert.equal(await extension.locator("#save-state").isEnabled(),true);
  await extension.locator("#state-name").fill("MediaMarkt seller and refurbished");
  await extension.screenshot({path:`${smokeRoot}/mediamarkt-capture.png`,clip:{x:0,y:0,width:430,height:650}});
  await media.evaluate(() => {for (const count of document.querySelectorAll(".result-count")) count.textContent="(27 Ergebnisse)";});
  await extension.locator("#save-state").click();
  await extension.locator(".library-card").filter({hasText:"MediaMarkt seller and refurbished"}).waitFor();
  const saved=(await call("LIST_STATES")).find((item) => item.name === "MediaMarkt seller and refurbished");
  assert.ok(saved);
  for (const key of ["marketplace","refurbished_new_array"]) assert.equal(new URL(saved.metadata.captureUrl).searchParams.get(key),filtered.searchParams.get(key));
  await media.goto(base);
  assert.equal(await media.locator("#MediaMarkt-marketplace").isChecked(),false);
  await call("START_REPLAY",{stateId:saved.id,tabId});
  const restored=await terminal(tabId);
  assert.equal(restored.status,"COMPLETE",JSON.stringify(restored));
  assert.equal(restored.results.every((item) => item.status === "VERIFIED"),true);
  assert.equal(await media.locator("#MediaMarkt-marketplace").isChecked(),true);
  assert.equal(await media.locator("#Nein-refurbished_new_array").isChecked(),true);
  const before=await media.evaluate(() => window.filterClicks());
  await call("START_REPLAY",{stateId:saved.id,tabId});
  assert.equal((await terminal(tabId)).status,"COMPLETE");
  assert.equal(await media.evaluate(() => window.filterClicks()),before,"Already-correct filters must not be toggled");

  const domOnly=structuredClone(saved);
  domOnly.id="media-dom-only";
  domOnly.metadata.captureUrl=base;
  domOnly.metadata.routeSnapshot=base;
  for (const criterion of domOnly.criteria) criterion.bindings=criterion.bindings.filter((item) => item.type === "DOM");
  await call("IMPORT_LIBRARY",{payload:{schemaVersion:4,states:[domOnly]}});
  await media.goto(base);
  await media.locator("details").evaluateAll((elements) => {for (const element of elements) element.open=false;});
  await call("START_REPLAY",{stateId:domOnly.id,tabId});
  assert.equal((await terminal(tabId)).status,"COMPLETE");
  assert.equal(await media.evaluate(() => window.filterClicks()),2);
  assert.equal(await media.locator("#MediaMarkt-marketplace").isChecked(),true);

  await media.locator('input[type="number"]').evaluateAll((inputs) => {inputs[0].closest("details").open=true;inputs[0].value="480";inputs[1].value="550";});
  const activeRange=await call("GET_CAPTURE_PREVIEW",{tabId});
  assert.equal(activeRange.unsupported.length,2,"Changed ranges must not be hidden as defaults");
  assert.equal(activeRange.criteria.some((item) => item.desiredValue.includes("480")),true);

  const catalog=await context.newPage();
  await catalog.goto(`http://127.0.0.1:${port}/catalog/search`);
  const catalogId=await tabIdFor(catalog);
  const generic=await call("GET_CAPTURE_PREVIEW",{tabId:catalogId});
  assert.equal(generic.site.adapterId,"generic");
  assert.equal(generic.coverage.meaningfulCaptured,2,JSON.stringify(generic));
  assert.equal(generic.unsupported.length,0);
  assert.equal(generic.unresolved.length,0);
  assert.deepEqual(generic.criteria.map((item) => item.desiredValue),[["Independent shop"],["New"]]);
  const genericSaved=await call("SAVE_CAPTURE",{tabId:catalogId,preview:generic,name:"Generic labelled facets"});
  await catalog.evaluate(() => {
    for (const input of document.querySelectorAll('input[type="checkbox"]')) input.checked=false;
    const seller=document.querySelector("details");
    const outer=document.createElement("details");
    outer.innerHTML="<summary>Advanced filters</summary>";
    seller.before(outer);
    outer.append(seller);
    for (const details of document.querySelectorAll("details")) details.open=false;
    for (const label of document.querySelectorAll("label")) {
      if (!label.querySelector('input[type="checkbox"]')) continue;
      label.lastChild.textContent=label.lastChild.textContent.replace(/\(\d+ (results|products)\)/,"(3 results)");
    }
  });
  await call("START_REPLAY",{stateId:genericSaved.id,tabId:catalogId});
  const genericResult=await terminal(catalogId);
  assert.equal(genericResult.status,"COMPLETE",JSON.stringify(genericResult));
  assert.equal(await catalog.evaluate(() => window.filterClicks()),2);
  await catalog.evaluate(() => {
    document.querySelector("#lower").closest("details").open=true;
    document.querySelector("#lower").value="10";
    document.querySelector("#upper").value="90";
  });
  const numeric=await call("GET_CAPTURE_PREVIEW",{tabId:catalogId});
  assert.deepEqual(numeric.criteria.find((item) => item.semanticType === "PRICE").desiredValue,["10","90"]);
  assert.equal(numeric.unsupported.length,0);
  const numericSaved=await call("SAVE_CAPTURE",{tabId:catalogId,preview:numeric,name:"Generic numeric bounds"});
  await catalog.evaluate(() => {document.querySelector("#lower").value="0";document.querySelector("#upper").value="100";});
  await call("START_REPLAY",{stateId:numericSaved.id,tabId:catalogId});
  assert.equal((await terminal(catalogId)).status,"COMPLETE");
  assert.equal(await catalog.locator("#lower").inputValue(),"10");
  assert.equal(await catalog.locator("#upper").inputValue(),"90");
  await call("START_REPLAY",{stateId:genericSaved.id,tabId:catalogId});
  assert.equal((await terminal(catalogId)).status,"COMPLETE");
  assert.equal(await catalog.evaluate(() => window.filterClicks()),2);
  await catalog.evaluate(() => {
    const seller=document.querySelector('ul[aria-labelledby="seller-title"]');
    seller.after(seller.cloneNode(true));
  });
  const ambiguous=await call("GET_CAPTURE_PREVIEW",{tabId:catalogId});
  assert.equal(ambiguous.criteria.some((item) => item.semanticType === "SELLER"),false);
  assert.equal(ambiguous.unresolved.length,1,"Identical unresolved values are reported once");
  await catalog.evaluate(() => {
    const details=document.createElement("details");
    details.open=true;
    details.innerHTML='<summary>Dimensions</summary><label for="weight">Weight</label><input id="weight" type="number" min="0" max="100" value="0"><label for="height">Height</label><input id="height" type="number" min="0" max="100" value="100">';
    document.querySelector("main").append(details);
  });
  const independent=await call("GET_CAPTURE_PREVIEW",{tabId:catalogId});
  assert.deepEqual(independent.criteria.find((item)=>item.semanticType === "DIMENSIONS").desiredValue,["0","100"],"Independent numeric controls are not an unrestricted range pair");
  const hidden=structuredClone(genericSaved);
  hidden.id="hidden-facet";
  hidden.criteria=hidden.criteria.filter((item)=>item.semanticType === "CONDITION");
  await call("IMPORT_LIBRARY",{payload:{schemaVersion:4,states:[hidden]}});
  const clicksBeforeHidden=await catalog.evaluate(() => window.filterClicks());
  await catalog.evaluate(() => {
    const group=[...document.querySelectorAll("details")].find((element)=>element.querySelector(":scope > summary")?.textContent === "Condition");
    group.querySelector('input[type="checkbox"]').checked=false;
    group.style.display="none";
  });
  await call("START_REPLAY",{stateId:hidden.id,tabId:catalogId});
  const hiddenResult=await terminal(catalogId);
  assert.equal(hiddenResult.status,"FAILED");
  assert.equal(await catalog.evaluate(() => window.filterClicks()),clicksBeforeHidden,"Hidden controls must not receive synthetic clicks");
  console.log("Facet regressions passed: MediaMarkt Save and verified replay, generic labelled lists, nested accordions, changing counts, defaults, and ambiguity.");
}
