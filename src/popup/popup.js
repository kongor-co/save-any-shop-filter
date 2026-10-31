import { MESSAGE, SCHEMA_VERSION, MAX_IMPORT_BYTES, MAX_IMPORT_STATES } from "../shared/constants.js";
import { filterLibrary, shopHostname } from "./library.js";

const state = {
  activeTab: null,
  capture: null,
  library: [],
  libraryScope: "current",
  replay: null,
  replayTimer: null,
  actionState: null,
  updatePreview: null,
  updateRequest: 0
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  tabs: [...document.querySelectorAll(".tab")],
  captureView: $("#capture-view"),
  libraryView: $("#library-view"),
  settingsView: $("#settings-view"),
  replayView: $("#replay-view"),
  loading: $("#capture-loading"),
  captureError: $("#capture-error"),
  captureContent: $("#capture-content"),
  criteria: $("#criteria-list"),
  stateName: $("#state-name"),
  save: $("#save-state"),
  libraryList: $("#library-list"),
  emptyLibrary: $("#empty-library"),
  libraryCount: $("#library-count"),
  toast: $("#toast"),
  detailsDialog: $("#details-dialog"),
  actionsDialog: $("#actions-dialog"),
  confirmDialog: $("#confirm-dialog")
};

initialize().catch((error) => showCaptureError(humanError(error)));

async function initialize() {
  [state.activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  bindEvents();
  await Promise.all([loadCapture(), loadLibrary()]);
  const replay = await send(MESSAGE.GET_ACTIVE_REPLAY, { tabId: state.activeTab.id });
  if (replay && !isTerminal(replay.status)) showReplay(replay);
}

function bindEvents() {
  for (const tab of elements.tabs) tab.addEventListener("click", () => switchView(tab.dataset.view));
  $("#refresh-capture").addEventListener("click", loadCapture);
  elements.save.addEventListener("click", saveCapture);
  $("#copy-route").addEventListener("click", copySanitizedRoute);
  $("#library-search").addEventListener("input", renderLibrary);
  $("#library-scope").addEventListener("change", (event) => {
    state.libraryScope = event.target.value;
    renderLibrary();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId !== state.activeTab?.id) return;
    // Chrome may omit the URL after access is lost during navigation.
    // Fall back to the full library instead of retaining the previous shop.
    if (!(changeInfo.url || changeInfo.status)) return;
    state.activeTab = tab;
    renderLibrary();
  });
  $("#library-list").addEventListener("click", handleLibraryAction);
  $("#export-all").addEventListener("click", () => exportStates());
  $("#import-trigger").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", importFile);
  $("#cancel-replay").addEventListener("click", cancelReplay);
  $("#confirm-replay-context").addEventListener("click", confirmReplayContext);
  $("#replay-done").addEventListener("click", async () => { await loadLibrary(); switchView("library"); });
  $("#close-details").addEventListener("click", () => elements.detailsDialog.close());
  $("#close-actions").addEventListener("click", () => elements.actionsDialog.close());
  elements.actionsDialog.addEventListener("click", handleDialogAction);
  $("#cancel-delete").addEventListener("click", () => elements.confirmDialog.close());
  $("#confirm-delete").addEventListener("click", confirmDelete);
  $("#close-update").addEventListener("click", () => $("#update-dialog").close());
  $("#cancel-update").addEventListener("click", () => $("#update-dialog").close());
  $("#confirm-update").addEventListener("click", confirmSavedUpdate);
  $("#update-dialog").addEventListener("close", () => { state.updatePreview = null; state.updateRequest += 1; });
}

async function loadCapture() {
  elements.loading.hidden = false;
  elements.captureError.hidden = true;
  elements.captureContent.hidden = true;
  try {
    const preview = await send(MESSAGE.GET_CAPTURE_PREVIEW, { tabId: state.activeTab.id });
    state.capture = preview;
    renderCapture(preview);
  } catch (error) {
    showCaptureError(humanError(error));
  } finally {
    elements.loading.hidden = true;
  }
}

