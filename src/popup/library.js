// Library visibility is presentation only. Replay still validates the saved origin.
export function shopHostname(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function filterLibrary(library, { activeUrl, scope = "current", query = "" } = {}) {
  const hostname = scope === "current" ? shopHostname(activeUrl) : null;
  const search = query.trim().toLowerCase();
  return library.filter((item) => {
    if (hostname) {
      if (shopHostname(item.site.origin) !== hostname) return false;
    }
    return `${item.name} ${item.site.hostname} ${item.context.category || ""} ${item.context.searchQuery || ""}`.toLowerCase().includes(search);
  });
}
