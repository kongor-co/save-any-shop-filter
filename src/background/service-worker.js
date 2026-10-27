import {
  LIBRARY_INDEX_KEY,
  MESSAGE,
  REPLAY_STATUS,
  SCHEMA_VERSION
} from "../shared/constants.js";
import { calculateReplayBudget, topologicalSort } from "../shared/planner.js";
import { calculateCoverage } from "../shared/coverage.js";
import {
  buildReplayUrl,
  captureRouteCriteria,
  cleanCaptureUrl,
  getRouteSchemaInfo,
  getRouteCaptureHints,
  mergeCriteria
} from "../shared/route.js";
import {
  sanitizeName,
  validateImportPayload,
  validateReplayUrl,
  validateSavedState,
  validateUiMessage
} from "../shared/validator.js";
import {
  CONTEXT_COMPATIBILITY,
  classifyContextCompatibility,
  deriveMappingHealth,
  recoveryDecision,
  routeClassForUrl,
  selectApplicableCriteria
} from "../shared/replay-policy.js";
import {
  clearActiveReplay,
  getActiveReplay,
  getReplay,
  getState,
  listActiveReplays,
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
const replayLocks = new Map();
const readyDocuments = new Map();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.storage.local.set({
      [LIBRARY_INDEX_KEY]: [],
      "fv:meta": { schemaVersion: SCHEMA_VERSION, installedAt: new Date().toISOString() }
    });
  }
  if (reason === "update") await listStates();
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
  if (changeInfo.status === "loading") readyDocuments.delete(tabId);
  if (changeInfo.status === "complete") reconcileNavigation(tabId).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  readyDocuments.delete(tabId);
  const replay = await getActiveReplay(tabId);
  if (replay && !TERMINAL_STATUSES.has(replay.status)) {
    await putReplay({ ...replay, status: REPLAY_STATUS.INTERRUPTED, error: "TAB_CLOSED", updatedAt: new Date().toISOString() });
  }
  await clearActiveReplay(tabId);
});

const recovery = Promise.resolve().then(recoverActiveReplays);
recovery.catch(() => undefined);

async function handleMessage(message, sender) {
  const fromExtensionPage = typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  if (sender.tab && !fromExtensionPage) {
    validateUiMessage(message, "content");
    return handleContentMessage(message, sender);
  }
  if (sender.id !== chrome.runtime.id) throw new Error("UNAUTHORIZED_SENDER");
  await recovery;
  validateUiMessage(message, "ui");

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
    case MESSAGE.CONFIRM_REPLAY_CONTEXT:
      return ok(await confirmReplayContext(message.replayId));
    case MESSAGE.CANCEL_REPLAY:
      return ok(await cancelReplay(message.replayId));
    case MESSAGE.GET_ACTIVE_REPLAY:
      return ok(await getReplayStatus(assertTabId(message.tabId)));
    default:
      throw new Error("UNKNOWN_MESSAGE_TYPE");
  }
}

async function handleContentMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("MISSING_CONTENT_TAB");
  if (message.type === MESSAGE.CONTENT_READY) {
    registerReadyDocument(sender, tabId, message.href);
    return ok(true);
  }
  return withReplayLock(message.replayId, () => updateReplayFromContent(message, sender, tabId));
}