function renderCapture(preview) {
  elements.loading.hidden = true;
  elements.captureError.hidden = true;
  elements.captureContent.hidden = false;
  const support = $("#support-level");
  support.textContent = supportLabel(preview.supportLevel);
  support.className = `support-badge ${preview.supportLevel === "LIMITED" ? "limited" : ""}`;
  $("#page-context").textContent = `${preview.site.hostname} · ${preview.context.category || preview.context.searchQuery || preview.context.surface}`;
  elements.stateName.value = preview.suggestedName;
  elements.criteria.replaceChildren(...preview.criteria.map((criterion) => criterionNode(criterion)));
  const coverage = preview.coverage || { captured: preview.criteria.length, meaningfulCaptured: preview.criteria.length, unsupported: preview.unsupported?.length || 0, unresolved: 0, defaultsIgnored: 0, saveEligible: preview.criteria.length > 0 };
  renderCoverage($("#coverage-summary"), coverage);
  elements.save.disabled = !coverage.saveEligible;
  elements.save.textContent = coverage.saveEligible
    ? `Save ${coverage.meaningfulCaptured} active ${coverage.meaningfulCaptured === 1 ? "setting" : "settings"}`
    : "Nothing meaningful to save";
  $("#save-reason").hidden = coverage.saveEligible;
  $("#save-reason").textContent = coverage.saveReason || "";
  $("#copy-route").hidden = coverage.saveEligible || !preview.captureUrl;
  const omissions = [...(preview.unsupported || []), ...(preview.unresolved || [])];
  $("#unsupported-wrap").hidden = omissions.length === 0;
  $("#unsupported-count").textContent = String(omissions.length);
  $("#unsupported-list").replaceChildren(...omissions.map((item) => {
    const p = document.createElement("p");
    p.textContent = `${item.label}: ${item.reason}`;
    return p;
  }));
}

function criterionNode(criterion, result = null) {
  const row = document.createElement("div");
  const status = result?.status;
  const severity = result ? resultSeverity(status) : "success";
  row.className = `criterion-row ${severity === "warning" ? "warning" : severity === "failure" ? "failure" : ""}`;
  const icon = document.createElement("span");
  icon.className = "status-icon";
  icon.textContent = result ? (severity === "success" ? "✓" : severity === "warning" ? "!" : "×") : "✓";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = humanSemantic(criterion.semanticType);
  const detail = document.createElement("small");
  detail.textContent = result?.message || (criterion.observedRepresentation || criterion.desiredValue || []).join(", ");
  copy.append(title, detail);
  const role = document.createElement("span");
  role.className = "role";
  role.textContent = result ? statusLabel(status) : criterion.role;
  row.append(icon, copy, role);
  return row;
}

async function saveCapture() {
  elements.save.disabled = true;
  elements.save.textContent = "Checking page consistency…";
  try {
    const saved = await send(MESSAGE.SAVE_CAPTURE, {
      tabId: state.activeTab.id,
      preview: state.capture,
      name: elements.stateName.value
    });
    toast(`Saved “${saved.name}”`);
    await loadLibrary();
    switchView("library");
  } catch (error) {
    toast(humanError(error), true);
    await loadCapture();
  }
}

async function copySanitizedRoute() {
  if (!state.capture?.captureUrl) return;
  try {
    await navigator.clipboard.writeText(state.capture.captureUrl);
    toast("Sanitized route copied. This is a URL fallback, not a verified saved configuration.");
  } catch {
    toast("The sanitized route could not be copied.", true);
  }
}

async function loadLibrary() {
  state.library = await send(MESSAGE.LIST_STATES);
  renderLibrary();
}

