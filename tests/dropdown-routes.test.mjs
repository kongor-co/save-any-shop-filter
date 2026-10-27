import test from "node:test";
import assert from "node:assert/strict";
import {captureRouteCriteria,cleanCaptureUrl,buildReplayUrl,getRouteCaptureHints,getRouteSchemaInfo,mergeCriteria} from "../src/shared/route.js";

function example(){
  const url=new URL("https://www.shop-apotheke.com/blasensteine-nierensteine/");
  url.searchParams.set("category","shop-apotheke.com/Ernährung "+String.fromCharCode(38)+" Abnehmen");
  url.searchParams.set("refinementList[variants.packSize][0]","15 St");
  url.searchParams.set("refinementList[variants.packSize][1]","20x1,4 g");
  return url;
}

test("Shop Apotheke normalizes category and pack sizes while preserving physical route values",()=>{
  const url=example();const criteria=captureRouteCriteria(url);
  assert.deepEqual(criteria.map((item)=>[item.semanticType,item.desiredValue]),[["CATEGORY",[url.searchParams.get("category").split("/").at(-1)]],["PACK_SIZE",["15 St","20x1,4 g"]]]);
  assert.equal(criteria[0].bindings[0].values[0],url.searchParams.get("category"));
  assert.equal(getRouteSchemaInfo(url).version,2);
  assert.deepEqual([...new URL(buildReplayUrl(cleanCaptureUrl(url),criteria)).searchParams],[...url.searchParams]);
  const dom=structuredClone(criteria);for(const item of dom)item.bindings=[{bindingId:item.criterionId+"-dom",type:"DOM"}];
  assert.equal(mergeCriteria(criteria,dom).length,2);
});

test("capture hints associate active structured parameters with dropdown field names",()=>{
  const url=example();const hints=getRouteCaptureHints(url);
  assert.deepEqual(hints.find((hint)=>hint.semanticType==="PACK_SIZE"),{labels:["Menge"],semanticType:"PACK_SIZE",controlNames:["variants.packSize"],parameters:["refinementList[variants.packSize][0]","refinementList[variants.packSize][1]"]});
  assert.equal(hints.find((hint)=>hint.semanticType==="CATEGORY").parameters[0],"category");
  url.hostname="independent.example";
  const generic=getRouteCaptureHints(url);
  assert.equal(generic.some((hint)=>hint.semanticType==="PACK_SIZE"),false,"Retailer semantics do not leak into other hosts");
  assert.ok(generic.find((hint)=>hint.semanticType==="VARIANTS_PACKSIZE").controlNames.includes("variants.packSize"));
});

test("Shop Apotheke search aliases and presentation still round trip",()=>{
  const url=example();url.searchParams.set("query","vitamin d");url.searchParams.set("q","vitamin d");url.searchParams.set("sortBy","products_mktplc_prod_DE_de_price_asc");
  const criteria=captureRouteCriteria(url,{includePresentation:true});
  assert.deepEqual(criteria.find((item)=>item.semanticType==="SEARCH_QUERY").desiredValue,["vitamin d"]);
  assert.equal(criteria.find((item)=>item.semanticType==="SEARCH_QUERY").bindings.length,2);
  assert.deepEqual(criteria.find((item)=>item.semanticType==="SORT").desiredValue,["products_mktplc_prod_DE_de_price_asc"]);
});

test("sensitive structured parameters cannot become dropdown capture hints",()=>{
  const url=example();url.searchParams.set("refinementList[sessionToken][0]","secret");
  assert.equal(getRouteCaptureHints(url).some((hint)=>hint.controlNames?.includes("sessionToken")),false);
  assert.equal(new URL(cleanCaptureUrl(url)).searchParams.has("refinementList[sessionToken][0]"),false);
});
