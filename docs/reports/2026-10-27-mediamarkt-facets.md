# MediaMarkt and generic facet validation

Validation date: 27 October 2026

MediaMarkt seller and refurbished selections now have route and DOM capture support. Reusable changes also cover labelled option lists, native accordion groups, explicit result-count labels, and proven default ranges on other storefronts. The complete local release gate passes. A live attempt demonstrated capture, persisted Save, and reset, but a consent dialog prevented full live replay acceptance.

## Implementation

The MediaMarkt route schema is version 2. It recognizes `marketplace` as seller state and `refurbished_new_array` as refurbished state. Both parameters survive URL sanitation and replay construction. Existing search aliases and sorting remain supported, and these retailer-specific parameters remain ignored on unknown hosts.

Route descriptors provide data-only accessible label hints for the seller and refurbished groups. Generic DOM capture uses those hints to merge the checkbox and URL representations into two semantic criteria. There are no MediaMarkt CSS classes or group IDs hardcoded into the generic locator engine.

Generic capture recognizes labelled native lists, accessible list groups, and details elements with summaries. It checks that container and option locators uniquely resolve the observed controls. Result-count suffixes such as a count of results or products do not become option identity. Native accordion ancestors are expanded only when replay needs to change a control, with cancellation and bounded waits preserved.

Header search, footer controls, explicit catch-all rating choices, and proven unrestricted minimum/maximum pairs are omitted from active filter state. Range defaults require matching bounds, endpoint labels, and unrestricted values. Independent numeric fields and changed ranges are preserved rather than hidden as defaults. Active graphical sliders remain explicitly unsupported; ordinary numeric bounds remain replayable through supported inputs.

New captures use mapping version 3 with labelled-list and summary-group locators. Older mapping versions remain accepted with their original locator vocabulary. Saved-state schema version 4 and version 3 migration remain unchanged. Hidden or disabled controls cannot receive state-changing replay actions.

## Browser regression results

The MediaMarkt fixture preserves the observed native list references, checkbox names, changing result counts, full-range price and discount controls, and catch-all rating state. The popup captures two meaningful settings with zero unsupported and zero unresolved controls, ignores nine default component controls, and enables Save.

Packaged Chromium verifies popup Save despite a count change between preview and Save, preservation of both URL parameters, state reset, route restoration, visible checkbox verification, idempotent replay, and DOM-only replay through closed accordions. A changed price range remains reported rather than being omitted as default.

A separate generic shop with no retailer mapping verifies labelled-list and summary-group capture, nested accordion expansion, count changes, numeric bound restoration, and idempotency. Negative cases keep duplicated groups unresolved, preserve independent numeric controls, and reject clicks on controls hidden after capture.

## Live evidence

The [first live attempt](../acceptance/records/2026-10-27T12-55-16-974Z.json) captured both expected criteria, saved them, and demonstrated that reset removed both. A read-only blocker observation raced with expected navigation; the runner was corrected and a deterministic regression added for that race.

The [follow-up attempt](../acceptance/records/2026-10-27T12-58-23-641Z.json) again completed capture, persisted Save, and reset. Replay visibly verified the seller criterion before a cookie-consent dialog was detected. The runner cancelled its replay and recorded `CONSENT_REQUIRED`, without answering the dialog or claiming a pass.

These attempts precede the final safety refinements and remain historical evidence. Their source fingerprints do not certify the final working tree; the generated support matrix marks them stale. Full live acceptance still requires a run that can finish after the user has handled consent.

## Release gate

Command: `npm run test:release`

| Check | Result |
|---|---|
| Static checks, valid UTF-8, and support evidence freshness | Passed |
| Deterministic tests | 105 passed, zero failures or skips |
| Shared-core line coverage | 99.29 percent |
| Shared-core branch coverage | 91.25 percent |
| Shared-core function coverage | 100 percent |
| Packaged Chromium regressions | Passed |
| Whitespace and patch validation | Passed |

For a manual check, reload the unpacked extension and refresh the MediaMarkt listing. Save the seller and refurbished selections, clear both selections, replay, and independently inspect the selected controls. These results establish the tested standard-control support; they do not imply support for every custom widget on every retailer.
