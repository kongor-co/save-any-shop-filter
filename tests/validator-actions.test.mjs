import test from "node:test";
import assert from "node:assert/strict";
import { validateSavedState, validateImportPayload, validateUiMessage } from "../src/shared/validator.js";

function domState() {
  return {
    schemaVersion: 4,
    id: "dom-state",
    name: "Committed filters",
    site: { origin: "https://shop.example", hostname: "shop.example", locale: "en", adapterId: "shop", adapterVersion: 2 },
    context: { surface: "PRODUCT_LIST", category: "Shoes", searchQuery: null, routeClass: "/shoes", compatibilityFingerprint: "shop" },
    criteria: [{
      criterionId: "brand",
      role: "FILTER",
      semanticType: "BRAND",
      desiredValue: ["Nike"],
      observedRepresentation: ["Nike"],
      dependencies: [],
      bindings: [{
        bindingId: "brand-dom",
        type: "DOM",
        origin: "https://shop.example",
        mapping: {
          mappingVersion: 2,
          controlType: "BOOLEAN",
          desiredValue: ["Nike"],
          filterContainer: { locatorChain: [{ type: "FIELDSET_LEGEND", value: "Brand" }] },
          option: { locatorChain: [{ type: "LABEL_TEXT", value: "Nike" }] },
          interactionPlan: [
            { action: "OPEN_FILTER_GROUP", timeoutMs: 1000 },
            { action: "ACTIVATE_OPTION", timeoutMs: 1000 },
            { action: "COMMIT", timeoutMs: 3000, locatorChain: [{ type: "BUTTON_TEXT", value: "Apply" }] },
            { action: "VERIFY_RESULT", timeoutMs: 3000 }
          ],
          verificationRule: { type: "OPTION_SELECTED", desiredValue: ["Nike"] }
        }
      }]
    }],
    metadata: {
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      captureUrl: "https://shop.example/shoes",
      routeSnapshot: "https://shop.example/shoes",
      supportLevel: "VERIFIED",
      unsupported: [],
      coverage: { activeDetected: 1, captured: 1, meaningfulCaptured: 1, unsupported: 0, unresolved: 0, defaultsIgnored: 0, saveEligible: true, saveReason: null, supportLevel: "VERIFIED" },
      lastReplayAt: null,
      lastSuccessfulReplayAt: null,
      health: "UNKNOWN"
    }
  };
}

test("validated plans accept bounded declarative commit workflows", () => {
  const state = domState();
  assert.equal(validateSavedState(state), state);
});

test("mapping version 3 supports labelled lists and summary groups without breaking older mappings", () => {
  for (const version of [1,2,3,4,5]) {
    const state=domState();
    state.criteria[0].bindings[0].mapping.mappingVersion=version;
    assert.equal(validateSavedState(state),state);
  }
  for (const type of ["LABELLED_LIST","DETAILS_SUMMARY"]) {
    const state=domState();
    const mapping=state.criteria[0].bindings[0].mapping;
    mapping.mappingVersion=3;
    mapping.filterContainer.locatorChain=[{type,value:"Brand"}];
    assert.equal(validateSavedState(state),state);
    mapping.mappingVersion=2;
    assert.throws(() => validateSavedState(state),/mapping version 3/);
  }
});

test("range endpoint locators require mapping version 4 and a known endpoint",()=>{
  const state=domState();
  const mapping=state.criteria[0].bindings[0].mapping;
  mapping.mappingVersion=4;
  mapping.option.locatorChain=[{type:"NATIVE_RANGE_ENDPOINT",value:"LOWER"}];
  assert.equal(validateSavedState(state),state);
  mapping.mappingVersion=3;
  assert.throws(()=>validateSavedState(state),/mapping version 4/);
  mapping.mappingVersion=4;
  mapping.option.locatorChain[0].value="FIRST";
  assert.throws(()=>validateSavedState(state),/Invalid range endpoint/);
});

