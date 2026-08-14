import {
  ACTION_TYPES,
  BINDING_TYPES,
  CONTROL_TYPES,
  CRITERION_ROLES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_STATES,
  SCHEMA_VERSION
} from "./constants.js";
import { topologicalSort } from "./planner.js";
import { calculateCoverage } from "./coverage.js";
import { routeSchemaInfo } from "../adapters/route-schemas.js";

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
    for (const value of criterion.desiredValue) assert(validString(String(value), 500), "Invalid desired value item");
    assert(Array.isArray(criterion.dependencies), "Invalid dependencies");
    if (criterion.atomicGroup !== undefined) assert(validString(criterion.atomicGroup, 100), "Invalid atomic group");
    assert(Array.isArray(criterion.bindings) && criterion.bindings.length <= 20, "Invalid bindings");
    for (const binding of criterion.bindings) validateBinding(binding, state.site.origin);
  }
  topologicalSort(state.criteria);
  assert(state.metadata && typeof state.metadata === "object", "Missing metadata");
  assert(state.metadata.coverage && typeof state.metadata.coverage === "object", "Missing coverage report");
  assert(typeof state.metadata.coverage.saveEligible === "boolean", "Invalid coverage report");
  return state;
}

function validateLocator(locator) {
  assert(locator && typeof locator === "object", "Invalid locator");
  assert(validString(locator.type, 80), "Invalid locator type");
  assert(validString(String(locator.value), 500), "Invalid locator value");
  const allowed = new Set(["ID", "NAME_VALUE", "ARIA_LABEL", "LABEL_TEXT", "BUTTON_TEXT", "LINK_TEXT", "SELECT_NAME", "FIELDSET_LEGEND", "GROUP_ARIA_LABEL", "HEADING_TEXT", "IDEALO_FILTER_GROUP", "IDEALO_OPTION"]);
  assert(allowed.has(locator.type), "Unknown locator type");
}

function validateBinding(binding, origin) {
  assert(binding && typeof binding === "object", "Invalid binding");
  assert(validString(binding.bindingId, 100), "Invalid binding id");
  assert(BINDING_TYPES.has(binding.type), "Unknown binding type");
  if (binding.origin) assert(binding.origin === origin, "Binding origin mismatch");
  if (binding.type === "URL_QUERY") {
    assert(validString(binding.parameter, 200), "Invalid query parameter");
    assert(Array.isArray(binding.values) && binding.values.length <= 100, "Invalid query values");
    for (const value of binding.values) assert(validString(String(value), 500), "Invalid query value");
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
    assert(mapping && typeof mapping === "object", "Missing DOM mapping");
    assert(CONTROL_TYPES.has(mapping.controlType), "Unknown control type");
    assert(mapping.filterContainer && Array.isArray(mapping.filterContainer.locatorChain) && mapping.filterContainer.locatorChain.length > 0, "Missing container locator chain");
    assert(mapping.option && Array.isArray(mapping.option.locatorChain) && mapping.option.locatorChain.length > 0, "Missing option locator chain");
    mapping.filterContainer.locatorChain.forEach(validateLocator);
    mapping.option.locatorChain.forEach(validateLocator);
    assert(Array.isArray(mapping.interactionPlan), "Invalid interaction plan");
    for (const step of mapping.interactionPlan) {
      assert(step && ACTION_TYPES.has(step.action), "Unknown interaction action");
      assert(!Object.values(step).some((value) => typeof value === "string" && FORBIDDEN_TEXT.test(value)), "Forbidden executable text");
      if (step.locatorChain !== undefined) {
        assert(Array.isArray(step.locatorChain) && step.locatorChain.length <= 10, "Invalid action locator chain");
        step.locatorChain.forEach(validateLocator);
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

export function validateUiMessage(message) {
  assert(message && typeof message === "object" && validString(message.type, 80), "Invalid message");
  return message;
}

export function sanitizeName(name, fallback = "Saved filters") {
  const clean = String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return clean || fallback;
}
