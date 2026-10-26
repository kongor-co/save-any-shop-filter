# FilterVault post-QA implementation plan

Date: 2026-08-14  
Status: Proposed  
Inputs: cross-shop QA report, live route cases, prior implementation review, and the current source tree

## 1. Outcome and release standard

The next release should replace broad heuristic claims with evidence-based support. A saved configuration is successful only when FilterVault can:

1. identify meaningful active state;
2. represent every claimed criterion without guessing;
3. replay it with the required interaction and commit behavior; and
4. verify that the storefront accepted it.

The release must not claim that a page is supported merely because the URL contains a search term or because navigation reached the intended URL. Partial coverage must be visible to the user before saving.

## 2. Decisions that reconcile the QA findings

These decisions supersede proposals that would broaden the generic route parser without site context.

| Decision | Rationale |
|---|---|
| Introduce hostname-aware route schemas. | Short and localized parameters such as Amazon `s`, Zalando `dir`, Home24 `shop`, and OTTO `sortiertnach` are meaningful only in their storefront context. A global regex would create false positives. |
| Treat parsed path facets as first-class criteria. | Kleinanzeigen, Zalando, rebuy, and Idealo encode important state in the path. Ignoring it causes false “nothing to save” results. |
| Keep a sanitized atomic route snapshot as replay evidence, not as a generic filter criterion. | It preserves interdependent path/query state while avoiding the unsafe claim that every arbitrary pathname is a filter. Only schema-recognized path segments make a page save-eligible. |
| Require meaningful state for saving. | At least one verified filter facet or non-default presentation setting is required. A context-only search term is useful replay context, but is not sufficient to claim that filters were saved. |
| Coalesce aliases and paired parameters. | `q`/`query`, `query`/`queryInitial`, and Zalando `order`/`dir` should be represented once and replayed atomically where required. |
| Separate route transport from semantic verification. | URL equality proves navigation, not that the shop accepted or rendered the requested state. |
| Keep unknown dual-range sliders unsupported. | Generic slider automation is too fragile. A slider becomes supported only through a verified URL mapping or a storefront adapter. |
| Prefer small storefront schemas over twelve large DOM adapters. | Stable URL semantics should carry most coverage. DOM automation is added only where a shop requires opening, selecting, submitting, or committing controls. |

## 3. Target architecture

Add a registry between generic route handling and storefront-specific DOM execution:

```text
capture URL/DOM
    -> match hostname schema
    -> normalize aliases and path facets
    -> calculate coverage
    -> save versioned criteria + sanitized route snapshot
    -> build replay route
    -> execute required interaction plan
    -> verify route and visible storefront state
```

Each route schema should expose a small declarative contract:

- hostname and route matching;
- recognized context, filter, and presentation parameters;
- aliases and atomic parameter groups;
- path parser and, only when needed, path builder;
- volatile/sensitive parameters to remove;
- default values that should not be captured;
- visible verification signals;
- optional adapter ID and version for DOM work.

The generic fallback remains conservative: descriptive long-form keys may be recognized, but ambiguous one-letter, localized, and merchant-specific keys are accepted only by a matching schema.

## 4. Delivery plan

### Phase 0 — Preserve the evidence and create a failing baseline (P0, S)

1. Copy the 12 live route cases into a version-controlled test fixture.
2. Convert every case into a contract test for capture, cleanup, save eligibility, and replay URL construction.
3. Record current failures as test expectations or explicitly skipped tests with defect IDs; do not weaken expected behavior to match the implementation.
4. Add privacy assertions proving that tracking, session, pagination, and sponsored-placement parameters are removed.

Acceptance criteria:

- All 12 cases execute deterministically without internet access.
- Each case identifies expected captured, dropped, coalesced, and unsupported state.
- The baseline clearly fails on the known P0 gaps before implementation.

### Phase 1 — Hostname-aware route schema foundation (P0, M)

1. Add a route-schema registry under `src/adapters/` and move Idealo route knowledge into it.
2. Update route capture and cleanup to accept the matched schema rather than relying only on global parameter patterns.
3. Add typed path criteria with stable semantic keys; never expose encoded path fragments as user-facing labels.
4. Preserve a sanitized full route snapshot for atomic replay, while rebuilding or mutating only schema-owned parts.
5. Support alias coalescing, multi-value parameters, and atomic parameter groups.
6. Store the route schema ID/version with the saved configuration.

Acceptance criteria:

- Amazon `s`, Zalando `dir`, Home24 `shop`, and OTTO localized keys are classified only on their respective hosts.
- Unknown hosts do not gain support for those ambiguous keys.
- Kleinanzeigen path facets make the provided filtered route save-eligible.
- Cleaning a URL never removes a schema-declared criterion and never retains declared volatile metadata.

### Phase 2 — Honest save eligibility and coverage accounting (P0, M)

Replace the current binary “criteria exist” rule with a capture coverage result:

- `activeDetected`: active state observed in the route or visible controls;
- `captured`: state represented and replayable;
- `unsupported`: active controls recognized but deliberately not supported;
- `unresolved`: state that appears active but could not be mapped safely;
- `defaultsIgnored`: controls omitted because they are in their default state.

