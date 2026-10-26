# FilterVault cross-shop test report

Date: 2026-08-14  
Environment: Codex in-app Browser, desktop viewport, Germany locale/network  
Scope: Amazon, Kleinanzeigen, Idealo, rebuy, MediaMarkt, Decathlon, Cyberport, Zalando, Shop Apotheke, OTTO, Autohero, and home24

## Executive result

FilterVault is not yet a reliable “save any shop filter” extension. Canonical filtered URLs replayed successfully on most tested stores, but the current generic DOM capture model misses important real-world controls: link-backed facets, hidden or unlabeled checkboxes, custom comboboxes/listboxes, modal filters with a Save action, dual-handle sliders, and filter state encoded in opaque path segments.

The most important architectural conclusion is that replay should be URL-first and DOM-assisted. The canonical pathname and all semantic query parameters should be the primary saved state. DOM mappings should enrich that state, verify it, and handle the minority of controls that are not represented in the route.

Two proven route bugs were fixed during this test:

- Route-backed sorting is now included in saved captures.
- The route classifier now recognizes filter/query formats observed on Amazon, rebuy, Decathlon, Cyberport, OTTO, and Autohero while discarding volatile Amazon and MediaMarkt request metadata.

Static validation and all 17 automated tests pass after the fix.

## Important limitation

The unpacked local extension was not installed in the in-app Browser profile, so the FilterVault popup itself could not be clicked in this run. Installing an extension is a separate browser action that requires explicit confirmation. The live tests therefore exercised each shop's real controls, verified the resulting page state, reset the route, and replayed the canonical filtered URL. The extension's route capture/replay code was then checked and unit-tested against the observed URL formats.

This validates storefront compatibility and route replay behavior, but it is not a substitute for one final popup-level acceptance run in a Chrome profile where this exact unpacked build is loaded.

## Method

For each store, the test attempted to:

1. Open a search or category results page without signing in.
2. Apply representative filters from different control classes: checkbox/link facet, multi-select, numeric range, modal/listbox, or route-backed category.
3. Change the sort order where the control was operable.
4. Record the URL and authoritative visible state (heading, active chip, checked state, sort label, or result count).
5. Reset to the unfiltered route.
6. Navigate back to the recorded filtered route and verify that the state returned.

Cookie prompts were rejected or limited to necessary cookies. No login, purchase, wishlist mutation, location permission, prescription flow, financing application, or CAPTCHA bypass was attempted.

## Results matrix

| Shop | Scenario exercised | Canonical replay | Current generic capture outlook | Main risk |
|---|---|---:|---|---|
| Amazon | search + adidas brand + lowest-price sort | Pass | Partial | `rh` facet state and `s` sorting coexist with volatile `qid`, `rnid`, `ds`, `dc`, and `ref` values |
| Kleinanzeigen | bicycle category + €100–800 + mountain bike | Pass | Poor | Category, price, and type are encoded in the pathname; sorting is a custom combobox |
| Idealo | Samsung + 256 GB + 12/8 GB RAM + used-products off + lowest-price sort | Pass | Adapter required | Opaque path tokens and dual price sliders; exact reported page was previously rejected as unsupported |
| rebuy | phone storage/network/in-stock + price sort | Pass by combined URL | Partial | Facets are link-backed query parameters; sequential link interactions can replace prior query state |
| MediaMarkt | laptop search redirect + APPLE brand | Pass | Partial | Volatile `queryMeta`/request hashes and custom filters; direct semantic route is much cleaner than search redirect URL |
| Decathlon | running-shoe search + men + sort menu probe | Pass | Partial | `facets` query value is authoritative; custom sort and controls often lack intrinsic labels after rerender |
| Cyberport | notebook manufacturer Lenovo + range audit | Pass | Poor | Visible filter names expose broken `[object Object]Label`; extensive dual sliders |
| Zalando | men's shoes + adidas brand modal | Pass | Poor without path adapter | Hidden unlabeled checkbox, explicit Save action, and brand state encoded in pathname |
| Shop Apotheke | Vitamin D + category + sort menu probe | Pass | Partial | Custom listboxes and duplicate `query`/`q`; category query value is opaque |
| OTTO | laptop search + price up to €1,000 | Pass | Partial | Very large checkbox tree; applying another facet can replace prior route state; checked nodes may have no label after replay |
| Autohero | small-car body type + lowest-price sort | Pass | Good | Clean query state, but nested model/budget panels still need coverage |
| home24 | sofa search + filter/sort audit | Pass for search route | Incomplete | Autocomplete selection was inert in automation; listing filters need adapter-level verification |