function renderLibrary() {
  renderSettingsInfo();
  const hostname = shopHostname(state.activeTab?.url);
  const scope = $("#library-scope");
  scope.querySelector('[value="current"]').textContent = hostname ? `This shop: ${hostname}` : "This shop unavailable";
  scope.querySelector('[value="current"]').disabled = !hostname;
  scope.value = hostname ? state.libraryScope : "all";
  const current = scope.value === "current" ? hostname : null;
  const query = $("#library-search").value.trim();
  const visible = filterLibrary(state.library, { activeUrl: state.activeTab?.url, scope: scope.value, query });
  elements.libraryCount.textContent = String(visible.length);
  $("#library-summary").textContent = current ? `Saved filters for ${current}` : "Grouped by shop and context";
  $("#library-scope-status").textContent = `${visible.length} of ${state.library.length} saved configurations shown${current ? ` for ${current}` : " across all shops"}.`;
  $("#library-search").placeholder = current ? "Search this shop" : "Search the library";
  $("#empty-library-title").textContent = query ? "No matching saved filters" : current ? "No saved filters for this shop yet" : "No saved filters yet";
  $("#empty-library-copy").textContent = query ? "Try another search or change the shop filter." : current ? "Save a configuration here, or choose All shops to browse your library." : "Save a configuration from a shopping results page.";
  elements.emptyLibrary.hidden = visible.length !== 0;
  elements.libraryList.replaceChildren();
  const groups = new Map();
  for (const item of visible) {
    if (!groups.has(item.site.hostname)) groups.set(item.site.hostname, []);
    groups.get(item.site.hostname).push(item);
  }
  for (const [hostname, states] of groups) {
    const section = document.createElement("section");
    section.className = "shop-group";
    const heading = document.createElement("h2");
    heading.className = "shop-title";
    heading.innerHTML = '<span class="shop-dot" aria-hidden="true"></span>';
    heading.append(document.createTextNode(hostname));
    section.append(heading, ...states.map(libraryCard));
    elements.libraryList.append(section);
  }
}

function renderSettingsInfo() {
  $("#settings-import-help").textContent = `FilterVault JSON only. Up to ${MAX_IMPORT_BYTES / 1_000_000} MB and ${MAX_IMPORT_STATES} configurations per import.`;
  const shops = new Set(state.library.map((saved) => shopHostname(saved.site.origin)));
  const info = [
    ["Saved configurations", String(state.library.length)],
    ["Webshops", String(shops.size)],
    ["Extension version", chrome.runtime.getManifest().version],
    ["Backup format", `JSON v${SCHEMA_VERSION}`]
  ];
  $("#settings-info").replaceChildren(...info.map(([label, value]) => {
    const div = document.createElement("div");
    const span = document.createElement("span"); span.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    div.append(span, strong); return div;
  }));
}

function libraryCard(saved) {
  const card = document.createElement("article");
  card.className = "library-card";
  card.dataset.stateId = saved.id;
  const context = saved.context.category || saved.context.searchQuery || saved.context.surface;
  card.innerHTML = `
    <div class="card-main">
      <div><strong></strong><small></small></div>
      <span class="health ${String(saved.metadata.health || "unknown").toLowerCase()}"></span>
    </div>
    <div class="card-actions">
      <button class="replay" type="button" data-action="replay">Replay</button>
      <button type="button" data-action="details">Details</button>
      <button type="button" data-action="update">Update</button>
      <button type="button" data-action="more" aria-label="More actions">•••</button>
    </div>`;
  card.querySelector("strong").textContent = saved.name;
  card.querySelector("small").textContent = `${context} · ${saved.criteria.length} criteria`;
  card.querySelector(".health").textContent = saved.metadata.health || "UNKNOWN";
  return card;
}

async function handleLibraryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const saved = state.library.find((item) => item.id === button.closest("[data-state-id]")?.dataset.stateId);
  if (!saved) return;
  try {
    if (button.dataset.action === "replay") await beginReplay(saved);
    if (button.dataset.action === "details") showDetails(saved);
    if (button.dataset.action === "more") await moreActions(saved);
    if (button.dataset.action === "update") await openUpdatePreview(saved);
  } catch (error) {
    toast(humanError(error), true);
  }
}

async function moreActions(saved) {
  state.actionState = saved;
  $("#rename-value").value = saved.name;
  elements.actionsDialog.showModal();
  $("#undo-state-update").disabled = true;
  const info = await send(MESSAGE.GET_STATE_UPDATE_INFO, { stateId: saved.id });
  if (state.actionState?.id === saved.id) $("#undo-state-update").disabled = !info.undoAvailable;
}