async function updateReplayFromContent(message, sender, tabId) {
  const checkpoint = await getReplay(message.replayId);
  if (!checkpoint || checkpoint.tabId !== tabId) throw new Error("STALE_REPLAY_ID");
  if (checkpoint.expectedOrigin !== senderOrigin(sender)) throw new Error("ORIGIN_MISMATCH");
  if (!sender.documentId || checkpoint.documentId !== sender.documentId) throw new Error("STALE_DOCUMENT");
  if (checkpoint.frameId !== sender.frameId) throw new Error("STALE_FRAME");
  if (![REPLAY_STATUS.APPLYING, REPLAY_STATUS.VERIFYING].includes(checkpoint.status)) return ok(true);
  const saved = await getState(checkpoint.savedStateId);
  const results = message.results || message.result?.results || [];
  const allowedIds = new Set(saved.criteria.map((item) => item.criterionId));
  if (results.some((item) => !allowedIds.has(item.criterionId))) throw new Error("UNKNOWN_RESULT_CRITERION");
  if (new Set(results.map((item) => item.criterionId)).size !== results.length) throw new Error("DUPLICATE_RESULT_CRITERION");
  if (message.result) {
    if (message.result.replayId !== checkpoint.replayId) throw new Error("STALE_REPLAY_ID");
    if (results.length !== saved.criteria.length) throw new Error("INCOMPLETE_REPLAY_RESULT");
  }
  if (checkpoint.cancelRequested || TERMINAL_STATUSES.has(checkpoint.status)) return ok(true);

  if (message.type === MESSAGE.REPLAY_PROGRESS) {
    const updated = {
      ...checkpoint,
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

async function ensureExecutor(tabId, expectedOrigin = null) {
  readyDocuments.delete(tabId);
  const injections = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["src/content/executor.js"]
  });
  const injectedDocument = Array.isArray(injections) ? injections.find((item) => item.frameId === 0)?.documentId : null;
  if (injectedDocument) {
    const tab = await chrome.tabs.get(tabId);
    const origin = new URL(tab.url).origin;
    if (expectedOrigin ? origin !== expectedOrigin : false) throw new Error("ORIGIN_MISMATCH");
    return { tabId, frameId: 0, documentId: injectedDocument, origin };
  }
  return waitForReadyDocument(tabId, expectedOrigin, injectedDocument);
}

async function captureTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  assertSupportedUrl(tab.url);
  const ready = await ensureExecutor(tabId, new URL(tab.url).origin);
  const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE.CAPTURE_PAGE, hints: getRouteCaptureHints(tab.url) }, messageTarget(ready));
  if (!response?.ok) throw new Error(response?.error || "CAPTURE_FAILED");

  const routeCriteria = captureRouteCriteria(response.snapshot.url, { includePresentation: true });
  const criteria = mergeCriteria(routeCriteria, response.snapshot.domCriteria || []);
  const captureUrl = cleanCaptureUrl(response.snapshot.url, { includePresentation: true });
  const routeSchema = getRouteSchemaInfo(captureUrl);
  const context = buildContext(response.snapshot, captureUrl, criteria);
  const unsupported = response.snapshot.unsupported || [];
  const unresolved = response.snapshot.unresolved || [];
  const defaultsIgnored = response.snapshot.defaultsIgnored || [];
  const adapterId = response.snapshot.adapterId && response.snapshot.adapterId !== "generic"
    ? response.snapshot.adapterId
    : routeSchema.id;
  const coverage = calculateCoverage({ criteria, unsupported, unresolved, defaultsIgnored, adapterId });
  const preview = {
    site: {
      origin: new URL(captureUrl).origin,
      hostname: new URL(captureUrl).hostname,
      locale: response.snapshot.locale || "und",
      adapterId,
      adapterVersion: response.snapshot.adapterId && response.snapshot.adapterId !== "generic"
        ? (response.snapshot.adapterVersion || 1)
        : routeSchema.version,
      routeSchemaId: routeSchema.id,
      routeSchemaVersion: routeSchema.version
    },
    context,
    criteria,
    unsupported,
    unresolved,
    defaultsIgnored,
    coverage,
    supportLevel: coverage.supportLevel,
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
  if (!fresh.coverage.saveEligible) throw new Error("NO_MEANINGFUL_CRITERIA");
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
      routeSnapshot: fresh.captureUrl,
      supportLevel: fresh.supportLevel,
      unsupported: fresh.unsupported,
      unresolved: fresh.unresolved,
      defaultsIgnored: fresh.defaultsIgnored,
      coverage: fresh.coverage,
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
  return withReplayLock(`tab:${tabId}`, () => startReplayInTab(stateId, tabId));
}

async function startReplayInTab(stateId, tabId) {
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
  const replayUrl = buildReplayUrl(state.metadata.routeSnapshot || state.metadata.captureUrl, state.criteria);
  validateReplayUrl(replayUrl, savedOrigin);
  const now = new Date().toISOString();
  const checkpoint = {
    checkpointVersion: 3,
    deadlineAt: Date.now() + calculateReplayBudget(state.criteria),
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
    contextCompatibility: null,
    contextConfirmed: false,
    cancelRequested: false,
    startedAt: now,
    updatedAt: now
  };
  await putReplay(checkpoint);

  if (!sameReplayRoute(tab.url, replayUrl)) {
    const waiting = { ...checkpoint, status: REPLAY_STATUS.WAITING_NAVIGATION, updatedAt: new Date().toISOString() };
    await putReplay(waiting);
    try {
      await chrome.tabs.update(tabId, { url: replayUrl });
      await withReplayLock(replayId, async () => {
        const latest = await getReplay(replayId);
        await putReplay({ ...latest, navigationDispatchedAt: new Date().toISOString() });
      });
    } catch (error) { await failReplay(waiting, error); }
    return getReplay(replayId);
  }
  executeReplay(checkpoint, state).catch((error) => failReplay(checkpoint, error));
  return checkpoint;
}

