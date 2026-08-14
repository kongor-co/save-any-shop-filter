import {
  ACTIVE_REPLAY_PREFIX,
  LIBRARY_INDEX_KEY,
  MAX_REPLAY_MS,
  MESSAGE,
  REPLAY_STATUS,
  SCHEMA_VERSION
} from "../shared/constants.js";
import { topologicalSort } from "../shared/planner.js";
import {
  buildReplayUrl,
  captureRouteCriteria,
  cleanCaptureUrl,
  mergeCriteria
} from "../shared/route.js";
import {
  sanitizeName,
  validateImportPayload,
  validateSavedState,
  validateUiMessage
} from "../shared/validator.js";
import {
  clearActiveReplay,
  getActiveReplay,
  getReplay,
  getState,
  listStates,
  putReplay,
  putState,
  removeState
} from "./storage.js";

const TERMINAL_STATUSES = new Set([
  REPLAY_STATUS.COMPLETE,
  REPLAY_STATUS.COMPLETE_WITH_WARNINGS,
  REPLAY_STATUS.PARTIAL,
  REPLAY_STATUS.FAILED,
  REPLAY_STATUS.CANCELLED,
  REPLAY_STATUS.INTERRUPTED
]);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.storage.local.set({
      [LIBRARY_INDEX_KEY]: [],
      "fv:meta": { schemaVersion: SCHEMA_VERSION, installedAt: new Date().toISOString() }
    });
  }
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: normalizeError(error) });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") resumeAfterNavigation(tabId).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const replay = await getActiveReplay(tabId);
  if (replay && !TERMINAL_STATUSES.has(replay.status)) {
    await putReplay({ ...replay, status: REPLAY_STATUS.INTERRUPTED, error: "TAB_CLOSED", updatedAt: new Date().toISOString() });
  }
  await clearActiveReplay(tabId);
});

async function handleMessage(message, sender) {
  validateUiMessage(message);
  const fromExtensionPage = typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  if (sender.tab && !fromExtensionPage) return handleContentMessage(message, sender);
  if (sender.id !== chrome.runtime.id) throw new Error("UNAUTHORIZED_SENDER");

  switch (message.type) {
    case MESSAGE.GET_CAPTURE_PREVIEW:
      return ok(await captureTab(assertTabId(message.tabId)));
    case MESSAGE.SAVE_CAPTURE:
      return ok(await saveCapture(message));
    case MESSAGE.LIST_STATES:
      return ok(await listStates());
    case MESSAGE.RENAME_STATE:
      return ok(await renameState(message));
    case MESSAGE.DUPLICATE_STATE:
      return ok(await duplicateState(message.stateId));
    case MESSAGE.DELETE_STATE:
      await removeState(message.stateId);
      return ok(true);
    case MESSAGE.EXPORT_LIBRARY:
      return ok(await exportLibrary(message.stateIds));
    case MESSAGE.IMPORT_LIBRARY:
      return ok(await importLibrary(message.payload));
    case MESSAGE.START_REPLAY:
      return ok(await startReplay(message.stateId, assertTabId(message.tabId)));
    case MESSAGE.CANCEL_REPLAY:
      return ok(await cancelReplay(message.replayId));
    case MESSAGE.GET_ACTIVE_REPLAY:
      return ok(await getActiveReplay(assertTabId(message.tabId)));
    default:
      throw new Error("UNKNOWN_MESSAGE_TYPE");
  }
}

async function handleContentMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("MISSING_CONTENT_TAB");
  if (![MESSAGE.CONTENT_READY, MESSAGE.REPLAY_PROGRESS, MESSAGE.REPLAY_COMPLETE].includes(message.type)) {
    throw new Error("UNAUTHORIZED_CONTENT_MESSAGE");
  }
  if (message.type === MESSAGE.CONTENT_READY) return ok(true);

  const checkpoint = await getReplay(message.replayId);
  if (!checkpoint || checkpoint.tabId !== tabId) throw new Error("STALE_REPLAY_ID");
  if (checkpoint.expectedOrigin !== sender.origin) throw new Error("ORIGIN_MISMATCH");
  if (checkpoint.documentId && sender.documentId && checkpoint.documentId !== sender.documentId) throw new Error("STALE_DOCUMENT");

  if (message.type === MESSAGE.REPLAY_PROGRESS) {
    const updated = {
      ...checkpoint,
      documentId: sender.documentId || checkpoint.documentId,
      status: message.status || REPLAY_STATUS.APPLYING,
      activeCriterion: message.activeCriterion || null,
      results: Array.isArray(message.results) ? message.results : checkpoint.results,
      updatedAt: new Date().toISOString()
    };
    await putReplay(updated);
    return ok(true);
  }

  const completed = {
    ...checkpoint,
    documentId: sender.documentId || checkpoint.documentId,
    status: message.result?.status || REPLAY_STATUS.FAILED,
    results: message.result?.results || checkpoint.results,
    activeCriterion: null,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await putReplay(completed);
  await updateReplayMetadata(completed);
  return ok(true);
}