async function openUpdatePreview(saved, mode = "update") {
  const request = ++state.updateRequest;
  state.updatePreview = null;
  const dialog = $("#update-dialog");
  $("#update-title").textContent = mode === "undo" ? "Undo last filter update" : "Update saved filters";
  $("#update-context").textContent = saved.name;
  $("#update-description").textContent = mode === "undo"
    ? "Restore the previous saved settings. Use Replay to apply them to the shop."
    : "Review the current page's settings before replacing this saved configuration. The previous version will be available through Undo.";
  $("#update-status").textContent = "Preparing change preview…";
  $("#update-changes").replaceChildren();
  $("#update-coverage").replaceChildren();
  $("#update-omissions").hidden = true;
  $("#confirm-update").disabled = true;
  $("#confirm-update").textContent = mode === "undo" ? "Undo last update" : "Update saved filters";
  dialog.showModal();
  try {
    const preview = await send(mode === "undo" ? MESSAGE.PREVIEW_STATE_UNDO : MESSAGE.PREVIEW_STATE_UPDATE,
      mode === "undo" ? { stateId: saved.id } : { stateId: saved.id, tabId: state.activeTab.id });
    if (!dialog.open || request !== state.updateRequest) return;
    state.updatePreview = { ...preview, tabId: state.activeTab.id };
    $("#update-context").textContent = `${preview.name} · ${preview.site.hostname} · ${preview.context.category || preview.context.searchQuery || preview.context.surface}`;
    $("#update-status").textContent = preview.reason || (preview.changes.length ? `${preview.changes.length} filter or setting changes to review.` : "Control mappings or captured page details will be refreshed.");
    $("#update-changes").replaceChildren(...preview.changes.map((change) => {
      const row = document.createElement("div"); row.className = "update-change";
      const title = document.createElement("strong"); title.textContent = `${humanSemantic(change.kind)}: ${humanSemantic(change.semanticType)}`;
      const before = document.createElement("small"); before.textContent = `Before: ${change.before.join(", ") || "None"}`;
      const after = document.createElement("small"); after.textContent = `After: ${change.after.join(", ") || "None"}`;
      row.append(title, before, after); return row;
    }));
    renderCoverage($("#update-coverage"), preview.coverage);
    const omissions = [...preview.unsupported, ...preview.unresolved];
    $("#update-omissions").hidden = !omissions.length;
    $("#update-omissions-list").replaceChildren(...omissions.map((item) => {
      const row = document.createElement("p"); row.textContent = `${item.label}: ${item.reason}`; return row;
    }));
    $("#confirm-update").disabled = !preview.canApply;
  } catch (error) { if (dialog.open ? request === state.updateRequest : false) $("#update-status").textContent = humanError(error); }
}

async function confirmSavedUpdate() {
  const preview = state.updatePreview;
  if (!preview) return;
  $("#confirm-update").disabled = true;
  try {
    const updated = await send(preview.mode === "undo" ? MESSAGE.UNDO_STATE_UPDATE : MESSAGE.APPLY_STATE_UPDATE,
      preview.mode === "undo" ? { stateId: preview.stateId, expectedRevision: preview.expectedRevision }
        : { stateId: preview.stateId, tabId: preview.tabId, expectedRevision: preview.expectedRevision, captureToken: preview.captureToken });
    $("#update-dialog").close();
    await loadLibrary();
    toast(preview.mode === "undo" ? `Restored previous filters for “${updated.name}”.` : `Updated “${updated.name}”. Replay to verify the new settings.`);
  } catch (error) {
    state.updatePreview = null;
    $("#update-status").textContent = `${humanError(error)} Close this preview and try again.`;
  }
}

