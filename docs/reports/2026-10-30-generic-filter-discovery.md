# Generic filter discovery and Proshop regression

Date: 2026-10-30

## Reported failure

The Proshop listing had two active fields: `f~stregkodelaesere_forbindelse=kabling` and `f~stregkodelaesere_type=haandmodel`. Its UI displayed Kabel and Hand Modell. Capture returned no settings and disabled Save.

Two generic gaps caused this result:

1. The URL classifier did not recognize the explicit `f~` filter namespace.
2. Dropdown inspection required a combobox/listbox pair. The page instead used `aria-haspopup` buttons with `aria-controls`, nested menu containers, and native checkboxes created only after opening the menu. The checked inputs had field/value IDs, no name, and the default value `on`.

Live read-only inspection in the built-in browser confirmed this structure and the actual checked state. Opening and closing the inspected menu preserved the filter selection. A separate navigation to the URL using encoded tilde keys confirmed that Proshop retained both visible selection chips.

## Implemented correction

No Proshop domain entry or Proshop CSS selector was added.

- Explicit filter/facet namespaces are recognized independently of host. Supported forms include `f~field`, dotted or underscored filter/facet names, and bracketed filter/facet fields with optional indices.
- Sensitive fields are excluded before hints, capture, sanitation, and replay. Physical repeated/indexed values are preserved; delimiters inside opaque values are not guessed.
- Accessible menu buttons can use the existing dropdown container locator. The popup and its controlling trigger must be unique.
- Native checked options are matched through an exact input name/value or an exact field/value ID. Every expected URL value needs one checked option. Extra, missing, and duplicate selections keep warnings.
- Menu labels can differ from URL tokens. The reported filters display Kabel and Hand Modell while retaining the original tokens for replay.
- Unfamiliar plain query keys can provide capture-time hints when a uniquely matching filter-labelled menu and native option identities confirm their meaning. Their supported DOM state is saved without expanding the URL sanitizer to arbitrary keys.
- Explicit removal-chip labels without a captured control now produce an unresolved warning. Removal buttons are never saved as replay actions.
- Capture restores originally open or closed menu state. Replay uses the existing native interaction and verification rules.

The saved-state schema, mapping vocabulary, extension permissions, and existing retailer registry remain unchanged. Existing mappings remain accepted. Native option bindings reuse existing ID or name/value locators scoped to the current controlled popup.

## Applicability review

| Pattern | Applicability | Boundary |
|---|---|---|
| Common filter and sort query names | Generic across hosts | A recognized name provides route semantics; visible verification is separate |
| Refinement lists, menus, rating menus, numeric menus, and ranges in structured query keys | Generic across hosts | Sensitive fields and unknown encodings are excluded |
| Explicit filter/facet namespaces | Generic across hosts after this fix | Field syntax is bounded; values and delimiters are not guessed |
| Native checkboxes, radios, selects, numbers, labelled groups, and supported native range pairs | Generic DOM engine | Requires unique, supported, non-sensitive controls and verified interactions |
| Combobox/listbox dropdowns | Generic across hosts | Requires current accessible popup ownership and resolvable options |
| Lazy ARIA menus with native checkbox or radio options | Generic across hosts after this fix | Requires unique ownership and exact field/value evidence |
| Unknown plain query names with matched native menu evidence | Generic DOM fallback after this fix | Discovery uses filter-labelled containers, currently English or German, and exact identities; unknown URL keys are still sanitized |
| Selected removal chips | Read-only evidence and diagnostics | They do not authorize clicking a removal action to restore state |
| Retailer-specific path facets and opaque query formats | Declared retailer rules | Semantics cannot reliably be inferred from arbitrary strings |
| Custom JavaScript widgets, virtualized options, closed shadow roots, and cross-frame controls | Limited or unsupported | Need additional verified support; no universal compatibility claim is justified |

The extension is not restricted to its twelve retailer schemas. Those schemas supply special meanings and evidence for particular URL formats. Its shared control engine runs on unregistered shops too. Conversely, no finite test suite proves support for every possible webshop. An unfamiliar format with no supported UI evidence still needs another generic pattern or a verified adapter. The OTTO `selektion` expression discovered during the earlier inventory remains an example of an opaque format requiring separate work.

## Validation

| Check | Result |
|---|---|
| `npm run check` | Passed, including 150 tests, static checks, and current support evidence |
| `npm run test:coverage` | Passed, 99.86% lines, 93.17% branches, 99.54% functions |
| Built-in browser local regression fixture | Passed, 110 checks |
| New packaged browser case syntax | Passed |
| `git diff --check` | Passed |
| Live Proshop encoded route | Both selection chips retained |

The browser fixture executes the actual content script. A controlled Chrome API boundary connects captured snapshots to the actual worker Save orchestration and in-memory storage. Content replay runs in the browser against actual fixture DOM controls. It checks:

- namespace capture and replay on an unregistered origin;
- options identified by field/value IDs;
- named options whose generated IDs change between openings;
- unfamiliar plain query keys replayed through DOM mappings;
- Save eligibility and persistence of both selected criteria;
- visible verification, exact required checkbox changes, and idempotency;
- restoration of open and closed menus;
- rejection of unchecked options and ambiguous menu labels;
- reporting of an unmatched applied chip;
- no removal-chip clicks;
- retained capture behavior for Idealo, Decathlon, MediaMarkt, Cyberport, Shop Apotheke, Home24, both OTTO scenarios, and generic native/custom controls.

`scripts/namespaced-menu-browser-cases.mjs` adds corresponding real packaged-extension cases to the existing browser suite. That full packaged suite and a live extension Save/reset/replay run were not executed in this change. The local fixture is not a substitute for those release checks and does not establish a live Verified retailer status.

## Retest in the installed extension

Reload the unpacked extension and refresh the Proshop listing. Capture should show two settings with the selected values Kabel and Hand Modell and allow Save. Save them, clear the shop filters, and replay. If the shop no longer exposes matching checked options, verification should report the affected criterion instead of claiming complete restoration.
