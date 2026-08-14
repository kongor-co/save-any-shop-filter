import {
  findRouteSchema,
  routeSchemaInfo,
  schemaParameterDescriptor,
  schemaPathCriteria
} from "../adapters/route-schemas.js";

const FILTER_KEYS = new Set([
  "brand", "brands", "size", "sizes", "color", "colour", "material", "condition",
  "availability", "stock", "shipping", "seller", "waterproof", "gender", "min_price",
  "max_price", "price_min", "price_max", "price", "department", "rh", "facets",
  "bodytype", "pricemin", "pricemax", "instock", "insale", "fullbattery"
]);
const CONTEXT_KEYS = new Set([
  "q", "query", "search", "keyword", "category", "department", "k", "ntt",
  "originquery", "queryinitial"
]);
const PRESENTATION_KEYS = new Set(["sort", "sortby", "sortkey", "order", "view", "layout"]);
const PAGINATION_KEYS = new Set(["page", "p", "cursor", "offset", "start", "limit"]);
const EPHEMERAL_PATTERN = /^(utm_|gclid$|fbclid$|msclkid$|ref$|ref_|affiliate|aff_|campaign|experiment|session|token|querymeta|queryrequestid|searchfeatures|qid$|rnid$|ds$|dc$)/i;
const FILTER_PATTERN = /(?:^f_(?:prop|variant)_|^refinementlist\[|filter|facet|refinement|(?:^|[_~-])(?:min|max|preis|price)(?:$|[_~-])|brand|size|color|colour|bodytype|wsvcampaign)/i;

export function normalizeSemanticType(value) {
  return String(value || "UNKNOWN")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "UNKNOWN";
}

export function classifyRouteParameter(name, urlLike = null) {
  if (urlLike) {
    const owned = schemaParameterDescriptor(findRouteSchema(urlLike), name);
    if (owned) return owned.role;
  }
  const key = String(name).toLowerCase();
  if (PAGINATION_KEYS.has(key)) return "PAGINATION";
  if (EPHEMERAL_PATTERN.test(key)) return "EPHEMERAL";
  if (PRESENTATION_KEYS.has(key)) return "PRESENTATION";
  if (CONTEXT_KEYS.has(key)) return "CONTEXT";
  if (FILTER_KEYS.has(key) || FILTER_PATTERN.test(key)) return "FILTER";
  return "IGNORED";
}

export function getRouteSchemaInfo(urlLike) {
  return routeSchemaInfo(urlLike);
}

function stableId(prefix, ...parts) {
  const text = parts.join("|").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${prefix}-${text}`.slice(0, 96);
}

export function captureRouteCriteria(urlLike, { includePresentation = false } = {}) {
  const url = new URL(urlLike);
  const schema = findRouteSchema(url);
  const grouped = new Map();

  for (const [parameter, value] of url.searchParams.entries()) {
    const owned = schemaParameterDescriptor(schema, parameter);
    const classification = owned?.role || classifyRouteParameter(parameter);
    if (["IGNORED", "EPHEMERAL", "PAGINATION"].includes(classification)) continue;
    if (classification === "PRESENTATION" && !includePresentation) continue;
    const canonical = owned?.canonical || parameter.toLowerCase();
    const semanticType = owned?.semanticType || normalizeSemanticType(parameter);
    const groupKey = `${classification}:${canonical}:${semanticType}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        canonical,
        classification,
        semanticType,
        atomicGroup: owned?.atomicGroup || null,
        values: [],
        parameters: new Map()
      });
    }
    const group = grouped.get(groupKey);
    group.values.push(value);
    if (!group.parameters.has(parameter)) group.parameters.set(parameter, []);
    group.parameters.get(parameter).push(value);
  }

  const queryCriteria = [...grouped.values()].map((group) => ({
    criterionId: stableId("route", group.canonical, group.semanticType),
    role: group.classification,
    semanticType: group.semanticType,
    desiredValue: [...new Set(group.values)],
    observedRepresentation: [...new Set(group.values)],
    dependencies: [],
    atomicGroup: group.atomicGroup || undefined,
    bindings: [...group.parameters].map(([parameter, values]) => ({
      bindingId: stableId("binding", "query", parameter),
      type: "URL_QUERY",
      parameter,
      encoding: values.length > 1 ? "REPEATED" : "SINGLE",
      values: [...new Set(values)],
      verificationTexts: [...new Set(values)],
      applicability: {}
    }))
  }));

  const pathCriteria = schemaPathCriteria(schema, url).map((criterion) => ({
    criterionId: stableId("route", schema?.id || "generic", criterion.key, ...criterion.desiredValue),
    role: criterion.role,
    semanticType: criterion.semanticType,
    desiredValue: criterion.desiredValue,
    observedRepresentation: criterion.observedRepresentation,
    dependencies: [],
    pathSummary: criterion.pathSummary || undefined,
    bindings: [{
      bindingId: stableId("binding", "path", schema?.id || "generic", criterion.key),
      type: "URL_PATH",
      pathname: criterion.pathname,
      verificationTexts: criterion.verificationTexts || [],
      applicability: {}
    }]
  }));

  return [...pathCriteria, ...queryCriteria];
}

