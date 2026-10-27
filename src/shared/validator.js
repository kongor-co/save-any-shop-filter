import {
  ACTION_TYPES,
  BINDING_TYPES,
  CONTROL_TYPES,
  CRITERION_ROLES,
  CRITERION_STATUS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_STATES,
  MESSAGE,
  MAPPING_VERSION,
  REPLAY_STATUS,
  SCHEMA_VERSION
} from "./constants.js";
import { topologicalSort } from "./planner.js";
import { calculateCoverage } from "./coverage.js";
import { routeSchemaInfo } from "../adapters/route-schemas.js";
import { buildReplayUrl } from "./route.js";

const FORBIDDEN_TEXT = /(?:javascript\s*:|\beval\s*\(|\bFunction\s*\(|<script\b)/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validString(value, max = 500) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !FORBIDDEN_TEXT.test(value);
}

export function validateSavedState(state) {
  assert(state && typeof state === "object" && !Array.isArray(state), "State must be an object");
  assert(state.schemaVersion === SCHEMA_VERSION, "Unsupported schema version");
  assert(validString(state.id, 100), "Invalid state id");
  assert(validString(state.name, 160), "Invalid state name");
  assert(state.site && validString(state.site.origin, 500), "Invalid site origin");
  const origin = new URL(state.site.origin);
  assert(origin.protocol === "https:" || origin.protocol === "http:", "Unsupported site protocol");
  assert(origin.origin === state.site.origin, "Site origin must be canonical");
  assert(state.context && typeof state.context === "object", "Missing context");
  assert(Array.isArray(state.criteria) && state.criteria.length <= 250, "Invalid criteria");

  for (const criterion of state.criteria) {
    assert(validString(criterion.criterionId, 100), "Invalid criterion id");
    assert(CRITERION_ROLES.has(criterion.role), "Invalid criterion role");
    assert(validString(criterion.semanticType, 100), "Invalid semantic type");
    assert(Array.isArray(criterion.desiredValue) && criterion.desiredValue.length <= 100, "Invalid desired value");
    for (const value of criterion.desiredValue) assert(validValue(value), "Invalid desired value item");
    assert(Array.isArray(criterion.dependencies), "Invalid dependencies");
    if (criterion.atomicGroup !== undefined) assert(validString(criterion.atomicGroup, 100), "Invalid atomic group");
    assert(Array.isArray(criterion.bindings) && criterion.bindings.length <= 20, "Invalid bindings");
    for (const binding of criterion.bindings) validateBinding(binding, state.site.origin);
  }
  assert(state.criteria.length > 0, "State must contain criteria");
  topologicalSort(state.criteria);
  assert(new Set(state.criteria.map((item) => item.criterionId)).size === state.criteria.length, "Duplicate criterion id");
  const actionCount = state.criteria.flatMap((item) => item.bindings).reduce((count, binding) => count + (binding.mapping?.interactionPlan?.length || 0), 0);
  assert(actionCount <= 512, "Too many interaction steps");
  assert(state.metadata && typeof state.metadata === "object", "Missing metadata");
  assert(state.metadata.coverage && typeof state.metadata.coverage === "object", "Missing coverage report");
  assert(typeof state.metadata.coverage.saveEligible === "boolean", "Invalid coverage report");
  validateReplayUrl(state.metadata.captureUrl, state.site.origin);
  if (state.metadata.routeSnapshot !== undefined) validateReplayUrl(state.metadata.routeSnapshot, state.site.origin);
  validateReplayUrl(buildReplayUrl(state.metadata.routeSnapshot || state.metadata.captureUrl, state.criteria), state.site.origin);
  return state;
}

export function validateReplayUrl(value, origin) {
  assert(validString(value, 4000), "Invalid replay URL");
  const url = new URL(value);
  assert(url.origin === origin, "Replay URL origin mismatch");
  assert(!url.username, "Replay URL must not contain credentials");
  assert(!url.password, "Replay URL must not contain credentials");
  return url;
}

function onlyFields(value, fields, error) {
  assert(plainObject(value), error);
  assert(Object.keys(value).every((key) => fields.includes(key)), error);
}

function validValue(value) {
  if (typeof value === "string") return validString(value, 500);
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

function valueList(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 0 || value.length > 100) return false;
  return value.every(validValue);
}

function validateLocator(locator, mappingVersion) {
  onlyFields(locator, ["type", "value"], "Invalid locator fields");
  assert(locator && typeof locator === "object", "Invalid locator");
  assert(validString(locator.type, 80), "Invalid locator type");
  assert(validString(String(locator.value), 500), "Invalid locator value");
  const allowed = new Set(["ID", "NAME_VALUE", "ARIA_LABEL", "LABEL_TEXT", "BUTTON_TEXT", "LINK_TEXT", "SELECT_NAME", "FIELDSET_LEGEND", "GROUP_ARIA_LABEL", "HEADING_TEXT", "IDEALO_FILTER_GROUP", "IDEALO_OPTION"]);
  const genericGroup = ["LABELLED_LIST", "DETAILS_SUMMARY"].includes(locator.type);
  if (genericGroup) assert(mappingVersion >= 3, "Locator requires mapping version 3");
  const rangeEndpoint = locator.type === "NATIVE_RANGE_ENDPOINT";
  if (rangeEndpoint) {
    assert(mappingVersion >= 4, "Locator requires mapping version 4");
    assert(["LOWER","UPPER"].includes(locator.value), "Invalid range endpoint");
  }
  assert(allowed.has(locator.type) || genericGroup || rangeEndpoint, "Unknown locator type");
}

function validateBinding(binding, origin) {
  if (binding.applicability !== undefined) {
    onlyFields(binding.applicability, ["viewport", "locale", "surface", "routeClass", "adapterVersion"], "Invalid binding applicability");
    for (const [key, value] of Object.entries(binding.applicability)) {
      if (key === "adapterVersion") assert(Number.isInteger(value) ? value > 0 : false, "Invalid adapter applicability");
      else assert(validString(value, 200), "Invalid binding applicability value");
    }
  }
  assert(binding && typeof binding === "object", "Invalid binding");
  assert(validString(binding.bindingId, 100), "Invalid binding id");
  assert(BINDING_TYPES.has(binding.type), "Unknown binding type");
  if (binding.origin) assert(binding.origin === origin, "Binding origin mismatch");
  if (binding.semanticEvidence !== undefined) assert(typeof binding.semanticEvidence === "boolean", "Invalid semantic evidence flag");
  if (binding.type === "URL_QUERY") {
    assert(validString(binding.parameter, 200), "Invalid query parameter");
    assert(Array.isArray(binding.values) && binding.values.length <= 100, "Invalid query values");
    for (const value of binding.values) assert(validValue(value), "Invalid query value");
    if (binding.verificationTexts !== undefined) {
      assert(Array.isArray(binding.verificationTexts) && binding.verificationTexts.length <= 100, "Invalid query verification values");
      for (const value of binding.verificationTexts) assert(validString(String(value), 500), "Invalid query verification value");
    }
    return;
  }
  if (binding.type === "URL_PATH") {
    assert(validString(binding.pathname, 2000) && binding.pathname.startsWith("/"), "Invalid URL pathname");
    if (binding.verificationTexts !== undefined) {
      assert(Array.isArray(binding.verificationTexts) && binding.verificationTexts.length <= 100, "Invalid path verification values");
      for (const value of binding.verificationTexts) assert(validString(String(value), 500), "Invalid path verification value");
    }
    return;
  }
  if (binding.type === "DOM") {
    const mapping = binding.mapping;
    onlyFields(mapping, ["mappingVersion", "controlType", "desiredValue", "filterContainer", "option", "interactionPlan", "verificationRule"], "Invalid mapping fields");
    assert([1, 2, 3, MAPPING_VERSION].includes(mapping.mappingVersion), "Unsupported mapping version");
    assert(valueList(mapping.desiredValue), "Invalid mapping desired value");
    onlyFields(mapping.verificationRule, ["type", "desiredValue"], "Invalid verification rule");
    const ruleType = mapping.controlType === "NATIVE_SELECT" ? "SELECT_VALUE"
      : ["TEXT_VALUE", "NUMERIC_VALUE"].includes(mapping.controlType) ? "INPUT_VALUE" : "OPTION_SELECTED";
    assert(mapping.verificationRule.type === ruleType, "Invalid verification rule type");
    assert(valueList(mapping.verificationRule.desiredValue), "Invalid verification values");
    assert(JSON.stringify(mapping.verificationRule.desiredValue) === JSON.stringify(mapping.desiredValue), "Verification values differ from mapping");
    for (const part of [mapping.filterContainer, mapping.option]) {
      onlyFields(part, ["locatorChain", "semanticValue"], "Invalid mapping target");
      assert(Array.isArray(part.locatorChain) ? part.locatorChain.length <= 10 : false, "Too many locators");
    }
    assert(Array.isArray(mapping.interactionPlan) ? mapping.interactionPlan.length <= 32 : false, "Too many interaction steps");
    assert(mapping && typeof mapping === "object", "Missing DOM mapping");
    assert(CONTROL_TYPES.has(mapping.controlType), "Unknown control type");
    assert(mapping.filterContainer && Array.isArray(mapping.filterContainer.locatorChain) && mapping.filterContainer.locatorChain.length > 0, "Missing container locator chain");
    assert(mapping.option && Array.isArray(mapping.option.locatorChain) && mapping.option.locatorChain.length > 0, "Missing option locator chain");
    mapping.filterContainer.locatorChain.forEach((locator) => validateLocator(locator, mapping.mappingVersion));
    mapping.option.locatorChain.forEach((locator) => validateLocator(locator, mapping.mappingVersion));
    assert(Array.isArray(mapping.interactionPlan), "Invalid interaction plan");
    for (const step of mapping.interactionPlan) {
      onlyFields(step, ["action", "timeoutMs", "locatorChain"], "Invalid interaction step fields");
      if (step.timeoutMs !== undefined) {
        assert(Number.isInteger(step.timeoutMs), "Invalid step timeout");
        assert(step.timeoutMs > 0, "Invalid step timeout");
        assert(step.timeoutMs <= 8000, "Invalid step timeout");
      }
      assert(step && ACTION_TYPES.has(step.action), "Unknown interaction action");
      assert(!Object.values(step).some((value) => typeof value === "string" && FORBIDDEN_TEXT.test(value)), "Forbidden executable text");
      if (step.locatorChain !== undefined) {
        assert(Array.isArray(step.locatorChain) && step.locatorChain.length <= 10, "Invalid action locator chain");
        step.locatorChain.forEach((locator) => validateLocator(locator, mapping.mappingVersion));
      }
    }
  }
}

export function validateImportPayload(payload) {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  assert(new TextEncoder().encode(serialized).length <= MAX_IMPORT_BYTES, "Import exceeds size limit");
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  assert(parsed && typeof parsed === "object", "Import must be an object");
  assert([3, SCHEMA_VERSION].includes(parsed.schemaVersion), "Unsupported export schema version");
  assert(Array.isArray(parsed.states) && parsed.states.length <= MAX_IMPORT_STATES, "Invalid import state count");
  const migrated = { ...parsed, schemaVersion: SCHEMA_VERSION, states: parsed.states.map(migrateSavedState) };
  migrated.states.forEach(validateSavedState);
  return migrated;
}

export function migrateSavedState(rawState) {
  assert(rawState && typeof rawState === "object" && !Array.isArray(rawState), "State must be an object");
  if (rawState.schemaVersion === SCHEMA_VERSION) return structuredClone(rawState);
  assert(rawState.schemaVersion === 3, "Unsupported schema version");
  const state = structuredClone(rawState);
  const captureUrl = state.metadata?.captureUrl;
  const schema = captureUrl ? routeSchemaInfo(captureUrl) : { id: "generic", version: 1 };
  state.schemaVersion = SCHEMA_VERSION;
  state.site = {
    ...state.site,
    routeSchemaId: state.site?.routeSchemaId || schema.id,
    routeSchemaVersion: state.site?.routeSchemaVersion || schema.version
  };
  for (const criterion of state.criteria || []) {
    for (const binding of criterion.bindings || []) {
      if (binding.type === "DOM" && binding.mapping) {
        binding.mapping.mappingVersion ||= 1;
      }
    }
  }
  const unsupported = state.metadata?.unsupported || [];
  state.metadata = {
    ...state.metadata,
    routeSnapshot: state.metadata?.routeSnapshot || captureUrl,
    coverage: state.metadata?.coverage || calculateCoverage({
      criteria: state.criteria || [],
      unsupported,
      adapterId: state.site?.adapterId || "generic"
    }),
    health: "UNKNOWN"
  };
  return state;
}

export function validateUiMessage(message, source = "ui") {
  assert(message && typeof message === "object" && !Array.isArray(message) && validString(message.type, 80), "Invalid message");
  const uiSchemas = {
    [MESSAGE.GET_CAPTURE_PREVIEW]: { fields: ["tabId"], validate: () => validTabId(message.tabId) },
    [MESSAGE.SAVE_CAPTURE]: { fields: ["tabId", "preview", "name"], validate: () => validTabId(message.tabId) && plainObject(message.preview) && optionalString(message.name, 160) },
    [MESSAGE.LIST_STATES]: { fields: [], validate: () => true },
    [MESSAGE.RENAME_STATE]: { fields: ["stateId", "name"], validate: () => validString(message.stateId, 100) && validString(message.name, 160) },
    [MESSAGE.DUPLICATE_STATE]: { fields: ["stateId"], validate: () => validString(message.stateId, 100) },
    [MESSAGE.DELETE_STATE]: { fields: ["stateId"], validate: () => validString(message.stateId, 100) },
    [MESSAGE.EXPORT_LIBRARY]: { fields: ["stateIds"], validate: () => message.stateIds === undefined || validIdList(message.stateIds) },
    [MESSAGE.IMPORT_LIBRARY]: { fields: ["payload"], validate: () => typeof message.payload === "string" || plainObject(message.payload) },
    [MESSAGE.START_REPLAY]: { fields: ["stateId", "tabId"], validate: () => validString(message.stateId, 100) && validTabId(message.tabId) },
    [MESSAGE.CONFIRM_REPLAY_CONTEXT]: { fields: ["replayId"], validate: () => validString(message.replayId, 100) },
    [MESSAGE.CANCEL_REPLAY]: { fields: ["replayId"], validate: () => validString(message.replayId, 100) },
    [MESSAGE.GET_ACTIVE_REPLAY]: { fields: ["tabId"], validate: () => validTabId(message.tabId) }
  };
  const contentSchemas = {
    [MESSAGE.CONTENT_READY]: { fields: ["href"], validate: () => validString(message.href, 4000) },
    [MESSAGE.REPLAY_PROGRESS]: {
      fields: ["replayId", "status", "activeCriterion", "results"],
      validate: () => validString(message.replayId, 100)
        && [REPLAY_STATUS.APPLYING, REPLAY_STATUS.VERIFYING].includes(message.status)
        && (message.activeCriterion === null || validString(message.activeCriterion, 100))
        && validResultList(message.results)
    },
    [MESSAGE.REPLAY_COMPLETE]: {
      fields: ["replayId", "result"],
      validate: () => validString(message.replayId, 100) && validReplayResult(message.result)
    }
  };
  const schemas = source === "content" ? contentSchemas : uiSchemas;
  const schema = schemas[message.type];
  assert(schema, source === "content" ? "Unauthorized content message" : "Unknown UI message");
  const allowed = new Set(["type", ...schema.fields]);
  assert(Object.keys(message).every((key) => allowed.has(key)), "Unexpected message field");
  assert(schema.validate(), "Invalid message payload");
  return message;
}

function validReplayResult(result) {
  return plainObject(result)
    && validString(result.replayId, 100)
    && [REPLAY_STATUS.COMPLETE, REPLAY_STATUS.COMPLETE_WITH_WARNINGS, REPLAY_STATUS.PARTIAL, REPLAY_STATUS.FAILED, REPLAY_STATUS.CANCELLED].includes(result.status)
    && validResultList(result.results)
    && Object.keys(result).every((key) => ["replayId", "status", "results"].includes(key));
}

function validResultList(results) {
  if (!Array.isArray(results) || results.length > 250) return false;
  const statuses = new Set(Object.values(CRITERION_STATUS));
  return results.every((result) => plainObject(result)
    && validString(result.criterionId, 100)
    && optionalString(result.semanticType, 100)
    && (result.desiredValue === undefined || (Array.isArray(result.desiredValue) && result.desiredValue.length <= 100))
    && statuses.has(result.status)
    && optionalString(result.message, 1000)
    && (result.evidence === null || optionalString(result.evidence, 200))
    && Object.keys(result).every((key) => ["criterionId", "semanticType", "desiredValue", "status", "message", "evidence"].includes(key)));
}

function validIdList(value) {
  return Array.isArray(value) && value.length <= MAX_IMPORT_STATES && value.every((item) => validString(item, 100));
}

function validTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

function optionalString(value, max) {
  return value === undefined || value === null || validString(value, max);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeName(name, fallback = "Saved filters") {
  const clean = String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return clean || fallback;
}
