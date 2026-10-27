# Live storefront acceptance

Live acceptance checks the packaged extension against a dated retailer scenario. It is separate from the deterministic release gate because retailer availability, regional restrictions, consent screens, and bot challenges are outside the test's control.

## Run a scenario

Install development dependencies and the Playwright Chromium runtime first:

```powershell
npm ci
npx playwright install chromium
```

Run all configured retailers, or choose one:

```powershell
npm run test:live
npm run test:live -- --shop idealo-de
npm run test:live -- --shop decathlon-de
npm run test:live -- --shop mediamarkt-de
npm run test:live -- --shop cyberport-de
npm run test:live -- --shop shop-apotheke-de
npm run test:live -- --shop home24-de
```

If Chromium is installed outside Playwright's default location, set `PLAYWRIGHT_BROWSERS_PATH` to that installed browser directory before running the command. `FILTERVAULT_PLAYWRIGHT_MODULE` can select an existing Playwright module, as in the packaged smoke suite.

The runner creates a new browser profile and extension copy under `.live-acceptance/<run>/`. It grants that test copy access only to the selected retailer origins. The production manifest, the user's browser profiles, and persistent user settings are not changed. No consent, login, CAPTCHA, or challenge is answered automatically. Context uncertainty stops for manual review rather than being confirmed automatically.

## What a pass establishes

Each scenario must complete these stages:

1. Open the filtered listing and capture the expected semantic criteria.
2. Save through the actual service worker and read back the persisted criteria.
3. Open the unfiltered route and demonstrate that at least one captured filter changed.
4. Replay the saved state and verify every required criterion through visible storefront or DOM evidence.

Route-only results, capture omissions, incomplete result sets, failed reset proofs, and failed saves cannot qualify as passes. Optional presentation warnings may remain when every required criterion is verified. A pass applies only to that scenario, source fingerprint, and test date. It does not establish universal retailer support or acceptance of the production permission prompt.

Exit status 0 means all selected cases passed. Status 1 means a scenario or the harness failed. Status 2 means there was no failure, but at least one case was blocked or partial. PowerShell callers can read the native result from `$LASTEXITCODE`.

Each run writes `report.json`, `report.md`, and available screenshots in its ignored output directory. Browser profiles and extension copies remain local and must not be committed or uploaded. The manual GitHub Actions workflow uploads only reports and screenshots, and never the profile or extension copy.

The artifact upload explicitly includes the hidden output directory while restricting its paths to those three evidence formats. GitHub documents the hidden-file input in the [artifact action definition](https://github.com/actions/upload-artifact/blob/v4/action.yml).

## Record support evidence

To retain the structured report as version-controlled evidence:

```powershell
npm run test:live -- --record
npm run support:update
npm run support:check
```

Run the support update even when the live command reports blocked or failed cases. `--record` writes the report into `docs/acceptance/records`; it never converts a blocked or partial result into a pass. Inspect the report and generated matrix before committing. Local screenshots can help diagnose an access error or layout drift, but are not required to regenerate the matrix.

The support matrix joins the route-schema catalog, the existing twelve-storefront route contracts, the configured acceptance scenarios, and validated acceptance records. It marks evidence stale when its runtime version, normalized source fingerprint, route-schema version, or scenario fingerprint no longer matches. Historical results are retained. The newest result is shown even when it is less favorable than an earlier pass.

The fingerprint covers the production manifest and all runtime files under `src`. Text line endings are normalized so the same source has the same identity on Windows and Linux. Test origin grants are recorded explicitly and are not included in the production fingerprint.

## Update a scenario

Canonical filtered routes come from `tests/fixtures/live-route-cases.json`. Expected semantic values, unfiltered routes, and readiness selectors live in `docs/acceptance/scenarios.json`. Change both when retailer behavior requires it. Keep capture expectations independent of replay output so a missing criterion cannot silently redefine success.

Add a reproducible fixture and appropriate regression tests before changing an adapter. Then rerun live acceptance against the changed source. A historical pass must not be reused to certify a changed scenario or runtime.

`npm run check` validates the generated support matrix as part of the normal CI gate. The separate **Live storefront acceptance** workflow is started manually and accepts `all`, `idealo-de`, `decathlon-de`, or `mediamarkt-de`. It runs no schedule and does not publish or commit its results.
