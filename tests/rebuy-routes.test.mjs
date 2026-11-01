import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { captureRouteCriteria, cleanCaptureUrl, buildReplayUrl, getRouteCaptureHints, getRouteSchemaInfo } from "../src/shared/route.js";
import { rebuyCategoryPath } from "../src/adapters/route-schemas.js";
import { updateListingPath, assertUpdateContext } from "../src/shared/saved-updates.js";

const catalog = JSON.parse(await readFile(new URL("./fixtures/rebuy-catalog.json",import.meta.url),"utf8"));
const keyFor = (name) => name === "availability" ? "f_variant_availability" : `f_prop_${name}`;

test("reBuy headphone regression separates nested categories, Sony and its query filter", () => {
  const url = "https://www.rebuy.de/kaufen/audio-und-hifi/kopfhoerer/sony?f_prop_position_earphonespeaker=ohrumschlie%C3%9Fend\u0026sortBy=price_asc";
  const criteria = captureRouteCriteria(url,{includePresentation:true});
  assert.deepEqual(criteria.map((item) => [item.semanticType,item.desiredValue]),[
    ["CATEGORY_CONTEXT",["audio und hifi kopfhoerer"]],["BRAND",["sony"]],["HEADPHONE_POSITION",["ohrumschließend"]],["SORT",["price_asc"]]
  ]);
  assert.deepEqual(criteria.at(-1).observedRepresentation,["Preis: aufsteigend"]);
  assert.equal(getRouteSchemaInfo(url).version,2);
  assert.equal(buildReplayUrl(cleanCaptureUrl(url,{includePresentation:true}),criteria),cleanCaptureUrl(url,{includePresentation:true}));
});

for (const category of catalog.categories.filter((item) => !item.landing)) {
  test(`reBuy ${category.path}: all ${2 ** category.fields.length} observed facet-presence combinations round trip`, (t) => {
    const count = 2 ** category.fields.length;
    for(let mask=0;mask<count;mask+=1){
      const url=new URL(`https://www.rebuy.de${category.path}`);
      const expected=[];
      for(let index=0;index<category.fields.length;index+=1){
        if(!(Math.floor(mask/(2 ** index))%2))continue;
        const name=category.fields[index],key=keyFor(name),values=catalog.fields[name][1];
        const mode=mask%4;
        if(mode===0){url.searchParams.append(key,values[0]);expected.push(key);}
        else if(mode===1){for(const value of values.slice(0,2))url.searchParams.append(key,value);expected.push(key);}
        else if(mode===2){for(const value of values.slice(0,2))url.searchParams.append(key+"[]",value);expected.push(key+"[]");}
        else{url.searchParams.append(key,values[0]);url.searchParams.append(key+"[]",values[1]);expected.push(key,key+"[]");}
      }
      for(const [index,name]of category.numeric.entries())if(Math.floor(mask/(2 ** (index%3)))%2)url.searchParams.set(name,name.startsWith("price")?(name.endsWith("Min")?"1000":"50000"):(name.endsWith("Min")?"6.1":"6.5"));
      if(mask%3)url.searchParams.set("inStock",mask%3===1?"0":"1");
      if(mask%5)url.searchParams.set("sortBy",["","price_asc","price_desc","variant_a0_price asc","variant_a2_price desc"][mask%5]);
      url.searchParams.set("utm_source","discard");url.searchParams.set("page","3");
      const criteria=captureRouteCriteria(url,{includePresentation:true});
      const captured=new Set(criteria.flatMap((item)=>item.bindings.map((binding)=>binding.parameter)));
      for(const key of expected)assert.ok(captured.has(key),`Missing ${key}`);
      const clean=cleanCaptureUrl(url,{includePresentation:true});
      assert.equal(new URL(clean).searchParams.has("utm_source"),false);
      assert.equal(buildReplayUrl(clean,criteria),clean);
    }
    t.diagnostic(`${count} complete URL-state combinations checked`);
  });
}

