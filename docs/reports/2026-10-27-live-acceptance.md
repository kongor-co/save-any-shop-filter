# Live acceptance infrastructure validation

Validation date: 27 October 2026

The dedicated acceptance runner, evidence validation, and generated support matrix are implemented. The complete deterministic release gate passes. Neither live retailer qualified for a pass in this environment, so the support matrix records blocked outcomes and makes no new live support claim.

## Implementation

`npm run test:live` runs isolated Idealo and Decathlon scenarios derived from the existing route contracts. It requires expected semantic capture, persisted Save readback, a demonstrated filter reset, and visible verification after replay. The runner does not answer consent, authentication, CAPTCHA, or context confirmation prompts. It cancels only its own replay and removes its temporary saved configuration after the attempt.

`npm run test:live -- --record` retains structured evidence under `docs/acceptance/records`. Reports identify the production runtime version, normalized source fingerprint, route-schema version, scenario definition and fingerprint, execution stages, reset differences, and available replay results. Browser profiles, extension copies, and screenshots remain in an ignored local run directory.

`npm run support:update` generates the support matrix for all twelve route schemas. It keeps route-contract coverage separate from dated live acceptance and labels mismatched source, version, or scenario evidence stale. The normal static check rejects stale generated documentation and invalid evidence. The default browser suite now remains entirely local; optional live access has moved to the dedicated command.

A manual GitHub Actions workflow runs the same live command and retains reports and screenshots, including on blocked runs. It has no schedule, does not commit evidence, and excludes browser profiles and extension copies from upload. The workflow definition was added locally; it was not dispatched on GitHub during this validation.

## Live results

Two clean isolated runs were attempted. The latest structured record is [the 11:30 UTC run](../acceptance/records/2026-10-27T11-30-27-174Z.json).

| Scenario | Latest outcome | Evidence |
|---|---|---|
| Idealo Samsung and RAM | Blocked before capture | HTTP 403 response |
| Decathlon shirts, sizes, and price | Blocked before capture | Empty document |

No filters were captured, saved, or replayed on these blocked pages. No consent or anti-bot challenge was bypassed. The records preserve the unsuccessful attempts rather than treating URL retention as verification.

The temporary live-test extension receives access only to the selected retailer origins. This validates the production runtime source when the page is accessible, but does not certify the production permission prompt. A future live pass must retain that limitation and its exact scenario scope.

## Local release validation

Command: `npm run test:release`

| Check | Result |
|---|---|
| Static extension and support evidence checks | Passed |
| Deterministic tests | 100 passed, zero failures or skips |
| Shared-core line coverage | 99.28 percent |
| Shared-core branch coverage | 91.03 percent |
| Shared-core function coverage | 100 percent |
| Packaged Chromium suite | Passed |
| Generated support matrix freshness | Passed |
| Whitespace and patch validation | Passed |

The browser suite executes the actual acceptance helper against a local shop and proves capture, persisted Save, reset of two filters, verified replay, and temporary-state cleanup. Additional deterministic regressions reject unverified criteria, false reset proofs, failed persistence, malformed pass records, newer blocked results hidden by older passes, context-only capture, foreign replay cancellation, and line-ending-dependent fingerprints.

The next release prerequisite remains live acceptance in an environment where the configured retailer pages are accessible. Use the same runner and scenario definitions, record the outcome, and regenerate the matrix. Any retailer regression found there should receive a reproducible local fixture before adapter changes are made.