test("portal dropdown locators require mapping version 5",()=>{
  const state=domState();
  const mapping=state.criteria[0].bindings[0].mapping;
  mapping.mappingVersion=5;
  mapping.filterContainer.locatorChain=[{type:"COMBOBOX_LABEL",value:"Menge"}];
  mapping.option.locatorChain=[{type:"DROPDOWN_OPTION",value:"15 St"}];
  assert.equal(validateSavedState(state),state);
  mapping.mappingVersion=4;
  assert.throws(()=>validateSavedState(state),/mapping version 5/);
});

test("import validation rejects changed origins, credentials, and ambiguous identities", () => {
  for (const key of ["captureUrl", "routeSnapshot"]) {
    for (const url of ["https://other.example/shoes", "https://user:password@shop.example/shoes", "javascript:alert(1)"]) {
      const state = domState();
      state.metadata[key] = url;
      assert.throws(() => validateImportPayload({schemaVersion:4, states:[state]}));
    }
  }
  const duplicate = domState();
  duplicate.criteria.push(structuredClone(duplicate.criteria[0]));
  assert.throws(() => validateSavedState(duplicate), /Duplicate criterion/);
});

test("untrusted mappings require supported versions, bounded plans and observable verification", () => {
  const changes = [
    (m) => { m.mappingVersion = 999; },
    (m) => { m.mappingVersion = undefined; },
    (m) => { m.verificationRule = null; },
    (m) => { m.verificationRule.type = "UNKNOWN"; },
    (m) => { m.verificationRule.desiredValue = ["Adidas"]; },
    (m) => { m.desiredValue = []; },
    (m) => { m.desiredValue = [{}]; },
    (m) => { m.desiredValue = [null]; },
    (m) => { m.desiredValue = [Number.NaN]; },
    (m) => { m.option.locatorChain = Array.from({length:11}, () => ({type:"ID",value:"brand"})); },
    (m) => { m.interactionPlan = Array.from({length:33}, () => ({action:"ACTIVATE_IF_NEEDED"})); },
    (m) => { m.interactionPlan[0].timeoutMs = 0; },
    (m) => { m.interactionPlan[0].timeoutMs = 8001; },
    (m) => { m.interactionPlan[0].timeoutMs = "3000"; },
    (m) => { m.interactionPlan[0].code = "click()"; },
    (m) => { m.option.locatorChain[0].script = "click()"; },
    (m) => { m.code = "click()"; }
  ];
  for (const change of changes) {
    const state = domState();
    change(state.criteria[0].bindings[0].mapping);
    assert.throws(() => validateSavedState(state));
  }
  const excessive = domState();
  excessive.criteria[0].bindings = Array.from({length:20}, () => structuredClone(excessive.criteria[0].bindings[0]));
  for (const binding of excessive.criteria[0].bindings) binding.mapping.interactionPlan = Array.from({length:32}, () => ({action:"VERIFY"}));
  assert.throws(() => validateSavedState(excessive), /Too many interaction steps/);
  const valid = domState();
  const binding = valid.criteria[0].bindings[0];
  binding.applicability = {locale:"en", viewport:"desktop", surface:"PRODUCT_LIST", routeClass:"/shoes", adapterVersion:2};
  assert.equal(validateSavedState(valid), valid);
  for (const bad of [{adapterVersion:0}, {adapterVersion:"2"}, {locale:""}, {unknown:"yes"}]) {
    binding.applicability = bad;
    assert.throws(() => validateSavedState(valid));
  }
  for (const [controlType, type] of [["NATIVE_SELECT", "SELECT_VALUE"], ["NUMERIC_VALUE", "INPUT_VALUE"], ["TEXT_VALUE", "INPUT_VALUE"]]) {
    const state = domState();
    Object.assign(state.criteria[0].bindings[0].mapping, {controlType, verificationRule:{type,desiredValue:["Nike"]}});
    assert.equal(validateSavedState(state), state);
  }
  for (const value of [true, 42]) {
    const state = domState();
    state.criteria[0].desiredValue = [value];
    assert.equal(validateSavedState(state), state);
  }
});

