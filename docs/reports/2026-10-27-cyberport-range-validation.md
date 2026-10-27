# Cyberport and range-control validation

Validation date: 27 October 2026

The reported MediaMarkt default-range warnings are corrected, and the Cyberport example now captures manufacturer, power supply, and rating. Conventional structured filter URLs and identifiable paired native range inputs have reusable support. The complete local release gate passes. Full live Cyberport replay remains unconfirmed because its server returned HTTP 403 to the isolated automation profile.

## Findings and implementation

The earlier MediaMarkt fixture placed numeric fields and slider handles in one group. The observed page puts the handles in their own labelled fieldset. That separation prevented the previous default proof from recognizing unrestricted handles. The fixture now reproduces the nested structure. Default detection requires matching explicit bounds, selected endpoints, a shared handle parent, and identifiable numeric or endpoint labels or explicit lower/upper markers. Independently labelled numeric fields and sliders remain separate controls.

Cyberport uses conventional structured query keys. The previous generic heuristic captured refinement lists under physical key names, while rating-menu state was dropped during sanitation. Structured descriptors now cover refinement lists, hierarchical menus, menus, ratings, ranges, and numeric menus on registered and unregistered shops. Indexed choices coalesce semantically without losing their physical URL parameters. Cyberport schema version 2 adds German rating display and verification text. Existing search and sorting contracts remain tested. Sensitive nested parameter names are excluded.

The Cyberport default relevance selector is readonly with autocomplete explicitly disabled. It is ignored only when its name identifies sorting, its value is an explicit default relevance label, and there is no active sort parameter. Genuine autocomplete controls and changed custom widgets retain omission warnings.

The Cyberport native checkbox and radio inputs are styled out of view while their associated labels are visible. Route verification can read the label only when the associated native control is actually checked. Unchecked labels do not verify selection. This adds read-only evidence and does not permit clicks on hidden controls.

Identifiable native range pairs now have declarative endpoint locators and numeric replay actions. Their values are captured independently of changing accessible value labels. A scoped allowlisted Apply action is included when present. Changed pair structure fails safely, final values are verified, and replaying already-correct values performs no additional commits. This does not establish support for arbitrary custom graphical sliders or every single-handle widget.

New captures use mapping version 4. Versions 1, 2, and 3 remain valid with their existing locator vocabularies. A version 4 endpoint locator cannot be imported under an older mapping version. Saved-state schema version 4 and version 3 migration remain unchanged. Production permissions remain unchanged.

## Validation

Command: `npm run test:release`

| Check | Result |
|---|---|
| Static extension and support evidence checks | Passed |
| Deterministic tests | 110 passed, zero failures or skips |
| Shared-core line coverage | 99.56 percent |
| Shared-core branch coverage | 91.62 percent |
| Shared-core function coverage | 100 percent |
| Packaged Chromium suite | Passed |
| Patch whitespace checks | Passed |

Chromium coverage includes existing Idealo, Decathlon, MediaMarkt, generic shop, cancellation, document replacement, and worker recovery cases. New regressions verify Cyberport capture, persisted Save, reset, route restoration, independently selected labels, active-widget warnings, native paired-range Apply, idempotency, unrelated-slider preservation, and changed-structure failure.

The MediaMarkt fixture shows two captured settings and no unsupported or unresolved controls. The Cyberport fixture shows three captured settings and no unsupported or unresolved controls. These are deterministic fixture results, not claims of full live acceptance.

## Live evidence and manual check

Live DOM inspection confirmed both reported layouts. The [isolated Cyberport acceptance attempt](../acceptance/records/2026-10-27T14-59-51-540Z.json) received HTTP 403 during navigation. No capture or replay pass is claimed for that attempt, and no access challenge was bypassed. The generated support matrix records the block.

Reload the unpacked extension at `chrome://extensions`, refresh each listing, and reopen the popup. Recreate the supplied Cyberport state and confirm ASUS, Akku, and 5 Sterne are listed. Save it, clear those three filters, replay, and independently inspect all three selected controls. Existing saved Cyberport configurations do not gain a previously omitted rating automatically; save a new configuration from the filtered page.

Support for every filter on every shop cannot be inferred from these cases. Unknown custom interactions continue to produce explicit warnings until their state and replay can be established reliably.