async function ensureExecutor(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["src/content/executor.js"]
  });
}

async function captureTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  assertSupportedUrl(tab.url);
  await ensureExecutor(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE.CAPTURE_PAGE });
  if (!response?.ok) throw new Error(response?.error || "CAPTURE_FAILED");

  const routeCriteria = captureRouteCriteria(response.snapshot.url);
  const criteria = mergeCriteria(routeCriteria, response.snapshot.domCriteria || []);
  const captureUrl = cleanCaptureUrl(response.snapshot.url);
  const context = buildContext(response.snapshot, captureUrl);
  const preview = {
    site: {
      origin: new URL(captureUrl).origin,
      hostname: new URL(captureUrl).hostname,
      locale: response.snapshot.locale || "und",
      adapterId: response.snapshot.adapterId || "generic",
      adapterVersion: response.snapshot.adapterVersion || 1
    },
    context,
    criteria,
    unsupported: response.snapshot.unsupported || [],
    supportLevel: criteria.length === 0
      ? "UNSUPPORTED"
      : response.snapshot.unsupported?.length
        ? "LIMITED"
        : response.snapshot.adapterId && response.snapshot.adapterId !== "generic"
          ? "VERIFIED"
          : "COMPATIBLE",
    captureUrl,
    pageTitle: response.snapshot.title || new URL(captureUrl).hostname,
    capturedAt: new Date().toISOString()
  };
  preview.captureFingerprint = semanticFingerprint(preview);
  preview.suggestedName = suggestName(preview);
  return preview;
}

async function saveCapture(message) {
  const tabId = assertTabId(message.tabId);
  if (!message.preview || typeof message.preview !== "object") throw new Error("MISSING_CAPTURE_PREVIEW");
  const fresh = await captureTab(tabId);
  if (fresh.captureFingerprint !== message.preview.captureFingerprint) throw new Error("CAPTURE_STATE_CHANGED");
  if (!fresh.criteria.length) throw new Error("NO_SUPPORTED_CRITERIA");
  const now = new Date().toISOString();
  const state = {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name: sanitizeName(message.name, fresh.suggestedName),
    site: fresh.site,
    context: fresh.context,
    criteria: fresh.criteria,
    metadata: {
      createdAt: now,
      updatedAt: now,
      captureUrl: fresh.captureUrl,
      supportLevel: fresh.supportLevel,
      unsupported: fresh.unsupported,
      lastReplayAt: null,
      lastSuccessfulReplayAt: null,
      health: "UNKNOWN"
    }
  };
  await putState(state);
  return state;
}

async function renameState(message) {
  const state = await getState(message.stateId);
  const updated = {
    ...state,
    name: sanitizeName(message.name, state.name),
    metadata: { ...state.metadata, updatedAt: new Date().toISOString() }
  };
  await putState(updated);
  return updated;
}

async function duplicateState(stateId) {
  const state = await getState(stateId);
  const now = new Date().toISOString();
  const copy = structuredClone(state);
  copy.id = crypto.randomUUID();
  copy.name = sanitizeName(`${state.name} copy`);
  copy.metadata = { ...copy.metadata, createdAt: now, updatedAt: now, lastReplayAt: null, lastSuccessfulReplayAt: null };
  await putState(copy);
  return copy;
}

async function exportLibrary(stateIds) {
  const all = await listStates();
  const selected = Array.isArray(stateIds) && stateIds.length ? all.filter((state) => stateIds.includes(state.id)) : all;
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    product: "FilterVault",
    states: selected
  };
}

