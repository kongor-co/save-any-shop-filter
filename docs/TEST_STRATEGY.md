# FilterVault test strategy

## Objective

FilterVault tests are organized around failure risk rather than file structure. The suite must detect silent state loss, unsafe capture, replay overclaims, persistence corruption, retailer-route regressions, inaccessible popup controls, and browser lifecycle races.

## Test layers

| Layer | Files/command | Primary risks covered |
|---|---|---|
| Unit | `npm run test:unit` | Classification, coverage, dependency planning, deadlines, validation, migration, route building, schema parsing. |
| Property/contract | `route-properties.test.mjs`, `live-routes.test.mjs` | Sanitation idempotence, capture/replay round trips, host isolation, and the 12 retailer contracts. |
| Storage integration | `npm run test:integration` | Indexed library behavior, corruption isolation, v3 migration, session replay checkpoints. |
| Security/privacy | `npm run test:security` | Least-privilege manifest, CSP, hostile imports, size limits, executable text, sensitive values, and unsafe browser dialogs. |
| Structural accessibility | `popup-structure.test.mjs` | Unique IDs, valid references, dialog names, labels, explicit button types, and live regions. |
| Packaged browser E2E | `npm run smoke:browser` | Real MV3 service worker, content injection, popup UI, capture, save, replay, cancellation, migration surfaces, import/export, and Library actions. |
| Live storefront acceptance | Manual/release environment | Storefront redirects, consent/bot walls, visible active tokens, route acceptance, and retailer redesigns. |

## Deterministic browser scenarios

The packaged Chromium test uses an isolated profile and a temporary copy of the extension. It covers:

- generic checkbox, custom checkbox, non-default native select, numeric value, route query, and unsupported slider capture;
- verified Idealo route tags and multi-select state;
- context-only pages with disabled Save and sanitized-route fallback;
- default select omission and sensitive-field exclusion;
- unresolved active controls that are reported instead of guessed;
- active link/chip capture through semantic locators;
- deliberately unstable pages and bounded capture failure;
- checkout rejection;
- replay navigation, DOM restoration, route-only warnings, and cancellation races;
- popup Save, Details, Rename, Duplicate, Delete confirmation, keyboard dialog focus, Export, and Import.

## Coverage gate

`npm run test:coverage` measures the environment-independent shared core and route-schema registry. Required minimums are:

- lines: 95%;
- branches: 80%;
- functions: 90%.

Content scripts, service workers, and popup code are exercised in packaged Chromium because meaningful coverage for those modules requires Chrome APIs and real DOM lifecycle behavior. A low-value mocked percentage is not used as a substitute for those integration tests.

## Release gate

Run:

```powershell
npm run test:release
```

A release candidate requires all deterministic layers to pass. Before claiming a retailer as live Verified, also reload the exact unpacked build in Chrome and perform capture, Save, state mutation, replay, and criterion-level verification on the documented live route.

## Adding a retailer or control type

Every new retailer schema must include:

1. a version-controlled route fixture;
2. expected captured, coalesced, removed, and unsupported state;
3. an unknown-host isolation assertion for ambiguous keys;
4. replay URL round-trip assertions;
5. a deterministic DOM fixture when visible verification or commit actions are claimed; and
6. a live acceptance record before its support label becomes Verified.

Every new interaction action or locator type must include validator rejection tests, a successful deterministic browser path, cancellation behavior where it can wait, and a negative ambiguity case.
