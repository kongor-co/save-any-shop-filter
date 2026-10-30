import test from "node:test";
import assert from "node:assert/strict";
import {captureRouteCriteria,cleanCaptureUrl,buildReplayUrl,getRouteCaptureHints,getRouteSchemaInfo,classifyRouteParameter,routeBindingMatches,mergeCriteria} from "../src/shared/route.js";
import {calculateCoverage} from "../src/shared/coverage.js";

function example(host="www.proshop.de") {
  const url = new URL(`https://${host}/Bardcode-Lesegeraet`);
  url.searchParams.set("f~stregkodelaesere_forbindelse","kabling");
  url.searchParams.set("f~stregkodelaesere_type","haandmodel");
  return url;
}

test("explicit filter namespaces capture Proshop state and work identically on unregistered shops", () => {
  for (const host of ["www.proshop.de","independent.example","another-shop.test"]) {
    const url = example(host); const criteria = captureRouteCriteria(url);
    assert.equal(getRouteSchemaInfo(url).id,"generic");
    assert.deepEqual(criteria.map((item) => [item.semanticType,item.desiredValue]), [["STREGKODELAESERE_FORBINDELSE",["kabling"]],["STREGKODELAESERE_TYPE",["haandmodel"]]]);
    assert.equal(calculateCoverage({criteria,adapterId:"generic"}).saveEligible,true);
    const replay = buildReplayUrl(cleanCaptureUrl(url),criteria);
    assert.deepEqual([...new URL(replay).searchParams],[...url.searchParams]);
    for (const item of criteria) assert.equal(routeBindingMatches(replay,item.bindings[0]),true);
    assert.deepEqual(getRouteCaptureHints(url)[0], {labels:["stregkodelaesere_forbindelse"],semanticType:"STREGKODELAESERE_FORBINDELSE",controlNames:["stregkodelaesere_forbindelse"],parameters:["f~stregkodelaesere_forbindelse"]});
  }
});

test("filter namespaces preserve repeated and indexed values without guessing delimiters", () => {
  const url = new URL("https://independent.example/catalog");
  for (const name of ["f~material","filter.material","filters_material","facet~finish","filter[connection][0]","filter[connection][1]","facets[finish]"]) url.searchParams.append(name,"a,b|c");
  url.searchParams.append("f~material","steel");
  const criteria = captureRouteCriteria(url);
  assert.equal(criteria.length,6);
  assert.deepEqual(criteria[0].desiredValue,["a,b|c","steel"]);
  assert.equal(criteria.find((item) => item.semanticType === "CONNECTION").bindings.length,2);
  assert.deepEqual([...new URL(buildReplayUrl(cleanCaptureUrl(url),criteria)).searchParams].sort(),[...url.searchParams].sort());
  assert.equal(classifyRouteParameter("f~field"),"FILTER");
  assert.equal(classifyRouteParameter("unmapped"),"IGNORED");
  assert.deepEqual(captureRouteCriteria("https://independent.example/catalog?f=anything"),[]);
});

test("sensitive namespaced fields are excluded from hints, capture, sanitation and replay", () => {
  const url = example("independent.example");
  const fields = ["sessionToken","email","profile.address","customer","user_id","auth","tracking","csrf","credit_card","utm_source"];
  for (const field of fields) {
    for (const name of [`f~${field}`,`filter.${field}`,`filters[${field}][0]`]) {
      url.searchParams.set(name,"private"); assert.equal(classifyRouteParameter(name),"EPHEMERAL");
    }
  }
  const criteria = captureRouteCriteria(url); assert.equal(criteria.length,2);
  assert.equal(getRouteCaptureHints(url).length,2);
  for (const result of [cleanCaptureUrl(url),buildReplayUrl(url,criteria)]) assert.equal([...new URL(result).searchParams.values()].includes("private"),false);
});

test("translated menu labels replace opaque token display without changing replay values", () => {
  const route = captureRouteCriteria(example()); const dom = structuredClone(route);
  for (const item of dom) item.bindings=[{bindingId:item.criterionId+"-dom",type:"DOM"}];
  dom[0].observedRepresentation=["Kabel"]; dom[1].observedRepresentation=["Hand Modell"];
  const merged = mergeCriteria(route,dom);
  assert.equal(merged.length,2); assert.deepEqual(merged[0].observedRepresentation,["Kabel"]);
  assert.deepEqual(merged[0].desiredValue,["kabling"]);
  assert.deepEqual(new URL(buildReplayUrl(cleanCaptureUrl(example()),merged)).searchParams.get("f~stregkodelaesere_forbindelse"),"kabling");
});