export function cleanCaptureUrl(urlLike, { includePresentation = false } = {}) {
  const url = new URL(urlLike);
  const schema = findRouteSchema(url);
  for (const key of [...url.searchParams.keys()]) {
    const kind = schemaParameterDescriptor(schema, key)?.role || classifyRouteParameter(key);
    if (["PAGINATION", "EPHEMERAL", "IGNORED"].includes(kind) || (kind === "PRESENTATION" && !includePresentation)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

export function buildReplayUrl(captureUrl, criteria) {
  const url = new URL(cleanCaptureUrl(captureUrl, { includePresentation: true }));
  for (const criterion of criteria) {
    for (const binding of criterion.bindings || []) {
      if (binding.type === "URL_PATH" && typeof binding.pathname === "string") {
        url.pathname = binding.pathname;
        continue;
      }
      if (binding.type !== "URL_QUERY") continue;
      url.searchParams.delete(binding.parameter);
      for (const value of binding.values || []) url.searchParams.append(binding.parameter, String(value));
    }
  }
  const schema = findRouteSchema(url);
  for (const key of [...url.searchParams.keys()]) {
    const kind = schemaParameterDescriptor(schema, key)?.role || classifyRouteParameter(key);
    if (["PAGINATION", "EPHEMERAL", "IGNORED"].includes(kind)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

export function routeBindingMatches(urlLike, binding) {
  if (!binding) return false;
  if (binding.type === "URL_PATH") return new URL(urlLike).pathname === binding.pathname;
  if (binding.type !== "URL_QUERY") return false;
  const actual = new URL(urlLike).searchParams.getAll(binding.parameter).map(String).sort();
  const desired = (binding.values || []).map(String).sort();
  return actual.length === desired.length && actual.every((value, index) => value === desired[index]);
}

export function mergeCriteria(routeCriteria, domCriteria) {
  const merged = structuredClone(routeCriteria);
  for (const domCriterion of domCriteria) {
    const existing = merged.find((criterion) => {
      if (criterion.semanticType !== domCriterion.semanticType) return false;
      const left = [...criterion.desiredValue].map((v) => String(v).toLowerCase()).sort().join("|");
      const right = [...domCriterion.desiredValue].map((v) => String(v).toLowerCase()).sort().join("|");
      return left === right;
    });
    if (existing) {
      existing.bindings.push(...domCriterion.bindings);
      existing.observedRepresentation = [...new Set([...existing.observedRepresentation, ...domCriterion.observedRepresentation])];
    } else {
      merged.push(domCriterion);
    }
  }

  return merged.filter((criterion) => {
    if (!criterion.pathSummary) return true;
    const summaryPath = criterion.bindings.find((binding) => binding.type === "URL_PATH")?.pathname;
    return !merged.some((other) => other !== criterion
      && other.bindings?.some((binding) => binding.type === "DOM")
      && other.bindings?.some((binding) => binding.type === "URL_PATH" && binding.pathname === summaryPath));
  });
}
