import { MESSAGE } from "../shared/constants.js";

const state = {
  activeTab: null,
  capture: null,
  library: [],
  replay: null,
  replayTimer: null
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  tabs: [...document.querySelectorAll(".tab")],
  captureView: $("#capture-view"),
  libraryView: $("#library-view"),
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
  detailsDialog: $("#details-dialog")
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
  $("#library-search").addEventListener("input", renderLibrary);
  $("#library-list").addEventListener("click", handleLibraryAction);
  $("#export-all").addEventListener("click", () => exportStates());
  $("#import-trigger").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", importFile);
  $("#cancel-replay").addEventListener("click", cancelReplay);
  $("#replay-done").addEventListener("click", async () => { await loadLibrary(); switchView("library"); });
  $("#close-details").addEventListener("click", () => elements.detailsDialog.close());
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
  elements.save.disabled = preview.criteria.length === 0;
  elements.save.textContent = preview.criteria.length ? `Save ${preview.criteria.length} ${preview.criteria.length === 1 ? "criterion" : "criteria"}` : "Nothing supported to save";
  const unsupported = preview.unsupported || [];
  $("#unsupported-wrap").hidden = unsupported.length === 0;
  $("#unsupported-count").textContent = String(unsupported.length);
  $("#unsupported-list").replaceChildren(...unsupported.map((item) => {
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

async function loadLibrary() {
  state.library = await send(MESSAGE.LIST_STATES);
  elements.libraryCount.textContent = String(state.library.length);
  renderLibrary();
}

function renderLibrary() {
  const query = $("#library-search").value.trim().toLowerCase();
  const visible = state.library.filter((item) => `${item.name} ${item.site.hostname} ${item.context.category || ""} ${item.context.searchQuery || ""}`.toLowerCase().includes(query));
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
  } catch (error) {
    toast(humanError(error), true);
  }
}

async function moreActions(saved) {
  const choice = prompt("Choose: rename, duplicate, export, or delete", "rename");
  if (!choice) return;
  if (choice.toLowerCase() === "rename") {
    const name = prompt("New name", saved.name);
    if (name) await send(MESSAGE.RENAME_STATE, { stateId: saved.id, name });
  } else if (choice.toLowerCase() === "duplicate") {
    await send(MESSAGE.DUPLICATE_STATE, { stateId: saved.id });
  } else if (choice.toLowerCase() === "export") {
    await exportStates([saved.id]);
  } else if (choice.toLowerCase() === "delete") {
    if (confirm(`Delete “${saved.name}”? This cannot be undone.`)) await send(MESSAGE.DELETE_STATE, { stateId: saved.id });
  } else {
    throw new Error("Choose rename, duplicate, export, or delete.");
  }
  await loadLibrary();
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
  const saved = state.library.find((item) => item.id === replay.savedStateId);
  const byId = new Map((saved?.criteria || []).map((item) => [item.criterionId, item]));
  const results = replay.results || [];
  $("#replay-results").replaceChildren(...results.map((result) => criterionNode(byId.get(result.criterionId) || result, result)));
  const terminal = isTerminal(replay.status);
  $("#replay-spinner").hidden = terminal;
  $("#cancel-replay").hidden = terminal;
  $("#replay-done").hidden = !terminal;
  if (terminal) $("#replay-title").textContent = replayTitle(replay);
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

function humanSemantic(value) {
  return String(value || "Filter").toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function statusLabel(status) {
  return ({ ALREADY_APPLIED: "Already set", APPLIED: "Applied", VERIFIED: "Verified", VALUE_UNAVAILABLE: "Unavailable", FILTER_UNAVAILABLE: "Unavailable", MAPPING_BROKEN: "Mapping broken", RESOLUTION_INCONCLUSIVE: "Inconclusive", UNSUPPORTED_CONTROL: "Unsupported", UNSUPPORTED_INTERACTION: "Unsupported", VERIFY_FAILED: "Not verified", DEPENDENCY_FAILED: "Skipped", CANCELLED: "Cancelled" })[status] || status;
}

function resultSeverity(status) {
  if (["ALREADY_APPLIED", "APPLIED", "VERIFIED"].includes(status)) return "success";
  if (["VALUE_UNAVAILABLE", "FILTER_UNAVAILABLE", "RESOLUTION_INCONCLUSIVE", "UNSUPPORTED_CONTROL", "UNSUPPORTED_INTERACTION", "DEPENDENCY_FAILED"].includes(status)) return "warning";
  return "failure";
}

function replayTitle(replay) {
  const succeeded = (replay.results || []).filter((result) => resultSeverity(result.status) === "success").length;
  const total = (replay.results || []).length;
  if (replay.status === "COMPLETE") return `All ${total} criteria restored`;
  if (replay.status === "CANCELLED") return "Replay cancelled";
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
    NO_SUPPORTED_CRITERIA: "No supported active filters were found.",
    REPLAY_ALREADY_ACTIVE: "A replay is already active in this tab."
  };
  return known[code] || code.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
