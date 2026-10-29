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
    version: 2,
    hosts: ["mediamarkt.de", "www.mediamarkt.de"],
    parameters: {
      query: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      queryinitial: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      marketplace: descriptor("FILTER", "SELLER", { domLabels: ["Verkäufer"] }),
      refurbished_new_array: descriptor("FILTER", "REFURBISHED", { domLabels: ["Refurbished"] }),
      sort: descriptor("PRESENTATION", "SORT")
    }
  },
  {
    id: "decathlon-de",
    version: 2,
    hosts: ["decathlon.de", "www.decathlon.de"],
    parameters: {
      ntt: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      facets: descriptor("FILTER", "FACETS"),
      price: descriptor("FILTER", "PRICE_RANGE", {
        describeValues: describeDecathlonPrice,
        verificationTexts: verifyDecathlonPrice
      }),
      ns: descriptor("PRESENTATION", "SORT", {
        describeValues: describeDecathlonSort,
        verificationTexts: describeDecathlonSort
      }),
      sort: descriptor("PRESENTATION", "SORT")
    },
    parsePath: parseDecathlonPath
  },
  {
    id: "cyberport-de",
    version: 2,
    hosts: ["cyberport.de", "www.cyberport.de"],
    parameters: {
      query: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      "ratingmenu[ratingsbucket]": descriptor("FILTER", "RATING", {
        describeValues: (values) => values.map((value) => `${value} Sterne`),
        verificationTexts: (values) => values.map((value) => `${value} Sterne`)
      }),
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
    version: 2,
    hosts: ["shop-apotheke.com", "www.shop-apotheke.com"],
    parameters: {
      query: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      q: descriptor("CONTEXT", "SEARCH_QUERY", { canonical: "search" }),
      category: descriptor("FILTER", "CATEGORY", {
        domLabels:["Kategorien"], controlNames:["primaryCategory"],
        normalizeValues: (values) => values.map((value) => String(value).split("/").filter(Boolean).at(-1)),
        describeValues: (values) => values.map((value) => String(value).split("/").filter(Boolean).at(-1)),
        verificationTexts: (values) => values.map((value) => String(value).split("/").filter(Boolean).at(-1))
      }),
      sortby: descriptor("PRESENTATION", "SORT")
    },
    dynamicParameters:[{
      pattern:/^refinementList\[variants\.packSize\](?:\[\d+\])?$/i,
      descriptor:descriptor("FILTER","PACK_SIZE",{canonical:"refinementlist[variants.packsize]",domLabels:["Menge"],controlNames:["variants.packSize"]})
    }]
  },
  {
    id: "otto-de",
    version: 3,
    hosts: ["otto.de", "www.otto.de"],
    parameters: {
      arbeitsspeicher: descriptor("FILTER", "RAM"),
      "kategorien~sind": descriptor("FILTER", "CATEGORY", {literalKeyCharacters:"~"}),
      sortiertnach: descriptor("PRESENTATION", "SORT"),
      stil: ottoChoiceDescriptor("STYLE", "stil", ["Stil"]),
      "us-groessen": ottoChoiceDescriptor("US_SIZE", "us-groessen", ["Größe", "US-Größen"],
        (values) => splitOttoChoices(values).map((value) => value.toUpperCase())),
      zielgruppe: ottoChoiceDescriptor("TARGET_GROUP", "zielgruppe", ["Für wen?"],
        (values) => splitOttoChoices(values).map((value) => ({damen:"Damen",herren:"Herren",maedchen:"Mädchen",jungen:"Jungen"})[value] || value)),
      farbe: descriptor("FILTER","COLOR",{
        domLabels:["Farbe"],controlNames:["farbe"],inputName:"farbe",inputValues:splitOttoChoices,
        normalizeValues:splitOttoChoices,describeValues:splitOttoChoices,verificationTexts:splitOttoChoices,literalValueCharacters:","
      }),
      verkaeufer: descriptor("FILTER","SELLER",{
        domLabels:["Verkäufer"],controlNames:["verkaeufer"],inputName:"verkaeufer",inputValues:splitOttoChoices,
        normalizeValues:splitOttoChoices,describeValues:describeOttoSellers,verificationTexts:describeOttoSellers
      }),
      ...Object.fromEntries([["hoehe","H","HEIGHT"],["tiefe","T","DEPTH"],["breite","B","WIDTH"]].map(([axis,short,type]) => [`${axis}-in-cm~bis`,descriptor("FILTER",`MAX_${type}`,{
        domLabels:[`${axis} in cm`],controlNames:[`${axis}-in-cm`],inputName:`${axis}-in-cm`,
        inputValues:(values) => values.map((value) => `_,${value}`),rangeEndpoint:"MAX",literalKeyCharacters:"~",
        describeValues:(values) => values.map((value) => `${short}: bis ${value} cm`),
        verificationTexts:(values) => values.map((value) => `${short}: bis ${value} cm`)
      })]))
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
    version: 2,
    hosts: ["home24.de", "www.home24.de"],
    parameters: {
      shop: descriptor("FILTER", "SELLER"),
      order: descriptor("PRESENTATION", "SORT", {describeValues:describeHome24Sort,verificationTexts:describeHome24Sort}),
      average_rating: descriptor("FILTER", "RATING", {
        domLabels:["Bewertung"],summaryKey:"rating",verificationTexts:(values) => values
      }),
      color: descriptor("FILTER", "COLOR", {
        domLabels:["Farbe"],summaryKey:"color",normalizeValues:splitHome24Choices,
        describeValues:describeHome24Colors,verificationTexts:describeHome24Colors
      }),
      ...Object.fromEntries([["width","Breite"],["height","Höhe"],["depth","Tiefe"]].flatMap(([axis,label]) =>
        [["min","ab"],["max","bis"]].map(([bound,word]) => [`${axis}.${bound}`,descriptor("FILTER",`${bound.toUpperCase()}_${axis.toUpperCase()}`,{
          domLabels:["Maße"],summaryKey:axis,
          describeValues:(values) => values.map((value) => `${label}: ${word} ${value}cm`),
          verificationTexts:(values) => values.map((value) => `${label}: ${word} ${value}cm`)
        })])))
    }
  }
];

export const ROUTE_SCHEMA_CATALOG = Object.freeze(SCHEMAS.map(({id,version,hosts}) =>
  Object.freeze({id,version,hosts:Object.freeze([...hosts])})));

export function findRouteSchema(urlLike) {
  const hostname = (urlLike instanceof URL ? urlLike : new URL(urlLike)).hostname.toLowerCase();
  return SCHEMAS.find((schema) => schema.hosts.includes(hostname)) || null;
}

export function routeSchemaInfo(urlLike) {
  const schema = findRouteSchema(urlLike);
  return schema ? { id: schema.id, version: schema.version } : { id: "generic", version: 1 };
}

export function routeCaptureHints(urlLike) {
  const url = urlLike instanceof URL ? urlLike : new URL(urlLike);
  const schema = findRouteSchema(url);
  const keys = [...url.searchParams.keys()];
  const descriptors = [...Object.values(schema?.parameters || {}),...keys.map((key) => schemaParameterDescriptor(schema,key))];
  const hints = descriptors.filter((item) => item?.domLabels?.length).map((item) => ({
    labels:[...item.domLabels],semanticType:item.semanticType,
    ...(item.controlNames ? {controlNames:[...item.controlNames],parameters:keys.filter((key) => schemaParameterDescriptor(schema,key)?.semanticType === item.semanticType)} : {}),
    ...(item.inputName ? {controlEvidence:parameterControlEvidence(item,keys.filter((key) => schemaParameterDescriptor(schema,key)?.semanticType === item.semanticType).flatMap((key) => url.searchParams.getAll(key)))} : {}),
    ...(item.summaryKey ? {
      summaryKey:item.summaryKey,
      parameters:keys.filter((key) => schemaParameterDescriptor(schema,key)?.semanticType === item.semanticType),
      appliedFilterTexts:item.verificationTexts(keys.filter((key) => schemaParameterDescriptor(schema,key)?.semanticType === item.semanticType).flatMap((key) => url.searchParams.getAll(key)))
    } : {})
  }));
  return [...new Map(hints.map((hint) => [JSON.stringify(hint),hint])).values()];
}

export function parameterControlEvidence(item, values) {
  if (!item?.inputName) return null;
  return {name:item.inputName,values:item.inputValues(values),labels:item.verificationTexts(values),
    ...(item.rangeEndpoint ? {rangeEndpoint:item.rangeEndpoint,...(values.length === 1 ? {rangeValue:String(values[0])} : {})} : {})};
}

export function serializeRouteUrl(urlLike) {
  const url = new URL(urlLike);
  const schema = findRouteSchema(url);
  if (!Object.values(schema?.parameters || {}).some((item) => item.literalKeyCharacters || item.literalValueCharacters)) return url.toString();
  const parts = [...url.searchParams].map(([name,value]) => {
    const item = schemaParameterDescriptor(schema,name);
    const [key,encodedValue] = new URLSearchParams([[name,value]]).toString().split("=");
    return `${item?.literalKeyCharacters === "~" ? key.replaceAll("%7E","~") : key}=${item?.literalValueCharacters === "," ? encodedValue.replaceAll("%2C",",") : encodedValue}`;
  });
  url.search = parts.join(String.fromCharCode(38));
  return url.toString();
}

function splitOttoChoices(values) {
  return [...new Set(values.flatMap((value) => String(value).split(",")).filter(Boolean))];
}

function ottoChoiceDescriptor(semanticType, name, domLabels, describeValues = splitOttoChoices) {
  return descriptor("FILTER", semanticType, {
    domLabels, controlNames: [name], inputName: name, inputValues: splitOttoChoices,
    normalizeValues: splitOttoChoices, describeValues, verificationTexts: describeValues, literalValueCharacters: ","
  });
}

function describeOttoSellers(values) {
  return splitOttoChoices(values).map((value) => `Verkäufer: ${value.toLowerCase() === "otto" ? "OTTO" : value}`);
}

export function schemaParameterDescriptor(schema, parameter) {
  const key = String(parameter).toLowerCase();
  if (schema?.parameters[key]) return schema.parameters[key];
  return schema?.dynamicParameters?.find((entry) => entry.pattern.test(parameter))?.descriptor || structuredParameterDescriptor(parameter);
}

function structuredParameterDescriptor(parameter) {
  const match = String(parameter).match(/^(refinementList|hierarchicalMenu|menu|ratingMenu|range|numericMenu)\[([a-z0-9_.\u00c0-\u024f -]{1,100})\](?:\[(\d{1,3})\])?$/i);
  if (!match) return null;
  const [, widget, attribute] = match;
  if (/token|session|password|secret|email|phone|address|payment|account|profile|user.?id|auth|tracking/i.test(attribute)) return null;
  const kind = widget.toLowerCase();
  const field = attribute.replace(/^facets\./i, "").replace(/\.values$/i, "");
  const semanticType = /^(manufacturer|brand|hersteller)$/i.test(field) ? "BRAND"
    : kind === "ratingmenu" ? "RATING"
      : kind === "range" ? `${semantic(field)}_RANGE` : semantic(field);
  return descriptor("FILTER", semanticType, {canonical:`${kind}[${attribute.toLowerCase()}]`,domLabels:[field],controlNames:[attribute,field,attribute.split(".").at(-1)]});
}

function splitHome24Choices(values) {
  return [...new Set(values.flatMap((value) => String(value).split("|")).filter(Boolean))];
}

function describeHome24Colors(values) {
  const labels = {black:"Schwarz",gray:"Grau",white:"Weiß",brown:"Braun",beige:"Beige",green:"Grün",blue:"Blau",red:"Rot",yellow:"Gelb",orange:"Orange",purple:"Lila",pink:"Rosa",silver:"Silber",gold:"Gold",transparent:"Transparent",multicolor:"Mehrfarbig"};
  return splitHome24Choices(values).map((value) => labels[value] || value);
}

function describeHome24Sort(values) {
  const labels = {POPULARITY:"Beliebtheit",PRICE_ASC:"Niedrigster Preis",PRICE_DESC:"Höchster Preis",DISCOUNT_DESC:"Rabatt",FIRST_SELLABLE_AT_DESC:"Neuheiten",AVERAGE_RATING:"Bewertung"};
  return values.map((value) => labels[value] || value);
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

function parseDecathlonPath(url) {
  const criteria = [];
  for (const segment of pathSegments(url.pathname)) {
    const match = segment.match(/^f-([^_]+)_(.+)$/i);
    if (!match) continue;
    const facet = match[1].toLowerCase();
    const rawValue = match[2];
    const semanticType = facet === "zustand"
      ? "CONDITION"
      : facet === "partner"
        ? "SELLER"
        : facet === "sg"
          ? "SIZE"
          : semantic(facet);
    const values = facet === "sg" ? decodeDecathlonSizes(rawValue) : decodeDecathlonFacetValues(rawValue);
    if (values.length) criteria.push(pathCriterion(url, `path-${facet}`, "FILTER", semanticType, values));
  }
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

function decodeDecathlonFacetValues(value) {
  return String(value).split("_").map((part) => titleCase(decodePathValue(part))).filter(Boolean);
}

function decodeDecathlonSizes(value) {
  const sizes = [];
  for (const part of String(value).split("_")) {
    const match = part.match(/(?:^|-)(5xl|4xl|3xl|2xl|xxxl|xxl|xl|xs|s|m|l)(?:-|$)/i);
    if (match) sizes.push(match[1].toUpperCase().replace("XXXL", "3XL").replace("XXL", "2XL"));
  }
  return [...new Set(sizes.length ? sizes : decodeDecathlonFacetValues(value))];
}

function describeDecathlonPrice(values) {
  const match = String(values[0] || "").match(/^from_([^_]+)_to_([^_]+)$/i);
  return match ? [`${match[1]} € – ${match[2]} €`] : values;
}

function verifyDecathlonPrice(values) {
  const match = String(values[0] || "").match(/^from_([^_]+)_to_([^_]+)$/i);
  return match ? [`${match[1]} €`, `${match[2]} €`] : values;
}

function describeDecathlonSort(values) {
  const labels = {
    rankingrule: "Am relevantesten",
    priceascending: "Preis aufsteigend",
    pricedescending: "Preis absteigend",
    discountdescending: "Rabatt absteigend",
    ratingdescending: "Höchste Bewertungen",
    lastchance: "Letzte Chance",
    newest: "Neueste"
  };
  return values.map((value) => labels[String(value).toLowerCase()] || String(value));
}

function titleCase(value) {
  const text = String(value || "").trim();
  return text ? text[0].toLocaleUpperCase("de-DE") + text.slice(1) : "";
}

function semantic(value) {
  return String(value || "FILTER").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() || "FILTER";
}

export const ROUTE_SCHEMA_IDS = Object.freeze(SCHEMAS.map((schema) => schema.id));
