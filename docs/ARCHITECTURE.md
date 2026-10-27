# FilterVault architecture

## Design objective

FilterVault captures meaningful shopping state, stores it locally, replays only approved actions, and verifies the result. It must prefer an honest partial result over an unsafe or unverifiable success claim.

## Runtime flow

```text
current tab
  -> hostname route schema
  -> route and DOM capture
  -> normalization and coverage calculation
  -> validated local configuration
  -> replay route and ordered action plan
  -> criterion-level verification
  -> user-visible result
```

## Modules

### `src/adapters`

Contains declarative retailer route schemas. A schema owns host-specific query keys, path facets, aliases, atomic groups, default values, and volatile values. Host-specific knowledge must not be added to the generic parser.

Parameter descriptors may also declare accessible group labels. The worker passes those data-only hints into capture so a native DOM group and its route parameter normalize to the same semantic criterion. MediaMarkt uses this for seller and refurbished state. The generic content engine does not hardcode that retailer's CSS classes or group IDs.

Conventional structured query widgets are parsed independently of the host: refinement lists, hierarchical menus, menus, rating menus, ranges, and numeric menus. The attribute provides semantic identity, array indices are removed only from the canonical grouping key, and physical parameter names remain unchanged. Nested sensitive field names are excluded before capture. Cyberport version 2 supplies the German rating display text; its search and sort aliases remain supported.

### `src/shared`

Contains environment-independent rules used by capture, storage, and replay:

- `route.js` classifies and sanitizes route state.
- `planner.js` produces bounded ordered replay plans.
- `validator.js` rejects malformed, ambiguous, or executable saved data.
- `coverage.js` derives honest support and omission summaries.
- `constants.js` owns persisted versions and shared limits.
- `replay-policy.js` owns context compatibility, binding applicability, mapping health, and worker recovery decisions.

Keep this layer free of browser globals so it remains directly testable.

### `src/content`

`executor.js` reads visible page state, resolves supported controls, executes approved actions, waits for bounded settling, and verifies semantic results. It must not execute saved script text or guess between ambiguous controls.

Generic groups include labelled lists, fieldsets, and native details elements with summaries. Capture verifies that its container and option locator chains uniquely resolve the observed controls. Explicit result-count suffixes and hidden count decorations do not become option identity. Search and page header/footer controls are excluded from filter capture.

Full-range defaults require explicit matching bounds and unrestricted values. Numeric pairs need minimum/maximum labels. Slider pairs need a shared parent and identifiable handle labels or explicit lower/upper markers. This includes handles in a nested fieldset and degenerate ARIA ranges with one available value. Independent numeric fields and sliders, missing bounds, contradictory values, and changed ranges are not silently ignored. Explicit readonly relevance selectors without active sort parameters are defaults; other comboboxes retain omission warnings.

New captures use mapping version 4. `NATIVE_RANGE_ENDPOINT` locates an identifiable ordered native pair within a uniquely resolved group. Capture stores stable endpoint identity rather than a value-dependent accessible label. Numeric input actions can restore native handles and use a scoped, allowlisted Apply action. Every action and final value is verified; changed pair structure fails without guessing. Mapping versions 1, 2, and 3 remain accepted, including version 3 labelled-list and summary locators. Existing saved criteria are preserved.

Route verification may read the visible associated label of a checked native checkbox or radio styled out of view. An unchecked label cannot verify selection. This does not authorize clicks on hidden inputs, and page header/footer and sensitive controls remain excluded. Replay expands closed native accordion ancestors only when needed and resolves controls again before each action.

### `src/background`

The service worker coordinates injection, navigation, optional origin access, replay checkpoints, and storage. `storage.js` owns migration, normalization, limits, and corruption isolation.

Replay starts are serialized per tab. The worker targets the document ID returned by Chrome script injection and validates content messages against the checkpoint's replay, tab, frame, document, origin, and criterion identities.

Checkpoint version 3 records a single replay deadline and the active document. A restarted worker queries that document's executor and reconnects to its running or completed result instead of replaying its action plan. Missing executors and document replacement produce an interrupted result. Navigation and executor deadlines are checked when the worker awakens or the UI polls; page-side waits enforce the same execution deadline independently.

Context confirmation is tied to the inspected document and a field-order-independent context signature. The page executor also checks material context before each action and during waits. Cancellation leaves the page in its current state and prevents subsequent steps, including pending commit actions.

Import validation constrains both captured and constructed replay URLs to the saved origin and excludes URL credentials. DOM mapping versions, verification rules, locator chains, step fields, timeouts, and total action counts are validated before execution. Existing saved-state schema versions 3 and 4 remain supported; the checkpoint version is independent of saved-state versioning.

### `src/popup`

The popup presents capture coverage, save eligibility, the local library, replay diagnostics, and import or export actions. It must expose omissions before saving and must not present route-only completion as fully verified.

## Persisted data rules

- User data stays in `chrome.storage.local`.
- Temporary replay checkpoints stay in `chrome.storage.session`.
- Stored actions are data-only and validator-approved.
- Route snapshots exclude credentials, session values, tracking data, fragments, and pagination.
- Unknown future schema versions fail without changing stored data.
- Migrations preserve known state and never invent missing criteria.

## Adding retailer support

Prefer the smallest reliable layer:

1. Use a route schema when stable URL semantics are sufficient.
2. Add visible token verification when a stable chip, label, or selected state is available.
3. Add ordered DOM actions only when route replay cannot complete the workflow.
4. Leave unstable dual sliders, opaque widgets, consent flows, login, and checkout unsupported.

A retailer is Verified only after packaged live capture and replay confirm every claimed criterion. Route-only support must remain visibly weaker.

## Architectural boundaries

- The route registry is the only source of host-specific URL semantics.
- The validator is the trust boundary for imported or persisted plans.
- The planner describes intent; the executor performs browser interaction.
- The coverage model controls user-facing support labels.
- Tests, not README claims, define supported behavior.
