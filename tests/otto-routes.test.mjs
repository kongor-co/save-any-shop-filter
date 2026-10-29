import test from "node:test";
import assert from "node:assert/strict";
import {captureRouteCriteria,cleanCaptureUrl,buildReplayUrl,getRouteCaptureHints,getRouteSchemaInfo,routeBindingMatches} from "../src/shared/route.js";
import {calculateCoverage} from "../src/shared/coverage.js";

function example(){const url=new URL("https://www.otto.de/haushalt/kuechengeraete/reiskocher/");for(const [key,value]of [["farbe","grau,lila"],["hoehe-in-cm~bis","24"],["tiefe-in-cm~bis","25"],["verkaeufer","otto"]])url.searchParams.set(key,value);return url;}

test("OTTO preserves four semantic filters and literal query separators",()=>{
  const url=example();const criteria=captureRouteCriteria(url);
  assert.deepEqual(criteria.map((item)=>[item.semanticType,item.desiredValue]),[["COLOR",["grau","lila"]],["MAX_HEIGHT",["24"]],["MAX_DEPTH",["25"]],["SELLER",["otto"]]]);
  const replay=buildReplayUrl(cleanCaptureUrl(url),criteria);
  assert.ok(replay.includes("farbe=grau,lila"));assert.ok(replay.includes("hoehe-in-cm~bis=24"));
  assert.deepEqual([...new URL(replay).searchParams],[...url.searchParams]);
  assert.equal(getRouteSchemaInfo(url).version,3);
  assert.deepEqual(criteria[1].bindings[0].controlEvidence,{name:"hoehe-in-cm",values:["_,24"],labels:["H: bis 24 cm"],rangeEndpoint:"MAX",rangeValue:"24"});
});

test("OTTO control hints include inactive range axes without inventing filters",()=>{
  const hints=getRouteCaptureHints(example());
  const width=hints.find((item)=>item.semanticType==="MAX_WIDTH");assert.deepEqual(width.parameters,[]);assert.deepEqual(width.controlEvidence.values,[]);
  assert.equal(captureRouteCriteria(example()).some((item)=>item.semanticType==="MAX_WIDTH"),false);
  assert.deepEqual(hints.find((item)=>item.semanticType==="COLOR").controlEvidence.values,["grau","lila"]);
});

test("OTTO-specific names and separators do not leak into other shops or free text",()=>{
  const url=example();url.hostname="independent.example";assert.equal(captureRouteCriteria(url).length,0);assert.deepEqual(getRouteCaptureHints(url),[]);
  url.hostname="www.otto.de";url.searchParams.set("q","a,b~c");url.searchParams.set("utm_source","tracking");
  const clean=cleanCaptureUrl(url);assert.ok(clean.includes("q=a%2Cb%7Ec"));assert.equal(new URL(clean).searchParams.has("utm_source"),false);
  url.searchParams.set("farbe","grau,lila,grau");assert.deepEqual(captureRouteCriteria(url).find((item)=>item.semanticType==="COLOR").desiredValue,["grau","lila"]);
});

test("OTTO retains legacy RAM, category, and sort contracts",()=>{
  const url=new URL("https://www.otto.de/technik/");url.searchParams.set("arbeitsspeicher","8-gb");url.searchParams.set("kategorien~sind","notebooks");url.searchParams.set("sortiertnach","preis-aufsteigend");
  const criteria=captureRouteCriteria(url,{includePresentation:true});assert.deepEqual(criteria.map((item)=>item.semanticType),["RAM","CATEGORY","SORT"]);
  assert.deepEqual([...new URL(buildReplayUrl(cleanCaptureUrl(url,{includePresentation:true}),criteria)).searchParams],[...url.searchParams]);
});

function fashionExample(host = "www.otto.de") {
  const url = new URL(`https://${host}/mode/waesche/`);
  for (const [key, value] of [["stil", "elegant,erotisch"], ["us-groessen", "s"], ["zielgruppe", "damen"]]) url.searchParams.set(key, value);
  return url;
}

test("OTTO fashion choices capture three filters with four values and enable Save", () => {
  for (const host of ["www.otto.de", "otto.de"]) {
    const url = fashionExample(host);
    const criteria = captureRouteCriteria(url);
    assert.deepEqual(criteria.map((item) => [item.semanticType, item.desiredValue]), [["STYLE", ["elegant", "erotisch"]], ["US_SIZE", ["s"]], ["TARGET_GROUP", ["damen"]]]);
    assert.deepEqual(criteria.map((item) => item.observedRepresentation), [["elegant", "erotisch"], ["S"], ["Damen"]]);
    assert.equal(calculateCoverage({criteria, adapterId: "otto-de"}).saveEligible, true);
    const replay = buildReplayUrl(cleanCaptureUrl(url), criteria);
    assert.ok(replay.includes("stil=elegant,erotisch"));
    assert.deepEqual([...new URL(replay).searchParams], [...url.searchParams]);
    for (const item of criteria) assert.equal(routeBindingMatches(replay, item.bindings[0]), true);
    assert.deepEqual(criteria.map((item) => item.bindings[0].controlEvidence), [
      {name: "stil", values: ["elegant", "erotisch"], labels: ["elegant", "erotisch"]},
      {name: "us-groessen", values: ["s"], labels: ["S"]},
      {name: "zielgruppe", values: ["damen"], labels: ["Damen"]}
    ]);
    const hints = getRouteCaptureHints(url).filter((item) => item.parameters?.length);
    assert.deepEqual(hints.map((item) => item.semanticType), ["STYLE", "US_SIZE", "TARGET_GROUP"]);
  }
});

test("OTTO fashion multi-selects preserve physical query values, remove tracking, and stay host-specific", () => {
  const url = fashionExample();
  url.searchParams.append("stil", "casual,elegant"); url.searchParams.set("us-groessen", "s,m");
  url.searchParams.set("zielgruppe", "maedchen"); url.searchParams.set("utm_source", "test");
  const criteria = captureRouteCriteria(url);
  assert.deepEqual(criteria[0].desiredValue, ["elegant", "erotisch", "casual"]);
  assert.deepEqual(criteria[1].desiredValue, ["s", "m"]);
  assert.deepEqual(criteria[1].bindings[0].controlEvidence.labels, ["S", "M"]);
  assert.deepEqual(criteria[2].observedRepresentation, ["Mädchen"]);
  const replay = new URL(buildReplayUrl(cleanCaptureUrl(url), criteria));
  assert.deepEqual(replay.searchParams.getAll("stil"), ["elegant,erotisch", "casual,elegant"]);
  assert.equal(replay.searchParams.has("utm_source"), false);
  const foreign = fashionExample("unknown.example");
  assert.deepEqual(captureRouteCriteria(foreign), []); assert.deepEqual(getRouteCaptureHints(foreign), []);
});
