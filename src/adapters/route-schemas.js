const descriptor = (role, semanticType, options = {}) => ({ role, semanticType, ...options });

const SCHEMAS = [
  {
    id: "amazon-de",
    version: 1,
    hosts: ["amazon.de", "www.amazon.de"],
    parameters: {
      k: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      rh: descriptor("FILTER", "REFINEMENTS"),
      s: descriptor("PRESENTATION", "SORT")
    }
  },
  {
    id: "kleinanzeigen-de",
    version: 1,
    hosts: ["kleinanzeigen.de", "www.kleinanzeigen.de"],
    parameters: {},
    parsePath: parseKleinanzeigenPath
  },
  {
    id: "idealo-de",
    version: 2,
    hosts: ["idealo.de", "www.idealo.de"],
    parameters: {
      sortkey: descriptor("PRESENTATION", "SORT")
    },
    parsePath: parseIdealoPath
  },
  {
    id: "rebuy-de",
    version: 1,
    hosts: ["rebuy.de", "www.rebuy.de"],
    parameters: {
      pricemax: descriptor("FILTER", "MAX_PRICE"),
      sortby: descriptor("PRESENTATION", "SORT")
    },
    parsePath: parseRebuyPath
  },
  {
    id: "mediamarkt-de",
    version: 1,
    hosts: ["mediamarkt.de", "www.mediamarkt.de"],
    parameters: {
      query: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      queryinitial: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      sort: descriptor("PRESENTATION", "SORT")
    }
  },
  {
    id: "decathlon-de",
    version: 1,
    hosts: ["decathlon.de", "www.decathlon.de"],
    parameters: {
      ntt: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      facets: descriptor("FILTER", "FACETS"),
      sort: descriptor("PRESENTATION", "SORT")
    }
  },
  {
    id: "cyberport-de",
    version: 1,
    hosts: ["cyberport.de", "www.cyberport.de"],
    parameters: {
      query: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      sortby: descriptor("PRESENTATION", "SORT")
    }
  },
  {
    id: "zalando-de",
    version: 1,
    hosts: ["zalando.de", "www.zalando.de", "en.zalando.de"],
    parameters: {
      order: descriptor("PRESENTATION", "SORT", { canonical: "sort", atomicGroup: "sort" }),
      dir: descriptor("PRESENTATION", "SORT", { canonical: "sort", atomicGroup: "sort" })
    },
    parsePath: parseZalandoPath
  },
  {
    id: "shop-apotheke-de",
    version: 1,
    hosts: ["shop-apotheke.com", "www.shop-apotheke.com"],
    parameters: {
      query: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      q: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      category: descriptor("FILTER", "CATEGORY"),
      sortby: descriptor("PRESENTATION", "SORT")
    }
  },
  {
    id: "otto-de",
    version: 1,
    hosts: ["otto.de", "www.otto.de"],
    parameters: {
      arbeitsspeicher: descriptor("FILTER", "RAM"),
      "kategorien~sind": descriptor("FILTER", "CATEGORY"),
      sortiertnach: descriptor("PRESENTATION", "SORT")
    }
  },
  {
    id: "autohero-de",
    version: 1,
    hosts: ["autohero.com", "www.autohero.com"],
    parameters: {
      sort: descriptor("PRESENTATION", "SORT")
    },
    dynamicParameters: [
      { pattern: /^brand\d+$/i, descriptor: descriptor("FILTER", "BRAND", { canonical: "brand" }) }
    ]
  },
  {
    id: "home24-de",
    version: 1,
    hosts: ["home24.de", "www.home24.de"],
    parameters: {
      shop: descriptor("FILTER", "SELLER"),
      order: descriptor("PRESENTATION", "SORT")
    }
  }
];

export function findRouteSchema(urlLike) {
  const hostname = (urlLike instanceof URL ? urlLike : new URL(urlLike)).hostname.toLowerCase();
  return SCHEMAS.find((schema) => schema.hosts.includes(hostname)) || null;
}

export function routeSchemaInfo(urlLike) {
  const schema = findRouteSchema(urlLike);
  return schema ? { id: schema.id, version: schema.version } : { id: "generic", version: 1 };
}

export function schemaParameterDescriptor(schema, parameter) {
  if (!schema) return null;
  const key = String(parameter).toLowerCase();
  if (schema.parameters[key]) return schema.parameters[key];
  return schema.dynamicParameters?.find((entry) => entry.pattern.test(parameter))?.descriptor || null;
}

export function schemaPathCriteria(schema, urlLike) {
  if (!schema?.parsePath) return [];
  return schema.parsePath(urlLike instanceof URL ? urlLike : new URL(urlLike));
}

function parseKleinanzeigenPath(url) {
  const grouped = new Map();
  const matches = url.pathname.matchAll(/(?:\+|\/)([a-z0-9_.~-]+):([^+/]+)/gi);
  for (const match of matches) {
    const rawKey = match[1].split(".").at(-1).replace(/_s$/i, "");
    const semanticType = rawKey === "ram" ? "RAM" : rawKey === "brand" ? "BRAND" : semantic(rawKey);
    const value = decodePathValue(match[2]);
    if (!grouped.has(semanticType)) grouped.set(semanticType, []);
    grouped.get(semanticType).push(value);
  }
  return [...grouped].map(([semanticType, values]) => pathCriterion(url, `path-${semanticType.toLowerCase()}`, "FILTER", semanticType, values));
}

function parseIdealoPath(url) {
  const match = url.pathname.match(/\/ProductCategory\/[^/]*?F([^/.]+)\.html$/i);
  if (!match) return [];
  const tokens = match[1].split("-").filter(Boolean);
  if (!tokens.length) return [];
  return [{
    ...pathCriterion(url, "idealo-path-filters", "FILTER", "IDEALO_FILTER_STATE", tokens),
    observedRepresentation: [`${tokens.length} route-backed filter${tokens.length === 1 ? "" : "s"}`],
    pathSummary: true
  }];
}

function parseRebuyPath(url) {
  const segments = pathSegments(url.pathname);
  const kaufen = segments.indexOf("kaufen");
  if (kaufen < 0) return [];
  const rest = segments.slice(kaufen + 1);
  const criteria = [];
  if (rest[0]) criteria.push(pathCriterion(url, "path-category", "CONTEXT", "CATEGORY_CONTEXT", [decodePathValue(rest[0])]));
  if (rest[1]) criteria.push(pathCriterion(url, "path-brand", "FILTER", "BRAND", [decodePathValue(rest[1])]));
  if (rest[2]) criteria.push(pathCriterion(url, "path-model", "FILTER", "MODEL", [decodePathValue(rest.slice(2).join(" "))]));
  return criteria;
}

function parseZalandoPath(url) {
  const segments = pathSegments(url.pathname);
  if (segments.length < 2 || !segments[1].includes(".")) return [];
  const brands = segments[1].split(".").filter(Boolean).map(decodePathValue);
  return brands.length ? [pathCriterion(url, "path-brand", "FILTER", "BRAND", brands)] : [];
}

function pathCriterion(url, key, role, semanticType, values) {
  return {
    key,
    role,
    semanticType,
    desiredValue: [...new Set(values.map(String))],
    observedRepresentation: [...new Set(values.map(String))],
    pathname: url.pathname,
    verificationTexts: [...new Set(values.map(String))]
  };
}

function pathSegments(pathname) {
  return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

function decodePathValue(value) {
  return decodeURIComponent(String(value)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function semantic(value) {
  return String(value || "FILTER").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() || "FILTER";
}

export const ROUTE_SCHEMA_IDS = Object.freeze(SCHEMAS.map((schema) => schema.id));