async function importLibrary(payload) {
  const parsed = validateImportPayload(payload);
  const existing = new Set((await listStates()).map((state) => state.id));
  const imported = [];
  for (const raw of parsed.states) {
    const state = structuredClone(raw);
    if (existing.has(state.id)) state.id = crypto.randomUUID();
    state.name = sanitizeName(state.name);
    state.metadata = { ...state.metadata, updatedAt: new Date().toISOString(), health: "UNKNOWN" };
    validateSavedState(state);
    await putState(state);
    existing.add(state.id);
    imported.push(state.id);
  }
  return { imported: imported.length };
}

async function startReplay(stateId, tabId) {
  const state = await getState(stateId);
  validateSavedState(state);
  topologicalSort(state.criteria);
  const active = await getActiveReplay(tabId);
  if (active && !TERMINAL_STATUSES.has(active.status)) throw new Error("REPLAY_ALREADY_ACTIVE");

  const tab = await chrome.tabs.get(tabId);
  assertSupportedUrl(tab.url);
  const currentOrigin = new URL(tab.url).origin;
  const savedOrigin = state.site.origin;
  if (currentOrigin !== savedOrigin) {
    const granted = await chrome.permissions.contains({ origins: [`${savedOrigin}/*`] });
    if (!granted) {
      return { permissionRequired: `${savedOrigin}/*`, savedOrigin };
    }
  }

  const replayId = crypto.randomUUID();
  const replayUrl = buildReplayUrl(state.metadata.captureUrl, state.criteria);
  const now = new Date().toISOString();
  const checkpoint = {
    checkpointVersion: 1,
    replayId,
    savedStateId: state.id,
    savedStateName: state.name,
    tabId,
    frameId: 0,
    documentId: null,
    expectedOrigin: savedOrigin,
    expectedUrl: replayUrl,
    status: REPLAY_STATUS.PLANNING,
    activeCriterion: null,
    results: [],
    cancelRequested: false,
    startedAt: now,
    updatedAt: now
  };
  await putReplay(checkpoint);

  if (!sameReplayRoute(tab.url, replayUrl)) {
    const waiting = { ...checkpoint, status: REPLAY_STATUS.WAITING_NAVIGATION, updatedAt: new Date().toISOString() };
    await putReplay(waiting);
    await chrome.tabs.update(tabId, { url: replayUrl });
    return waiting;
  }
  executeReplay(checkpoint, state).catch((error) => failReplay(checkpoint, error));
  return checkpoint;
}

async function resumeAfterNavigation(tabId) {
  const checkpoint = await getActiveReplay(tabId);
  if (!checkpoint || checkpoint.status !== REPLAY_STATUS.WAITING_NAVIGATION || checkpoint.cancelRequested) return;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || new URL(tab.url).origin !== checkpoint.expectedOrigin) {
    await failReplay(checkpoint, new Error("UNEXPECTED_NAVIGATION"));
    return;
  }
  const state = await getState(checkpoint.savedStateId);
  await executeReplay(checkpoint, state);
}

