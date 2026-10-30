(() => {
  "use strict";

  const MESSAGE = {
    CAPTURE_PAGE: "CAPTURE_PAGE",
    INSPECT_PAGE_CONTEXT: "INSPECT_PAGE_CONTEXT",
    GET_REPLAY_EXECUTOR: "GET_REPLAY_EXECUTOR",
    EXECUTE_REPLAY: "EXECUTE_REPLAY",
    CANCEL_REPLAY_EXECUTOR: "CANCEL_REPLAY_EXECUTOR",
    CONTENT_READY: "CONTENT_READY",
    REPLAY_PROGRESS: "REPLAY_PROGRESS",
    REPLAY_COMPLETE: "REPLAY_COMPLETE"
  };
  const SUCCESS = new Set(["APPLIED", "ALREADY_APPLIED", "VERIFIED", "ROUTE_ONLY"]);
  const cancelledReplays = new Set();
  let execution = null;

  if (globalThis.__FILTER_VAULT_EXECUTOR__) {
    notifyReady();
    return;
  }
  globalThis.__FILTER_VAULT_EXECUTOR__ = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === MESSAGE.INSPECT_PAGE_CONTEXT) {
      sendResponse({ ok: true, context: inspectContext() });
      return false;
    }
    if (message.type === MESSAGE.GET_REPLAY_EXECUTOR) {
      const snapshot = execution?.replayId === message.replayId
        ? { replayId: execution.replayId, status: execution.status, activeCriterion: execution.activeCriterion, results: execution.results, result: execution.result }
        : null;
      sendResponse({ ok: true, snapshot });
      return false;
    }
    if (message.type === MESSAGE.CAPTURE_PAGE) {
      Promise.resolve(capturePage(message.hints)).then((snapshot) => sendResponse({ ok: true, snapshot }))
        .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
      return true;
    }
    if (message.type === MESSAGE.CANCEL_REPLAY_EXECUTOR) {
      if (typeof message.replayId === "string") cancelledReplays.add(message.replayId);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === MESSAGE.EXECUTE_REPLAY) {
      executeReplay(message).then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
      return true;
    }
    return false;
  });

  notifyReady();

  function notifyReady() {
    chrome.runtime.sendMessage({ type: MESSAGE.CONTENT_READY, href: location.href }).catch(() => undefined);
  }

  async function capturePage(hints = []) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedUrl = location.href;
      const startedSignature = activeStateSignature();
      const effectiveHints = discoverMenuHints(hints);
      const snapshot = captureSnapshot(effectiveHints);
      await inspectActiveMenus(snapshot, effectiveHints);
      reportUnmappedRemovalChips(snapshot);
      await delay(180 + (attempt * 120));
      if (startedUrl === location.href && startedSignature === activeStateSignature()) return snapshot;
    }
    throw new Error("CAPTURE_UNSTABLE");
  }

  function captureSnapshot(hints) {
    const pageType = detectPageType();
    if (["CHECKOUT", "LOGIN", "ACCOUNT", "PRODUCT_DETAIL", "OTHER"].includes(pageType)) {
      throw new Error(`UNSUPPORTED_PAGE_TYPE:${pageType}`);
    }

    const candidates = isDecathlonAdapter()
      ? { supported: [], unsupported: [], unresolved: [], defaultsIgnored: [] }
      : collectSupportedControls(hints);
    let domCriteria = groupCandidates(candidates.supported);
    if (isIdealoAdapter()) domCriteria = enrichIdealoCriteria(domCriteria);
    const adapterId = isIdealoAdapter() ? "idealo-de" : isDecathlonAdapter() ? "decathlon-de" : "generic";
    return {
      url: location.href,
      title: document.title,
      locale: document.documentElement.lang || navigator.language || "und",
      pageType,
      adapterId,
      adapterVersion: isDecathlonAdapter() ? 2 : 1,
      contextLabel: inferContextLabel(),
      domCriteria,
      unsupported: candidates.unsupported.slice(0, 30),
      unresolved: candidates.unresolved.slice(0, 30),
      defaultsIgnored: candidates.defaultsIgnored.slice(0, 30)
    };
  }

  function reportUnmappedRemovalChips(snapshot) {
    const represented = snapshot.domCriteria.flatMap((criterion) => criterion.observedRepresentation || []).map(plainText);
    for (const button of queryAllDeep('button[aria-label]')) {
      if (!isElementVisible(button) || outsideFilterSurface(button) || isSensitiveControl(button)) continue;
      const label = /^(?:filter entfernen|remove filter)\s*:\s*(.+)$/i.exec(button.getAttribute("aria-label"))?.[1];
      if (!label || represented.includes(plainText(label))) continue;
      snapshot.unresolved.push({label,reason:"An applied filter chip was detected, but its setting could not be mapped safely. Removal buttons are not replay targets."});
    }
  }

  function detectPageType() {
    const path = location.pathname.toLowerCase();
    if (/\/(checkout|payment|order|basket|cart)(\/|$)/.test(path)) return "CHECKOUT";
    if (/\/(login|sign-in|signin|auth)(\/|$)/.test(path) || document.querySelector('input[type="password"]')) return "LOGIN";
    if (/\/(account|profile|settings)(\/|$)/.test(path)) return "ACCOUNT";

    const filterControls = queryAllDeep('input[type="checkbox"], input[type="radio"], select, button[role="combobox"][aria-controls], button[aria-pressed][aria-label^="Filtern nach:"], button[aria-pressed][aria-label^="Filter by:"], [role="checkbox"], [role="radio"], [aria-checked], [aria-selected]');
    const menuFilters = queryAllDeep('button[aria-haspopup][aria-controls][aria-expanded]').filter(isDropdownTrigger)
      .filter((trigger) => !outsideFilterSurface(trigger)).filter((trigger) => /^(?:filtern nach|filter by|filters?\b)/i.test(trigger.parentElement?.getAttribute("aria-label") || ""));
    filterControls.push(...menuFilters);
    const productLinks = [...document.querySelectorAll('a[href]')].filter((link) => /product|produkt|item|sku|dp\//i.test(link.getAttribute("href") || ""));
    const routeLooksSearch = /search|category|collections?|products?|shop|catalog/i.test(path) || [...new URL(location.href).searchParams.keys()].some((key) => /^(q|query|search|keyword|k|ntt)$/i.test(key));
    if (filterControls.length >= 2 || productLinks.length >= 4 || routeLooksSearch) return routeLooksSearch ? "SEARCH" : "LISTING";
    if (/\/[^/]+\/[^/]+/.test(path) && document.querySelector('button, [role="button"]')) return "PRODUCT_DETAIL";
    return "OTHER";
  }

  function collectSupportedControls(hints) {
    const supported = [];
    const unsupported = [];
    const unresolved = [];
    const defaultsIgnored = [];
    const seen = new Set();
    const defaultRanges = new WeakMap();
    const nativeStates = queryAllDeep('input[type="checkbox"],input[type="radio"]');
    const controlProofs = new Map();
    const proves = (hint) => {
      if (!controlProofs.has(hint)) controlProofs.set(hint,controlEvidenceSatisfied(hint.controlEvidence,nativeStates));
      return controlProofs.get(hint);
    };
    const selectors = [
      'input[type="checkbox"]', 'input[type="radio"]', "select",
      'input[type="number"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
      '[aria-selected="true"]', '[aria-pressed="true"]', 'a[aria-current="true"], a[aria-current="page"]'
    ].join(",");

    for (const element of queryAllDeep(selectors)) {
      if (seen.has(element) || !isElementVisible(element) || isSensitiveControl(element)) continue;
      seen.add(element);
      if (outsideFilterSurface(element)) continue;
      if (decorativeOptionInput(element)) continue;
      const menuOwner = dropdownOwner(element);
      if (menuOwner ? dropdownPopup(menuOwner)?.matches('[role="menu"]') : false) {
        if (dropdownHint(menuOwner,hints)?.parameters?.length) continue;
      }
      if (element instanceof HTMLInputElement) {
        if (["checkbox","radio"].includes(element.type)) {
          const hint = (hints || []).find((item) => item.controlEvidence?.name === element.name ? item.parameters?.length : false);
          if (hint) {
            if (element.checked ? !hint.controlEvidence.values.includes(element.value) : false) unresolved.push({label:controlLabel(element) || element.name,reason:"This checked value is not represented by the saved route."});
            continue;
          }
          if (removalChipButton(element)) {
            if (element.checked) unresolved.push({label:controlLabel(element) || element.name,reason:"A removal chip requires a verified route representation and is not a replay action target."});
            continue;
          }
        }
      }
      if (representedIntervalControl(element,hints,proves)) continue;
      if (representedFilterSummary(element,hints)) continue;
      if (element.matches('button[aria-pressed="true"]')) {
        if (/^(filtern nach:|filter by:)/i.test(element.getAttribute("aria-label") || "")) {
          if (/\(\d+\)$/.test(plainText(labelText(element)))) {
            unresolved.push({label:controlLabel(element),reason:"This filter group summary could not be matched to all selected values."});
            continue;
          }
        }
      }
      if (currentPageChip(element)) {
        defaultsIgnored.push({label:controlLabel(element),reason:"The current page is already preserved as listing context."});
        continue;
      }
      const defaultReason = defaultControlReason(element, defaultRanges);
      if (defaultReason) {
        defaultsIgnored.push({label: controlLabel(element) || "Default filter", reason: defaultReason});
        continue;
      }
      if (element instanceof HTMLSelectElement && isDefaultSelect(element)) {
        defaultsIgnored.push({ label: controlLabel(element) || "Default selection", reason: "Default selection is not active filter state." });
        continue;
      }
      const candidate = captureControl(element, hints);
      if (candidate) supported.push(candidate);
      else if (appearsActive(element)) unresolved.push({ label: controlLabel(element) || "Unresolved active control", reason: "The active control could not be mapped unambiguously." });
    }

    for (const element of queryAllDeep('[role="slider"], input[type="range"], [aria-autocomplete], [role="combobox"]')) {      if (!isElementVisible(element) || isSensitiveControl(element)) continue;
      if (element instanceof HTMLSelectElement) continue;
      if (outsideFilterSurface(element)) continue;
      const representedInterval = representedIntervalControl(element,hints,proves);
      if (representedInterval) {
        if (representedInterval === "DEFAULT") defaultsIgnored.push({label:controlLabel(element) || "Default range",reason:"The complete available range is selected; no range filter is active."});
        continue;
      }
      if (isDropdownTrigger(element)) {
        const hint = dropdownHint(element, hints);
        if (hint?.parameters?.length) continue;
        if (inactiveDropdown(element)) {
          defaultsIgnored.push({label:controlLabel(element),reason:"This dropdown has no active selection."});
        } else {
          unsupported.push({label:controlLabel(element),reason:"The active dropdown selection has no verified mapping."});
        }
        continue;
      }
      const presentationDefault = defaultPresentationReason(element);
      if (presentationDefault) {
        defaultsIgnored.push({label:controlLabel(element) || "Default sorting",reason:presentationDefault});
        continue;
      }
      const defaultReason = defaultControlReason(element, defaultRanges);
      if (defaultReason) {
        defaultsIgnored.push({label: controlLabel(element) || "Default range", reason: defaultReason});
        continue;
      }
      if (!isElementVisible(element) || isSensitiveControl(element)) continue;
      if (isIdealoAdapter() && element.matches('[role="slider"], input[type="range"]') && !hasIdealoPriceFilter()) continue;
      if (nativeRangeEndpoint(element)) {
        const candidate = captureControl(element, hints);
        if (candidate) {
          supported.push(candidate);
          continue;
        }
      }
      unsupported.push({
        label: controlLabel(element) || "Advanced filter control",
        reason: element.matches('[role="slider"], input[type="range"]') ? "Dual/range sliders require a verified adapter." : "Autocomplete controls require a verified adapter."
      });
    }
    for (const hint of hints || []) {
      if (!hint.controlEvidence || !hint.parameters?.length) continue;
      if (!proves(hint)) unresolved.push({label:hint.labels[0],reason:"The route values could not be confirmed by checked controls and their visible removal chips."});
    }
    return {
      supported,
      unsupported: dedupeUnsupported(unsupported),
      unresolved: dedupeUnsupported(unresolved),
      defaultsIgnored: dedupeUnsupported(defaultsIgnored)
    };
  }

  function outsideFilterSurface(element) {
    if (element.closest('[role="search"], footer, [role="contentinfo"]')) return true;
    const navigation = element.closest('nav[aria-label],[role="navigation"][aria-label],[aria-label="Seitennavigation"],[aria-label="Pagination" i]');
    if (navigation ? /pagination|seitennavigation|seiten.?navigation|seitenwahl/i.test(navigation.getAttribute("aria-label")) : false) return true;
    const header = element.closest('header, [role="banner"]');
    if (header) return !header.closest('fieldset, details, [role="group"]');
    return false;
  }

  function captureSemanticType(label, hints, group = null) {
    if (Array.isArray(hints)) {
      if (group ? isDropdownTrigger(group) : false) {
        const dropdown = dropdownHint(group,hints);
        if (dropdown) return dropdown.semanticType;
      }
      const field = group ? dropdownField(group)?.name : null;
      const fieldHint = field ? hints.find((item) => item.controlNames?.includes(field)) : null;
      if (fieldHint) return fieldHint.semanticType;
      const hint = hints.find((item) => item.labels?.some((value) => normalizedText(value) === normalizedText(label)));
      if (hint) return hint.semanticType;
    }
    return normalizeSemanticType(label);
  }

  function decorativeOptionInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    if (!element.matches('[inert], [readonly]')) return false;
    return Boolean(element.closest('[role="option"][aria-selected]'));
  }

  function removalChipButton(input) {
    const host = input.parentElement;
    if (!host?.tagName.includes("-")) return null;
    if (host.getAttribute("icon-right") !== "close") return null;
    return unique([...host.querySelectorAll(':scope > button[slot="content"]')].filter(isElementVisible));
  }

  function controlEvidenceSatisfied(evidence, inputs) {
    if (!evidence || !evidence.values?.length) return false;
    if (evidence.values.length !== evidence.labels?.length) return false;
    return evidence.values.every((value,index) => {
      const matches = inputs.filter((input) => input.name === evidence.name ? input.value === value : false);
      const originals = matches.filter((input) => !removalChipButton(input));
      if (!originals.length || originals.some((input) => !input.checked)) return false;
      const mirrors = matches.filter((input) => {
        const button = removalChipButton(input);
        return button ? input.checked && plainText(labelText(button)) === plainText(evidence.labels[index]) : false;
      });
      return mirrors.length === 1;
    });
  }

  function namedFieldset(element) {
    let current = element;
    while (current) {
      if (current.matches?.('fieldset[name]')) return current;
      current = current.parentElement || current.getRootNode?.().host;
    }
    return null;
  }

  function representedIntervalControl(element, hints, proves) {
    if (!element.matches('input[type="number"],input[type="range"]')) return null;
    const fieldset = namedFieldset(element);
    if (!fieldset) return null;
    const hint = (hints || []).find((item) => item.controlEvidence?.name === fieldset.getAttribute("name") ? item.controlEvidence.rangeEndpoint === "MAX" : false);
    if (!hint) return null;
    const handles = queryAllDeep('input[type="range"]',fieldset);
    if (handles.length !== 2 || handles[0].parentElement !== handles[1].parentElement) return null;
    const states = handles.map((handle) => [handle.getAttribute("min"),handle.getAttribute("max"),handle.value]);
    if (states.flat().some((value) => value === null || value === "" || !Number.isFinite(Number(value)))) return null;
    const [lower,upper] = states.map((state) => state.map(Number));
    if (lower[0] !== upper[0] || lower[1] !== upper[1] || lower[0] > lower[1]) return null;
    if (lower[2] !== lower[0]) return null;
    const numbers = queryAllDeep('input[type="number"]',fieldset).filter((input) => input.value !== "");
    if (!hint.parameters?.length) {
      if ([...new URL(location.href).searchParams.keys()].some((key) => key === hint.controlEvidence.name || key.startsWith(`${hint.controlEvidence.name}~`))) return null;
      return upper[2] === upper[1] ? (numbers.length ? null : "DEFAULT") : null;
    }
    if (!proves(hint) || upper[2] !== Number(hint.controlEvidence.rangeValue)) return null;
    for (const input of numbers) {
      const label = controlLabel(input) || input.getRootNode().host?.textContent || "";
      if (!/^(bis|to|max(?:imum)?|upper)\b/i.test(label.trim())) return null;
      if (Number(input.value) !== Number(hint.controlEvidence.rangeValue)) return null;
    }
    return "REPRESENTED";
  }

  function currentPageChip(element) {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" ? element.checked && element.disabled : false) {
        const heading = element.parentElement?.querySelector('[slot="headline"]');
        if (heading ? plainText(heading.textContent) === plainText(document.querySelector("main h1,h1")?.textContent) : false) return true;
      }
    }
    if (!element.matches('button[aria-pressed="true"]')) return false;
    if (element.closest('fieldset,[role="group"],[role="listbox"]')) return false;
    if (normalizedText(controlLabel(element)) !== normalizedText(document.querySelector("main h1,h1")?.textContent)) return false;
    const links = [...(element.parentElement?.querySelectorAll('a[href]') || [])];
    return links.some((link) => {
      const url = new URL(link.href,location.href);
      return url.origin === location.origin ? url.pathname !== location.pathname : false;
    });
  }

  function isDropdownTrigger(element) {
    if (!element.matches?.('button[aria-controls][aria-expanded]')) return false;
    if (![null,"none"].includes(element.getAttribute("aria-autocomplete"))) return false;
    if (element.matches('[role="combobox"][aria-label]')) return true;
    return ["true","menu"].includes(element.getAttribute("aria-haspopup")) ? Boolean(dropdownLabel(element)) : false;
  }

  function dropdownLabel(trigger) {
    return trigger.getAttribute("aria-label") || labelText(trigger);
  }

  function dropdownField(trigger) {
    return [...(trigger.parentElement?.querySelectorAll('input[name][aria-hidden="true"]') || [])].find((input) => input.parentElement === trigger.parentElement) || null;
  }

  function dropdownHint(trigger, hints) {
    const field = dropdownField(trigger)?.name;
    return (hints || []).find((hint) => hint.controlNames?.includes(field)
      || hint.labels?.some((label) => normalizedText(label) === normalizedText(dropdownLabel(trigger)))
      || (trigger.matches('[aria-haspopup]') ? hint.controlNames?.some((name) => [trigger.id,trigger.getAttribute("aria-controls")].some((id) => String(id || "").toLowerCase().endsWith(name.toLowerCase()))) : false));
  }

  function dropdownPopup(trigger) {
    const root = trigger.getRootNode();
    const controlled = unique([...root.querySelectorAll('[id]')].filter((element) => element.id === trigger.getAttribute("aria-controls")));
    if (!controlled) return null;
    if (controlled.matches('[role="listbox"],[role="menu"]')) return controlled;
    return unique(queryAllDeep('[role="listbox"]',controlled));
  }

  function discoverMenuHints(hints) {
    const result = [...(hints || [])];
    const triggers = queryAllDeep('button[aria-haspopup][aria-controls][aria-expanded]').filter(isDropdownTrigger)
      .filter(isElementVisible).filter((trigger) => !outsideFilterSurface(trigger)).filter((trigger) => !isSensitiveControl(trigger))
      .filter((trigger) => /^(?:filtern nach|filter by|filters?\b)/i.test(trigger.parentElement?.getAttribute("aria-label") || ""));
    for (const key of new Set(new URL(location.href).searchParams.keys())) {
      if (!/^[a-z0-9_.\u00c0-\u024f-]{1,100}$/i.test(key)) continue;
      if (/token|session|password|secret|email|phone|address|payment|account|profile|user.?id|auth|tracking|cookie|csrf|credit.?card|customer|^(?:utm_|gclid$|fbclid$)/i.test(key)) continue;
      if (result.some((hint) => hint.parameters?.includes(key))) continue;
      const hint = {labels:[],semanticType:normalizeSemanticType(key),controlNames:[key],parameters:[key]};
      const matching = triggers.filter((trigger) => dropdownHint(trigger,[hint]));
      if (matching.length !== 1) continue;
      hint.labels = [dropdownLabel(matching[0])];
      result.push(hint);
    }
    return result;
  }

  function dropdownForPopup(popup) {
    return unique(queryAllDeep('button[aria-controls][aria-expanded]').filter(isDropdownTrigger).filter((trigger) => dropdownPopup(trigger) === popup));
  }

  function dropdownOwner(element) {
    let popup = element.closest('[role="listbox"],[role="menu"]');
    while (popup) {
      const trigger = dropdownForPopup(popup);
      if (trigger) return trigger;
      popup = popup.parentElement?.closest('[role="listbox"],[role="menu"]');
    }
    return null;
  }

  function menuOptions(popup) {
    return queryAllDeep('input[type="checkbox"],input[type="radio"]',popup).filter(isElementVisible).filter((option) => !isSensitiveControl(option));
  }

  function menuOptionIdentity(option, hint) {
    const matches = [];
    for (const parameter of hint.parameters || []) {
      for (const value of new URL(location.href).searchParams.getAll(parameter)) {
        for (const field of hint.controlNames || []) {
          if (option.name === field ? option.value === value : false) matches.push({value,locator:{type:"NAME_VALUE",value:`${field}\u0000${value}`}});
          else if ([`${field}_${value}`,`${field}-${value}`].includes(option.id)) matches.push({value,locator:{type:"ID",value:option.id}});
        }
      }
    }
    return unique([...new Map(matches.map((match) => [JSON.stringify(match),match])).values()]);
  }

  function captureMenuOptions(popup, hint, hints, snapshot) {
    const selected = menuOptions(popup).filter((option) => option.checked);
    const expected = [...new Set((hint.parameters || []).flatMap((key) => new URL(location.href).searchParams.getAll(key)))];
    const identities = selected.map((option) => menuOptionIdentity(option,hint));
    if (identities.some((identity) => !identity) || expected.some((value) => identities.filter((identity) => identity?.value === value).length !== 1)) {
      snapshot.unresolved.push({label:dropdownLabel(dropdownForPopup(popup)),reason:"The URL filter values do not match unique checked menu options."});
      return [];
    }
    const captured = selected.map((option,index) => {
      const candidate = captureControl(option,hints);
      if (!candidate) return null;
      candidate.values = [identities[index].value];
      candidate.binding.bindingId = stableId("dom-menu",hint.semanticType,identities[index].value);
      candidate.binding.mapping.option.locatorChain = [identities[index].locator];
      return candidate;
    }).filter(Boolean);
    if (captured.length !== selected.length) snapshot.unresolved.push({label:dropdownLabel(dropdownForPopup(popup)),reason:"The checked menu options could not be mapped unambiguously."});
    return captured;
  }

  function inactiveDropdown(trigger) {
    const field = dropdownField(trigger);
    if (!field || field.value) return false;
    if (normalizedText(trigger.textContent) !== normalizedText(trigger.getAttribute("aria-label"))) return false;
    const selected = [...(dropdownPopup(trigger)?.querySelectorAll('[aria-selected="true"]') || [])];
    if (selected.some((option) => !defaultDropdownOptionReason(option))) return false;
    const name = field.name.toLowerCase();
    return ![...new URL(location.href).searchParams.keys()].some((key) => key.toLowerCase() === name || key.toLowerCase().includes(`[${name}]`));
  }

  async function openDropdown(trigger, message) {
    if (!isDropdownTrigger(trigger) || !isElementVisible(trigger) || isDisabled(trigger) || trigger.closest('[inert]')) return false;
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    const deadline = Date.now()+1500;
    while (Date.now()<deadline) {
      if (message) assertNotCancelled(message);
      const popup = dropdownPopup(trigger);
      if (popup ? isElementVisible(popup) : false) return true;
      await delay(50);
    }
    return false;
  }

  async function revealDropdown(label, message) {
    const locate = () => resolveLocator({type:"COMBOBOX_LABEL",value:label},document,true);
    const current = locate();
    if (current ? isElementVisible(current) : false) return current;
    const reveal = unique(queryAllDeep("button").filter(isElementVisible).filter((button) => /^(mehr filter|more filters|alle filter|all filters)$/i.test(plainText(button.textContent))));
    if (!reveal || isDisabled(reveal) || reveal.closest('[inert]')) return null;
    if (message) assertNotCancelled(message);
    reveal.click();
    const deadline = Date.now()+1500;
    while (Date.now()<deadline) {
      if (message) assertNotCancelled(message);
      const trigger = locate();
      if (trigger ? isElementVisible(trigger) : false) return trigger;
      await delay(50);
    }
    return null;
  }

  async function inspectActiveMenus(snapshot, hints) {
    const selector = 'button[role="combobox"],button[aria-haspopup][aria-controls][aria-expanded]';
    let triggers = queryAllDeep(selector).filter(isDropdownTrigger).filter(isElementVisible).filter((trigger) => !outsideFilterSurface(trigger)).filter((trigger) => !isSensitiveControl(trigger));
    const original = triggers.filter((trigger) => trigger.getAttribute("aria-expanded") === "true");
    const reveal = unique(queryAllDeep("button").filter(isElementVisible).filter((button) => /^(mehr filter|more filters|alle filter|all filters)$/i.test(plainText(button.textContent))));
    const inspected = [];
    try {
      for (const hint of hints || []) {
        if (hint.controlEvidence) continue;
        if (hint.appliedFilterTexts) continue;
        if (!hint.parameters?.length) continue;
        if (triggers.some((trigger) => dropdownHint(trigger,[hint]))) continue;
        for (const label of hint.labels || []) {
          if (await revealDropdown(label)) break;
        }
      }
      triggers = queryAllDeep(selector).filter(isDropdownTrigger).filter(isElementVisible).filter((trigger) => !outsideFilterSurface(trigger)).filter((trigger) => !isSensitiveControl(trigger));
      for (const trigger of triggers) {
        const hint = dropdownHint(trigger,hints);
        if (hint?.controlEvidence) continue;
        if (hint?.appliedFilterTexts) continue;
        if (!hint?.parameters?.length) continue;
        const same = triggers.filter((other) => normalizedText(dropdownLabel(other)) === normalizedText(dropdownLabel(trigger)));
        if (same.length !== 1) {
          snapshot.unresolved.push({label:controlLabel(trigger),reason:"More than one dropdown has this filter label."});
          continue;
        }
        inspected.push(trigger);
        if (!await openDropdown(trigger)) {
          snapshot.unsupported.push({label:controlLabel(trigger),reason:"The active dropdown could not be inspected safely."});
          continue;
        }
        const popup = dropdownPopup(trigger);
        if (dropdownForPopup(popup) !== trigger) {
          snapshot.unresolved.push({label:dropdownLabel(trigger),reason:"The dropdown popup has more than one controlling button."});
          continue;
        }
        const candidates = popup.matches('[role="menu"]') ? captureMenuOptions(popup,hint,hints,snapshot)
          : queryAllDeep('[role="option"][aria-selected="true"]',popup).filter(isElementVisible).map((option) => captureControl(option,hints)).filter(Boolean);
        for (const criterion of groupCandidates(candidates)) {
          const existing = snapshot.domCriteria.find((item) => item.semanticType === criterion.semanticType);
          if (!existing) snapshot.domCriteria.push(criterion);
          else {
            existing.desiredValue = [...new Set([...existing.desiredValue,...criterion.desiredValue])];
            existing.observedRepresentation = [...new Set([...existing.observedRepresentation,...criterion.observedRepresentation])];
            existing.bindings = [...new Map([...existing.bindings,...criterion.bindings].map((binding) => [binding.bindingId,binding])).values()];
          }
        }
      }
    } finally {
      for (const trigger of inspected) if (trigger.getAttribute("aria-expanded") === "true") trigger.click();
      if (reveal?.isConnected) {
        if (/^(weniger filter|less filters|fewer filters)$/i.test(plainText(reveal.textContent))) reveal.click();
      }
      for (const trigger of original) if (trigger.isConnected) await openDropdown(trigger);
    }
  }

  function defaultPresentationReason(element) {
    if (!element.matches('[role="combobox"][aria-autocomplete="none"][readonly]')) return null;
    if (!/^(sort[-_]?by|sort|sorting|sortierung)$/i.test(element.getAttribute("name") || element.id)) return null;
    if (!/^(relevanz|relevance|recommended|beste ergebnisse|empfohlen)$/i.test(element.value || "")) return null;
    if ([...new URL(location.href).searchParams.keys()].some((key) => /^(sort|sort[-_]?by|sorting|sortierung|order|ns)$/i.test(key))) return null;
    return "The default relevance order does not restrict results.";
  }

  function defaultControlReason(element, cache) {
    const dropdownDefault = defaultDropdownOptionReason(element);
    if (dropdownDefault) return dropdownDefault;
    if (element instanceof HTMLInputElement) {
      if (element.type === "radio") {
        if (element.checked) {
          const catchAllValue = ["all", "any", "*"].includes(element.value.toLowerCase());
          const catchAllLabel = /^(all ratings|all reviews|all results|alle bewertungen|alle ergebnisse|any rating|beliebig|keine einschränkung)$/i.test(controlLabel(element));
          if (catchAllValue ? catchAllLabel : false) return "The catch-all selection does not restrict results.";
        }
      }
    }
    if (!element.matches('input[type="number"], input[type="range"], [role="slider"]')) return null;
    const group = findFilterGroup(element)?.element || (element.matches('[role="slider"]') ? element.parentElement : null);
    if (!group) return null;
    if (!cache.has(group)) cache.set(group, unrestrictedRangeControls(group));
    return cache.get(group).has(element) ? "The complete available range is selected; no range filter is active." : null;
  }

  function defaultDropdownOptionReason(element) {
    if (!element.matches('[role="option"][aria-selected="true"]')) return null;
    const popup = element.closest('[role="listbox"]');
    const trigger = popup ? dropdownForPopup(popup) : null;
    const field = trigger ? dropdownField(trigger)?.name : null;
    if (!field) return null;
    const keys = [...new URL(location.href).searchParams.keys()];
    if (/^(sort[-_]?by|sort|sorting|sortierung)$/i.test(field)) {
      if (keys.some((key) => /^(sort|sort[-_]?by|order|ns)$/i.test(key))) return null;
      if (/^(relevanz|relevance|recommended|empfohlen|beste ergebnisse)$/i.test(plainText(controlLabel(element)))) return "Default relevance is presentation state.";
    }
    if (/^(primaryCategory|category)$/i.test(field)) {
      if (keys.some((key) => key.toLowerCase() === "category")) return null;
      if (plainText(controlLabel(element)) === plainText(document.querySelector("main h1,h1")?.textContent)) return "The current listing category is already preserved by its route.";
    }
    return null;
  }

  function unrestrictedRangeControls(group) {
    const controls = queryAllDeep('input[type="number"], input[type="range"], [role="slider"]', group)
      .filter((element) => (findFilterGroup(element)?.element || element.parentElement) === group);
    const numbers = controls.filter((element) => element.matches('input[type="number"]'));
    const sliders = controls.filter((element) => !numbers.includes(element));
    const pair = (items) => {
      if (items.length !== 2) return null;
      const states = items.map((element) => {
        const min = element.getAttribute("min") ?? element.getAttribute("aria-valuemin");
        const max = element.getAttribute("max") ?? element.getAttribute("aria-valuemax");
        const value = element.value ?? element.getAttribute("aria-valuenow");
        if ([min, max, value].some((item) => item === null || item === "")) return null;
        return {min:Number(min), max:Number(max), value:Number(value)};
      });
      if (states.some((state) => !state || Object.values(state).some((value) => !Number.isFinite(value)))) return null;
      const [a, b] = states;
      if (a.min !== b.min || a.max !== b.max || a.min > a.max) return null;
      if (!(a.value === a.min ? b.value === a.max : b.value === a.min ? a.value === a.max : false)) return null;
      return a;
    };
    const sliderPair = pair(sliders);
    const numberPair = pair(numbers);
    if (sliders.length ? !sliderPair : false) return new Set();
    if (numbers.length ? !numberPair : false) return new Set();
    if (!sliderPair ? !numberPair : false) return new Set();
    if (sliders.length ? !rangeHandleIdentity(sliders) : false) return new Set();
    const labels = (numbers.length ? numbers : sliders).map(controlLabel);
    if (numbers.length) {
      if (!labels.some((label) => /^(?:von|from|min(?:imum)?|lower)\b/i.test(label))) return new Set();
      if (!labels.some((label) => /^(?:bis|to|max(?:imum)?|upper)\b/i.test(label))) return new Set();
    }
    if (sliderPair ? numberPair !== null : false) {
      if (sliderPair.min !== numberPair.min || sliderPair.max !== numberPair.max) return new Set();
    }
    return new Set(controls);
  }

  function captureControl(element, hints = []) {
    const group = findFilterGroup(element);
    const groupLabel = group ? group.label : "";
    if (!group || !groupLabel) return null;
    const endpoint = nativeRangeEndpoint(element);
    const optionLabel = endpoint ? `${endpoint === "LOWER" ? "Lower" : "Upper"} bound` : controlLabel(element);
    if (!optionLabel) return null;

    let controlType;
    let desired;
    let interactionAction;
    let verificationType;

    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      if (!element.checked) return null;
      controlType = element.type === "radio" ? "SINGLE_SELECT" : "BOOLEAN";
      desired = optionLabel;
      interactionAction = "ACTIVATE_IF_NEEDED";
      verificationType = "OPTION_SELECTED";
    } else if (element instanceof HTMLSelectElement) {
      if (isDefaultSelect(element)) return null;
      const selected = [...element.selectedOptions].filter((option) => option.value && !option.disabled);
      if (!selected.length) return null;
      controlType = "NATIVE_SELECT";
      desired = selected.map((option) => option.value);
      interactionAction = "SELECT_NATIVE_OPTION";
      verificationType = "SELECT_VALUE";
    } else if (element instanceof HTMLInputElement && ["number", "range"].includes(element.type)) {
      if (isIdealoAdapter() && !hasIdealoPriceFilter()) return null;
      if (!element.value) return null;
      controlType = "NUMERIC_VALUE";
      desired = element.value;
      interactionAction = "SET_INPUT_VALUE";
      verificationType = "INPUT_VALUE";
    } else {
      const state = observedBooleanState(element);
      if (state !== true) return null;
      controlType = "BUTTON_OR_CHIP";
      desired = optionLabel;
      interactionAction = "ACTIVATE_IF_NEEDED";
      verificationType = "OPTION_SELECTED";
    }

    const containerLocators = buildContainerLocators(group.element, groupLabel);
    const optionLocators = buildOptionLocators(element, optionLabel);
    if (!containerLocators.length || !optionLocators.length) return null;
    if (resolveLocatorChain(containerLocators, document, true) !== group.element) return null;
    if (resolveLocatorChain(optionLocators, group.element, false) !== element) return null;
    const viewport = innerWidth < 720 ? "compact" : "desktop";
    const values = Array.isArray(desired) ? desired : [desired];
    return {
      groupLabel,
      semanticType: captureSemanticType(groupLabel, hints, group.element),
      observed: Array.isArray(desired) ? selectedLabels(element) : [optionLabel],
      values,
      binding: {
        bindingId: stableId("dom", groupLabel, optionLabel, values.join("|")),
        type: "DOM",
        origin: location.origin,
        applicability: { viewport },
        mapping: {
          mappingVersion: 5,
          controlType,
          desiredValue: values,
          filterContainer: { locatorChain: containerLocators },
          option: { semanticValue: values, locatorChain: optionLocators },
          interactionPlan: [
            ...(element.closest("details") || isDropdownTrigger(group.element) ? [{action: "ENSURE_EXPANDED", timeoutMs: 3000}] : []),
            { action: interactionAction, timeoutMs: 3000 },
            ...(element instanceof HTMLInputElement ? (["number", "range"].includes(element.type) ? commitPlan(group.element) : []) : []),
            { action: "VERIFY", timeoutMs: 3000 }
          ],
          verificationRule: { type: verificationType, desiredValue: values }
        }
      }
    };
  }

  function nativeRangePair(group) {
    const inputs = queryAllDeep('input[type="range"]', group).filter((input) => findFilterGroup(input)?.element === group);
    if (inputs.length !== 2) return null;
    if (!rangeHandleIdentity(inputs)) return null;
    const states = inputs.map((input) => [input.getAttribute("min"),input.getAttribute("max"),input.value]);
    if (states.flat().some((value) => value === null || value === "" || !Number.isFinite(Number(value)))) return null;
    const [lower,upper] = states.map((state) => state.map(Number));
    if (lower[0] !== upper[0] || lower[1] !== upper[1] || lower[0] >= lower[1]) return null;
    if (lower[2] > upper[2]) return null;
    return inputs;
  }

  function rangeHandleIdentity(handles) {
    if (handles.length !== 2) return false;
    if (handles[0].parentElement !== handles[1].parentElement) return false;
    const labels = handles.map(controlLabel);
    const numericLabel = (label) => /^-?\d+(?:[.,]\d+)?\s*(?:€|%|eur|euros?|usd|\$|gbp|£|kg|cm|mm)?$/i.test(label);
    if (labels.every(numericLabel)) return true;
    if (/^(?:von|from|min(?:imum)?|lower)\b/i.test(labels[0])) {
      if (/^(?:bis|to|max(?:imum)?|upper)\b/i.test(labels[1])) return true;
    }
    return handles[0].getAttribute("data-lower") === "true" ? handles[1].getAttribute("data-upper") === "true" : false;
  }

  function nativeRangeEndpoint(element) {
    if (!element.matches('input[type="range"]')) return null;
    const group = findFilterGroup(element)?.element;
    if (!group) return null;
    const pair = nativeRangePair(group);
    return pair ? (pair[0] === element ? "LOWER" : "UPPER") : null;
  }

  function commitPlan(group) {
    const buttons = [...group.querySelectorAll('button,input[type="submit"]')].filter((button) =>
      /^(apply|show (?:\d+ )?results|submit filters|anzeigen|übernehmen|anwenden)$/i.test(normalizedText(button.textContent || button.value)));
    return buttons.length === 1 ? [{action:"COMMIT",timeoutMs:5000}] : [];
  }

  function groupCandidates(candidates) {
    const groups = new Map();
    for (const candidate of candidates) {
      const key = candidate.semanticType;
      if (!groups.has(key)) {
        groups.set(key, {
          criterionId: stableId("dom-criterion", key),
          role: "FILTER",
          semanticType: key,
          desiredValue: [],
          observedRepresentation: [],
          dependencies: [],
          bindings: []
        });
      }
      const criterion = groups.get(key);
      criterion.desiredValue.push(...candidate.values.map(String));
      criterion.observedRepresentation.push(...candidate.observed.map(String));
      criterion.bindings.push(candidate.binding);
    }
    return [...groups.values()].map((criterion) => ({
      ...criterion,
      desiredValue: [...new Set(criterion.desiredValue)],
      observedRepresentation: [...new Set(criterion.observedRepresentation)]
    }));
  }

  function enrichIdealoCriteria(criteria) {
    const tags = idealoActiveTags();
    const consumed = new Set();
    for (const criterion of criteria) {
      const matches = tags.filter((tag) => (criterion.observedRepresentation || []).some((value) => normalizedText(value) === normalizedText(tag)));
      if (!matches.length) continue;
      matches.forEach((tag) => consumed.add(tag));
      criterion.bindings.unshift({
        bindingId: stableId("idealo-path", criterion.semanticType, ...matches),
        type: "URL_PATH",
        pathname: location.pathname,
        verificationTexts: matches,
        applicability: {}
      });
    }
    for (const tag of tags) {
      if (consumed.has(tag)) continue;
      const [rawName, ...rawValue] = tag.split(":");
      const hasNamedValue = rawValue.length > 0;
      const semanticType = normalizeSemanticType(hasNamedValue ? rawName : "IDEALO_FILTER");
      criteria.push({
        criterionId: stableId("idealo-route", semanticType, tag),
        role: "FILTER",
        semanticType,
        desiredValue: [hasNamedValue ? rawValue.join(":").trim() : tag],
        observedRepresentation: [tag],
        dependencies: [],
        bindings: [{
          bindingId: stableId("idealo-path", semanticType, tag),
          type: "URL_PATH",
          pathname: location.pathname,
          verificationTexts: [tag],
          applicability: {}
        }]
      });
    }
    return criteria;
  }

  function inspectContext() {
    const url = new URL(location.href);
    const pageType = detectPageType();
    const surface = pageType === "LISTING" ? "PRODUCT_LIST" : pageType === "SEARCH" ? "SEARCH_RESULTS" : "UNSUPPORTED";
    const routeClass = url.pathname.replace(/\b\d+\b/g, ":id").replace(/\/+$/, "") || "/";
    const locale = String(document.documentElement.lang || navigator.language || "und").replaceAll("_", "-").toLocaleLowerCase();
    const query = ["q", "query", "search", "keyword", "k", "Ntt"].map((key) => url.searchParams.get(key)).find(Boolean)
      || (/\/suche\/([^/]+)/i.exec(url.pathname)?.[1] ? decodeURIComponent(/\/suche\/([^/]+)/i.exec(url.pathname)[1]).replace(/[-_]+/g, " ") : null);
    return {
      origin: url.origin, surface, category: inferContextLabel(), searchQuery: query, routeClass, locale,
      viewport: innerWidth < 720 ? "compact" : "desktop",
      adapterVersion: isDecathlonAdapter() ? 2 : 1,
      compatibilityFingerprint: `${url.origin}|${surface}|${routeClass}|${locale}`
    };
  }

  function executeReplay(message) {
    if (execution?.replayId === message.replayId) return execution.promise;
    if (execution) {
      if (!execution.result) return Promise.reject(new Error("REPLAY_ALREADY_ACTIVE"));
    }
    execution = { replayId: message.replayId, status: "APPLYING", activeCriterion: null, results: [], result: null };
    execution.promise = runReplay(message).catch(async (error) => {
      const cancelled = safeError(error) === "REPLAY_CANCELLED";
      const results = [...execution.results];
      for (const criterion of message.criteria || []) {
        if (results.some((item) => item.criterionId === criterion.criterionId)) continue;
        results.push(criterionResult(criterion, cancelled ? "NOT_ATTEMPTED" : "VERIFY_FAILED", cancelled ? "Replay cancelled before completion." : safeError(error)));
      }
      const result = { replayId: message.replayId, status: cancelled ? "CANCELLED" : "FAILED", results };
      await finishReplay(result);
      return result;
    }).finally(() => cancelledReplays.delete(message.replayId));
    return execution.promise;
  }

  async function finishReplay(result) {
    execution.status = result.status;
    execution.results = result.results;
    execution.activeCriterion = null;
    execution.result = result;
    await chrome.runtime.sendMessage({ type: MESSAGE.REPLAY_COMPLETE, replayId: result.replayId, result }).catch(() => undefined);
  }

  async function runReplay(message) {
    if (location.origin !== message.expectedOrigin) throw new Error("ORIGIN_MISMATCH");
    if (!Array.isArray(message.criteria) || typeof message.replayId !== "string") throw new Error("INVALID_REPLAY_PLAN");
    const pageType = detectPageType();
    if (!["LISTING", "SEARCH"].includes(pageType)) throw new Error(`INCOMPATIBLE_CONTEXT:${pageType}`);
    const results = [];
    const failedCriteria = new Set();

    for (const criterion of message.criteria) {
      assertNotCancelled(message);
      if ((criterion.dependencies || []).some((dependency) => failedCriteria.has(dependency))) {
        const result = criterionResult(criterion, "DEPENDENCY_FAILED", "A prerequisite filter could not be restored.");
        results.push(result);
        failedCriteria.add(criterion.criterionId);
        await progress(message, criterion, results, "APPLYING");
        continue;
      }

      await progress(message, criterion, results, "APPLYING");
      const result = await applyCriterion(criterion, message);
      results.push(result);
      if (!SUCCESS.has(result.status) || result.status === "ROUTE_ONLY") failedCriteria.add(criterion.criterionId);
      await progress(message, null, results, "APPLYING");
    }

    await progress(message, null, results, "VERIFYING");
    for (let index = 0; index < results.length; index += 1) {
      assertNotCancelled(message);
      if (!SUCCESS.has(results[index].status)) continue;
      const criterion = message.criteria.find((item) => item.criterionId === results[index].criterionId);
      const verification = await verifyCriterion(criterion, message);
      if (!verification) {
        results[index] = criterionResult(criterion, "VERIFY_FAILED", "The filter changed after it was applied.");
      } else if (verification === "VERIFIED") {
        results[index] = criterionResult(criterion, "VERIFIED", "The storefront visibly confirms this criterion.", "VISIBLE_STATE");
      } else if (verification === "ROUTE_ONLY") {
        results[index] = criterionResult(criterion, "ROUTE_ONLY", "The route retained this criterion, but no independent visible confirmation was available.", "NORMALIZED_ROUTE");
      }
    }

    const status = overallStatus(results, message.criteria);
    const result = { replayId: message.replayId, status, results };
    await finishReplay(result);
    return result;
  }

  async function applyCriterion(criterion, message) {
    if (criterion.applicabilityUnavailable) return criterionResult(criterion, "UNSUPPORTED_CONTROL", "No binding applies to this layout or locale.");
    const routeBindings = (criterion.bindings || []).filter((binding) => ["URL_QUERY", "URL_PATH"].includes(binding.type));
    const domBindings = (criterion.bindings || []).filter((binding) => binding.type === "DOM");
    const routeSatisfied = routeBindings.length > 0 && routeBindings.every(routeBindingMatches);
    const domSatisfied = domBindings.length > 0 && domBindings.every(bindingCurrentlySatisfied);
    if (routeSatisfied && (!domBindings.length || domSatisfied)) {
      if (domSatisfied || hasVisibleCriterionEvidence(criterion)) {
        return criterionResult(criterion, "VERIFIED", "The saved route and visible storefront state represent this criterion.", domSatisfied ? "DOM_CONTROL" : "VISIBLE_STATE");
      }
      return criterionResult(criterion, "ROUTE_ONLY", "The saved route represents this criterion; visible confirmation is not available.", "NORMALIZED_ROUTE");
    }
    if (!domBindings.length) {
      return criterionResult(criterion, "VERIFY_FAILED", "The retailer did not retain the saved route state.");
    }

    let changed = false;
    for (const binding of domBindings) {
      assertNotCancelled(message);
      const applied = await applyDomBinding(binding, message);
      if (!applied.ok) return criterionResult(criterion, applied.status, applied.message);
      changed ||= applied.changed;
    }
    return criterionResult(criterion, changed ? "APPLIED" : "ALREADY_APPLIED", changed ? "Applied and verified." : "Already selected; no interaction was needed.");
  }

  async function applyDomBinding(binding, message) {
    const mapping = binding.mapping;
    if (!mapping || binding.origin !== location.origin) return failure("RESOLUTION_INCONCLUSIVE", "The mapping is not authorized for this page.");
    let group = resolveLocatorChain(mapping.filterContainer?.locatorChain || [], document, true);
    const menuLabel = mapping.filterContainer?.locatorChain?.find((locator) => locator.type === "COMBOBOX_LABEL")?.value;
    if (menuLabel) {
      if (!group || !isElementVisible(group)) group = await revealDropdown(menuLabel,message);
    }
    if (!group) return failure("RESOLUTION_INCONCLUSIVE", "FilterVault cannot determine whether this filter group is currently available.");
    if (isDropdownTrigger(group)) {
      if (!await openDropdown(group,message)) return failure("RESOLUTION_INCONCLUSIVE", "The saved dropdown could not be opened safely.");
    }
    let option = resolveLocatorChain(mapping.option?.locatorChain || [], group, false);
    if (!option) {
      if (appearsVirtualized(group)) return failure("RESOLUTION_INCONCLUSIVE", "The value may be outside the rendered portion of this filter.");
      return failure("VALUE_UNAVAILABLE", "The filter group exists, but the saved value is currently unavailable.");
    }
    if (isDisabled(option)) return failure("VALUE_UNAVAILABLE", "The saved value is visible but currently disabled.");
    if (!mappingMatchesControl(option, mapping)) return failure("UNSUPPORTED_CONTROL", "The mapped control no longer matches its verified type.");
    if (observeDesired(option, mapping)) return { ok: true, changed: false };

    const plan = (mapping.interactionPlan || []).filter((step) => !["VERIFY", "VERIFY_RESULT"].includes(step.action));
    if (!plan.length) return failure("UNSUPPORTED_INTERACTION", "No supported interaction plan is available.");
    let changed = false;
    for (const step of plan) {
      assertNotCancelled(message);
      group = resolveLocatorChain(mapping.filterContainer.locatorChain, document, true);
      if (!group) return failure("RESOLUTION_INCONCLUSIVE", "The filter group changed during replay.");
      option = resolveLocatorChain(mapping.option.locatorChain, group, false);
      if (!option) return failure("RESOLUTION_INCONCLUSIVE", "The option changed during replay.");
      if (!mappingMatchesControl(option, mapping)) return failure("UNSUPPORTED_CONTROL", "The control type changed during replay.");
      const outcome = await performAction({ option, group, mapping, step, message });
      if (!outcome) return failure("UNSUPPORTED_INTERACTION", `The ${step.action.toLowerCase().replaceAll("_", " ")} step could not be completed safely.`);
      changed ||= !["SCROLL_INTO_VIEW", "WAIT_ROUTE_STABLE", "WAIT_FOR_CONDITION"].includes(step.action);
    }
    const timeout = Math.min(Math.max(...plan.map((step) => step.timeoutMs || 3000)), 8000);
    const verified = await waitFor(() => bindingCurrentlySatisfied(binding), timeout, message);
    return verified ? { ok: true, changed: true } : failure("VERIFY_FAILED", "The interaction occurred, but the desired state could not be verified.");
  }

  async function verifyCriterion(criterion, message) {
    const routeBindings = (criterion.bindings || []).filter((binding) => ["URL_QUERY", "URL_PATH"].includes(binding.type));
    const domBindings = (criterion.bindings || []).filter((binding) => binding.type === "DOM");
    if (domBindings.length) {
      for (const binding of domBindings) {
        let group = resolveLocatorChain(binding.mapping?.filterContainer?.locatorChain || [], document, true);
        const menuLabel = binding.mapping?.filterContainer?.locatorChain?.find((locator) => locator.type === "COMBOBOX_LABEL")?.value;
        if (menuLabel) {
          if (!group || !isElementVisible(group)) group = await revealDropdown(menuLabel,message);
        }
        if (group ? isDropdownTrigger(group) : false) {
          if (!await openDropdown(group,message)) return false;
        }
        if (!bindingCurrentlySatisfied(binding)) return false;
      }
      return "VERIFIED";
    }
    if (hasVisibleCriterionEvidence(criterion)) return "VERIFIED";
    if (!routeBindings.length || !routeBindings.every(routeBindingMatches)) return false;
    return "ROUTE_ONLY";
  }

  function bindingCurrentlySatisfied(binding) {
    const group = resolveLocatorChain(binding.mapping?.filterContainer?.locatorChain || [], document, true);
    const option = group && resolveLocatorChain(binding.mapping?.option?.locatorChain || [], group, false);
    return Boolean(option && observeDesired(option, binding.mapping));
  }

  async function performAction({ option, group, mapping, step, message }) {
    assertNotCancelled(message);
    const action = step.action;
    if (["ENSURE_EXPANDED", "OPEN_FILTER_GROUP"].includes(action)) {
      if (isDropdownTrigger(group)) return openDropdown(group,message);
      const accordions = [];
      let ancestor = group;
      while (ancestor) {
        if (ancestor.matches("details")) accordions.unshift(ancestor);
        ancestor = ancestor.parentElement;
      }
      for (const details of accordions) {
        assertNotCancelled(message);
        if (details.open) continue;
        const summary = details.querySelector(":scope > summary");
        if (!summary) return false;
        summary.click();
        if (!await waitFor(() => details.open, Math.min(step.timeoutMs || 3000, 8000), message)) return false;
      }
      if (accordions.length) return true;
      const trigger = group.getAttribute("aria-expanded") === "false" ? group : group.querySelector('[aria-expanded="false"]');
      if (trigger) {
        trigger.click();
        return waitFor(() => trigger.getAttribute("aria-expanded") === "true", Math.min(step.timeoutMs || 3000, 8000), message);
      }
      return true;
    }
    if (!isElementVisible(option) || isDisabled(option)) return false;
    if (action === "SCROLL_INTO_VIEW" || action === "SCROLL_CONTAINER") {
      option.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      return true;
    }
    if (action === "FOCUS") {
      option.focus();
      return true;
    }
    if (action === "SELECT_NATIVE_OPTION" && option instanceof HTMLSelectElement) {
      const desired = (mapping.desiredValue || [])[0];
      if (![...option.options].some((candidate) => candidate.value === desired)) return false;
      option.value = desired;
      dispatchControlEvents(option);
      return true;
    }
    if (action === "SET_INPUT_VALUE" && option instanceof HTMLInputElement) {
      const desired = String((mapping.desiredValue || [])[0] ?? "");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(option, desired); else option.value = desired;
      dispatchControlEvents(option);
      option.blur();
      return true;
    }
    if (["ACTIVATE_IF_NEEDED", "ACTIVATE_OPTION", "DEACTIVATE_IF_NEEDED"].includes(action)) {
      const selected = observedBooleanState(option);
      if (selected === null) return false;
      const desired = action !== "DEACTIVATE_IF_NEEDED";
      if (selected === desired) return true;
      option.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      option.click();
      return true;
    }
    if (action === "COMMIT") {
      const target = step.locatorChain?.length
        ? (resolveLocatorChain(step.locatorChain, group, false) || resolveLocatorChain(step.locatorChain, document, false))
        : [...group.querySelectorAll('button,[role="button"],input[type="submit"]')].find((element) => /apply|show results|submit|anzeigen|übernehmen|anwenden/i.test(element.textContent || element.value || ""));
      if (!target) return false;
      if (isDisabled(target)) return observeDesired(option, mapping);
      const label = normalizedText(target.textContent || target.value);
      if (!/^(apply|show (?:\d+ )?results|submit filters|anzeigen|übernehmen|anwenden)(?:\b|$)/i.test(label)) return false;
      target.click();
      return waitForRouteStable(Math.min(step.timeoutMs || 5000, 8000), message);
    }
    if (action === "WAIT_ROUTE_STABLE" || action === "WAIT_FOR_CONDITION") {
      return waitForRouteStable(Math.min(step.timeoutMs || 3000, 8000), message);
    }
    return false;
  }

  function mappingMatchesControl(element, mapping) {
    if (element instanceof HTMLSelectElement) return mapping.controlType === "NATIVE_SELECT";
    if (element instanceof HTMLInputElement) {
      if (["checkbox", "radio"].includes(element.type)) return ["BOOLEAN", "SINGLE_SELECT", "MULTI_SELECT"].includes(mapping.controlType);
      if (["number", "range"].includes(element.type)) return mapping.controlType === "NUMERIC_VALUE";
      if (element.type === "text") return mapping.controlType === "TEXT_VALUE";
      return false;
    }
    if (!["BOOLEAN", "SINGLE_SELECT", "MULTI_SELECT", "BUTTON_OR_CHIP"].includes(mapping.controlType)) return false;
    return observedBooleanState(element) !== null;
  }

  function observeDesired(element, mapping) {
    if (!mappingMatchesControl(element, mapping)) return false;
    const desired = (mapping.desiredValue || []).map(String);
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked;
    if (element instanceof HTMLSelectElement) {
      const actual = [...element.selectedOptions].map((option) => option.value).sort();
      return actual.length === desired.length && actual.every((value, index) => value === [...desired].sort()[index]);
    }
    if (element instanceof HTMLInputElement) return desired.includes(element.value);
    return observedBooleanState(element) === true;
  }

  function resolveLocatorChain(chain, scope, isContainer) {
    for (const locator of chain) {
      const result = resolveLocator(locator, scope, isContainer);
      if (result) return result;
    }
    return null;
  }

  function resolveLocator(locator, scope, isContainer) {
    const value = String(locator.value || "");
    const all = (selector) => queryAllDeep(selector, isDropdownTrigger(scope) ? (dropdownPopup(scope) || scope) : scope);
    if (locator.type === "COMBOBOX_LABEL") {
      return unique(all('button[aria-controls][aria-expanded]').filter(isDropdownTrigger)
        .filter((trigger) => plainText(dropdownLabel(trigger)) === plainText(value)));
    }
    if (locator.type === "DROPDOWN_OPTION") {
      const popup = isDropdownTrigger(scope) ? dropdownPopup(scope) : null;
      if (!popup) return null;
      const options = queryAllDeep('[role="option"]',popup);
      const exact = options.filter((option) => plainText(labelText(option)) === plainText(value));
      if (exact.length) return unique(exact);
      return unique(options.filter((option) => plainText(labelText(option).replace(/\s*\(\s*\d+[\d.,]*\s*\)\s*$/,"")) === plainText(value)));
    }
    if (locator.type === "NATIVE_RANGE_ENDPOINT") {
      const pair = nativeRangePair(scope);
      if (!pair) return null;
      return value === "LOWER" ? pair[0] : value === "UPPER" ? pair[1] : null;
    }
    if (locator.type === "LABELLED_LIST") {
      return unique(all('ul[aria-labelledby],ol[aria-labelledby],[role="list"][aria-labelledby],[role="listbox"][aria-labelledby]')
        .filter((element) => normalizedText(groupLabel(element)) === normalizedText(value)));
    }
    if (locator.type === "DETAILS_SUMMARY") {
      return unique(all("details").filter((element) => normalizedText(groupLabel(element)) === normalizedText(value)));
    }
    if (locator.type === "ID") return unique(all(`[id="${escapeAttribute(value)}"]`));
    if (locator.type === "ARIA_LABEL" || locator.type === "GROUP_ARIA_LABEL") {
      return unique(all(`[aria-label="${escapeAttribute(value)}"]`));
    }
    if (locator.type === "SELECT_NAME") return unique(all(`select[name="${escapeAttribute(value)}"]`));
    if (locator.type === "NAME_VALUE") {
      const [name, optionValue] = value.split("\u0000");
      return unique(all(`[name="${escapeAttribute(name)}"][value="${escapeAttribute(optionValue)}"]`));
    }
    if (locator.type === "FIELDSET_LEGEND") {
      const matches = all("fieldset").filter((fieldset) => normalizedText(fieldset.querySelector(":scope > legend")?.textContent) === normalizedText(value));
      return unique(matches);
    }
    if (locator.type === "IDEALO_FILTER_GROUP") {
      const boxes = all("div").filter((element) => [...element.classList].some((token) => /^sr-filterBox_[^_]/.test(token)));
      return unique(boxes.filter((box) => {
        const title = [...box.querySelectorAll("span")].find((element) => [...element.classList].some((token) => token.startsWith("sr-boxTitle__text_")));
        return normalizedText(title?.getAttribute("title") || title?.textContent) === normalizedText(value);
      }));
    }
    if (locator.type === "IDEALO_OPTION") {
      const inputs = all('input[type="checkbox"], input[type="radio"]');
      return unique(inputs.filter((input) => normalizedText(idealoOptionLabel(input)) === normalizedText(value)));
    }
    if (locator.type === "HEADING_TEXT") {
      const headings = all("h1,h2,h3,h4,h5,h6,[role=heading]").filter((heading) => normalizedText(heading.textContent) === normalizedText(value));
      const containers = headings.map((heading) => heading.closest('fieldset,[role="group"],section,aside,div')).filter(Boolean);
      return unique(containers);
    }
    if (locator.type === "LABEL_TEXT") {
      const controls = all('input,select,button,[role="checkbox"],[role="radio"],[role="switch"],[aria-selected],[aria-pressed]');
      return unique(controls.filter((element) => normalizedText(controlLabel(element)) === normalizedText(optionLabelText(value))));
    }
    if (locator.type === "BUTTON_TEXT") {
      return unique(all('button,[role="button"],input[type="submit"]')
        .filter((element) => normalizedText(element.textContent || element.value) === normalizedText(value)));
    }
    if (locator.type === "LINK_TEXT") {
      return unique(all("a[href]").filter((element) => normalizedText(element.textContent) === normalizedText(value)));
    }
    return isContainer ? null : null;
  }

  function buildContainerLocators(element, label) {
    const locators = [];
    if (isDropdownTrigger(element)) return [{type:"COMBOBOX_LABEL",value:dropdownLabel(element)}];
    if (element.matches('ul[aria-labelledby],ol[aria-labelledby],[role="list"][aria-labelledby],[role="listbox"][aria-labelledby]')) locators.push({type:"LABELLED_LIST", value:label});
    if (element.matches("details")) locators.push({type:"DETAILS_SUMMARY", value:label});
    if (isIdealoAdapter()) locators.push({ type: "IDEALO_FILTER_GROUP", value: label });
    if (stableDomId(element.id)) locators.push({ type: "ID", value: element.id });
    if (element.getAttribute("aria-label")) locators.push({ type: "GROUP_ARIA_LABEL", value: element.getAttribute("aria-label") });
    if (element instanceof HTMLFieldSetElement && element.querySelector(":scope > legend")) locators.push({ type: "FIELDSET_LEGEND", value: label });
    locators.push({ type: "HEADING_TEXT", value: label });
    return dedupeLocators(locators);
  }

  function buildOptionLocators(element, label) {
    const locators = [];
    if (element.matches('[role="option"]')) {
      if (isDropdownTrigger(findFilterGroup(element)?.element || document.documentElement)) return [{type:"DROPDOWN_OPTION",value:label}];
    }
    const endpoint = nativeRangeEndpoint(element);
    if (endpoint) return [{type:"NATIVE_RANGE_ENDPOINT",value:endpoint}];
    if (isIdealoAdapter() && element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      locators.push({ type: "IDEALO_OPTION", value: label });
    }
    if (stableDomId(element.id)) locators.push({ type: "ID", value: element.id });
    const aria = element.getAttribute("aria-label");
    if (aria) locators.push({ type: "ARIA_LABEL", value: aria });
    if (element instanceof HTMLSelectElement && element.name) locators.push({ type: "SELECT_NAME", value: element.name });
    if ((element instanceof HTMLInputElement || element instanceof HTMLButtonElement) && element.getAttribute("name") && element.getAttribute("value")) {
      locators.push({ type: "NAME_VALUE", value: `${element.getAttribute("name")}\u0000${element.getAttribute("value")}` });
    }
    if (element instanceof HTMLAnchorElement) locators.push({ type: "LINK_TEXT", value: label });
    locators.push({ type: "LABEL_TEXT", value: label });
    return dedupeLocators(locators);
  }

  function findFilterGroup(element) {
    const owner = dropdownOwner(element);
    if (owner) return {element:owner,label:dropdownLabel(owner),depth:0};
    const popup = element.closest('[role="listbox"]');
    if (popup) {
      const trigger = dropdownForPopup(popup);
      if (trigger) return {element:trigger,label:trigger.getAttribute("aria-label"),depth:0};
      if (groupLabel(popup)) return {element:popup,label:groupLabel(popup),depth:0};
    }
    if (isIdealoAdapter()) {
      let idealoBox = element.parentElement;
      while (idealoBox) {
        if ([...idealoBox.classList].some((token) => /^sr-filterBox_[^_]/.test(token))) {
          const title = [...idealoBox.querySelectorAll("span")].find((candidate) => [...candidate.classList].some((token) => token.startsWith("sr-boxTitle__text_")));
          const label = conciseLabel(title?.getAttribute("title") || title?.textContent);
          if (label) return { element: idealoBox, label, depth: 0 };
        }
        idealoBox = idealoBox.parentElement;
      }
    }
    const candidates = [];
    let current = element.parentElement;
    let depth = 0;
    while (current&& depth < 16) {
      if (current.matches('fieldset,details,ul[aria-labelledby],ol[aria-labelledby],[role="list"][aria-labelledby],[role="listbox"][aria-labelledby],[role="group"],section,aside,nav,form,div')) {
        const label = groupLabel(current);
        if (label) candidates.push({ element: current, label, depth });
      }
      current = current.parentElement;
      depth += 1;
    }
    return candidates.sort((a, b) => a.depth - b.depth)[0] || null;
  }

  function labelText(element) {
    if (!element) return "";
    const copy = element.cloneNode(true);
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"], [data-result-count]')) hidden.remove();
    return optionLabelText(copy.textContent);
  }

  function optionLabelText(value) {
    return conciseLabel(String(value || "").replace(/\s*\(\s*\d+[\d.,]*\s+(?:ergebnisse?|results?|produkte?|products?|artikel|items?|treffer)\s*\)\s*$/i, ""));
  }

  function referencedLabel(element) {
    const ids = element.getAttribute("aria-labelledby");
    if (!ids) return "";
    const root = element.getRootNode();
    return conciseLabel(ids.split(/\s+/).map((id) => labelText(root.getElementById?.(id))).join(" "));
  }

  function groupLabel(element) {
    if (element instanceof HTMLFieldSetElement) {
      const label = labelText(element.querySelector(":scope > legend"));
      if (label) return label;
    }
    const aria = conciseLabel(element.getAttribute("aria-label"));
    if (aria) return aria;
    const referenced = referencedLabel(element);
    if (referenced) return referenced;
    if (element.matches("details")) return labelText(element.querySelector(":scope > summary"));
    return labelText(element.querySelector(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > [role=heading]"));
  }

  function controlLabel(element) {
    if (element instanceof HTMLInputElement) {
      const owner = dropdownOwner(element);
      if (owner ? dropdownPopup(owner)?.matches('[role="menu"]') : false) {
        const label = element.getAttribute("aria-label") || labelText(element.labels?.[0]);
        if (label) return conciseLabel(label.replace(/\s*\(\s*\d+[\d.,]*\s*\)\s*$/, ""));
      }
    }
    if (element.matches('[role="option"]')) {
      const label = labelText(element);
      const attribute = element.getAttribute("data-attribute");
      if (attribute) {
        for (const [key,value] of new URL(location.href).searchParams) {
          const field = /^refinementList\[([^\]]+)\](?:\[\d+\])?$/i.exec(key)?.[1];
          if (field !== attribute) continue;
          const withoutCount = label.replace(/\s*\(\s*\d+[\d.,]*\s*\)\s*$/,"");
          if ([plainText(label),plainText(withoutCount)].includes(plainText(value))) return value;
        }
      }
      return label;
    }
    if (isIdealoAdapter()) {
      const label = idealoOptionLabel(element);
      if (label) return optionLabelText(label);
    }
    const aria = optionLabelText(element.getAttribute("aria-label"));
    if (aria) return aria;
    const referenced = referencedLabel(element);
    if (referenced) return referenced;
    if (element.id) {
      const root = element.getRootNode();
      const label = [...root.querySelectorAll("label")].find((item) => item.htmlFor === element.id);
      if (labelText(label)) return labelText(label);
    }
    const wrappingLabel = element.closest("label");
    if (labelText(wrappingLabel)) return labelText(wrappingLabel);
    if (element instanceof HTMLSelectElement) return conciseLabel(element.name || element.id);
    return optionLabelText(element.textContent || element.getAttribute("value") || element.getAttribute("name"));
  }

  function inferContextLabel() {
    const heading = document.querySelector("main h1, h1, main h2");
    return conciseLabel(heading?.textContent) || document.title.split(/[|–—-]/)[0].trim().slice(0, 120);
  }

  function activeStateSignature() {
    const values = [];
    for (const element of queryAllDeep('input:checked, input[type="number"], input[type="range"], select, [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]')) {
      const value = element instanceof HTMLSelectElement
        ? [...element.selectedOptions].map((option) => option.value).join("|")
        : element.value || element.getAttribute("value") || element.textContent || "";
      values.push(`${controlLabel(element) || element.tagName}:${value}`.slice(0, 200));
    }
    return JSON.stringify(values.sort());
  }

  function hasVisibleCriterionEvidence(criterion) {
    if (isDecathlonAdapter()) return hasDecathlonVisibleCriterionEvidence(criterion);
    const controlEvidence = (criterion.bindings || []).filter((binding) => binding.controlEvidence);
    if (controlEvidence.length) {
      const inputs = queryAllDeep('input[type="checkbox"],input[type="radio"]');
      return controlEvidence.every((binding) => controlEvidenceSatisfied(binding.controlEvidence,inputs));
    }
    const chipEvidence = appliedFilterEvidence(criterion);
    if (chipEvidence !== null) return chipEvidence;
    if (nativeSortEvidence(criterion)) return true;
    const evidence = activeEvidenceText();
    const candidates = [
      ...(criterion.observedRepresentation || []),
      ...(criterion.bindings || []).flatMap((binding) => binding.verificationTexts || [])
    ].map(normalizedText).filter((value) => value.length >= 2 && !/^\d+$/.test(value));
    return candidates.length > 0 && candidates.every((value) => evidence.includes(value));
  }

  function appliedFilterRegions() {
    return queryAllDeep('section[aria-label],[role="region"][aria-label]')
      .filter(isElementVisible).filter((element) => /^(angewendete filter|ausgewählte filter|aktive filter|applied filters|active filters|selected filters)$/i.test(plainText(element.getAttribute("aria-label"))));
  }

  function appliedFilterTexts(region) {
    return queryAllDeep('button[aria-label]',region).filter(isElementVisible)
      .filter((button) => /^(?:filter\s+.+\s+(?:löschen|entfernen)|remove filter\b|remove .+ filter\b)/i.test(button.getAttribute("aria-label")))
      .map((button) => plainText(labelText(button))).filter(Boolean);
  }

  function appliedFilterEvidence(criterion) {
    if (criterion.role !== "FILTER") return null;
    const bindings = (criterion.bindings || []).filter((binding) => binding.semanticEvidence === true);
    const expected = bindings.flatMap((binding) => binding.verificationTexts || []).map(plainText).filter(Boolean);
    if (!expected.length) return null;
    const regions = appliedFilterRegions();
    if (!regions.length) return null;
    if (regions.length !== 1) return false;
    const actual = new Set(appliedFilterTexts(regions[0]));
    return expected.every((text) => actual.has(text));
  }

  function representedFilterSummary(element, hints) {
    if (!element.matches('button[aria-pressed="true"]')) return false;
    const summary = plainText(labelText(element)).match(/^(.+?)\s*\((\d+)\)$/);
    if (!summary) return false;
    const represented = (hints || []).filter((hint) => hint.summaryKey ? hint.labels?.some((label) => plainText(label) === summary[1]) : false)
      .filter((hint) => hint.parameters?.length);
    if (!represented.length) return false;
    const representedCounts = [new Set(represented.map((hint) => hint.summaryKey)).size,represented.flatMap((hint) => hint.appliedFilterTexts || []).length];
    if (!representedCounts.includes(Number(summary[2]))) return false;
    const regions = appliedFilterRegions();
    if (regions.length !== 1) return false;
    const actual = new Set(appliedFilterTexts(regions[0]));
    return represented.every((hint) => hint.appliedFilterTexts?.length ? hint.appliedFilterTexts.every((text) => actual.has(plainText(text))) : false);
  }

  function nativeSortEvidence(criterion) {
    if (criterion.role !== "PRESENTATION" || criterion.semanticType !== "SORT") return false;
    const values = (criterion.bindings || []).filter((binding) => binding.type === "URL_QUERY").flatMap((binding) => binding.values || []);
    if (!values.length) return false;
    const selects = queryAllDeep("select").filter(isElementVisible).filter((select) => /sort|sortier/i.test(`${select.name} ${select.id} ${select.getAttribute("aria-label") || ""}`));
    return values.every((value) => selects.some((select) => select.value === String(value)));
  }

  function hasDecathlonVisibleCriterionEvidence(criterion) {
    if (criterion.semanticType === "PRICE_RANGE") {
      const raw = (criterion.bindings || []).find((binding) => binding.type === "URL_QUERY" && binding.parameter.toLowerCase() === "price")?.values?.[0];
      const bounds = String(raw || "").match(/^from_([^_]+)_to_([^_]+)$/i);
      const minimum = queryAllDeep('input[aria-label="Minimum"]').find(isElementVisible);
      const maximum = queryAllDeep('input[aria-label="Maximum"]').find(isElementVisible);
      if (bounds && minimum && maximum
        && normalizedNumber(minimum.value) === normalizedNumber(bounds[1])
        && normalizedNumber(maximum.value) === normalizedNumber(bounds[2])) return true;
      const summary = queryAllDeep("button.accordion__trigger").find((button) =>
        isElementVisible(button) && /preis/i.test(button.innerText || button.textContent || ""));
      const displayedBounds = (summary?.innerText || summary?.textContent || "").match(/\d+(?:[.,]\d+)?/g) || [];
      return Boolean(bounds && displayedBounds.some((value) => Number(normalizedNumber(value)) === Number(normalizedNumber(bounds[1])))
        && displayedBounds.some((value) => Number(normalizedNumber(value)) === Number(normalizedNumber(bounds[2]))));
    }
    if (criterion.semanticType === "SORT") {
      const sort = queryAllDeep('[role="combobox"][aria-label*="Sortieren nach"]')
        .find(isElementVisible);
      return Boolean(sort && (criterion.observedRepresentation || [])
        .some((value) => normalizedText(sort.textContent) === normalizedText(value)));
    }

    const selected = queryAllDeep('input:checked, [role="switch"][aria-checked="true"], [role="checkbox"][aria-checked="true"], [role="radio"][aria-checked="true"]')
      .filter(isElementVisible)
      .map((element) => cleanDecathlonControlLabel(controlLabel(element)))
      .filter(Boolean);
    selected.push(...queryAllDeep("button.accordion__trigger")
      .filter(isElementVisible)
      .map((element) => cleanDecathlonControlLabel(element.innerText || element.textContent))
      .filter(Boolean));
    selected.push(...queryAllDeep("button.accordion__trigger .accordion__subline")
      .filter(isElementVisible)
      .map((element) => cleanDecathlonControlLabel(element.innerText || element.textContent))
      .filter(Boolean));
    const desired = (criterion.observedRepresentation || []).map(cleanDecathlonControlLabel).filter(Boolean);
    return desired.length > 0 && desired.every((value) => selected.some((actual) =>
      normalizedText(actual) === normalizedText(value)
      || decathlonSummaryContains(actual, value)));
  }

  function decathlonSummaryContains(summary, value) {
    const wanted = normalizedText(value);
    const actual = normalizedText(summary);
    if (wanted.length > 1) return actual.includes(wanted);
    return actual.split(/[^a-z0-9]+/i).includes(wanted);
  }

  function cleanDecathlonControlLabel(value) {
    return conciseLabel(String(value || "")
      .replace(/\s+\d+[\d.,]*\s+Artikel$/i, "")
      .replace(/^Verkauft\s+durch\s+/i, ""));
  }

  function normalizedNumber(value) {
    return String(value || "").replace(/[^\d,.-]/g, "").replace(",", ".").replace(/^0+(?=\d)/, "");
  }

  function activeEvidenceText() {
    const parts = [];
    for (const element of queryAllDeep('input:checked, select, [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"], [class*="filterTag"], [class*="filter-tag"], [class*="active-filter"]')) {
      if (!isElementVisible(element)) {
        if (!(element instanceof HTMLInputElement)) continue;
        if (!["checkbox", "radio"].includes(element.type)) continue;
        if (isSensitiveControl(element) || outsideFilterSurface(element)) continue;
        const labels = [...(element.labels || [])].filter(isElementVisible);
        if (!labels.length) continue;
        parts.push(...labels.map(labelText));
        continue;
      }
      if (element instanceof HTMLSelectElement) {
        if (isDefaultSelect(element)) continue;
        parts.push(controlLabel(element),...selectedLabels(element));
        continue;
      }
      parts.push(controlLabel(element), element.textContent, element.getAttribute("aria-label"));
    }
    return normalizedText(parts.filter(Boolean).join(" | "));
  }

  function queryAllDeep(selector, startingScope = document) {
    const results = [];
    const roots = [];
    const enqueue = (root) => {
      if (!root || roots.includes(root)) return;
      roots.push(root);
      try { results.push(...root.querySelectorAll(selector)); } catch { return; }
      for (const element of root.querySelectorAll("*")) if (element.shadowRoot) enqueue(element.shadowRoot);
    };
    enqueue(startingScope);
    return [...new Set(results)];
  }

  function observedBooleanState(element) {
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked;
    for (const attribute of ["aria-checked", "aria-selected", "aria-pressed"]) {
      if (element.hasAttribute(attribute)) return element.getAttribute(attribute) === "true";
    }
    if (element.hasAttribute("aria-current")) return !["false", ""].includes(element.getAttribute("aria-current"));
    return null;
  }

  function selectedLabels(select) {
    return select instanceof HTMLSelectElement ? [...select.selectedOptions].map((option) => conciseLabel(option.textContent) || option.value) : [];
  }

  function isElementVisible(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function isSensitiveControl(element) {
    if (element instanceof HTMLInputElement && ["password", "email", "tel"].includes(element.type)) return true;
    const haystack = `${element.getAttribute("name") || ""} ${element.id || ""} ${element.getAttribute("autocomplete") || ""} ${location.pathname}`;
    return /password|login|email|phone|card|cc-|cvc|address|checkout|payment|account|profile|token|session|secret|cookie|csrf|user.?id|tracking/i.test(haystack);
  }

  function isDisabled(element) {
    return Boolean(element.disabled || element.getAttribute("aria-disabled") === "true");
  }

  function isDefaultSelect(select) {
    if (!(select instanceof HTMLSelectElement) || select.selectedIndex < 0) return false;
    const explicitDefault = [...select.options].findIndex((option) => option.defaultSelected);
    if (explicitDefault >= 0) return select.selectedIndex === explicitDefault;
    return select.selectedIndex === 0;
  }

  function appearsActive(element) {
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked;
    if (element instanceof HTMLSelectElement) return !isDefaultSelect(element);
    if (element instanceof HTMLInputElement && ["number", "range"].includes(element.type)) return Boolean(element.value);
    return observedBooleanState(element) === true;
  }

  function appearsVirtualized(group) {
    return Boolean(group.querySelector('[aria-setsize], [data-virtualized="true"]')) || group.scrollHeight > group.clientHeight * 4;
  }

  function dispatchControlEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function waitFor(predicate, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      assertNotCancelled(message);
      if (predicate()) return resolve(true);
      const started = Date.now();
      let timer;
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      timer = setInterval(check, 75);
      function check() {
        try { assertNotCancelled(message); } catch (error) {
          observer.disconnect();
          clearInterval(timer);
          reject(error);
          return;
        }
        if (predicate()) return finish(true);
        if (Date.now() - started >= timeoutMs) finish(false);
      }
      function finish(value) {
        observer.disconnect();
        clearInterval(timer);
        resolve(value);
      }
    });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForRouteStable(timeoutMs, message) {
    const started = Date.now();
    let previous = `${location.href}|${activeStateSignature()}`;
    let stableSince = Date.now();
    while (Date.now() - started < timeoutMs) {
      await delay(100);
      assertNotCancelled(message);
      const current = `${location.href}|${activeStateSignature()}`;
      if (current !== previous) {
        previous = current;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 300) {
        return true;
      }
    }
    return false;
  }

  async function progress(message, criterion, results, status) {
    execution.status = status;
    execution.activeCriterion = criterion?.criterionId || null;
    execution.results = [...results];
    await chrome.runtime.sendMessage({
      type: MESSAGE.REPLAY_PROGRESS,
      replayId: message.replayId,
      status,
      activeCriterion: criterion?.criterionId || null,
      results
    }).catch(() => undefined);
  }

  function assertNotCancelled(message) {
    if (cancelledReplays.has(message.replayId)) throw new Error("REPLAY_CANCELLED");
    if (Date.now() > message.deadlineAt) throw new Error("REPLAY_TIMEOUT");
    if (message.runtimeContext) {
      const current = inspectContext();
      for (const key of ["origin", "surface", "routeClass", "searchQuery", "locale", "category"]) {
        if (current[key] !== message.runtimeContext[key]) throw new Error("CONTEXT_CHANGED_DURING_REPLAY");
      }
    }
  }

  function routeBindingMatches(binding) {
    if (binding.type === "URL_PATH") {
      if (location.pathname !== binding.pathname) return false;
      if (isIdealoAdapter() && (binding.verificationTexts || []).length) {
        const actual = idealoActiveTags().map(normalizedText);
        return binding.verificationTexts.every((value) => actual.includes(normalizedText(value)));
      }
      return true;
    }
    const actual = new URL(location.href).searchParams.getAll(binding.parameter).map(String).sort();
    const desired = (binding.values || []).map(String).sort();
    return actual.length === desired.length && actual.every((value, index) => value === desired[index]);
  }

  function overallStatus(results, criteria) {
    const verified = (result) => ["APPLIED", "ALREADY_APPLIED", "VERIFIED"].includes(result?.status);
    const required = criteria.filter((item) => item.role !== "PRESENTATION");
    const byId = new Map(results.map((item) => [item.criterionId, item]));
    const requiredComplete = required.every((item) => verified(byId.get(item.criterionId)));
    if (requiredComplete) {
      if (results.every(verified)) return "COMPLETE";
      return "COMPLETE_WITH_WARNINGS";
    }
    if (results.some((item) => verified(item) || item.status === "ROUTE_ONLY")) return "PARTIAL";
    return "FAILED";
  }

  function criterionResult(criterion, status, message, evidence = null) {
    return {
      criterionId: criterion.criterionId,
      semanticType: criterion.semanticType,
      desiredValue: criterion.desiredValue,
      status,
      message,
      evidence
    };
  }

  function failure(status, message) {
    return { ok: false, status, message };
  }

  function normalizeSemanticType(value) {
    return String(value || "UNKNOWN").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() || "UNKNOWN";
  }

  function stableId(prefix, ...parts) {
    const text = parts.join("|").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${prefix}-${text}`.slice(0, 96);
  }

  function stableDomId(id) {
    return Boolean(id && id.length <= 120 && !/\d{5,}|[a-f0-9]{10,}|^:r/i.test(id));
  }

  function conciseLabel(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text && text.length <= 160 && text !== "[object Object]" && !/^(apply|submit|show results|anzeigen|anwenden)$/i.test(text) ? text : "";
  }

  function normalizedText(value) {
    return String(value || "").replace(/\(\s*\d+[\d,.]*\s*\)\s*$/, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }

  function plainText(value) {
    return String(value || "").replace(/\s+/g," ").trim().toLocaleLowerCase();
  }

  function unique(items) {
    const distinct = [...new Set(items)].filter(Boolean);
    return distinct.length === 1 ? distinct[0] : null;
  }

  function escapeAttribute(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function dedupeLocators(locators) {
    const seen = new Set();
    return locators.filter((locator) => {
      const key = `${locator.type}:${locator.value}`;
      if (seen.has(key) || !locator.value) return false;
      seen.add(key);
      return true;
    });
  }

  function dedupeUnsupported(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.label}:${item.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isIdealoAdapter() {
    return /(^|\.)idealo\.de$/i.test(location.hostname) || document.documentElement.dataset.filterVaultAdapter === "idealo";
  }

  function isDecathlonAdapter() {
    return /(^|\.)decathlon\.de$/i.test(location.hostname) || document.documentElement.dataset.filterVaultAdapter === "decathlon";
  }

  function idealoOptionLabel(element) {
    const label = element.closest("label");
    const titled = label?.querySelector("a[title], [title]");
    if (conciseLabel(titled?.getAttribute("title"))) return conciseLabel(titled.getAttribute("title"));
    const semantic = label && [...label.querySelectorAll("span")].find((candidate) => [...candidate.classList].some((token) => token.includes("filter__label")));
    return conciseLabel(semantic?.textContent);
  }

  function idealoActiveTags() {
    return queryAllDeep("button")
      .filter((button) => [...button.classList].some((token) => /^sr-filterTag_[^_]/.test(token)))
      .map((button) => conciseLabel(button.textContent))
      .filter(Boolean);
  }

  function hasIdealoPriceFilter() {
    return idealoActiveTags().some((tag) => /(?:preis|€|eur)/i.test(tag));
  }

  function safeError(error) {
    return String(error instanceof Error ? error.message : error || "UNKNOWN_ERROR").slice(0, 300);
  }
})();