## Detailed findings

### Amazon

Tested route:

`/s?k=running+shoes+men&rh=p_123%3A198664&s=price-asc-rank...`

Verified:

- Search term remained “running shoes men”.
- Brand `adidas` was active.
- Sort restored as “Price: Low to high”.
- Direct URL replay restored both filter and sort.

Risks:

- Most sidebar refinements are anchors wrapping nameless checkboxes. A checkbox-only DOM strategy cannot identify them reliably.
- `rh` is the important filter parameter; `qid`, `rnid`, `ds`, `dc`, and `ref` are volatile request/navigation metadata and must not define saved state.
- Amazon can combine multiple facets inside one encoded `rh` value; it must be treated atomically.

### Kleinanzeigen

Tested route:

`/s-fahrraeder/preis:100:800/fahrrad/k0c217+fahrraeder.type_s:mountainbike`

Verified:

- Category was Fahrräder & Zubehör.
- Price inputs restored to 100 and 800.
- Mountainbikes heading and removal chips returned after direct replay.

Risks:

- There may be no semantic filter query parameters at all; the pathname is the filter state.
- The sort control is a custom combobox. The attempted “Niedrigster Preis” interaction did not persist in this automated surface and replay returned “Neueste”. This must be a dedicated acceptance case.
- A generic “same origin + same path class” check is insufficient because different filters produce different path grammar.

### Idealo

Tested the exact user-reported route:

`/preisvergleich/ProductCategory/19116F1820730-7777739-8454964-9930992oE2oJ0.html?sortKey=minPrice`

Verified:

- Samsung, 256 GB, 12 GB, and 8 GB were active.
- “Gebrauchte Produkte anzeigen: Nein” was present.
- Price inputs showed 208 and 2298 on the current inventory.
- Sort changed to and replayed as “Preis: Günstigster zuerst”.

Risks:

- Filter values are opaque path tokens, so the URL pathname is indispensable.
- Checkbox activation via the visible page was inert in this browser automation surface, although direct path replay restored every chip. This reinforces URL-first replay.
- The min/max inputs are coupled to a dual slider and should not be replayed through generic numeric input mutation.

### rebuy

Tested category: `/kaufen/handy`.

Verified combined replay route:

`?f_prop_rom=256%20GB&f_prop_mobile_internet=5G&inStock=1&sortBy=price_asc`

Risks:

- Facets are primarily links. During the live run, successive filter-link clicks replaced earlier query state and the final interactive URL retained only sorting; the explicitly combined URL restored all parameters.
- FilterVault must merge saved query criteria as a single route update, not replay independent anchor URLs sequentially.

### MediaMarkt

Tested clean brand route:

`/de/category/laptops-notebooks-362.html?brand=APPLE`

Verified the “Marke: APPLE” chip and Apple-only result content.

Risks:

- Search redirects add `queryInitial`, nested `queryMeta[...]`, request hashes, and `searchFeatures[...]`. Those values are volatile and can make a saved URL stale.
- The clean category + `brand` URL is replayable and should be preferred over the redirect URL.
- Direct role-checkbox activation was inert in the automated surface.

### Decathlon

Tested route:

`/search?Ntt=laufschuhe&originQuery=laufschuhe&facets=genderLabels:HERREN_`

Verified:

- The filter count changed to one.
- The expanded Gender group displayed HERREN as selected.
- Direct URL replay restored the filtered result set.

Risks:

- `Ntt` is search context and `facets` is filter state; both were previously missed by the route classifier.
- Result counts changed between loads, so count equality must never be the only verification rule.
- Sort is a custom listbox with values such as relevance, ascending price, descending price, discount, and ratings.

### Cyberport

Tested route:

`/notebook-und-tablet/notebooks.html?refinementList%5Bmanufacturer%5D%5B0%5D=Lenovo`

Verified Lenovo-only result content after replay.

Risks:

