# FilterVault post-QA implementation report

Date: 2026-08-14  
Release candidate: 0.2.0  
Implementation plan: `docs/POST_QA_IMPLEMENTATION_PLAN.md`

## Result

The post-QA correctness work is implemented. FilterVault now uses hostname-aware route schemas, recognizes supported path facets, blocks context-only saves, records capture coverage, migrates version 3 data, distinguishes route-only replay from visible verification, supports ordered interaction plans, retries unstable capture, uses plan-aware replay deadlines, and provides accessible Library actions without browser prompts.

The implementation intentionally does not add generic dual-slider automation or claim universal webshop support.

## Implemented changes

### Route semantics

- Added a declarative route-schema registry for all 12 tested storefronts.
- Added host-scoped handling for Amazon `s`, Zalando `dir`, Home24 `shop`, OTTO localized keys, and Autohero indexed brand keys.
- Added semantic path parsing for Kleinanzeigen, rebuy, Zalando, and Idealo route state.
- Added alias coalescing for MediaMarkt and Shop Apotheke search parameters.
- Added atomic grouping for Zalando `order` and `dir`.
- Retained only recognized state in sanitized capture URLs; tracking, request metadata, and pagination are removed.
- Kept ambiguous short parameters ignored on unknown hosts.

### Capture and save

- Added a persisted coverage report with captured, meaningful, unsupported, unresolved, and ignored-default counts.
- Save now requires a filter or non-default presentation setting. Search/page context alone does not qualify.
- Active omissions force Limited support and are shown before Save.
- Native selects in their default state are ignored.
- Capture takes bounded stability samples and returns `CAPTURE_UNSTABLE` only after retries.
- Unsupported pages can copy their sanitized route as an explicitly unverified fallback.

### Replay and verification

- Replay uses the sanitized route snapshot plus versioned criteria.
- Route equality is no longer treated as full storefront verification.
- Per-criterion results now distinguish visible verification from `ROUTE_ONLY` evidence.
- An all-route-only replay completes with warnings and degrades health rather than claiming Verified success.
- Added bounded ordered actions for opening groups, scrolling, activation, value setting, commit/apply, route settling, and verification.
- Added plan-aware replay budgets capped at 90 seconds and cancellation checks at criterion/action boundaries.

### Persistence and validation

- Bumped saved-state schema from 3 to 4 and DOM mapping version from 1 to 2.
- Added non-destructive v3-to-v4 migration for storage and imports.
- Migrated states retain their criteria and are marked with unknown health; missing criteria are never invented.
- Extended validation for action locator chains, verification texts, atomic groups, and the coverage report.
- Future schema versions remain rejected without modifying stored data.

### Popup and Library

- Added a capture coverage summary and concrete disabled-Save reason.
- Replaced `prompt()`/`confirm()` flows with keyboard-accessible dialogs.
- Added accessible Rename, Duplicate, Export, Delete, and Delete confirmation flows.
- Added coverage to saved-state details.
- Replay rows expose criterion-level evidence and warning state.

## Storefront contract results

All supplied routes pass offline capture, sanitation, replay construction, and save-eligibility contracts.

| Storefront | Implemented contract | Live rendered evidence observed |
|---|---|---|
| Amazon.de | Search context + host-specific sort; tracking/pagination removed | Search phrase and “Price: Low to high” were visible. |
| Kleinanzeigen | Brand and RAM parsed from path | Apple and 16 GB RAM appeared as active facet state. |
| Idealo | Encoded path state + sort; verified DOM tag adapter | Samsung, 12 GB, 8 GB, and lowest-price sort were visible and selected. |
| rebuy | Category/brand/model path + max price + sort | Samsung Galaxy S20 route, €500 maximum, and ascending result presentation were visible; the native sort control exposed a conflicting default label, so semantic replay remains route-only unless the visible result summary confirms it. |
| MediaMarkt | Search aliases coalesced + sort | Price ascending was visibly selected. |
| Decathlon | Search + brand facets + sort | ADIDAS-only results and ascending prices were visible. |
| Cyberport | Search + sort; sliders remain unsupported | Search results were visibly ascending; range sliders remain outside generic support. |
| Zalando | Brand path + atomic order/direction | Both Nike brands were reflected in the title/results and prices began in ascending order. |
| Shop Apotheke | Search aliases coalesced + category + sort | Price ascending and category filtering UI were visible. |
| OTTO | RAM + category + localized sort | 16 GB RAM and Laptops were visibly active; route retained localized sort state. |
| Autohero | Indexed brand + sort; tracking removed | BMW and “Niedrigster Preis” were visibly active. |
| Home24 | Seller + sort | Seller filter count and “Niedrigster Preis” were visibly active. |

Decathlon, Cyberport, Zalando, and OTTO initially returned blank documents in the shared browser tab; one clean-tab retry of each exact URL rendered successfully. This is recorded as an environment/navigation observation, not an extension defect.

## Automated verification

- Extension manifest/runtime syntax check: passed.
- Unit and contract suite: 38 tests passed.
- Twelve-store route suite: 12/12 passed.
- Negative route cases: ambiguous short parameters and context-only save both passed.
- Migration tests: v3 state and v3 export migration passed.
- Packaged Chromium smoke test: passed.
- Popup-level flows tested in the packaged build: Save, Details, Rename, Duplicate, Delete, and confirmation.
- Replay smoke result: supported filters visibly verified; route-only search context correctly produced `COMPLETE_WITH_WARNINGS`.
- Idealo fixture: three criteria captured with verified adapter evidence; default price bounds were not reported as active filters.

## Release-readiness boundary

The code and packaged offline browser flow are release-candidate ready. All 12 exact storefront states were also inspected live in the requested in-app browser.

One final release gate remains environment-specific: run the 0.2.0 unpacked extension itself in the user's Chrome profile against all 12 live routes after reloading it from this repository. The in-app browser used for live inspection cannot load the user's unpacked Chrome extension, so the two verified layers in this run were:

1. exact packaged extension against deterministic browser fixtures; and
2. exact live routes against the real storefront rendering.

This boundary should not be represented as a 12/12 live extension replay certification until that Chrome-profile run is completed.

## Known limitations retained by design

- Dual-handle sliders are unsupported without a verified route or storefront adapter.
- Consent, login, CAPTCHA, checkout, account, payment, and sensitive fields are never automated.
- Custom/virtualized controls are reported when they cannot be mapped uniquely.
- Some URL-backed criteria will remain route-only when the storefront exposes no stable active token or selected control.
- Storefront redesigns can invalidate host schemas or DOM mappings; criterion-level diagnostics and health state are intended to make that degradation visible.