async function reconcileNavigation(tabId) {
  const checkpoint = await getActiveReplay(tabId);
  if (!checkpoint) return;
  if (checkpoint.status === REPLAY_STATUS.WAITING_NAVIGATION) {
    await resumeAfterNavigation(tabId);
    return;
  }
  if ([REPLAY_STATUS.APPLYING, REPLAY_STATUS.VERIFYING].includes(checkpoint.status)) {
    try { await reconnectExecutor(checkpoint); }
    catch { await interruptReplay(checkpoint, "DOCUMENT_REPLACED"); }
  }
}

async function resumeAfterNavigation(tabId) {
  const checkpoint = await getActiveReplay(tabId);
  if (!checkpoint || checkpoint.status !== REPLAY_STATUS.WAITING_NAVIGATION || checkpoint.cancelRequested) return;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || new URL(tab.url).origin !== checkpoint.expectedOrigin) {
    await failReplay(checkpoint, new Error("UNEXPECTED_NAVIGATION"));
    return;
  }
  try {
    const state = await getState(checkpoint.savedStateId);
    await executeReplay(checkpoint, state);
  } catch (error) {
    await failReplay(checkpoint, error);
  }
}

async function executeReplay(checkpoint, state) {
  const preflight = await withReplayLock(checkpoint.replayId, async () => {
    const latest = await getReplay(checkpoint.replayId);
    if (!latest || latest.cancelRequested || TERMINAL_STATUSES.has(latest.status)) return null;
    if (![REPLAY_STATUS.PLANNING, REPLAY_STATUS.WAITING_NAVIGATION].includes(latest.status)) return null;
    const next = { ...latest, status: REPLAY_STATUS.PREFLIGHT, updatedAt: new Date().toISOString() };
    await putReplay(next);
    return next;
  });
  if (!preflight) return;
  if (Date.now() > preflight.deadlineAt) throw new Error("REPLAY_TIMEOUT");

  const ready = await ensureExecutor(preflight.tabId, preflight.expectedOrigin);
  const contextResponse = await boundedMessage(preflight, { type: MESSAGE.INSPECT_PAGE_CONTEXT }, ready);
  if (!contextResponse?.ok || !contextResponse.context) throw new Error(contextResponse?.error || "CONTEXT_INSPECTION_FAILED");
  const expectedContext = { ...state.context, origin: state.site.origin, locale: state.site.locale };
  const compatibility = classifyContextCompatibility(expectedContext, contextResponse.context);
  if (compatibility.level === CONTEXT_COMPATIBILITY.INCOMPATIBLE) throw new Error("INCOMPATIBLE_CONTEXT");
  const confirmationMatches = preflight.confirmedDocumentId === ready.documentId
    ? preflight.confirmedContext === contextSignature(contextResponse.context) : false;
  if (compatibility.level === CONTEXT_COMPATIBILITY.UNCERTAIN ? !confirmationMatches : false) {
    await withReplayLock(preflight.replayId, async () => {
      const latest = await getReplay(preflight.replayId);
      if (!latest || latest.status !== REPLAY_STATUS.PREFLIGHT) return;
      await putReplay({
        ...latest,
        documentId: ready.documentId,
        frameId: ready.frameId,
        status: REPLAY_STATUS.AWAITING_CONFIRMATION,
        contextCompatibility: compatibility,
        runtimeContext: contextResponse.context,
        updatedAt: new Date().toISOString()
      });
    });
    return;
  }

  const applying = await withReplayLock(preflight.replayId, async () => {
    const latest = await getReplay(preflight.replayId);
    if (!latest || latest.status !== REPLAY_STATUS.PREFLIGHT || latest.cancelRequested) return null;
    const next = {
      ...latest,
      documentId: ready.documentId,
      frameId: ready.frameId,
      status: REPLAY_STATUS.APPLYING,
      contextCompatibility: compatibility,
      runtimeContext: contextResponse.context,
      updatedAt: new Date().toISOString()
    };
    await putReplay(next);
    return next;
  });
  if (!applying) return;
  const criteria = selectApplicableCriteria(topologicalSort(state.criteria), contextResponse.context);
  const response = await boundedMessage(applying, {
    type: MESSAGE.EXECUTE_REPLAY,
    replayId: applying.replayId,
    expectedOrigin: applying.expectedOrigin,
    expectedContext: state.context,
    deadlineAt: applying.deadlineAt,
    runtimeContext: contextResponse.context,
    criteria
  }, ready, applying.deadlineAt - Date.now());
  if (!response?.ok) throw new Error(response?.error || "REPLAY_EXECUTOR_FAILED");
  const completion = { type: MESSAGE.REPLAY_COMPLETE, replayId: applying.replayId, result: response.result };
  validateUiMessage(completion, "content");
  await withReplayLock(applying.replayId, () => updateReplayFromContent(completion, {
    tab: { id: applying.tabId }, documentId: ready.documentId, frameId: ready.frameId, origin: ready.origin
  }, applying.tabId));
}