- Many options have the accessible name `[object Object]Label`, so ARIA-label capture is actively misleading.
- Manufacturer state is encoded in bracketed `refinementList[...]` parameters and was previously ignored.
- Price, display size, RAM, storage, core count, and performance use dual sliders. Generic slider replay should remain disabled until an adapter verifies both bounds and the committed route.

### Zalando

Tested route:

`/mens-shoes/adidas/`

Verified:

- Brand modal required selecting `adidas (All)` and an explicit Save action.
- The saved route restored the adidas brand filter and approximately 1,079 results at test time.

Risks:

- The checkbox is hidden/unlabeled; visible label text and modal context are required.
- The result path, not a query parameter, represents the brand.
- Selecting `adidas (All)` represented six adidas sub-brands in the filter summary, so a simple boolean brand model loses information.

### Shop Apotheke

Tested route:

`/search.htm?query=vitamin%20d&q=vitamin%20d&category=shop-apotheke.com%2FArzneimittel%20%26%20Gesundheit`

Verified the category badge and filtered results after replay.

Risks:

- Filters and sort are custom combobox/listbox widgets rather than native selects.
- The route contains both `query` and `q`; normalization must preserve meaning without creating duplicate criteria in the UI.
- Medical product inventory changes frequently; replay success must verify filter chips/state, not exact products or counts.

### OTTO

Tested route:

`/suche/laptop/?preis-in-eur~bis=1000`

Verified price state and search context after replay.

Risks:

- `preis-in-eur~bis` was previously ignored because the classifier recognized English `price` but not German `preis`.
- The page exposes a very large checkbox tree. Only checked/active controls should be captured.
- Applying category and then price left only the price route in this run. Replay logic must update the whole canonical route, not click stale facet links one at a time.

### Autohero

Tested route:

`/de/search/?sort=price_asc&bodyType=small_car`

Verified:

- “Bauform: Kleinwagen” was active.
- Sort restored as “Niedrigster Preis”.
- The result count and state survived reset/replay.

This is the strongest generic compatibility case. The remaining risk is coverage of nested brand/model, financing budget, registration year, mileage, fuel, delivery, and multi-value selections.

### home24

Tested stable search route:

`/search?query=sofa`

Verified the sofa result page and native “Sortieroptionen” select.

Risks:

- Search autocomplete suggestions had stable links, but clicking the option was inert in this automation surface; direct URL navigation worked.
- Listing controls expose Filter, Colour, and Price entry points, but a complete stateful filter replay was not proven in this run.
- Treat home24 as unsupported/experimental until a dedicated fixture and live adapter test pass.

## Defects and executable improvement backlog

### P0 — Always preserve semantic sort state

Status: fixed in this working tree.

Files:

- `src/background/service-worker.js`
- `src/shared/route.js`
- `tests/route.test.mjs`

Acceptance criteria:

- `sort`, `sortBy`, and `sortKey` are captured as `PRESENTATION` criteria.
- Saved capture URLs retain presentation state.
- Pagination and volatile request/tracking parameters remain excluded.

### P0 — Add a generic canonical-route criterion

Status: proposed.

Implementation:

- Add a `ROUTE_SNAPSHOT` criterion representing the cleaned pathname plus semantic query multimap.
- Allow saving when this criterion is the only reliable state and the page is a detected listing/search surface.
- Keep per-value criteria for UI readability, but construct one atomic replay URL before navigation.
- Never navigate individual saved facet anchors one by one.

Acceptance criteria:

- Kleinanzeigen price/type paths and Zalando brand paths can be saved even when no supported DOM control exists.
- rebuy/OTTO multi-filter routes are assembled atomically and do not lose earlier facets.
- The criterion excludes origin changes, fragments, pagination, trackers, request IDs, and auth/session tokens.

### P0 — Retailer path adapters

Status: proposed.

Add adapters behind a registry in `src/content/executor.js`:

- `kleinanzeigen-de`: parse/remove category, `preis:min:max`, and `+namespace.key:value` segments; verify removal chips and price inputs.
- `zalando-de`: capture path facets, modal multi-selection, and Save/commit behavior.
- Extend `idealo-de`: explicitly distinguish default slider bounds from a committed price route.

Acceptance criteria:

- Capture preview shows human-readable criteria for the three opaque-path stores.
- Each adapter has a static fixture and a live smoke scenario.

### P1 — Support link-backed facets and explicit commit actions

