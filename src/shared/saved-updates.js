import { getRouteSchemaInfo } from "./route.js";
import { classifyContextCompatibility } from "./replay-policy.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
}

export async function updateRevision(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function savedUpdateContent(saved) {
  const metadata = saved.metadata;
  return {
    site: saved.site, context: saved.context, criteria: saved.criteria,
    captureUrl: metadata.captureUrl, routeSnapshot: metadata.routeSnapshot || metadata.captureUrl,
    supportLevel: metadata.supportLevel, coverage: metadata.coverage,
    unsupported: metadata.unsupported || [], unresolved: metadata.unresolved || [], defaultsIgnored: metadata.defaultsIgnored || []
  };
}

export function previewUpdateContent(preview) {
  return savedUpdateContent({ ...preview, metadata: { ...preview, routeSnapshot: preview.captureUrl } });
}

// Normalize only filter-bearing paths declared by existing retailer schemas.
// Exact category identifiers are preserved, including numeric category IDs.
export function updateListingPath(urlLike) {
  const url = new URL(urlLike);
  const schema = getRouteSchemaInfo(url).id;
  let path = url.pathname;
  if (schema === "decathlon-de") path = path.split("/").filter((part) => !/^f-[^_]+_.+/i.test(part)).join("/");
  if (schema === "idealo-de") path = path.replace(/(\/ProductCategory\/\d+)F[^/.]+(\.html)$/i, "$1$2");
  if (schema === "zalando-de") {
    const parts = path.split("/").filter(Boolean);
    if (parts[1]?.includes(".")) path = `/${[parts[0], ...parts.slice(2)].join("/")}/`;
  }
  if (schema === "rebuy-de") path = path.replace(/(\/kaufen\/[^/]+)(?:\/.*)?$/i, "$1");
  if (schema === "kleinanzeigen-de") path = path.replace(/(?:\+|\/)[a-z0-9_.~-]+:[^+/]+/gi, "");
  return path.replace(/\/+$/, "") || "/";
}

export function assertUpdateContext(saved, preview) {
  if (saved.site.origin !== preview.site.origin) throw new Error("UPDATE_ORIGIN_MISMATCH");
  const oldPath = updateListingPath(saved.metadata.routeSnapshot || saved.metadata.captureUrl);
  const newPath = updateListingPath(preview.captureUrl);
  if (oldPath !== newPath) throw new Error("UPDATE_CONTEXT_MISMATCH");
  const search = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (search(saved.context.searchQuery) !== search(preview.context.searchQuery)) throw new Error("UPDATE_CONTEXT_MISMATCH");
  const contextValues = (criteria) => JSON.stringify([...groupedCriteria(criteria.filter((item) => item.role === "CONTEXT"))]
    .map(([key, group]) => [key, group.values.map(search).sort()]).sort(([left], [right]) => left.localeCompare(right)));
  if (contextValues(saved.criteria) !== contextValues(preview.criteria)) throw new Error("UPDATE_CONTEXT_MISMATCH");
  const compatibility = classifyContextCompatibility(
    { ...saved.context, origin: saved.site.origin, locale: saved.site.locale, routeClass: oldPath, compatibilityFingerprint: null },
    { ...preview.context, origin: preview.site.origin, locale: preview.site.locale, routeClass: newPath, compatibilityFingerprint: null }
  );
  if (!["EXACT", "COMPATIBLE"].includes(compatibility.level)) throw new Error("UPDATE_CONTEXT_MISMATCH");
}

function displayCriteriaValues(criterion) {
  const observed = criterion.observedRepresentation || [];
  const numericBindings = (criterion.bindings || []).filter((binding) =>
    binding.type === "DOM" ? binding.mapping.controlType === "NUMERIC_VALUE" : false);
  if (!numericBindings.length) return observed.length ? observed : criterion.desiredValue;

  // Numeric observations can contain only a control label. Read each binding's
  // value so equal range endpoints retain their separate lower/upper labels.
  const numericValues = new Set();
  const display = numericBindings.flatMap((binding, index) => {
    const locators = binding.mapping.option?.locatorChain || [];
    const endpoint = locators.find((locator) => locator.type === "NATIVE_RANGE_ENDPOINT");
    const label = endpoint ? `${endpoint.value === "LOWER" ? "Lower" : "Upper"} bound`
      : locators.find((locator) => ["LABEL_TEXT", "ARIA_LABEL"].includes(locator.type))?.value
        || (observed.length === numericBindings.length ? observed[index] : "");
    return binding.mapping.desiredValue.map((value) => {
      numericValues.add(String(value));
      return label ? `${label}: ${value}` : String(value);
    });
  });
  return [...display, ...criterion.desiredValue.filter((value) => !numericValues.has(String(value)))];
}

function groupedCriteria(criteria) {
  const groups = new Map();
  for (const criterion of criteria) {
    const key = JSON.stringify([criterion.role, criterion.semanticType]);
    if (!groups.has(key)) groups.set(key, { role: criterion.role, semanticType: criterion.semanticType, values: [], display: [] });
    const group = groups.get(key);
    group.values.push(...criterion.desiredValue.map((value) => JSON.stringify(canonical(value))));
    group.display.push(...displayCriteriaValues(criterion).map(String));
  }
  for (const group of groups.values()) {
    group.values = [...new Set(group.values)].sort();
    group.display = [...new Set(group.display)];
  }
  return groups;
}

export function diffSavedCriteria(before, after) {
  const previous = groupedCriteria(before);
  const next = groupedCriteria(after);
  const changes = [];
  for (const key of [...new Set([...previous.keys(), ...next.keys()])]) {
    const old = previous.get(key), current = next.get(key);
    const kind = !old ? "ADDED" : !current ? "REMOVED" : JSON.stringify(old.values) !== JSON.stringify(current.values) ? "CHANGED" : null;
    if (kind) changes.push({ kind, role: (current || old).role, semanticType: (current || old).semanticType, before: old?.display || [], after: current?.display || [] });
  }
  return changes;
}

export function replaceSavedCapture(saved, preview, now) {
  const content = previewUpdateContent(preview);
  return {
    ...saved, site: content.site, context: content.context, criteria: content.criteria,
    metadata: {
      ...saved.metadata, captureUrl: content.captureUrl, routeSnapshot: content.routeSnapshot,
      supportLevel: content.supportLevel, coverage: content.coverage,
      unsupported: content.unsupported, unresolved: content.unresolved, defaultsIgnored: content.defaultsIgnored,
      updatedAt: now, health: "UNKNOWN", lastReplayAt: null, lastSuccessfulReplayAt: null, mappingHealthEvidence: []
    }
  };
}

export function restoreSavedCapture(current, previous, now) {
  const restored = replaceSavedCapture(current, savedUpdateContent(previous), now);
  restored.metadata.routeSnapshot = previous.metadata.routeSnapshot || previous.metadata.captureUrl;
  return restored;
}