async function confirmReplayContext(replayId) {
  const checkpoint = await withReplayLock(replayId, async () => {
    const latest = await getReplay(replayId);
    if (!latest) throw new Error("REPLAY_NOT_FOUND");
    if (latest.status !== REPLAY_STATUS.AWAITING_CONFIRMATION) throw new Error("REPLAY_NOT_AWAITING_CONFIRMATION");
    const confirmed = {
      ...latest,
      status: REPLAY_STATUS.PLANNING,
      contextConfirmed: true,
      confirmedDocumentId: latest.documentId,
      confirmedContext: contextSignature(latest.runtimeContext),
      deadlineAt: Date.now() + calculateReplayBudget((await getState(latest.savedStateId)).criteria),
      updatedAt: new Date().toISOString()
    };
    await putReplay(confirmed);
    return confirmed;
  });
  const state = await getState(checkpoint.savedStateId);
  executeReplay(checkpoint, state).catch((error) => failReplay(checkpoint, error));
  return checkpoint;
}

async function cancelReplay(replayId) {
  const cancelled = await withReplayLock(replayId, async () => {
    const checkpoint = await getReplay(replayId);
    if (!checkpoint) throw new Error("REPLAY_NOT_FOUND");
    if (TERMINAL_STATUSES.has(checkpoint.status)) return checkpoint;
    const saved = await getState(checkpoint.savedStateId);
    const results = fillUnattempted(saved.criteria, checkpoint.results);
    const next = { ...checkpoint, results, cancelRequested: true, status: REPLAY_STATUS.CANCELLED, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await putReplay(next);
    return next;
  });
  await stopExecutor(cancelled);
  await updateReplayMetadata(cancelled);
  return cancelled;
}

async function failReplay(checkpoint, error) {
  await withReplayLock(checkpoint.replayId, async () => {
    const latest = await getReplay(checkpoint.replayId);
    if (TERMINAL_STATUSES.has(latest?.status)) return;
    const saved = await getState(checkpoint.savedStateId).catch(() => null);
    const failed = {
      ...(latest || checkpoint),
      results: saved ? fillUnattempted(saved.criteria, latest?.results || []) : (latest?.results || []),
      status: REPLAY_STATUS.FAILED,
      error: normalizeError(error),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await putReplay(failed);
    await updateReplayMetadata(failed);
    await stopExecutor(failed);
  });
}

async function updateReplayMetadata(checkpoint) {
  try {
    const state = await getState(checkpoint.savedStateId);
    const success = checkpoint.status === REPLAY_STATUS.COMPLETE || checkpoint.status === REPLAY_STATUS.COMPLETE_WITH_WARNINGS;
    const health = deriveMappingHealth(checkpoint.results, state.metadata.health);
    const mappingHealthEvidence = (checkpoint.results || []).map((result) => ({
      criterionId: result.criterionId,
      status: result.status,
      observedAt: checkpoint.completedAt || new Date().toISOString()
    }));
    await putState({
      ...state,
      metadata: {
        ...state.metadata,
        updatedAt: new Date().toISOString(),
        lastReplayAt: checkpoint.completedAt || new Date().toISOString(),
        lastSuccessfulReplayAt: success ? (checkpoint.completedAt || new Date().toISOString()) : state.metadata.lastSuccessfulReplayAt,
        health,
        mappingHealthEvidence
      }
    });
  } catch {
    // A deleted/corrupt state must not break replay finalization.
  }
}

function fillUnattempted(criteria, results = []) {
  const seen = new Set(results.map((item) => item.criterionId));
  return [...results, ...criteria.filter((item) => !seen.has(item.criterionId)).map((item) => ({
    criterionId: item.criterionId, semanticType: item.semanticType, desiredValue: item.desiredValue,
    status: "NOT_ATTEMPTED", message: "Replay stopped before this criterion completed.", evidence: null
  }))];
}

async function boundedMessage(checkpoint, message, target = checkpoint, maximumMs = 3000) {
  const remaining = Math.min(maximumMs, checkpoint.deadlineAt - Date.now());
  if (!(remaining > 0)) throw new Error("REPLAY_TIMEOUT");
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(checkpoint.tabId, message, messageTarget(target)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("EXECUTOR_TIMEOUT")), remaining); })
    ]);
  } finally { clearTimeout(timer); }
}