async function executeReplay(checkpoint, state) {
  const applying = { ...checkpoint, status: REPLAY_STATUS.APPLYING, updatedAt: new Date().toISOString() };
  await putReplay(applying);
  await ensureExecutor(checkpoint.tabId);
  const response = await chrome.tabs.sendMessage(checkpoint.tabId, {
    type: MESSAGE.EXECUTE_REPLAY,
    replayId: checkpoint.replayId,
    expectedOrigin: checkpoint.expectedOrigin,
    expectedContext: state.context,
    deadlineAt: Date.now() + MAX_REPLAY_MS,
    criteria: topologicalSort(state.criteria)
  });
  if (!response?.ok) throw new Error(response?.error || "REPLAY_EXECUTOR_FAILED");
  const finalCheckpoint = await getReplay(checkpoint.replayId);
  if (!finalCheckpoint || !TERMINAL_STATUSES.has(finalCheckpoint.status)) {
    const completed = {
      ...applying,
      status: response.result?.status || REPLAY_STATUS.FAILED,
      results: response.result?.results || [],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await putReplay(completed);
    await updateReplayMetadata(completed);
  }
}

async function cancelReplay(replayId) {
  const checkpoint = await getReplay(replayId);
  if (!checkpoint) throw new Error("REPLAY_NOT_FOUND");
  const cancelled = { ...checkpoint, cancelRequested: true, status: REPLAY_STATUS.CANCELLED, updatedAt: new Date().toISOString() };
  await putReplay(cancelled);
  try {
    await chrome.tabs.sendMessage(checkpoint.tabId, { type: MESSAGE.CANCEL_REPLAY_EXECUTOR, replayId });
  } catch {
    // Navigation may already have removed the executor.
  }
  return cancelled;
}

async function failReplay(checkpoint, error) {
  const latest = await getReplay(checkpoint.replayId);
  if (latest?.status === REPLAY_STATUS.CANCELLED) return;
  const failed = {
    ...(latest || checkpoint),
    status: REPLAY_STATUS.FAILED,
    error: normalizeError(error),
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await putReplay(failed);
  await updateReplayMetadata(failed);
}

async function updateReplayMetadata(checkpoint) {
  try {
    const state = await getState(checkpoint.savedStateId);
    const success = checkpoint.status === REPLAY_STATUS.COMPLETE || checkpoint.status === REPLAY_STATUS.COMPLETE_WITH_WARNINGS;
    const hasBroken = (checkpoint.results || []).some((result) => ["MAPPING_BROKEN", "VERIFY_FAILED"].includes(result.status));
    const hasWarning = (checkpoint.results || []).some((result) => !["APPLIED", "ALREADY_APPLIED", "VERIFIED"].includes(result.status));
    await putState({
      ...state,
      metadata: {
        ...state.metadata,
        updatedAt: new Date().toISOString(),
        lastReplayAt: checkpoint.completedAt || new Date().toISOString(),
        lastSuccessfulReplayAt: success ? (checkpoint.completedAt || new Date().toISOString()) : state.metadata.lastSuccessfulReplayAt,
        health: hasBroken ? "BROKEN" : hasWarning ? "DEGRADED" : "HEALTHY"
      }
    });
  } catch {
    // A deleted/corrupt state must not break replay finalization.
  }
}

function buildContext(snapshot, captureUrl) {
  const url = new URL(captureUrl);
  const searchQuery = ["q", "query", "search", "keyword"].map((key) => url.searchParams.get(key)).find(Boolean) || null;
  const surface = snapshot.pageType === "LISTING" ? "PRODUCT_LIST" : "SEARCH_RESULTS";
  const routeClass = url.pathname.replace(/\b\d+\b/g, ":id").replace(/\/+$/, "") || "/";
  return {
    surface,
    category: snapshot.contextLabel || null,
    searchQuery,
    routeClass,
    compatibilityFingerprint: `${url.origin}|${surface}|${routeClass}|${snapshot.locale || "und"}`
  };
}

function semanticFingerprint(preview) {
  const criteria = preview.criteria.map((criterion) => ({
    role: criterion.role,
    semanticType: criterion.semanticType,
    desiredValue: [...criterion.desiredValue].map(String).sort(),
    bindingTypes: [...new Set(criterion.bindings.map((binding) => binding.type))].sort()
  })).sort((a, b) => `${a.role}:${a.semanticType}`.localeCompare(`${b.role}:${b.semanticType}`));
  return JSON.stringify({ origin: preview.site.origin, context: preview.context, criteria });
}

function suggestName(preview) {
  const context = preview.context.searchQuery || preview.context.category || preview.pageTitle || preview.site.hostname;
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date());
  return sanitizeName(`${context} — ${date}`);
}

function sameReplayRoute(current, desired) {
  const left = new URL(current);
  const right = new URL(desired);
  left.hash = "";
  right.hash = "";
  return left.toString() === right.toString();
}

function assertSupportedUrl(url) {
  if (!url) throw new Error("NO_ACTIVE_PAGE");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("RESTRICTED_PAGE");
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("INVALID_TAB_ID");
  return tabId;
}

function ok(data) {
  return { ok: true, data };
}

function normalizeError(error) {
  const message = error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");
  if (/Cannot access|chrome:\/\/|edge:\/\/|Missing host permission/i.test(message)) return "PAGE_NOT_ACCESSIBLE";
  return message.slice(0, 300);
}