test("message schemas separate UI authority from document progress", () => {
  const messages = [
    {type:"GET_CAPTURE_PREVIEW",tabId:1}, {type:"SAVE_CAPTURE",tabId:1,preview:{}},
    {type:"LIST_STATES"}, {type:"RENAME_STATE",stateId:"s",name:"Name"},
    {type:"DUPLICATE_STATE",stateId:"s"}, {type:"DELETE_STATE",stateId:"s"},
    {type:"EXPORT_LIBRARY"}, {type:"EXPORT_LIBRARY",stateIds:["s"]},
    {type:"IMPORT_LIBRARY",payload:"{}"}, {type:"IMPORT_LIBRARY",payload:{}},
    {type:"START_REPLAY",stateId:"s",tabId:1}, {type:"CONFIRM_REPLAY_CONTEXT",replayId:"r"},
    {type:"CANCEL_REPLAY",replayId:"r"}, {type:"GET_ACTIVE_REPLAY",tabId:1}
  ];
  for (const message of messages) {
    assert.equal(validateUiMessage(message), message);
    assert.throws(() => validateUiMessage(message, "content"));
    assert.throws(() => validateUiMessage({...message, unknown:true}));
  }
  assert.throws(() => validateUiMessage({type:"START_REPLAY",stateId:"s",tabId:-1}));
  assert.throws(() => validateUiMessage({type:"EXPORT_LIBRARY",stateIds:[1]}));
  assert.throws(() => validateUiMessage({type:"SAVE_CAPTURE",tabId:1,preview:null}));
  assert.throws(() => validateUiMessage({type:"UNKNOWN"}));
  assert.throws(() => validateUiMessage(null));
  const result = {criterionId:"brand",status:"VERIFIED",semanticType:"BRAND",desiredValue:["Nike"],message:"Confirmed",evidence:"DOM_CONTROL"};
  const progress = {type:"REPLAY_PROGRESS",replayId:"r",status:"APPLYING",activeCriterion:"brand",results:[result]};
  assert.equal(validateUiMessage(progress, "content"), progress);
  validateUiMessage({...progress,status:"VERIFYING",activeCriterion:null}, "content");
  const complete = {type:"REPLAY_COMPLETE",replayId:"r",result:{replayId:"r",status:"COMPLETE",results:[result]}};
  assert.equal(validateUiMessage(complete, "content"), complete);
  validateUiMessage({type:"CONTENT_READY",href:"https://shop.example/"}, "content");
  for (const patch of [{status:"COMPLETE"}, {replayId:42}, {results:null}, {results:[{...result,status:"INVALID"}]}, {results:[{...result,code:"x"}]}, {results:[{...result,desiredValue:"Nike"}]}, {activeCriterion:42}]) {
    assert.throws(() => validateUiMessage({...progress,...patch}, "content"));
  }
  for (const patch of [{status:"APPLYING"}, {results:null}, {code:"x"}, {replayId:null}]) {
    assert.throws(() => validateUiMessage({...complete,result:{...complete.result,...patch}}, "content"));
  }
});

test("action locator chains reject unknown locator types", () => {
  const state = domState();
  state.criteria[0].bindings[0].mapping.interactionPlan[2].locatorChain = [{ type: "CSS_SELECTOR", value: "button" }];
  assert.throws(() => validateSavedState(state), /Unknown locator type/);
});

test("DOM bindings cannot target a different origin", () => {
  const state = domState();
  state.criteria[0].bindings[0].origin = "https://evil.example";
  assert.throws(() => validateSavedState(state), /Binding origin mismatch/);
});

test("URL path and query bindings enforce shape limits", () => {
  const path = domState();
  path.criteria[0].bindings = [{ bindingId: "bad-path", type: "URL_PATH", pathname: "relative/path" }];
  assert.throws(() => validateSavedState(path), /Invalid URL pathname/);

  const query = domState();
  query.criteria[0].bindings = [{ bindingId: "bad-query", type: "URL_QUERY", parameter: "brand", values: "nike" }];
  assert.throws(() => validateSavedState(query), /Invalid query values/);
});