async function handleDialogAction(event) {
  const button = event.target.closest("button[data-library-action]");
  const saved = state.actionState;
  if (!button || !saved) return;
  try {
    if (button.dataset.libraryAction === "rename") {
      await send(MESSAGE.RENAME_STATE, { stateId: saved.id, name: $("#rename-value").value });
      elements.actionsDialog.close();
      await loadLibrary();
    } else if (button.dataset.libraryAction === "duplicate") {
      await send(MESSAGE.DUPLICATE_STATE, { stateId: saved.id });
      elements.actionsDialog.close();
      await loadLibrary();
    } else if (button.dataset.libraryAction === "export") {
      await exportStates([saved.id]);
      elements.actionsDialog.close();
    } else if (button.dataset.libraryAction === "delete") {
      elements.actionsDialog.close();
      $("#confirm-copy").textContent = `“${saved.name}” will be permanently removed from this Chrome profile.`;
      elements.confirmDialog.showModal();
    } else if (button.dataset.libraryAction === "undo") {
      elements.actionsDialog.close();
      await openUpdatePreview(saved, "undo");
    }
  } catch (error) {
    toast(humanError(error), true);
  }
}

async function confirmDelete() {
  const saved = state.actionState;
  if (!saved) return;
  try {
    await send(MESSAGE.DELETE_STATE, { stateId: saved.id });
    elements.confirmDialog.close();
    state.actionState = null;
    await loadLibrary();
    toast(`Deleted “${saved.name}”`);
  } catch (error) {
    toast(humanError(error), true);
  }
}

async function beginReplay(saved) {
  const currentOrigin = /^https?:/.test(state.activeTab.url || "") ? new URL(state.activeTab.url).origin : null;
  if (currentOrigin !== saved.site.origin) {
    const origins = [`${saved.site.origin}/*`];
    const hasPermission = await chrome.permissions.contains({ origins });
    if (!hasPermission) {
      const granted = await chrome.permissions.request({ origins });
      if (!granted) throw new Error(`Permission is required to open and replay filters on ${saved.site.hostname}.`);
    }
  }
  const replay = await send(MESSAGE.START_REPLAY, { stateId: saved.id, tabId: state.activeTab.id });
  if (replay.permissionRequired) throw new Error(`Permission is required for ${replay.savedOrigin}.`);
  showReplay(replay);
}

function showReplay(replay) {
  state.replay = replay;
  for (const tab of elements.tabs) tab.classList.remove("is-active");
  elements.captureView.hidden = true;
  elements.libraryView.hidden = true;
  elements.settingsView.hidden = true;
  elements.replayView.hidden = false;
  $("#replay-title").textContent = replay.savedStateName || "Applying filters";
  renderReplay(replay);
  clearInterval(state.replayTimer);
  state.replayTimer = setInterval(pollReplay, 500);
}

async function pollReplay() {
  try {
    const replay = await send(MESSAGE.GET_ACTIVE_REPLAY, { tabId: state.activeTab.id });
    if (!replay) return;
    state.replay = replay;
    renderReplay(replay);
    if (isTerminal(replay.status)) clearInterval(state.replayTimer);
  } catch {
    clearInterval(state.replayTimer);
  }
}

function renderReplay(replay) {
  const awaiting = replay.status === "AWAITING_CONFIRMATION";
  $("#confirm-replay-context").hidden = !awaiting;
  const message = replay.error ? humanError(replay.error)
    : awaiting ? `${(replay.contextCompatibility?.reasons || []).join(" ")} Review the page before continuing.`
    : (replay.results || []).some((item) => item.status === "ROUTE_ONLY") ? "Some criteria are retained in the URL but remain unverified on the page." : "";
  $("#replay-message").textContent = message;
  $("#replay-message").hidden = !message;
  const saved = state.library.find((item) => item.id === replay.savedStateId);
  const byId = new Map((saved?.criteria || []).map((item) => [item.criterionId, item]));
  const results = replay.results || [];
  $("#replay-results").replaceChildren(...results.map((result) => criterionNode(byId.get(result.criterionId) || result, result)));
  const terminal = isTerminal(replay.status);
  $("#replay-spinner").hidden = terminal;
  if (awaiting) $("#replay-spinner").hidden = true;
  $("#cancel-replay").hidden = terminal;
  $("#replay-done").hidden = !terminal;
  if (terminal) $("#replay-title").textContent = replayTitle(replay);
  else if (awaiting) $("#replay-title").textContent = "Review changed page context";
}

