# Home24 filter validation

Validation date: 27 October 2026

The supplied Home24 configuration now captures maximum width, rating, separate colour choices, and sorting. The deterministic fixture shows four settings with no unsupported or unresolved controls. Full live acceptance remains unconfirmed: Home24 returned HTTP 403 to the isolated acceptance browser.

## Findings and implementation

The previous route rules dropped `width.max` and `average_rating` during sanitation. They also treated `black|gray` as one literal colour. Home24 route schema version 2 recognizes dotted dimension bounds and ratings, splits colour choices into semantic values, and retains the original physical URL parameters for replay. The supplied width maximum displays as `Breite: bis 14cm`; colours display as Schwarz and Grau. Existing seller and sorting parameters remain supported.

The two reported unresolved controls are selected filter-group launchers. They describe groups rather than selected values. The generic executor now excludes such a launcher from filter capture only when descriptor hints account for the selected count and every represented value has exact applied-chip evidence. An unrepresented or conflicting summary remains unresolved and cannot be saved as a guessed Boolean filter.

Applied-chip verification is read-only and scoped to one visible region explicitly labelled as applied or selected filters. It reads the value text on individual filter-removal buttons without clicking them. A complete text match is required. A missing colour, a different width, a different rating, unrelated product descriptions, or duplicated evidence regions cannot confirm the criterion.

Sorting can be confirmed by the actual value of a visible native select identified as sorting, including its default option. The generic evidence collector reads selected option labels rather than the text of every available option. Required filters with only route evidence remain partial; a mismatch confined to optional sorting remains a warning. Listing detection also recognizes semantically labelled filter-group launchers and German product links, allowing a listing with two matching products to remain a listing after filters are cleared.

No saved-state or mapping version changed. Existing imports, mappings, permissions, cancellation, origin restrictions, and storage behavior remain in place.

## Verification

The route tests cover capture, sanitation, replay construction, multiple colour choices, original query encoding, descriptor hints, conservative unknown values, seller and sorting compatibility, and isolation from unregistered hosts.

Packaged Chromium covers capture, persisted Save, reset, replay, idempotency, and zero clicks on removal chips or group launchers. Negative cases reject a 140cm chip for saved 14cm, five stars for saved four stars, an absent grey choice, product descriptions containing the expected text, a mismatched native sort, an unexplained summary count, and duplicate evidence regions.

The complete release command is `npm run test:release`, including static checks, 118 deterministic tests, shared-core coverage thresholds, and the existing packaged regressions for Idealo, Decathlon, MediaMarkt, Cyberport, Shop Apotheke, generic stores, and replay lifecycle behavior.

The final release gate passed: all 118 tests passed with no skips or failures, and every packaged browser regression passed. Shared-core coverage is 99.58 percent of lines, 92.05 percent of branches, and 100 percent of functions. Static support evidence and patch whitespace checks passed.

## Live boundary

Live browser inspection confirmed the supplied controls and the applied-filter region. The [first isolated attempt](../acceptance/records/2026-10-27T17-49-43-354Z.json) received HTTP 403 before capture. The [follow-up attempt](../acceptance/records/2026-10-27T17-51-41-426Z.json) was blocked by the same HTTP response. Neither is a capture or replay pass. These attempts precede the final native-select evidence refinement and do not certify the final runtime; the support matrix retains their source fingerprints as historical evidence. No access challenge was bypassed.

## Manual retest

Reload FilterVault at `chrome://extensions`, refresh the supplied Home24 listing, and save a new configuration. Confirm that width, rating, both colours, and sorting are shown. Clear the filters and restore the new configuration, then inspect the selected values on the shop. An older configuration cannot regain the width or rating that was previously omitted; recreate it from the filtered page.
