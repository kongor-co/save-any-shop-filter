# OTTO filter validation

Validation date: 27 October 2026

The supplied configuration now captures four filters: colour with both grau and lila, maximum height 24cm, maximum depth 25cm, and seller OTTO. The packaged Chromium fixture completes capture, persisted Save, reset, and verified replay without omitted-control warnings. Full live acceptance remains unconfirmed because the isolated live browser received an empty HTTP 400 response before capture.

## Findings and implementation

The former OTTO schema did not recognize the supplied colour, seller, or centimetre-bound query keys. Generic DOM capture then grouped checked removal-chip inputs under the broad selected-filter heading. Duplicate seller and colour controls, a disabled current-category checkbox, and unnamed interval controls produced extra warnings.

OTTO schema version 2 adds explicit colour, seller, and maximum centimetre dimensions while retaining the earlier RAM, category, and sorting contracts. Comma-separated colours become separate semantic values. Descriptor-declared comma and tilde syntax is retained during URL sanitation and replay construction. Free-text values retain normal escaping, and these retailer keys remain ignored on unknown hosts.

Descriptors compile optional read-only `controlEvidence` for query bindings. It includes the original input name, exact values, matching removal-chip labels, and optional maximum-interval metadata. Imported evidence is shape-checked and bounded; it contains no selectors or executable actions. Confirmation requires the original checked input state and exactly one matching visible removal chip for every value. A matching chip alone cannot override an unchecked original control, and a 240 value cannot confirm saved 24 merely because a stale label still shows 24.

Capture omits represented duplicate controls instead of storing them as one large clickable filter. Recognized native interval handles and numeric fields in open shadow roots are redundant only when they agree with the saved route and checked-state evidence. A known inactive interval must have explicit full bounds and empty numeric fields. Changed ranges, extra checked values, and unrelated sliders remain warnings. Unknown removal chips stay unresolved and cannot become DOM replay targets.

A disabled category checkbox whose headline slot matches the listing heading is page context. Existing saved-state and mapping versions remain unchanged. Bindings without the new optional evidence remain valid, and production permissions are unchanged.

## Verification

Deterministic route tests cover all four criteria, colour splitting, exact query round trips, literal separators, free-text escaping, unknown-host isolation, inactive interval hints, and compatibility with legacy OTTO query contracts. Import tests accept the bounded evidence form and reject malformed values, inconsistent labels, unknown fields, invalid range endpoints, and executable text.

The packaged fixture reproduces repeated native checkboxes, hidden interval radio state, custom removal chips, open shadow-root numeric inputs, a disabled category checkbox, and paired native handles. Chromium verifies capture, Save, reset, replay, idempotency, and zero filter clicks. Negative cases cover mismatching original state, incorrect interval values, missing chips, changed handles, extra checked values, unrecognized removal chips, and unrelated sliders.

The release gate is `npm run test:release`, including static checks, 123 deterministic tests, coverage thresholds, and the existing browser regressions for Idealo, Decathlon, MediaMarkt, Cyberport, Shop Apotheke, Home24, generic shops, and replay lifecycle behavior.

The final release gate passed with zero skipped or failed tests. Shared-core coverage is 99.60 percent of lines, 92.33 percent of branches, and 100 percent of functions. Every packaged browser regression, static support-evidence check, and patch whitespace check passed.

## Live boundary

In-app browser inspection initially encountered OTTO's filter-loading error page. Loading the base listing and revisiting the supplied route exposed the working controls and allowed their DOM structure, native states, interval bounds, and chip labels to be inspected.

The [isolated acceptance attempt](../acceptance/records/2026-10-27T20-53-40-511Z.json) received HTTP 400 with an empty document and stopped before capture. It is not a live replay pass. It also precedes the final general removal-chip safeguard, so its source fingerprint is historical evidence rather than certification of the final runtime. The support matrix retains that limitation.

## Manual retest

Reload FilterVault at `chrome://extensions`, refresh the OTTO listing, and save a new configuration. Confirm colour, maximum height, maximum depth, and seller are listed separately with both colours preserved. Clear those selections, replay the new configuration, and inspect the shop's selected filters. Existing saved configurations do not automatically gain the previously omitted route state or lose the old combined DOM criterion.
