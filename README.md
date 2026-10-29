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
- The Library defaults to **This shop**, using the current tab's website independently of capture support. Search and the Library count reflect that scope. Choose **All shops** to browse the full library; reopening the popup defaults to the current shop again. Pages without an available website show the full library. **Export all** always backs up every saved configuration.
- To change a saved configuration, adjust the shop's filters, open **Library**, and choose **Update** on its card. Review the changes and any omissions before confirming. Updates keep the configuration's name and identity and require the same shop and compatible listing context. **More actions** offers **Undo last filter update** for the latest replacement. Use **Replay** to apply saved filters to the page.
- Replay restores the saved route/context first, then applies supported DOM criteria idempotently and verifies the final state.
- The capture coverage report distinguishes meaningful saved settings, search/page context, unsupported controls, unresolved active controls, and ignored defaults before Save is enabled.
- Replay distinguishes storefront-verified criteria from route-only criteria. A required criterion retained only in the URL produces a partial result. Warnings on optional presentation criteria cannot turn unverified required filters into a completed replay.
- When the page context has changed, replay pauses for review. Confirmation applies to the inspected document and context; another change requires another review.
- Worker suspension reconnects to the existing page executor. Cancellation stops subsequent actions, and document replacement interrupts replay.

Version 0.3 includes hostname-aware route schemas for Amazon.de, Kleinanzeigen, Idealo, rebuy, MediaMarkt, Decathlon, Cyberport, Zalando Germany, Shop Apotheke, OTTO, Autohero, and Home24. The schemas recognize merchant-specific query parameters, aliases, atomic sort pairs, and supported path facets without treating ambiguous short parameters as global filters. Route support does not establish live verification for every retailer.

Idealo Germany additionally has a verified DOM adapter for route-backed filter tags and selected checkbox filters, including multi-select groups. Default price-slider bounds are ignored; active dual-handle sliders remain explicitly unsupported until a stable retailer mapping exists.

MediaMarkt seller and refurbished selections are captured from both their URL parameters and native checkbox groups. Generic capture also supports labelled option lists and native accordion groups on other shops, removes explicit result counts from option labels, and ignores proven full-range defaults and catch-all ratings. Native accordions are opened only when replay needs to change a control. Active custom sliders remain explicitly unsupported.

Cyberport manufacturer, power-supply, and rating filters are captured from structured URL state. Conventional refinement lists, menus, rating menus, and numeric ranges are also recognized on unregistered shops. Indexed choices share one semantic filter while retaining every physical URL key. Visible labels belonging to checked native inputs can verify route replay even when the inputs themselves are styled out of view.

Paired native range inputs with identifiable endpoints support capture and verified replay, including a scoped Apply button. Full-range handles in a separate fieldset are recognized as defaults. Explicit default relevance comboboxes are omitted; active custom sliders and genuine autocomplete controls remain reported when no reliable mapping exists.

Shop Apotheke category and pack-size menus use generic button-dropdown support. Active menu inspection uses associated listboxes, including popups rendered elsewhere in the document, and restores the previous menu and filter-panel visibility. Decorative checkboxes and result counts do not duplicate selected options. Both selected pack sizes are saved as one filter with their original URL keys. Pagination and the current listing chip are page context rather than saved filters.

Home24 width bounds, ratings, and separate colour choices have explicit route semantics. Applied-filter chips provide exact, scoped verification, and selected group launchers are treated as summaries only when their represented values are confirmed. Missing values and conflicting chips retain warnings. Native sort selections can confirm the saved sort even when the selected option is the default.

OTTO colour choices, seller, and maximum centimetre dimensions use explicit route semantics. Repeated custom-component inputs and removal chips are read as evidence rather than stored as one combined clickable filter. Confirmation requires both the original checked control and exactly one matching visible removal chip. Known interval mirrors, including numeric fields in open shadow roots, are omitted only when they agree with the saved route; inactive intervals require proven full bounds. Literal comma and tilde syntax is retained for OTTO's declared parameters.

OTTO fashion filters also recognize style, US clothing sizes, and target groups. Comma-separated choices remain separate semantic values while preserving the physical route. Original checkboxes or radio buttons and their matching visible removal chips must agree before replay is verified. Chips are never stored as actions that remove a filter.

FilterVault deliberately does not automate login, checkout, consent choices, CAPTCHAs, closed Shadow DOM, arbitrary scripts, or controls it cannot identify and verify safely.

## Development

Run the checks with the bundled or system Node.js 22+ runtime:

```powershell
npm test
npm run check
npm run test:coverage
npm run smoke:browser
```

No build step and no third-party runtime dependencies are required.

The [support matrix](docs/SUPPORT.md) separates deterministic route coverage from dated live acceptance. Run `npm run test:live` for the isolated Idealo, Decathlon, MediaMarkt, Cyberport, Shop Apotheke, Home24, and OTTO scenarios. The [live acceptance guide](docs/LIVE_ACCEPTANCE.md) explains recording results, blocked cases, and the manual CI workflow. Live retailer access is separate from the deterministic release gate.

Use `main` as the integration branch. Create a short-lived branch for each change, run the relevant checks, and merge through a pull request. A permanent `develop` branch is not required.

For the optional real-browser regression, install the development dependency and run `npm run smoke:browser`. It starts local mock shops in isolated Playwright Chromium, loads a temporary copy of the packaged extension, and verifies popup Save, replay diagnostics, Idealo capture, details, rename, duplicate, and delete flows.

`npm run test:release` runs the complete release gate: static extension checks, deterministic tests, shared-core coverage thresholds, and the packaged Chromium suite. The individual security and storage/route integration subsets are available as `npm run test:security` and `npm run test:integration`. See [the test strategy](docs/TEST_STRATEGY.md) for the coverage matrix and live-storefront boundary.

Before changing architecture or adding retailer support, read the [architecture guide](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and [contribution guide](CONTRIBUTING.md). The [documentation index](docs/README.md) separates current guidance from historical reports.

## Privacy

Saved page context, filter criteria, bindings, mapping health, and timestamps remain in `chrome.storage.local`. Active replay checkpoints use `chrome.storage.session`, which Chrome clears on browser restart, extension reload, update, or disable. FilterVault has no backend and sends no saved data to a FilterVault server.