async function stopExecutor(checkpoint) {
  if (!checkpoint.documentId) return;
  try {
    await boundedMessage({ ...checkpoint, deadlineAt: Date.now() + 1000 }, {
      type: MESSAGE.CANCEL_REPLAY_EXECUTOR, replayId: checkpoint.replayId
    }, checkpoint, 1000);
  } catch {
    // The old document may already be gone.
  }
}

async function interruptReplay(checkpoint, error) {
  await withReplayLock(checkpoint.replayId, async () => {
    const latest = await getReplay(checkpoint.replayId);
    if (!latest || TERMINAL_STATUSES.has(latest.status)) return;
    const saved = await getState(latest.savedStateId).catch(() => null);
    const interrupted = {
      ...latest, status: REPLAY_STATUS.INTERRUPTED, error,
      results: saved ? fillUnattempted(saved.criteria, latest.results) : latest.results,
      completedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await putReplay(interrupted);
    await stopExecutor(interrupted);
    await updateReplayMetadata(interrupted);
  });
}

async function getReplayStatus(tabId) {
  const checkpoint = await getActiveReplay(tabId);
  if (!checkpoint || TERMINAL_STATUSES.has(checkpoint.status)) return checkpoint;
  if (checkpoint.status === REPLAY_STATUS.AWAITING_CONFIRMATION) return checkpoint;
  if (Date.now() > checkpoint.deadlineAt) {
    await failReplay(checkpoint, new Error("REPLAY_TIMEOUT"));
    return getReplay(checkpoint.replayId);
  }
  return checkpoint;
}

async function reconnectExecutor(checkpoint) {
  const response = await boundedMessage(checkpoint, { type: MESSAGE.GET_REPLAY_EXECUTOR, replayId: checkpoint.replayId });
  const snapshot = response?.snapshot;
  if (!snapshot || snapshot.replayId !== checkpoint.replayId) throw new Error("EXECUTOR_LOST");
  const sender = { tab: { id: checkpoint.tabId }, frameId: checkpoint.frameId, documentId: checkpoint.documentId, origin: checkpoint.expectedOrigin };
  const message = snapshot.result
    ? { type: MESSAGE.REPLAY_COMPLETE, replayId: checkpoint.replayId, result: snapshot.result }
    : { type: MESSAGE.REPLAY_PROGRESS, replayId: checkpoint.replayId, status: snapshot.status, activeCriterion: snapshot.activeCriterion, results: snapshot.results };
  validateUiMessage(message, "content");
  await withReplayLock(checkpoint.replayId, () => updateReplayFromContent(message, sender, checkpoint.tabId));
}

async function recoverActiveReplays() {
  for (const checkpoint of await listActiveReplays()) {
    try {
      const decision = recoveryDecision(checkpoint);
      if (decision === "IGNORE") continue;
      if (decision === "INTERRUPT") {
        await interruptReplay(checkpoint, "INCOMPATIBLE_CHECKPOINT");
        continue;
      }
      if (Date.now() > checkpoint.deadlineAt) throw new Error("REPLAY_TIMEOUT");
      validateReplayUrl(checkpoint.expectedUrl, checkpoint.expectedOrigin);
      const state = await getState(checkpoint.savedStateId);
      const tab = await chrome.tabs.get(checkpoint.tabId);
      if (decision === "RECONNECT") {
        if (new URL(tab.url).origin !== checkpoint.expectedOrigin) throw new Error("UNEXPECTED_NAVIGATION");
        await reconnectExecutor(checkpoint);
        continue;
      }
      if (decision === "PREFLIGHT") {
        await withReplayLock(checkpoint.replayId, async () => {
          const latest = await getReplay(checkpoint.replayId);
          if (latest?.status !== REPLAY_STATUS.PREFLIGHT) return;
          await putReplay({ ...latest, status: REPLAY_STATUS.PLANNING });
        });
      }
      if (checkpoint.status === REPLAY_STATUS.WAITING_NAVIGATION) {
        if (!checkpoint.navigationDispatchedAt) {
          if (!sameReplayRoute(tab.url, checkpoint.expectedUrl)) {
            await chrome.tabs.update(checkpoint.tabId, { url: checkpoint.expectedUrl });
            continue;
          }
        }
        if (tab.status !== "complete") continue;
        if (new URL(tab.url).origin !== checkpoint.expectedOrigin) throw new Error("UNEXPECTED_NAVIGATION");
      } else if (!sameReplayRoute(tab.url, checkpoint.expectedUrl)) {
        throw new Error("UNEXPECTED_NAVIGATION");
      }
      executeReplay(checkpoint, state).catch((error) => failReplay(checkpoint, error));
    } catch (error) {
      await interruptReplay(checkpoint, normalizeError(error));
    }
  }
}

function registerReadyDocument(sender, tabId, href) {
  if (sender.frameId !== 0) throw new Error("UNAUTHORIZED_FRAME");
  if (!sender.documentId) throw new Error("MISSING_DOCUMENT_ID");
  const origin = senderOrigin(sender);
  if (new URL(href).origin !== origin) throw new Error("DOCUMENT_ORIGIN_MISMATCH");
  readyDocuments.set(tabId, {
    tabId,
    frameId: sender.frameId,
    documentId: sender.documentId,
    origin,
    href,
    seenAt: Date.now()
  });
}

async function waitForReadyDocument(tabId, expectedOrigin, expectedDocumentId = null) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const ready = readyDocuments.get(tabId);
    if (expectedDocumentId) {
      if (ready?.documentId !== expectedDocumentId) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        continue;
      }
    }
    if (ready && (!expectedOrigin || ready.origin === expectedOrigin)) return ready;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("EXECUTOR_DOCUMENT_NOT_READY");
}