test("every surveyed field supports all value encodings, punctuation and future property names", () => {
  assert.equal(Object.keys(catalog.fields).length,50);
  for(const name of [...Object.keys(catalog.fields),"future_capability"]){
    const key=keyFor(name),values=catalog.fields[name]?.[1]||["Ümlaut + slash/value","two, parts"];
    for(const encoding of ["scalar","repeated","array","mixed"]){
      const url=new URL("https://rebuy.de/kaufen/handy");
      url.searchParams.append(encoding==="array"?key+"[]":key,values[0]);
      if(encoding!=="scalar")url.searchParams.append(["array","mixed"].includes(encoding)?key+"[]":key,values[1]);
      const criterion=captureRouteCriteria(url).find((item)=>item.role==="FILTER");
      assert.ok(criterion,key);
      assert.deepEqual(criterion.desiredValue,encoding==="scalar"?[values[0]]:values.slice(0,2));
      assert.ok(getRouteCaptureHints(url).some((hint)=>hint.parameters?.length));
      assert.equal(buildReplayUrl(url, captureRouteCriteria(url)),cleanCaptureUrl(url));
    }
  }
});

test("catalog property privacy checks allow earphone attributes while excluding sensitive field names", () => {
  for(const field of ["email","customer_email","authToken","phone_number","phoneNumber","session_id","payment_address","tracking_cookie"]){
    const url=new URL("https://www.rebuy.de/kaufen/handy");url.searchParams.set(`f_prop_${field}[]`,"private");
    assert.equal(captureRouteCriteria(url).some((item)=>item.role==="FILTER"),false,field);
    assert.equal(new URL(cleanCaptureUrl(url)).search,"");
  }
  assert.equal(captureRouteCriteria("https://www.rebuy.de/kaufen/audio-und-hifi?f_prop_position_earphonespeaker=im+Ohr").at(-1).semanticType,"HEADPHONE_POSITION");
  assert.equal(captureRouteCriteria("https://unknown.example/list?displayMin=7.5").length,0);
});

test("category identities preserve nested product categories and existing phone and notebook paths", () => {
  for(const category of catalog.categories){
    for(const suffix of ["",...(category.children||[]).map((name)=>`/${name}`)]){
      const url=new URL(`https://www.rebuy.de${category.path}${suffix}/`);
      assert.equal(updateListingPath(url),rebuyCategoryPath(url).replace(/\/$/,""));
    }
    for(const related of category.related||[])assert.equal(rebuyCategoryPath(`https://rebuy.de/kaufen/${related}/`),`/kaufen/${related}`);
  }
  assert.equal(rebuyCategoryPath("https://rebuy.de/i,123/headphone/sony"),"/i,123/headphone/sony");
  assert.equal(rebuyCategoryPath("https://rebuy.de/kaufen"),"/kaufen");
  assert.equal(rebuyCategoryPath("https://rebuy.de/kaufen/wearables/smartwatches/apple"),"/kaufen/wearables/smartwatches");
  assert.equal(rebuyCategoryPath("https://rebuy.de/kaufen/kameras-und-zubehoer/objektive/canon"),"/kaufen/kameras-und-zubehoer/objektive");
  assert.equal(rebuyCategoryPath("https://rebuy.de/kaufen/konsolen-und-zubehoer/playstation/ps5"),"/kaufen/konsolen-und-zubehoer/playstation");
  const old=captureRouteCriteria("https://rebuy.de/kaufen/handy/samsung/galaxy-s20-serie");
  assert.deepEqual(old.map((item)=>item.semanticType),["CATEGORY_CONTEXT","BRAND","MODEL"]);
  const origin="https://www.rebuy.de",site={origin,hostname:"www.rebuy.de",locale:"de"};
  const previous={site,context:{surface:"PRODUCT_LIST",category:"Sony",searchQuery:null},criteria:captureRouteCriteria(`${origin}/kaufen/audio-und-hifi/kopfhoerer/sony`),metadata:{captureUrl:`${origin}/kaufen/audio-und-hifi/kopfhoerer/sony`}};
  const next={site,context:previous.context,criteria:captureRouteCriteria(`${origin}/kaufen/audio-und-hifi/lautsprecher/sony`),captureUrl:`${origin}/kaufen/audio-und-hifi/lautsprecher/sony`};
  assert.throws(()=>assertUpdateContext(previous,next),/CONTEXT_MISMATCH/);
});
