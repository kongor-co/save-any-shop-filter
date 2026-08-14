# FilterVault

FilterVault is a local-first Chrome/Chromium Manifest V3 extension that saves the semantic state of shopping filters and restores only what it can deterministically resolve and verify.

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
- Replay distinguishes storefront-verified criteria from route-only criteria. Route-only completion is reported with a warning rather than as fully verified.

Version 0.2 includes hostname-aware route schemas for Amazon.de, Kleinanzeigen, Idealo, rebuy, MediaMarkt, Decathlon, Cyberport, Zalando Germany, Shop Apotheke, OTTO, Autohero, and Home24. The schemas recognize merchant-specific query parameters, aliases, atomic sort pairs, and supported path facets without treating ambiguous short parameters as global filters.

Idealo Germany additionally has a verified DOM adapter for route-backed filter tags and selected checkbox filters, including multi-select groups. Default price-slider bounds are ignored; active dual-handle sliders remain explicitly unsupported until a stable retailer mapping exists.

FilterVault deliberately does not automate login, checkout, consent choices, CAPTCHAs, closed Shadow DOM, arbitrary scripts, dual-handle sliders, or controls it cannot identify and verify safely.

## Development

Run the checks with the bundled or system Node.js 20+ runtime:

```powershell
npm test
npm run check
```

No build step and no third-party runtime dependencies are required.

For the optional real-browser regression, install the development dependency and run `npm run smoke:browser`. It starts local mock shops in isolated Playwright Chromium, loads a temporary copy of the packaged extension, and verifies popup Save, replay diagnostics, Idealo capture, details, rename, duplicate, and delete flows.

## Privacy

Saved page context, filter criteria, bindings, mapping health, and timestamps remain in `chrome.storage.local`. Active replay checkpoints use `chrome.storage.session`, which Chrome clears on browser restart, extension reload, update, or disable. FilterVault has no backend and sends no saved data to a FilterVault server.