Support levels should be computed consistently:

| Level | Meaning |
|---|---|
| Verified | Every detected meaningful criterion is captured and has semantic verification. |
| Compatible | Captured state is replayable, but verification is limited to route plus basic visible evidence. |
| Limited | Some active state is unsupported or unresolved; save is allowed only with a clear omission warning. |
| Unsupported | No meaningful replayable filter or non-default presentation state exists. |

Implementation rules:

1. Context such as a search phrase is retained but does not alone enable Save.
2. A schema-recognized path facet, query filter, or non-default sort may enable Save.
3. Default selects, unchecked controls, and inactive options are not captured.
4. Save performs a fresh capture and persists the exact coverage report shown to the user.
5. “Compatible” must not be displayed when only a search term was captured from a page containing active uncaptured filters.

Acceptance criteria:

- The original Idealo example can save supported chips and sort while explicitly listing the two price slider handles as unsupported.
- A plain search results page with no filters and default sort is not presented as “filters saved.”
- Any omitted active state is visible before save and remains visible in Library health details.

### Phase 3 — Storefront route coverage (P0, L)

Implement the minimum schema necessary for the tested routes. Do not add DOM automation unless the route cannot be applied or verified without it.

| Storefront | Required captured state | Special handling |
|---|---|---|
| Amazon | `k` context, `rh` facets when present, `s` sort | `s` is host-specific; remove ref/tracking/pagination. |
| Kleinanzeigen | category, keyword, brand, RAM path facets | Parse semantic path tokens; preserve their order when required. |
| Idealo | category/path filter tokens and `sortKey` | Refactor existing verified adapter; price dual slider remains unsupported until mapped. |
| rebuy | product/brand/model path facets, `priceMax`, `sortBy` | Path filters must be visible criteria, not implicit replay baggage. |
| MediaMarkt | search context and `sort` | Coalesce duplicate search aliases; remove campaign metadata. |
| Decathlon | `Ntt`, `facets`, `sort` | Preserve multi-value facet encoding. |
| Cyberport | `query`, `sortBy` | Report unsupported sliders separately. |
| Zalando | audience/category and brand path facets, `order` + `dir` | Treat sort pair atomically; add commit flow only if live behavior requires it. |
| Shop Apotheke | search context, `category`, `sortBy` | Coalesce `query`/`q`; override generic classification so `category` is a filter. |
| OTTO | `arbeitsspeicher`, `kategorien~sind`, `sortiertnach` | Localized keys are schema-owned filters/presentation. |
| Autohero | indexed brand filters and `sort` | Support repeated/indexed facet families without a broad global matcher. |
| Home24 | `shop`, `order` | `shop` is a filter on this host; add explicit commit workflow if route-only replay is rejected. |

Acceptance criteria:

- None of the 12 supplied routes is save-blocked when it contains the expected meaningful criteria.
- Every expected filter and sort is either captured or explicitly reported unsupported; silent dropping is zero.
- Duplicate aliases create one user-facing criterion and one deterministic replay value.

### Phase 4 — Layered semantic replay verification (P0, L)

Verification should have three layers:

1. **Route:** the final normalized route contains the intended schema-owned state.
2. **Control/token:** selected chips, checked inputs, active options, sort labels, or filter summaries visibly match.
3. **Result behavior:** only where stable and cheap, confirm a characteristic change such as sort direction from a small visible sample. Do not verify exact product counts or exact product identity.

Every criterion should end in one of: verified, route-only, not found, rejected by storefront, timed out, or unsupported. A replay is fully successful only when all required criteria are verified. Route-only results may complete with warnings when the schema explicitly allows that weaker guarantee.

Acceptance criteria:

- A route that navigates correctly but loses an active chip is not reported as success.
- Verification failures identify the affected criterion and evidence checked.
- The extension never claims an exact result count as proof of replay correctness.

### Phase 5 — Commit-aware interaction plans (P0, L)

Extend the action model from a single mutation plus verify step to ordered, bounded plans. Required primitives are:

- open or expand a filter group;
- focus or scroll a control into view;
- activate/deactivate an option;
- set a value;
- click Apply/Show results/Submit;
- wait for route and result region to settle;
- verify final semantic state.

Plans must remain data-only and validator-approved; executable script text is never stored. Implement these plans first for storefronts where Phase 3/4 testing proves that route replay alone is insufficient, expected initially to be Home24 and Zalando. Do not create speculative plans for all shops.

Acceptance criteria:

- Multi-step plans execute in order and stop at the first failed required step.
- Apply/submit controls are scoped to the active filter surface rather than matched globally.
- All actions are cancellable and recorded in replay diagnostics.

### Phase 6 — Capture stability and plan-aware time budgets (P1, M)

1. Replace the single “state changed during capture” failure with bounded settling: take two matching samples, retry twice when the page changes, then return a specific unstable-page result.
2. Use a quiet-window check for route and filter-summary mutations rather than a fixed sleep.
3. Replace the fixed 30-second replay budget with a bounded plan budget based on navigation, action count, and commit steps, subject to a hard maximum.
4. Check cancellation between every step and during long waits.

