import { CRITERION_STATUS, REPLAY_STATUS } from "./constants.js";

export const CONTEXT_COMPATIBILITY = Object.freeze({
  EXACT: "EXACT",
  COMPATIBLE: "COMPATIBLE",
  UNCERTAIN: "UNCERTAIN",
  INCOMPATIBLE: "INCOMPATIBLE"
});

const BROKEN_MAPPING_RESULTS = new Set([CRITERION_STATUS.MAPPING_BROKEN]);
const DEGRADED_MAPPING_RESULTS = new Set([
  CRITERION_STATUS.ROUTE_ONLY,
  CRITERION_STATUS.FILTER_UNAVAILABLE,
  CRITERION_STATUS.RESOLUTION_INCONCLUSIVE,
  CRITERION_STATUS.UNSUPPORTED_INTERACTION,
  CRITERION_STATUS.VERIFY_FAILED
]);

export function routeClassForUrl(urlLike) {
  const url = new URL(urlLike);
  return url.pathname.replace(/\b\d+\b/g, ":id").replace(/\/+$/, "") || "/";
}

export function surfaceForPageType(pageType) {
  if (pageType === "LISTING") return "PRODUCT_LIST";
  if (pageType === "SEARCH") return "SEARCH_RESULTS";
  return "UNSUPPORTED";
}

export function buildRuntimeContext({ url, pageType, category = null, searchQuery = null, locale = "und", viewport = null }) {
  const parsed = new URL(url);
  const surface = surfaceForPageType(pageType);
  const routeClass = routeClassForUrl(parsed);
  const normalizedLocale = normalizeLocale(locale);
  return {
    origin: parsed.origin,
    surface,
    category: cleanContextValue(category),
    searchQuery: cleanContextValue(searchQuery),
    routeClass,
    locale: normalizedLocale,
    viewport: viewport || null,
    compatibilityFingerprint: `${parsed.origin}|${surface}|${routeClass}|${normalizedLocale}`
  };
}

export function classifyContextCompatibility(expected, current) {
  if (!expected?.origin || !current?.origin || !expected?.surface || !current?.surface) {
    return compatibility(CONTEXT_COMPATIBILITY.INCOMPATIBLE, ["Context identity is missing."]);
  }
  if (expected.origin && current.origin && expected.origin !== current.origin) {
    return compatibility(CONTEXT_COMPATIBILITY.INCOMPATIBLE, ["The page origin differs from the saved origin."]);
  }
  if (expected.surface && current.surface && expected.surface !== current.surface) {
    return compatibility(CONTEXT_COMPATIBILITY.INCOMPATIBLE, ["The page type differs from the saved listing type."]);
  }

  const reasons = [];
  const expectedSearch = cleanContextValue(expected.searchQuery);
  const currentSearch = cleanContextValue(current.searchQuery);
  if (expectedSearch && currentSearch && expectedSearch !== currentSearch) {
    return compatibility(CONTEXT_COMPATIBILITY.INCOMPATIBLE, ["The current search query differs from the saved query."]);
  }
  if (expectedSearch && !currentSearch) reasons.push("The saved search query is not visible in the current context.");

  const expectedRoute = cleanContextValue(expected.routeClass);
  const currentRoute = cleanContextValue(current.routeClass);
  if (expectedRoute && currentRoute && expectedRoute !== currentRoute) {
    reasons.push("The retailer redirected to a different route class.");
  }

  const expectedCategory = cleanContextValue(expected.category);
  const currentCategory = cleanContextValue(current.category);
  if (expectedCategory && currentCategory && !contextLabelsOverlap(expectedCategory, currentCategory)) {
    reasons.push("The visible category differs from the saved category.");
  }
  if (expectedCategory ? !currentCategory : false) reasons.push("The saved category is not visible in the current context.");

  const expectedLocale = normalizeLocale(expected.locale);
  const currentLocale = normalizeLocale(current.locale);
  if (expectedLocale !== "und" ? currentLocale === "und" : false) reasons.push("The current storefront locale is unknown.");
  if (expectedLocale !== "und" && currentLocale !== "und" && expectedLocale !== currentLocale) {
    reasons.push("The storefront locale differs from the saved locale.");
  }

  if (reasons.length) return compatibility(CONTEXT_COMPATIBILITY.UNCERTAIN, reasons);
  if (expected.compatibilityFingerprint && expected.compatibilityFingerprint === current.compatibilityFingerprint) {
    return compatibility(CONTEXT_COMPATIBILITY.EXACT, []);
  }
  return compatibility(CONTEXT_COMPATIBILITY.COMPATIBLE, []);
}

export function bindingApplies(binding, runtimeContext = {}) {
  const applicability = binding?.applicability;
  if (!applicability || typeof applicability !== "object") return true;
  for (const key of ["viewport", "surface", "routeClass", "adapterVersion"]) {
    if (applicability[key] === undefined) continue;
    if (applicability[key] !== runtimeContext[key]) return false;
  }
  if (applicability.locale) {
    if (!runtimeContext.locale || normalizeLocale(runtimeContext.locale) === "und") return false;
  }
  if (applicability.locale && runtimeContext.locale && normalizeLocale(applicability.locale) !== normalizeLocale(runtimeContext.locale)) return false;
  return true;
}

export function selectApplicableCriteria(criteria, runtimeContext) {
  return criteria.map((criterion) => {
    const bindings = (criterion.bindings || []).filter((binding) => bindingApplies(binding, runtimeContext));
    return {
      ...criterion,
      bindings,
      applicabilityUnavailable: bindings.length === 0 && (criterion.bindings || []).length > 0
    };
  });
}

export function deriveMappingHealth(results, previousHealth = "UNKNOWN") {
  if (!Array.isArray(results) || results.length === 0) return previousHealth;
  const statuses = results.map((result) => result?.status).filter(Boolean);
  if (statuses.some((status) => BROKEN_MAPPING_RESULTS.has(status))) return "BROKEN";
  if (statuses.some((status) => DEGRADED_MAPPING_RESULTS.has(status))) return "DEGRADED";
  return statuses.some((status) => ["VERIFIED", "APPLIED", "ALREADY_APPLIED"].includes(status)) ? "HEALTHY" : previousHealth;
}

export function recoveryDecision(checkpoint) {
  if (!checkpoint || checkpoint.cancelRequested) return "IGNORE";
  if ([
    REPLAY_STATUS.COMPLETE,
    REPLAY_STATUS.COMPLETE_WITH_WARNINGS,
    REPLAY_STATUS.PARTIAL,
    REPLAY_STATUS.FAILED,
    REPLAY_STATUS.CANCELLED,
    REPLAY_STATUS.INTERRUPTED,
    REPLAY_STATUS.AWAITING_CONFIRMATION
  ].includes(checkpoint.status)) return "IGNORE";
  if (checkpoint.checkpointVersion !== 3) return "INTERRUPT";
  if ([REPLAY_STATUS.PLANNING, REPLAY_STATUS.WAITING_NAVIGATION].includes(checkpoint.status)) return "RESUME";
  if (checkpoint.status === REPLAY_STATUS.PREFLIGHT) return "PREFLIGHT";
  if ([REPLAY_STATUS.APPLYING, REPLAY_STATUS.VERIFYING].includes(checkpoint.status)) return "RECONNECT";
  return "INTERRUPT";
}

function compatibility(level, reasons) {
  return { level, reasons };
}

function cleanContextValue(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return normalized || null;
}

function normalizeLocale(value) {
  return String(value || "und").trim().replaceAll("_", "-").toLocaleLowerCase() || "und";
}

function contextLabelsOverlap(left, right) {
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}
