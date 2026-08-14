import {
  ACTIVE_REPLAY_PREFIX,
  LIBRARY_INDEX_KEY,
  REPLAY_KEY_PREFIX,
  STATE_KEY_PREFIX
} from "../shared/constants.js";
import { validateSavedState } from "../shared/validator.js";

function stateKey(id) {
  return `${STATE_KEY_PREFIX}${id}`;
}

export async function listStates() {
  const indexResult = await chrome.storage.local.get(LIBRARY_INDEX_KEY);
  const index = Array.isArray(indexResult[LIBRARY_INDEX_KEY]) ? indexResult[LIBRARY_INDEX_KEY] : [];
  if (!index.length) return [];
  const keys = index.map(stateKey);
  const stored = await chrome.storage.local.get(keys);
  const states = [];
  const validIds = [];
  for (const id of index) {
    const state = stored[stateKey(id)];
    try {
      validateSavedState(state);
      states.push(state);
      validIds.push(id);
    } catch {
      // Corrupt entries are isolated rather than making the whole library unreadable.
    }
  }
  if (validIds.length !== index.length) await chrome.storage.local.set({ [LIBRARY_INDEX_KEY]: validIds });
  return states.sort((a, b) => String(b.metadata?.updatedAt || "").localeCompare(String(a.metadata?.updatedAt || "")));
}

export async function getState(id) {
  const result = await chrome.storage.local.get(stateKey(id));
  const state = result[stateKey(id)];
  validateSavedState(state);
  return state;
}

export async function putState(state) {
  validateSavedState(state);
  const result = await chrome.storage.local.get(LIBRARY_INDEX_KEY);
  const index = Array.isArray(result[LIBRARY_INDEX_KEY]) ? result[LIBRARY_INDEX_KEY] : [];
  if (!index.includes(state.id)) index.push(state.id);
  await chrome.storage.local.set({ [stateKey(state.id)]: state, [LIBRARY_INDEX_KEY]: index });
  return state;
}

export async function removeState(id) {
  const result = await chrome.storage.local.get(LIBRARY_INDEX_KEY);
  const index = Array.isArray(result[LIBRARY_INDEX_KEY]) ? result[LIBRARY_INDEX_KEY] : [];
  await chrome.storage.local.remove(stateKey(id));
  await chrome.storage.local.set({ [LIBRARY_INDEX_KEY]: index.filter((item) => item !== id) });
}

export async function putReplay(checkpoint) {
  await chrome.storage.session.set({
    [`${REPLAY_KEY_PREFIX}${checkpoint.replayId}`]: checkpoint,
    [`${ACTIVE_REPLAY_PREFIX}${checkpoint.tabId}`]: checkpoint.replayId
  });
}

export async function getReplay(replayId) {
  const result = await chrome.storage.session.get(`${REPLAY_KEY_PREFIX}${replayId}`);
  return result[`${REPLAY_KEY_PREFIX}${replayId}`] || null;
}

export async function getActiveReplay(tabId) {
  const activeKey = `${ACTIVE_REPLAY_PREFIX}${tabId}`;
  const active = await chrome.storage.session.get(activeKey);
  const replayId = active[activeKey];
  return replayId ? getReplay(replayId) : null;
}

export async function clearActiveReplay(tabId) {
  await chrome.storage.session.remove(`${ACTIVE_REPLAY_PREFIX}${tabId}`);
}
