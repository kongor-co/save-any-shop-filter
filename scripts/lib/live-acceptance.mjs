import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function runtimeIdentity(root) {
  async function files(directory) {
    const entries = await readdir(directory, {withFileTypes:true});
    const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(resolve(directory,entry.name)) : [resolve(directory,entry.name)]));
    return nested.flat();
  }
  const paths = [resolve(root,"manifest.json"), ...await files(resolve(root,"src"))].sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    const name = relative(root,path).replaceAll("\\","/");
    const bytes = await readFile(path);
    const content = /\.(?:js|json|css|html)$/.test(path) ? Buffer.from(bytes.toString("utf8").replaceAll("\r\n","\n")) : bytes;
    hash.update(`${name}\0${content.length}\0`);
    hash.update(content);
  }
  const manifest = JSON.parse(await readFile(resolve(root,"manifest.json"),"utf8"));
  return {version:manifest.version,runtimeSha256:hash.digest("hex")};
}

export const scenarioDigest = (scenario) => digest(JSON.stringify(scenario));

function values(items) {
  return (items || []).map(String).sort();
}

function matches(left, right) {
  if (left.semanticType !== right.semanticType) return false;
  return JSON.stringify(values(left.desiredValue)) === JSON.stringify(values(right.desiredValue));
}

export function checkCapture(criteria, expected) {
  if (!Array.isArray(expected) || !expected.length) throw new Error("NO_EXPECTED_CRITERIA");
  if (!Array.isArray(criteria) || criteria.length === 0) throw new Error("NO_CAPTURED_CRITERIA");
  for (const criterion of expected) {
    const role=criterion.role || "FILTER";
    if (!criteria.some((item) => item.role === role ? matches(item,criterion) : false)) throw new Error(`EXPECTED_CRITERION_MISSING:${criterion.semanticType}`);
  }
}

export function resetDifferences(captured, reset) {
  return captured.filter((item) => item.role === "FILTER").filter((item) => !reset.some((other) => matches(item,other))).map((item) => item.criterionId);
}

export function assessReplay(captured, replay, omissions = 0) {
  if (!replay || !Array.isArray(replay.results)) return {status:"FAIL",reason:"MISSING_REPLAY_REPORT"};
  if (!["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL"].includes(replay.status)) return {status:"FAIL",reason:`REPLAY_${replay.status || "UNKNOWN"}`};
  const byId = new Map(replay.results.map((item) => [item.criterionId,item]));
  if (byId.size !== captured.length || byId.size !== replay.results.length) return {status:"FAIL",reason:"INCOMPLETE_REPLAY_REPORT"};
  for (const criterion of captured) {
    if (!byId.has(criterion.criterionId)) return {status:"FAIL",reason:"UNKNOWN_REPLAY_CRITERION"};
  }
  const unverified = captured.filter((item) => item.role !== "PRESENTATION").filter((item) => {
    const result = byId.get(item.criterionId);
    if (result.status !== "VERIFIED") return true;
    return !["VISIBLE_STATE","DOM_CONTROL"].includes(result.evidence);
  });
  if (unverified.length) return {status:"PARTIAL",reason:"UNVERIFIED_REQUIRED_CRITERIA"};
  if (replay.status === "PARTIAL") return {status:"PARTIAL",reason:"REPLAY_PARTIAL"};
  if (omissions > 0) return {status:"PARTIAL",reason:"CAPTURE_OMISSIONS"};
  return {status:"PASS",reason:"CAPTURE_SAVE_RESET_REPLAY_VERIFIED"};
}

export async function detectBlocker(page, origin) {
  const current = new URL(page.url());
  if (current.origin !== origin) return "UNEXPECTED_ORIGIN";
  return page.evaluate(() => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" ? style.display !== "none" : false;
    };
    const text = (document.body?.innerText || "").slice(0,8000);
    if (/captcha|verify (?:that )?you are human|access denied|zugriff verweigert|unusual traffic|automated (?:access|requests)|checking your browser/i.test(text)) return "BOT_CHALLENGE";
    if (document.querySelector('input[type="password"]')) return "LOGIN_REQUIRED";
    for (const dialog of document.querySelectorAll('[role="dialog"],[aria-modal="true"],#onetrust-banner-sdk,#usercentrics-root')) {
      if (!visible(dialog)) continue;
      if (/cookie|consent|einwilligung|datenschutz|zustimmung/i.test(dialog.textContent || dialog.id)) return "CONSENT_REQUIRED";
    }
    if (!text.trim()) return "EMPTY_DOCUMENT";
    return null;
  }).catch((error) => {
    if (/Execution context was destroyed|Cannot find context with specified id/i.test(String(error.message))) return null;
    throw error;
  });
}

