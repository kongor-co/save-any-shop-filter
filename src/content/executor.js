(() => {
  "use strict";

  const MESSAGE = {
    CAPTURE_PAGE: "CAPTURE_PAGE",
    EXECUTE_REPLAY: "EXECUTE_REPLAY",
    CANCEL_REPLAY_EXECUTOR: "CANCEL_REPLAY_EXECUTOR",
    CONTENT_READY: "CONTENT_READY",
    REPLAY_PROGRESS: "REPLAY_PROGRESS",
    REPLAY_COMPLETE: "REPLAY_COMPLETE"
  };
  const SUCCESS = new Set(["APPLIED", "ALREADY_APPLIED", "VERIFIED"]);
  const cancelledReplays = new Set();

  if (globalThis.__FILTER_VAULT_EXECUTOR__) {
    notifyReady();
    return;
  }
  globalThis.__FILTER_VAULT_EXECUTOR__ = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === MESSAGE.CAPTURE_PAGE) {
      Promise.resolve(capturePage()).then((snapshot) => sendResponse({ ok: true, snapshot }))
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

  function capturePage() {
    const startedUrl = location.href;
    const startedSignature = activeStateSignature();
    const pageType = detectPageType();
    if (["CHECKOUT", "LOGIN", "ACCOUNT", "PRODUCT_DETAIL", "OTHER"].includes(pageType)) {
      throw new Error(`UNSUPPORTED_PAGE_TYPE:${pageType}`);
    }

    const candidates = collectSupportedControls();
    let domCriteria = groupCandidates(candidates.supported);
    if (isIdealoAdapter()) domCriteria = enrichIdealoCriteria(domCriteria);
    const endedSignature = activeStateSignature();
    if (startedUrl !== location.href || startedSignature !== endedSignature) throw new Error("CAPTURE_STATE_CHANGED");

    return {
      url: location.href,
      title: document.title,
      locale: document.documentElement.lang || navigator.language || "und",
      pageType,
      adapterId: isIdealoAdapter() ? "idealo-de" : "generic",
      adapterVersion: 1,
      contextLabel: inferContextLabel(),
      domCriteria,
      unsupported: candidates.unsupported.slice(0, 30)
    };
  }

  function detectPageType() {
    const path = location.pathname.toLowerCase();
    if (/\/(checkout|payment|order|basket|cart)(\/|$)/.test(path)) return "CHECKOUT";
    if (/\/(login|sign-in|signin|auth)(\/|$)/.test(path) || document.querySelector('input[type="password"]')) return "LOGIN";
    if (/\/(account|profile|settings)(\/|$)/.test(path)) return "ACCOUNT";

    const filterControls = queryAllDeep('input[type="checkbox"], input[type="radio"], select, [role="checkbox"], [role="radio"], [aria-checked], [aria-selected]');
    const productLinks = [...document.querySelectorAll('a[href]')].filter((link) => /product|item|sku|dp\//i.test(link.getAttribute("href") || ""));
    const routeLooksSearch = /search|category|collections?|products?|shop|catalog/i.test(path) || [...new URL(location.href).searchParams.keys()].some((key) => /q|query|search|filter|brand|size|color|price/i.test(key));
    if (filterControls.length >= 2 || productLinks.length >= 4 || routeLooksSearch) return routeLooksSearch ? "SEARCH" : "LISTING";
    if (/\/[^/]+\/[^/]+/.test(path) && document.querySelector('button, [role="button"]')) return "PRODUCT_DETAIL";
    return "OTHER";
  }

  function collectSupportedControls() {
    const supported = [];
    const unsupported = [];
    const seen = new Set();
    const selectors = [
      'input[type="checkbox"]', 'input[type="radio"]', "select",
      'input[type="number"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
      '[aria-selected="true"]', '[aria-pressed="true"]'
    ].join(",");

    for (const element of queryAllDeep(selectors)) {
      if (seen.has(element) || !isElementVisible(element) || isSensitiveControl(element)) continue;
      seen.add(element);
      const candidate = captureControl(element);
      if (candidate) supported.push(candidate);
    }

    for (const element of queryAllDeep('[role="slider"], input[type="range"], [aria-autocomplete], [role="combobox"]')) {
      if (!isElementVisible(element) || isSensitiveControl(element)) continue;
      if (isIdealoAdapter() && element.matches('[role="slider"], input[type="range"]') && !hasIdealoPriceFilter()) continue;
      unsupported.push({
        label: controlLabel(element) || "Advanced filter control",
        reason: element.matches('[role="slider"], input[type="range"]') ? "Dual/range sliders require a verified adapter." : "Autocomplete controls require a verified adapter."
      });
    }
    return { supported, unsupported: dedupeUnsupported(unsupported) };
  }

  function captureControl(element) {
    const group = findFilterGroup(element);
    const groupLabel = group ? group.label : "";
    if (!group || !groupLabel) return null;
    const optionLabel = controlLabel(element);
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
      const selected = [...element.selectedOptions].filter((option) => option.value && !option.disabled);
      if (!selected.length) return null;
      controlType = "NATIVE_SELECT";
      desired = selected.map((option) => option.value);
      interactionAction = "SELECT_NATIVE_OPTION";
      verificationType = "SELECT_VALUE";
    } else if (element instanceof HTMLInputElement && element.type === "number") {
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
    const viewport = innerWidth < 720 ? "compact" : "desktop";
    const values = Array.isArray(desired) ? desired : [desired];
    return {
      groupLabel,
      semanticType: normalizeSemanticType(groupLabel),
      observed: Array.isArray(desired) ? selectedLabels(element) : [optionLabel],
      values,
      binding: {
        bindingId: stableId("dom", groupLabel, optionLabel, values.join("|")),
        type: "DOM",
        origin: location.origin,
        applicability: { viewport },
        mapping: {
          mappingVersion: 1,
          controlType,
          desiredValue: values,
          filterContainer: { locatorChain: containerLocators },
          option: { semanticValue: values, locatorChain: optionLocators },
          interactionPlan: [
            { action: interactionAction, timeoutMs: 3000 },
            { action: "VERIFY", timeoutMs: 3000 }
          ],
          verificationRule: { type: verificationType, desiredValue: values }
        }
      }
    };
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

  async function executeReplay(message) {
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
      if (!SUCCESS.has(result.status)) failedCriteria.add(criterion.criterionId);
      await progress(message, null, results, "APPLYING");
    }

    await progress(message, null, results, "VERIFYING");
    for (let index = 0; index < results.length; index += 1) {
      if (!SUCCESS.has(results[index].status)) continue;
      const criterion = message.criteria.find((item) => item.criterionId === results[index].criterionId);
      const verified = await verifyCriterion(criterion);
      if (!verified) {
        results[index] = criterionResult(criterion, "VERIFY_FAILED", "The filter changed after it was applied.");
      }
    }

    const status = overallStatus(results);
    const result = { replayId: message.replayId, status, results };
    await chrome.runtime.sendMessage({ type: MESSAGE.REPLAY_COMPLETE, replayId: message.replayId, result }).catch(() => undefined);
    cancelledReplays.delete(message.replayId);
    return result;
  }

  async function applyCriterion(criterion, message) {
    const routeBindings = (criterion.bindings || []).filter((binding) => ["URL_QUERY", "URL_PATH"].includes(binding.type));
    const domBindings = (criterion.bindings || []).filter((binding) => binding.type === "DOM");
    const routeSatisfied = routeBindings.length > 0 && routeBindings.every(routeBindingMatches);
    const domSatisfied = domBindings.length > 0 && domBindings.every(bindingCurrentlySatisfied);
    if (routeSatisfied && (!domBindings.length || domSatisfied)) {
      return criterionResult(criterion, "ALREADY_APPLIED", "The saved route already represents this criterion.");
    }
    if (!domBindings.length) {
      return criterionResult(criterion, "VERIFY_FAILED", "The retailer did not retain the saved route state.");
    }

    let changed = false;
    for (const binding of domBindings) {
      assertNotCancelled(message);
      const applied = await applyDomBinding(binding);
      if (!applied.ok) return criterionResult(criterion, applied.status, applied.message);
      changed ||= applied.changed;
    }
    return criterionResult(criterion, changed ? "APPLIED" : "ALREADY_APPLIED", changed ? "Applied and verified." : "Already selected; no interaction was needed.");
  }

  async function applyDomBinding(binding) {
    const mapping = binding.mapping;
    if (!mapping || binding.origin !== location.origin) return failure("RESOLUTION_INCONCLUSIVE", "The mapping is not authorized for this page.");
    const group = resolveLocatorChain(mapping.filterContainer?.locatorChain || [], document, true);
    if (!group) return failure("RESOLUTION_INCONCLUSIVE", "FilterVault cannot determine whether this filter group is currently available.");
    const option = resolveLocatorChain(mapping.option?.locatorChain || [], group, false);
    if (!option) {
      if (appearsVirtualized(group)) return failure("RESOLUTION_INCONCLUSIVE", "The value may be outside the rendered portion of this filter.");
      return failure("VALUE_UNAVAILABLE", "The filter group exists, but the saved value is currently unavailable.");
    }
    if (isDisabled(option)) return failure("VALUE_UNAVAILABLE", "The saved value is visible but currently disabled.");
    if (observeDesired(option, mapping)) return { ok: true, changed: false };

    const action = (mapping.interactionPlan || []).find((step) => step.action !== "VERIFY");
    if (!action) return failure("UNSUPPORTED_INTERACTION", "No supported interaction plan is available.");
    const changed = performAction(option, mapping, action.action);
    if (!changed) return failure("UNSUPPORTED_INTERACTION", "This control requires a retailer-specific interaction.");
    const verified = await waitFor(() => observeDesired(option, mapping), Math.min(action.timeoutMs || 3000, 5000));
    return verified ? { ok: true, changed: true } : failure("VERIFY_FAILED", "The interaction occurred, but the desired state could not be verified.");
  }

  async function verifyCriterion(criterion) {
    const routeBindings = (criterion.bindings || []).filter((binding) => ["URL_QUERY", "URL_PATH"].includes(binding.type));
    const domBindings = (criterion.bindings || []).filter((binding) => binding.type === "DOM");
    if (domBindings.length) return domBindings.every(bindingCurrentlySatisfied);
    return routeBindings.length > 0 && routeBindings.every(routeBindingMatches);
  }

  function bindingCurrentlySatisfied(binding) {
    const group = resolveLocatorChain(binding.mapping?.filterContainer?.locatorChain || [], document, true);
    const option = group && resolveLocatorChain(binding.mapping?.option?.locatorChain || [], group, false);
    return Boolean(option && observeDesired(option, binding.mapping));
  }

  function performAction(element, mapping, action) {
    if (action === "SELECT_NATIVE_OPTION" && element instanceof HTMLSelectElement) {
      const desired = (mapping.desiredValue || [])[0];
      if (![...element.options].some((option) => option.value === desired)) return false;
      element.value = desired;
      dispatchControlEvents(element);
      return true;
    }
    if (action === "SET_INPUT_VALUE" && element instanceof HTMLInputElement) {
      const desired = String((mapping.desiredValue || [])[0] ?? "");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(element, desired); else element.value = desired;
      dispatchControlEvents(element);
      element.blur();
      return true;
    }
    if (action === "ACTIVATE_IF_NEEDED") {
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      element.click();
      return true;
    }
    return false;
  }

  function observeDesired(element, mapping) {
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
    const all = (selector) => queryAllDeep(selector, scope);
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
      return unique(controls.filter((element) => normalizedText(controlLabel(element)) === normalizedText(value)));
    }
    return isContainer ? null : null;
  }

  function buildContainerLocators(element, label) {
    const locators = [];
    if (isIdealoAdapter()) locators.push({ type: "IDEALO_FILTER_GROUP", value: label });
    if (stableDomId(element.id)) locators.push({ type: "ID", value: element.id });
    if (element.getAttribute("aria-label")) locators.push({ type: "GROUP_ARIA_LABEL", value: element.getAttribute("aria-label") });
    if (element instanceof HTMLFieldSetElement && element.querySelector(":scope > legend")) locators.push({ type: "FIELDSET_LEGEND", value: label });
    locators.push({ type: "HEADING_TEXT", value: label });
    return dedupeLocators(locators);
  }

  function buildOptionLocators(element, label) {
    const locators = [];
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
    locators.push({ type: "LABEL_TEXT", value: label });
    return dedupeLocators(locators);
  }

  function findFilterGroup(element) {
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
    while (current && depth < 7) {
      if (current.matches('fieldset,[role="group"],section,aside,nav,form,div')) {
        const label = groupLabel(current);
        if (label) candidates.push({ element: current, label, depth });
      }
      current = current.parentElement;
      depth += 1;
    }
    return candidates.sort((a, b) => a.depth - b.depth)[0] || null;
  }

  function groupLabel(element) {
    if (element instanceof HTMLFieldSetElement) {
      const legend = element.querySelector(":scope > legend");
      if (legend && conciseLabel(legend.textContent)) return conciseLabel(legend.textContent);
    }
    const aria = element.getAttribute("aria-label");
    if (conciseLabel(aria)) return conciseLabel(aria);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (conciseLabel(text)) return conciseLabel(text);
    }
    const heading = element.querySelector(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > [role=heading]");
    return conciseLabel(heading?.textContent);
  }

  function controlLabel(element) {
    if (isIdealoAdapter()) {
      const label = idealoOptionLabel(element);
      if (label) return label;
    }
    const aria = element.getAttribute("aria-label");
    if (conciseLabel(aria)) return conciseLabel(aria);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (conciseLabel(text)) return conciseLabel(text);
    }
    if (element.id) {
      const label = queryAllDeep("label").find((item) => item.htmlFor === element.id);
      if (label && conciseLabel(label.textContent)) return conciseLabel(label.textContent);
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel && conciseLabel(wrappingLabel.textContent)) return conciseLabel(wrappingLabel.textContent);
    if (element instanceof HTMLSelectElement) return conciseLabel(element.name || element.id);
    return conciseLabel(element.textContent || element.getAttribute("value") || element.getAttribute("name"));
  }

  function inferContextLabel() {
    const heading = document.querySelector("main h1, h1, main h2");
    return conciseLabel(heading?.textContent) || document.title.split(/[|–—-]/)[0].trim().slice(0, 120);
  }

  function activeStateSignature() {
    const values = [];
    for (const element of queryAllDeep('input:checked, input[type="number"], select, [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]')) {
      const value = element instanceof HTMLSelectElement
        ? [...element.selectedOptions].map((option) => option.value).join("|")
        : element.value || element.getAttribute("value") || element.textContent || "";
      values.push(`${controlLabel(element) || element.tagName}:${value}`.slice(0, 200));
    }
    return JSON.stringify(values.sort());
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
    return /password|login|email|phone|card|cc-|cvc|address|checkout|payment|account|profile/i.test(haystack);
  }

  function isDisabled(element) {
    return Boolean(element.disabled || element.getAttribute("aria-disabled") === "true");
  }

  function appearsVirtualized(group) {
    return Boolean(group.querySelector('[aria-setsize], [data-virtualized="true"]')) || group.scrollHeight > group.clientHeight * 4;
  }

  function dispatchControlEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function waitFor(predicate, timeoutMs) {
    return new Promise((resolve) => {
      if (predicate()) return resolve(true);
      const started = Date.now();
      let timer;
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      timer = setInterval(check, 75);
      function check() {
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

  async function progress(message, criterion, results, status) {
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
  }

  function routeBindingMatches(binding) {
    if (binding.type === "URL_PATH") {
      const expected = binding.verificationTexts || [];
      const actual = idealoActiveTags().map(normalizedText);
      if (expected.length) return expected.every((value) => actual.includes(normalizedText(value)));
      return location.pathname === binding.pathname;
    }
    const actual = new URL(location.href).searchParams.getAll(binding.parameter).map(String).sort();
    const desired = (binding.values || []).map(String).sort();
    return actual.length === desired.length && actual.every((value, index) => value === desired[index]);
  }

  function overallStatus(results) {
    const successful = results.filter((result) => SUCCESS.has(result.status)).length;
    if (successful === results.length) return "COMPLETE";
    if (successful === 0) return results.some((result) => result.status === "CANCELLED") ? "CANCELLED" : "FAILED";
    return "PARTIAL";
  }

  function criterionResult(criterion, status, message) {
    return {
      criterionId: criterion.criterionId,
      semanticType: criterion.semanticType,
      desiredValue: criterion.desiredValue,
      status,
      message
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
    return text && text.length <= 160 ? text : "";
  }

  function normalizedText(value) {
    return String(value || "").replace(/\(\s*\d+[\d,.]*\s*\)\s*$/, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
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