function messageTarget(ready) {
  return { documentId: ready.documentId, frameId: ready.frameId };
}

function contextSignature(context) {
  return JSON.stringify(Object.keys(context).sort().map((key) => [key, context[key]]));
}

function senderOrigin(sender) {
  if (typeof sender.origin === "string") return sender.origin;
  if (typeof sender.url === "string") return new URL(sender.url).origin;
  throw new Error("MISSING_SENDER_ORIGIN");
}

function buildContext(snapshot, captureUrl, criteria = []) {
  const url = new URL(captureUrl);
  const searchCriterion = criteria.find((criterion) => criterion.role === "CONTEXT" && criterion.semanticType === "SEARCH_QUERY");
  const searchQuery = searchCriterion?.desiredValue?.[0]
    || ["q", "query", "search", "keyword", "k", "Ntt"].map((key) => url.searchParams.get(key)).find(Boolean)
    || (/\/suche\/([^/]+)/i.exec(url.pathname)?.[1] ? decodeURIComponent(/\/suche\/([^/]+)/i.exec(url.pathname)[1]).replace(/[-_]+/g, " ") : null);
  const surface = snapshot.pageType === "LISTING" ? "PRODUCT_LIST" : "SEARCH_RESULTS";
  const routeClass = routeClassForUrl(url);
  const locale = snapshot.locale || "und";
  return {
    surface,
    category: snapshot.contextLabel || null,
    searchQuery,
    routeClass,
    locale,
    compatibilityFingerprint: `${url.origin}|${surface}|${routeClass}|${String(locale).toLocaleLowerCase()}`
  };
}

function semanticFingerprint(preview) {
  const criteria = preview.criteria.map((criterion) => ({
    role: criterion.role,
    semanticType: criterion.semanticType,
    desiredValue: [...criterion.desiredValue].map(String).sort(),
    bindingTypes: [...new Set(criterion.bindings.map((binding) => binding.type))].sort()
  })).sort((a, b) => `${a.role}:${a.semanticType}`.localeCompare(`${b.role}:${b.semanticType}`));
  const omissions = [...(preview.unsupported || []), ...(preview.unresolved || [])]
    .map((item) => `${item.label || ""}:${item.reason || ""}`).sort();
  return JSON.stringify({ origin: preview.site.origin, context: preview.context, criteria, omissions });
}

function suggestName(preview) {
  const context = preview.context.searchQuery || preview.context.category || preview.pageTitle || preview.site.hostname;
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date());
  return sanitizeName(`${context} - ${date}`);
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

function withReplayLock(replayId, operation) {
  const previous = replayLocks.get(replayId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  replayLocks.set(replayId, current);
  return current.finally(() => {
    if (replayLocks.get(replayId) === current) replayLocks.delete(replayId);
  });
}