export async function runAcceptanceScenario({page,call,tabId,scenario,schemaVersion,onStage = () => {},blocker = detectBlocker}) {
  const result = {scenarioId:scenario.id,scenario:structuredClone(scenario),scenarioSha256:scenarioDigest(scenario),schemaId:scenario.schemaId,schemaVersion,status:"FAIL",stage:"NAVIGATE",reason:null,capturedCriteria:[],resetCriteria:[],resetChanged:[],omissions:0,replay:null};
  const origin = new URL(scenario.filteredUrl).origin;
  async function navigate(url, selector) {
    const response = await page.goto(url,{waitUntil:"domcontentloaded",timeout:30_000});
    result.httpStatus = response?.status() || null;
    const blocked = await blocker(page,origin);
    if (blocked ? blocked !== "EMPTY_DOCUMENT" : false) throw new Error(`BLOCKED:${blocked}`);
    if ([401,403,429].includes(response?.status())) throw new Error(`BLOCKED:HTTP_${response.status()}`);
    if (response?.status() >= 400) throw new Error(`HTTP_${response.status()}`);
    if (selector) await page.locator(selector).first().waitFor({state:"visible",timeout:15_000});
    const after = await blocker(page,origin);
    if (after) throw new Error(`BLOCKED:${after}`);
  }
  function stage(name) { result.stage=name; onStage(name); }
  try {
    await navigate(scenario.filteredUrl,scenario.readySelector);
    stage("CAPTURE");
    const preview = await call("GET_CAPTURE_PREVIEW",{tabId});
    checkCapture(preview.criteria,scenario.expectedCriteria);
    result.capturedCriteria = preview.criteria.map(criterionEvidence);
    result.omissions = (preview.unsupported?.length || 0)+(preview.unresolved?.length || 0);
    stage("SAVE");
    const saved = await call("SAVE_CAPTURE",{tabId,preview,name:`Live acceptance ${scenario.id}`});
    result.savedStateId = saved.id;
    const stored = (await call("LIST_STATES")).find((item) => item.id === saved.id);
    if (!stored || JSON.stringify(stored.criteria.map(criterionEvidence)) !== JSON.stringify(result.capturedCriteria)) throw new Error("SAVE_ROUND_TRIP_MISMATCH");
    result.savedRoundTrip = true;
    stage("RESET");
    await navigate(scenario.resetUrl,scenario.resetReadySelector || "h1");
    const reset = await call("GET_CAPTURE_PREVIEW",{tabId});
    result.resetCriteria = reset.criteria.map(criterionEvidence);
    result.resetChanged = resetDifferences(result.capturedCriteria,result.resetCriteria);
    if (!result.resetChanged.length) throw new Error("RESET_DID_NOT_CHANGE_FILTERS");
    stage("REPLAY");
    const started = await call("START_REPLAY",{stateId:saved.id,tabId});
    if (started.permissionRequired) throw new Error("BLOCKED:PERMISSION_REQUIRED");
    if (typeof started.replayId !== "string" || !started.replayId) throw new Error("MISSING_REPLAY_ID");
    result.startedReplayId = started.replayId;
    const deadline = Date.now()+95_000;
    while (Date.now()<deadline) {
      result.replay = await call("GET_ACTIVE_REPLAY",{tabId});
      if (!result.replay || result.replay.replayId !== started.replayId) throw new Error("REPLAY_ID_CHANGED");
      const transitional = ["PLANNING","WAITING_NAVIGATION","PREFLIGHT"].includes(result.replay.status);
      const blocked = transitional ? null : await blocker(page,origin);
      if (blocked) throw new Error(`BLOCKED:${blocked}`);
      if (result.replay.status === "AWAITING_CONFIRMATION") throw new Error("BLOCKED:CONTEXT_REVIEW_REQUIRED");
      if (["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(result.replay.status)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait,200));
    }
    if (!["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(result.replay.status)) throw new Error("REPLAY_TIMEOUT");
    Object.assign(result,assessReplay(result.capturedCriteria,result.replay,result.omissions));
    stage("COMPLETE");
  } catch (error) {
    const message = String(error.message || error).slice(0,500);
    const detected = await blocker(page,origin).catch(() => null);
    if (message.startsWith("BLOCKED:") || detected) {
      result.status="BLOCKED";
      result.reason=message.startsWith("BLOCKED:") ? message.slice("BLOCKED:".length) : detected;
    } else if (/net::ERR_|browser has been closed|page has been closed/i.test(message)) {
      result.status="BLOCKED";
      result.reason="BROWSER_OR_NETWORK_UNAVAILABLE";
    } else {
      result.status="FAIL";
      result.reason=message;
    }
  } finally {
    if (result.startedReplayId) {
      const ownReplay = result.replay?.replayId === result.startedReplayId;
      const finished = ownReplay ? ["COMPLETE","COMPLETE_WITH_WARNINGS","PARTIAL","FAILED","CANCELLED","INTERRUPTED"].includes(result.replay.status) : false;
      if (!finished) await call("CANCEL_REPLAY",{replayId:result.startedReplayId}).catch(() => undefined);
    }
    if (result.savedStateId) await call("DELETE_STATE",{stateId:result.savedStateId}).catch(() => undefined);
  }
  result.finalUrl = page.url();
  result.replay = result.replay ? {status:result.replay.status,error:result.replay.error || null,results:result.replay.results || []} : null;
  return result;
}

export function criterionEvidence(criterion) {
  return {criterionId:criterion.criterionId,role:criterion.role,semanticType:criterion.semanticType,desiredValue:criterion.desiredValue};
}

export function acceptanceExitCode(cases) {
  if (!cases.length || cases.some((item) => item.status === "FAIL")) return 1;
  return cases.every((item) => item.status === "PASS") ? 0 : 2;
}
