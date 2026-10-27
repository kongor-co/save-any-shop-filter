# FilterVault

FilterVault is a local-first Chrome/Chromium Manifest V3 extension that saves the semantic state of shopping filters and restores only what it can deterministically resolve and verify.

This repository is the canonical home of the project. Earlier experiments named `auto-filter-assistant`, `auto-filter-assistant-2`, and `instant-filter-extension` are historical prototypes and are not active development targets.

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository folder.
4. Open a retailer listing or search page and select the FilterVault toolbar icon.

FilterVault targets Chrome 106 or newer. It uses only `activeTab`, `scripting`, and `storage` at install time. Persistent access is requested for one retailer origin only when it is needed for replay navigation.

## Use it

- On a shopping listing/search page, open FilterVault, review the detected route and active DOM-backed criteria, name the configuration, and choose **Save filters**.
- Open **Library** to search, inspect, replay, rename, duplicate, delete, import, or export configurations.
- Replay restores the saved route/context first, then applies supported DOM criteria idempotently and verifies the final state.
- The capture coverage report distinguishes meaningful saved settings, search/page context, unsupported controls, unresolved active controls, and ignored defaults before Save is enabled.
- Replay distinguishes storefront-verified criteria from route-only criteria. A required criterion retained only in the URL produces a partial result. Warnings on optional presentation criteria cannot turn unverified required filters into a completed replay.
- When the page context has changed, replay pauses for review. Confirmation applies to the inspected document and context; another change requires another review.
- Worker suspension reconnects to the existing page executor. Cancellation stops subsequent actions, and document replacement interrupts replay.

Version 0.3 includes hostname-aware route schemas for Amazon.de, Kleinanzeigen, Idealo, rebuy, MediaMarkt, Decathlon, Cyberport, Zalando Germany, Shop Apotheke, OTTO, Autohero, and Home24. The schemas recognize merchant-specific query parameters, aliases, atomic sort pairs, and supported path facets without treating ambiguous short parameters as global filters. Route support does not establish live verification for every retailer.

Idealo Germany additionally has a verified DOM adapter for route-backed filter tags and selected checkbox filters, including multi-select groups. Default price-slider bounds are ignored; active dual-handle sliders remain explicitly unsupported until a stable retailer mapping exists.

FilterVault deliberately does not automate login, checkout, consent choices, CAPTCHAs, closed Shadow DOM, arbitrary scripts, dual-handle sliders, or controls it cannot identify and verify safely.

## Development

Run the checks with the bundled or system Node.js 22+ runtime:

```powershell
npm test
npm run check
npm run test:coverage
npm run smoke:browser
```

No build step and no third-party runtime dependencies are required.

Use `main` as the integration branch. Create a short-lived branch for each change, run the relevant checks, and merge through a pull request. A permanent `develop` branch is not required.

For the optional real-browser regression, install the development dependency and run `npm run smoke:browser`. It starts local mock shops in isolated Playwright Chromium, loads a temporary copy of the packaged extension, and verifies popup Save, replay diagnostics, Idealo capture, details, rename, duplicate, and delete flows.

`npm run test:release` runs the complete release gate: static extension checks, deterministic tests, shared-core coverage thresholds, and the packaged Chromium suite. The individual security and storage/route integration subsets are available as `npm run test:security` and `npm run test:integration`. See [the test strategy](docs/TEST_STRATEGY.md) for the coverage matrix and live-storefront boundary.

Before changing architecture or adding retailer support, read the [architecture guide](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and [contribution guide](CONTRIBUTING.md). The [documentation index](docs/README.md) separates current guidance from historical reports.

## Privacy

Saved page context, filter criteria, bindings, mapping health, and timestamps remain in `chrome.storage.local`. Active replay checkpoints use `chrome.storage.session`, which Chrome clears on browser restart, extension reload, update, or disable. FilterVault has no backend and sends no saved data to a FilterVault server.