async function confirmReplayContext() {
  $("#confirm-replay-context").disabled = true;
  try {
    const replay = await send(MESSAGE.CONFIRM_REPLAY_CONTEXT, { replayId: state.replay.replayId });
    showReplay(replay);
  } catch (error) { toast(humanError(error), true); }
  finally { $("#confirm-replay-context").disabled = false; }
}

async function cancelReplay() {
  if (!state.replay) return;
  await send(MESSAGE.CANCEL_REPLAY, { replayId: state.replay.replayId });
  await pollReplay();
}

function showDetails(saved) {
  $("#details-name").textContent = saved.name;
  $("#details-context").textContent = `${saved.site.hostname} · ${saved.context.category || saved.context.searchQuery || saved.context.surface}`;
  const support = $("#details-support");
  support.textContent = supportLabel(saved.metadata.supportLevel);
  support.className = `support-badge ${saved.metadata.supportLevel === "LIMITED" ? "limited" : ""}`;
  $("#details-criteria").replaceChildren(...saved.criteria.map((criterion) => criterionNode(criterion)));
  renderCoverage($("#details-coverage"), saved.metadata.coverage || {});
  const meta = [
    ["Health", saved.metadata.health || "Unknown"],
    ["Locale", saved.site.locale || "Unknown"],
    ["Captured", formatDate(saved.metadata.createdAt)],
    ["Last replay", formatDate(saved.metadata.lastReplayAt)],
    ["Adapter", `${saved.site.adapterId} v${saved.site.adapterVersion}`],
    ["Origin", saved.site.origin]
  ];
  $("#details-meta").replaceChildren(...meta.map(([label, value]) => {
    const div = document.createElement("div");
    const span = document.createElement("span"); span.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    div.append(span, strong); return div;
  }));
  elements.detailsDialog.showModal();
}