Acceptance criteria:

- Normal asynchronous filter updates do not cause immediate capture failure.
- A genuinely changing page terminates with a useful, recoverable message.
- Slow but progressing plans are not killed by an unrelated global timeout, and no plan can run indefinitely.

### Phase 7 — Generic DOM capture hardening (P1, M)

Improve generic coverage without weakening safety:

1. Derive labels from associated labels, legends, headings, accessible names, active chips, and nearby link text/href in a strict priority order.
2. Reject meaningless labels such as `[object Object]`, empty text, prices without context, and generic “Apply” labels.
3. Scope repeated labels to their filter group.
4. Add safe recognition for common checkbox links and custom-select wrappers.
5. Report virtualized lists, dual-handle sliders, and opaque custom widgets as unsupported unless an adapter owns them.

Acceptance criteria:

- Existing generic fixture behavior remains valid.
- Ambiguous or unlabeled controls are reported, not guessed.
- Locator uniqueness and group scoping are tested before a binding is saved.

### Phase 8 — Popup and Library UX (P1/P2, M)

1. Show captured, ignored-default, unsupported, and unresolved counts before Save.
2. Make the disabled Save reason concrete, for example “Only the search term was detected” or “2 active filters need an adapter.”
3. Replace `prompt()` and `confirm()` with accessible in-popup dialogs or menus for More, Rename, Delete, and Replace.
4. Show per-criterion replay results and retain a concise diagnostic that can be copied for bug reports.
5. Offer “copy sanitized current route” as a fallback utility on unsupported pages, clearly separate from a saved FilterVault configuration.

Acceptance criteria:

- All actions are keyboard accessible, focus is restored correctly, and destructive actions require an explicit in-popup confirmation.
- The support badge and save button cannot contradict the coverage summary.
- A user can tell exactly what will and will not be restored before saving.

### Phase 9 — Migration, regression, and release gate (P0, M)

The persisted model changes require an explicit compatibility strategy:

1. Bump the saved schema to version 4 and the mapping version to 2.
2. Add a v3-to-v4 migration that preserves old configurations, marks their verification health as unknown, and does not invent missing criteria.
3. Continue replaying safe v3 bindings; invite re-capture when a matching newer route schema is available.
4. Reject future/unknown schema versions with a non-destructive message.
5. Test export/import, storage upgrade, and rollback behavior.

Release gates:

- Unit tests: schema matching, route parsing/building, alias coalescing, cleanup, eligibility, plan validation, deadlines, and migration.
- Fixture integration tests: generic controls, Idealo, and one fixture for each non-trivial path or commit adapter.
- Offline popup/service-worker smoke tests: capture, save through the actual popup UI, library display, replay, verify, rename, replace, and delete.
- Live Chrome tests on all 12 supplied storefront routes using the exact packaged build, with screenshots and criterion-level diagnostics.
- Negative tests: unfiltered page, default sort, unknown host with short keys, stale route, consent wall, missing control, changed label, network delay, cancellation, and tab navigation during replay.
- Privacy tests: credentials, session IDs, tracking parameters, and free-form sensitive form values are neither persisted nor exported.

No release should be labeled broadly supported unless all P0 gates pass. A shop may ship as Limited when omissions are explicit; it may be labeled Verified only when its live capture and replay pass semantic verification.

## 5. Recommended milestone sequence

### Milestone A — Correctness foundation

Deliver Phases 0–2 plus schema migration scaffolding. This removes misleading saves and creates the contracts needed for all later shop work.

### Milestone B — Twelve-shop route coverage

Deliver Phase 3, then run the offline route suite. Route-only functionality may be merged incrementally per shop, but support labels remain Limited until Phase 4 verification exists.

### Milestone C — Verified replay

Deliver Phases 4–6 and only the proven necessary commit adapters. This is the first milestone suitable for a “supported storefront” claim.

### Milestone D — Product hardening

Deliver Phases 7–9, complete popup-level live regression, and publish the final support matrix with known limitations.

## 6. Explicit non-goals for this cycle

- Universal automation of arbitrary range sliders or canvas-based widgets.
- Circumventing login, consent, CAPTCHA, bot protection, or geographic restrictions.
- Saving free-form checkout, account, payment, address, or other sensitive values.
- Exact result-count or exact-product equality as a replay guarantee.
- A claim that every filter on every webshop is supported.
- Large retailer-specific DOM adapters when a stable route schema and visible verification are sufficient.

## 7. Definition of done

This plan is complete when:

1. the 12 supplied routes have passing capture/cleanup/replay contracts;
2. Kleinanzeigen and OTTO no longer fail to save their tested meaningful state;
3. Amazon, Zalando, Shop Apotheke, and Home24 no longer silently lose the identified parameters;
4. Idealo saves its supported state while honestly excluding the dual slider;
5. replay success requires storefront evidence, not merely URL equality;
6. every omission and failure is criterion-specific and user-visible;
7. v3 data upgrades safely without data loss; and
8. the exact packaged extension passes popup-level save/replay regression on the documented live cases.