Status: proposed.

Implementation:

- Capture active facet removal links/chips and the canonical URL they represent.
- Add declarative interaction steps `OPEN_GROUP`, `ACTIVATE_OPTION`, and `COMMIT`.
- Resolve options by group + visible label + stable href semantics, not global text alone.

Acceptance criteria:

- Amazon, rebuy, MediaMarkt, Zalando, and Shop Apotheke scenarios apply without stale-link replacement.
- A modal filter is not reported as applied until Save/Apply closes the modal and route/chip verification succeeds.

### P1 — Improve accessible-name fallbacks

Status: proposed.

Implementation in `controlLabel` and locator generation:

- Reject placeholder names such as `[object Object]Label`.
- Prefer wrapping-label visible text, adjacent semantic spans, link title/href, and group-local text.
- Store normalized and original labels; strip volatile result counts only during matching.

Acceptance criteria:

- Cyberport manufacturer values resolve as Lenovo/HP/etc.
- Idealo and Zalando hidden inputs resolve through their visible labels.
- Duplicate global text does not produce a unique locator unless scoped to a verified group.

### P1 — Range adapters and paired-bound verification

Status: proposed.

Implementation:

- Model a range as one criterion with `min` and `max`, not two unrelated numeric inputs.
- Prefer committed URL values over slider geometry.
- If a site has no URL representation, require a retailer adapter that can set both handles, fire the correct events, commit, and verify both bounds.

Acceptance criteria:

- Kleinanzeigen text range is supported.
- Idealo and Cyberport dual sliders remain visibly unsupported until verified adapters exist.
- Default min/max values are never saved as active filters.

### P1 — Strong post-navigation verification

Status: proposed.

Verification order:

1. Canonical route multimap/path.
2. Active filter chip or removal control.
3. Checked/selected control scoped to the correct group.
4. Sort label.

Never verify by exact result count or product identity. Inventory changed during the Decathlon run while the same filter route remained valid.

### P2 — Support-level policy and honest UX

Status: proposed.

- `VERIFIED`: live adapter scenario passed.
- `COMPATIBLE`: canonical route + visible-state replay passed, but no site adapter.
- `LIMITED`: some state can be saved; unsupported controls are listed individually.
- `UNSUPPORTED`: no semantic route or verifiable active criterion.

The popup should say exactly which values will and will not be saved. “Nothing supported to save” should include a diagnostic reason and a “copy sanitized URL” fallback when safe.

### P2 — Regression suite

Status: proposed.

Add one fixture per route/control family rather than one fixture per visual storefront:

- Amazon atomic `rh` + sort and metadata stripping.
- Kleinanzeigen path grammar.
- Idealo opaque path + tags + unused default range.
- Bracketed `refinementList` query.
- Decathlon `facets` query.
- Zalando modal checkbox + commit.
- Custom listbox sort.
- Duplicate query aliases.
- Range with text inputs versus dual sliders.

Every fixture must test capture, cleaned URL, save eligibility, replay URL, idempotent second replay, and verification failure when a value disappears.

## Human use cases still requiring coverage

The following are legitimate shopping behaviors but were not safe or practical to complete in this anonymous desktop run:

- Mobile/responsive filter drawers and viewport-specific locators.
- Signed-in price/member filters, saved searches, and personalized availability.
- Store/postcode/location-dependent inventory and delivery filters.
- Infinite-scroll or virtualized filter values outside the rendered DOM.
- Multi-language replay across locale-specific paths and labels.
- A/B-tested layouts and retailer redesigns.
- Filters stored only in application state, history state, or closed shadow DOM.
- Stale/out-of-stock saved values and category migrations.
- Multi-tab replay, cancellation during navigation, interrupted browser restarts, and permission-denied flows.

These should be represented as explicit test cases and support states; they cannot honestly be claimed as universally covered by a generic browser extension.

## Release recommendation

Do not market the current build as “save any shop filter.” Ship it as an early compatible build only after the canonical-route criterion and popup-level acceptance run are complete. Autohero and the fixed Idealo flow are suitable first verified cases. Amazon, Decathlon, Shop Apotheke, MediaMarkt, and Cyberport can follow with query/listbox adapters. Kleinanzeigen and Zalando require pathname-aware adapters before they should be shown as supported.
