import test from "node:test";
import assert from "node:assert/strict";
import {captureRouteCriteria,cleanCaptureUrl,buildReplayUrl,classifyRouteParameter} from "../src/shared/route.js";

function filteredUrl(host="www.cyberport.de") {
  const url=new URL(`https://${host}/gaming/gaming-maeuse.html`);
  url.searchParams.set("refinementList[manufacturer][0]","ASUS");
  url.searchParams.set("refinementList[facets.Stromversorgungsart.values][0]","Akku");
  url.searchParams.set("ratingMenu[ratingsBucket]","5");
  return url;
}

test("Cyberport captures all three filters with meaningful names and rating evidence",()=>{
  const url=filteredUrl();
  const criteria=captureRouteCriteria(url);
  assert.deepEqual(criteria.map((item)=>[item.semanticType,item.desiredValue]),[["BRAND",["ASUS"]],["STROMVERSORGUNGSART",["Akku"]],["RATING",["5"]]]);
  assert.deepEqual(criteria[2].observedRepresentation,["5 Sterne"]);
  assert.deepEqual(criteria[2].bindings[0].verificationTexts,["5 Sterne"]);
  assert.deepEqual([...new URL(buildReplayUrl(cleanCaptureUrl(url),criteria)).searchParams].sort(),[...url.searchParams].sort());
});

test("structured widgets work on unregistered shops and group indexed selections without losing keys",()=>{
  const url=filteredUrl("independent.example");
  url.searchParams.set("refinementList[manufacturer][1]","Logitech");
  url.searchParams.set("range[price]","50:150");
  url.searchParams.set("hierarchicalMenu[categories][0]","Gaming > Mice");
  url.searchParams.set("menu[condition]","New");
  url.searchParams.set("numericMenu[weight]","0:100");
  const criteria=captureRouteCriteria(url);
  const brand=criteria.find((item)=>item.semanticType==="BRAND");
  assert.deepEqual(brand.desiredValue,["ASUS","Logitech"]);
  assert.deepEqual(brand.bindings.map((item)=>item.parameter),["refinementList[manufacturer][0]","refinementList[manufacturer][1]"]);
  for (const type of ["PRICE_RANGE","CATEGORIES","CONDITION","WEIGHT","RATING"]) assert.ok(criteria.some((item)=>item.semanticType===type));
  assert.deepEqual([...new URL(buildReplayUrl(cleanCaptureUrl(url),criteria)).searchParams].sort(),[...url.searchParams].sort());
  assert.equal(classifyRouteParameter("ratingMenu[ratingsBucket]"),"FILTER");
  assert.equal(classifyRouteParameter("range[price]"),"FILTER");
});

test("structured widget support does not retain nested sensitive parameters or unknown state",()=>{
  const url=filteredUrl("independent.example");
  for (const field of ["email","sessionToken","user_id","profile.address","auth","payment"]) {
    const key=`refinementList[${field}][0]`;
    url.searchParams.set(key,"private");
    assert.equal(classifyRouteParameter(key),"EPHEMERAL");
  }
  url.searchParams.set("unknown[anything]","secret");
  const clean=new URL(cleanCaptureUrl(url));
  assert.equal([...clean.searchParams.values()].includes("private"),false);
  assert.equal(clean.searchParams.has("unknown[anything]"),false);
  assert.equal(captureRouteCriteria(url).length,3);
});

test("Cyberport retains search and sorting support",()=>{
  const url=new URL("https://www.cyberport.de/tools/search-results.html");
  url.searchParams.set("query","laptop");
  url.searchParams.set("sortBy","PRD-2B1T_de_price_asc");
  assert.deepEqual(captureRouteCriteria(url,{includePresentation:true}).map((item)=>[item.semanticType,item.desiredValue]),[["SEARCH_QUERY",["laptop"]],["SORT",["PRD-2B1T_de_price_asc"]]]);
});