async function exportStates(stateIds) {
  const payload = await send(MESSAGE.EXPORT_LIBRARY, { stateIds });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `filtervault-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const result = await send(MESSAGE.IMPORT_LIBRARY, { payload: await file.text() });
    toast(`Imported ${result.imported} configuration${result.imported === 1 ? "" : "s"}.`);
    await loadLibrary();
  } catch (error) {
    toast(humanError(error), true);
  } finally {
    event.target.value = "";
  }
}

function switchView(view) {
  clearInterval(state.replayTimer);
  elements.captureView.hidden = view !== "capture";
  elements.libraryView.hidden = view !== "library";
  elements.settingsView.hidden = view !== "settings";
  elements.replayView.hidden = true;
  for (const tab of elements.tabs) {
    const active = tab.dataset.view === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

function showCaptureError(message) {
  elements.captureError.hidden = false;
  elements.captureContent.hidden = true;
  $("#capture-error-message").textContent = message;
}

async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || "FilterVault could not complete the request.");
  return response.data;
}

function toast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.style.background = error ? "var(--red)" : "var(--ink)";
  elements.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { elements.toast.hidden = true; }, 3600);
}

function supportLabel(level) {
  return ({ VERIFIED: "Verified support", COMPATIBLE: "Generic compatibility", LIMITED: "Limited support", UNSUPPORTED: "Unsupported" })[level] || "Generic compatibility";
}

function renderCoverage(container, coverage) {
  const items = [
    [coverage.captured || 0, "captured", false],
    [coverage.unsupported || 0, "unsupported", (coverage.unsupported || 0) > 0],
    [coverage.unresolved || 0, "unresolved", (coverage.unresolved || 0) > 0],
    [coverage.defaultsIgnored || 0, "defaults ignored", false]
  ];
  container.replaceChildren(...items.map(([count, label, warning]) => {
    const badge = document.createElement("span");
    badge.textContent = `${count} ${label}`;
    if (warning) badge.className = "coverage-warning";
    return badge;
  }));
}

function humanSemantic(value) {
  return String(value || "Filter").toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function statusLabel(status) {
  if (status === "ROUTE_ONLY") return "URL retained, unverified";
  if (status === "NOT_ATTEMPTED") return "Not attempted";
  return ({ ALREADY_APPLIED: "Already set", APPLIED: "Applied", VERIFIED: "Verified", VALUE_UNAVAILABLE: "Unavailable", FILTER_UNAVAILABLE: "Unavailable", MAPPING_BROKEN: "Mapping broken", RESOLUTION_INCONCLUSIVE: "Inconclusive", UNSUPPORTED_CONTROL: "Unsupported", UNSUPPORTED_INTERACTION: "Unsupported", VERIFY_FAILED: "Not verified", DEPENDENCY_FAILED: "Skipped", CANCELLED: "Cancelled" })[status] || status;
}

function resultSeverity(status) {
  if (["ROUTE_ONLY", "NOT_ATTEMPTED", "CANCELLED"].includes(status)) return "warning";
  if (["ALREADY_APPLIED", "APPLIED", "VERIFIED"].includes(status)) return "success";
  if (["VALUE_UNAVAILABLE", "FILTER_UNAVAILABLE", "RESOLUTION_INCONCLUSIVE", "UNSUPPORTED_CONTROL", "UNSUPPORTED_INTERACTION", "DEPENDENCY_FAILED"].includes(status)) return "warning";
  return "failure";
}

function replayTitle(replay) {
  const succeeded = (replay.results || []).filter((result) => resultSeverity(result.status) === "success").length;
  const total = (replay.results || []).length;
  if (replay.status === "COMPLETE") return `All ${total} criteria restored`;
  if (replay.status === "CANCELLED") return "Replay cancelled";
  if (replay.status === "INTERRUPTED") return "Replay interrupted";
  if (replay.status === "FAILED") return "Filters could not be restored";
  return `${succeeded} of ${total} criteria restored`;
}

function isTerminal(status) {
  return ["COMPLETE", "COMPLETE_WITH_WARNINGS", "PARTIAL", "FAILED", "CANCELLED", "INTERRUPTED"].includes(status);
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function humanError(error) {
  const code = String(error?.message || error || "UNKNOWN_ERROR");
  const known = {
    PAGE_NOT_ACCESSIBLE: "Chrome does not allow extensions to run on this page.",
    RESTRICTED_PAGE: "Open a regular shopping website to use FilterVault.",
    NO_ACTIVE_PAGE: "No active web page is available.",
    "UNSUPPORTED_PAGE_TYPE:CHECKOUT": "FilterVault never captures or replays checkout pages.",
    "UNSUPPORTED_PAGE_TYPE:LOGIN": "FilterVault never captures login or credential pages.",
    "UNSUPPORTED_PAGE_TYPE:ACCOUNT": "FilterVault does not capture account pages.",
    "UNSUPPORTED_PAGE_TYPE:PRODUCT_DETAIL": "Return to a product listing or search page to save filters.",
    "UNSUPPORTED_PAGE_TYPE:OTHER": "FilterVault could not verify this as a product listing or search page.",
    CAPTURE_STATE_CHANGED: "The page changed during capture. Wait for it to settle, then try again.",
    CAPTURE_UNSTABLE: "The page kept changing while filters were read. Wait for results to settle, then retry.",
    NO_SUPPORTED_CRITERIA: "No supported active filters were found.",
    NO_MEANINGFUL_CRITERIA: "Only search or page context was detected; select a filter or non-default sort before saving.",
    REPLAY_ALREADY_ACTIVE: "A replay is already active in this tab.",
    UPDATE_ORIGIN_MISMATCH: "Open the saved configuration's exact webshop before updating it.",
    UPDATE_CONTEXT_MISMATCH: "Open the same listing or search as the saved configuration before updating it.",
    SAVED_STATE_IN_USE: "This configuration is being replayed. Finish or cancel its replay before updating it.",
    SAVED_STATE_CHANGED: "The saved configuration changed while this preview was open.",
    NO_STATE_UPDATE_TO_UNDO: "There is no previous filter update available to restore.",
    NO_UPDATE_CHANGES: "These settings already match the saved configuration."
  };
  return known[code] || code.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
