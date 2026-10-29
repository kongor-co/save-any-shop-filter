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

New captures use mapping version 5. `NATIVE_RANGE_ENDPOINT` locates an identifiable ordered native pair within a uniquely resolved group. Capture stores stable endpoint identity rather than a value-dependent accessible label. Numeric input actions can restore native handles and use a scoped, allowlisted Apply action. Every action and final value is verified; changed pair structure fails without guessing. Mapping versions 1 through 4 remain accepted with their existing locator vocabularies. Existing saved criteria are preserved.

`COMBOBOX_LABEL` and `DROPDOWN_OPTION` resolve button-based dropdowns through their current `aria-controls` relationship, including listboxes rendered elsewhere in the document. Generated popup and option IDs are not persisted. Active URL descriptors provide field names for matching and semantic normalization. Capture opens only matching active menus, inspects selected options, and restores the original menu and More filters surface. Bounded expansion is limited to explicit filter-reveal labels. Inert or readonly checkbox decorations inside selected options are not separate controls. Numeric result suffixes are reconciled with physical URL values rather than becoming saved values.

Shop Apotheke version 2 provides category label normalization and pack-size field metadata. Raw category paths and every indexed pack-size parameter remain in URL bindings. Context detection uses actual search query keys rather than treating filter keys as search queries. Pagination navigation and a current-page chip matching the listing heading do not become active filters. Inactive button dropdowns require an empty backing field and no active selection; unknown active dropdowns and actual autocomplete inputs retain warnings.

Home24 version 2 recognizes dotted dimension bounds and ratings, and separates pipe-delimited colour choices while preserving their physical URL encoding. Descriptor-generated display and verification texts stay in the route registry. Generic applied-chip verification reads only one visible region explicitly labelled as applied or selected filters and matches complete text on individual removal buttons. It never clicks those buttons. Partial strings, product descriptions, missing choices, and duplicate evidence regions cannot confirm the criterion.

Selected group-summary buttons are excluded from active control capture only when descriptor hints account for the selected count and every represented value is confirmed by an applied chip. Otherwise a summary stays unresolved and cannot become a saved Boolean filter. Native sort evidence requires a visible select identified as sorting and its actual selected value matching the saved route value. Existing saved-state and mapping versions are unchanged by these read-only evidence rules.

OTTO version 2 descriptors compile optional query `controlEvidence`: an input name, exact input values, matching removal-chip labels, and optional maximum-range metadata. The validator bounds these read-only fields and rejects selectors, executable text, invalid endpoints, and inconsistent arrays. They authorize no new actions. Evidence requires matching original checked inputs and exactly one visible custom-component chip for each value. Missing originals, unchecked duplicates, missing chips, and conflicting values cannot verify the criterion.

Capture uses this evidence to omit duplicated native representations instead of creating ambiguous DOM mappings. Known interval fields are resolved through composed ancestors across open shadow roots. Active interval handles and numeric fields must agree with both the saved maximum and the proven checked state. Inactive named intervals need complete explicit bounds and empty numeric fields. Unrelated sliders and draft changes remain reported. A disabled current-category checkbox with a headline slot matching the page heading is page context. Saved-state and mapping versions remain unchanged, and prior bindings without control evidence remain valid.

A selected removal chip without a recognized route representation remains unresolved. It cannot fall through to generic Boolean capture and become a replay action that removes the selected value.

Route serialization preserves literal delimiters only for descriptor-declared OTTO keys and values. It leaves free-text query values encoded and preserves origin, credentials for rejection by the existing validator, and the sanitation policy. Other storefronts keep their existing serialization behavior.

Route verification may read the visible associated label of a checked native checkbox or radio styled out of view. An unchecked label cannot verify selection. This does not authorize clicks on hidden inputs, and page header/footer and sensitive controls remain excluded. Replay expands closed native accordion ancestors only when needed and resolves controls again before each action.

### `src/background`

The service worker coordinates injection, navigation, optional origin access, replay checkpoints, and storage. `storage.js` owns migration, normalization, limits, and corruption isolation.

Replay starts are serialized per tab. The worker targets the document ID returned by Chrome script injection and validates content messages against the checkpoint's replay, tab, frame, document, origin, and criterion identities.

Checkpoint version 3 records a single replay deadline and the active document. A restarted worker queries that document's executor and reconnects to its running or completed result instead of replaying its action plan. Missing executors and document replacement produce an interrupted result. Navigation and executor deadlines are checked when the worker awakens or the UI polls; page-side waits enforce the same execution deadline independently.

Context confirmation is tied to the inspected document and a field-order-independent context signature. The page executor also checks material context before each action and during waits. Cancellation leaves the page in its current state and prevents subsequent steps, including pending commit actions.

Import validation constrains both captured and constructed replay URLs to the saved origin and excludes URL credentials. DOM mapping versions, verification rules, locator chains, step fields, timeouts, and total action counts are validated before execution. Existing saved-state schema versions 3 and 4 remain supported; the checkpoint version is independent of saved-state versioning.

### `src/popup`

The popup presents capture coverage, save eligibility, the local library, replay diagnostics, and import or export actions. It must expose omissions before saving and must not present route-only completion as fully verified.

Library visibility defaults to the active tab's HTTP or HTTPS hostname, updated on navigation in that tab. Matching ignores case, a trailing DNS dot, and the conventional `www` prefix. It preserves other subdomains and country domains, without substring or registrable-domain guesses. The shop scope intersects text search and determines the displayed count and empty-state copy. A popup-local All shops selection is available; no preference or saved-state migration is required. Missing or restricted URLs fall back to all shops. Capture failure does not disable the Library. The scope changes presentation only: saved data, full-library export, permissions, saved-origin validation, and replay orchestration retain their existing behavior.

## Persisted data rules

Saved-filter updates use a fresh capture through the existing capture pipeline. The worker checks the exact origin, listing path, search query, context criteria, and context compatibility before replacement. Only registered filter-bearing path patterns are normalized; numeric category identifiers and unknown paths remain exact. A canonical SHA-256 record revision and capture token reject stale confirmations. Replacement preserves the ID, name, and creation date, and clears previous replay verification.

One previous capture is stored separately at `fv:update-undo:<stateId>` with its own `formatVersion: 1`. The saved-state schema remains version 4 and mapping version remains 5. The replacement and backup use one storage write. Undo preserves a later rename, restores the previous capture, clears verification, and consumes the backup. Deletion removes the backup. Export, Duplicate, and Import operate on saved states without carrying this history.

Updates, Undo, Rename, Delete, replay preparation, and replay metadata writes coordinate per saved record. Update and Undo reject records with an active or awaiting replay in any tab. Replay releases the record lock before navigation so fast completion cannot deadlock. Checkpoints carry a functional content revision so late results cannot verify replacement criteria. Preview and Cancel do not write an update; existing read-time schema migration still applies.

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
