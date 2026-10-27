import test from "node:test";
import assert from "node:assert/strict";
import {captureRouteCriteria,cleanCaptureUrl,buildReplayUrl,getRouteCaptureHints,getRouteSchemaInfo} from "../src/shared/route.js";

function example(){const url=new URL("https://www.home24.de/aussenstrahler/");for(const [key,value]of [["order","POPULARITY"],["width.max","14"],["average_rating","★★★★ und mehr"],["color","black|gray"]])url.searchParams.set(key,value);return url;}

test("Home24 captures width, rating, and separate color choices without changing physical query values",()=>{
  const url=example();const criteria=captureRouteCriteria(url,{includePresentation:true});
  assert.deepEqual(criteria.map((item)=>[item.semanticType,item.desiredValue]),[["SORT",["POPULARITY"]],["MAX_WIDTH",["14"]],["RATING",["★★★★ und mehr"]],["COLOR",["black","gray"]]]);
  assert.deepEqual(criteria[1].observedRepresentation,["Breite: bis 14cm"]);
  assert.deepEqual(criteria[3].observedRepresentation,["Schwarz","Grau"]);
  assert.deepEqual(criteria[3].bindings[0].values,["black|gray"]);
  assert.equal(buildReplayUrl(cleanCaptureUrl(url,{includePresentation:true}),criteria),url.toString());
  assert.equal(getRouteSchemaInfo(url).version,2);
});

test("Home24 summary hints require every active represented value",()=>{
  const hints=getRouteCaptureHints(example());
  assert.deepEqual(hints.find((hint)=>hint.semanticType==="MAX_WIDTH"),{labels:["Maße"],semanticType:"MAX_WIDTH",summaryKey:"width",parameters:["width.max"],appliedFilterTexts:["Breite: bis 14cm"]});
  assert.deepEqual(hints.find((hint)=>hint.semanticType==="COLOR").appliedFilterTexts,["Schwarz","Grau"]);
  const url=example();url.hostname="independent.example";
  assert.equal(captureRouteCriteria(url).some((item)=>["MAX_WIDTH","RATING"].includes(item.semanticType)),false);
  assert.deepEqual(captureRouteCriteria(url).find((item)=>item.semanticType==="COLOR").desiredValue,["black|gray"]);
  assert.deepEqual(getRouteCaptureHints(url),[]);
});

test("Home24 preserves seller, known sorting, unknown colors, and dimension bounds conservatively",()=>{
  const url=example();url.searchParams.set("shop","home24 SE");url.searchParams.set("order","PRICE_ASC");url.searchParams.set("color","black|gray|unknown|black");url.searchParams.set("height.min","5");url.searchParams.set("depth.max","20");
  const criteria=captureRouteCriteria(url,{includePresentation:true});
  assert.deepEqual(criteria.find((item)=>item.semanticType==="COLOR").desiredValue,["black","gray","unknown"]);
  assert.deepEqual(criteria.find((item)=>item.semanticType==="SORT").observedRepresentation,["Niedrigster Preis"]);
  assert.deepEqual(criteria.find((item)=>item.semanticType==="MIN_HEIGHT").desiredValue,["5"]);
  assert.deepEqual(criteria.find((item)=>item.semanticType==="MAX_DEPTH").desiredValue,["20"]);
  assert.deepEqual(criteria.find((item)=>item.semanticType==="SELLER").desiredValue,["home24 SE"]);
});
