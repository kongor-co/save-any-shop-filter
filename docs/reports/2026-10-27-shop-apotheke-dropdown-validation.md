# Shop Apotheke dropdown validation

Validation date: 27 October 2026

The reported category and two-pack-size configuration now captures as two semantic filters with no unsupported or unresolved controls. A live packaged-extension acceptance run completed capture, persisted Save, reset, and replay with both criteria independently verified. The category path and both physical indexed pack-size parameters remain intact.

## Causes and changes

The previous advanced-control scan treated every combobox as an autocomplete. Shop Apotheke uses button-based dropdown launchers for these filters. The generic executor now distinguishes these controls from editable autocomplete inputs. An inactive dropdown requires an empty backing field, no meaningful selection, and no matching active URL state. Unknown active dropdowns continue to warn.

The selected pack-size option rows contain readonly, inert checkboxes used as decoration. Capture now records the option row once and resolves its own listbox rather than the broader page filter heading. Active route descriptors provide the field identity and canonical semantic type. This merges URL and DOM state into one pack-size criterion with the values `15 St` and `20x1,4 g`.

Dropdown mappings follow the current `aria-controls` association, including popups rendered elsewhere in the document. They do not persist generated popup or option IDs. Numeric result suffixes are matched against URL values instead of being stored as selected values. Capture inspects matching active menus, reveals a collapsed More filters surface when required, and restores the earlier visibility. Replay opens and resolves menus again, with bounded waits and cancellation checks.

The selected listing chip duplicates the current page heading and is page context. Pagination is also excluded from filter capture. The first live attempt exposed a transient page-one link captured before results settled; removing it from filter state prevents an otherwise correct Save freshness rejection. Search-page classification now uses actual search-query keys, so clearing a pack-size filter does not falsely change the listing surface into an incompatible context.

Shop Apotheke route schema version 2 normalizes the category display and pack-size semantics while keeping the original category path and indexed query keys in replay bindings. New DOM mappings use version 5. Mapping versions 1 through 4 remain accepted. Saved-state schema version 4 and version 3 migration remain unchanged. Production permissions remain unchanged.

## Live acceptance

The [successful live record](../acceptance/records/2026-10-27T15-54-48-819Z.json) applies to the final runtime source fingerprint and the supplied storefront scenario:

- HTTP 200 and two expected semantic criteria captured;
- zero unsupported or unresolved omissions;
- persisted Save round trip confirmed;
- clearing filters demonstrably removed both criteria;
- replay completed with both category and pack-size criteria marked `VERIFIED` through visible storefront evidence.

The [earlier failed attempt](../acceptance/records/2026-10-27T15-53-29-860Z.json) is retained as historical evidence of the pagination defect. It does not override the later result. A live pass applies to this scenario and source, not every control on every retailer.

## Deterministic verification

The new packaged Chromium fixture reproduces all thirteen dropdown launchers, separate popup roots, regenerated IDs, inert checkbox decorations, count suffixes, a current-page chip, pagination, and a collapsed More filters surface. Tests cover closed and open capture, restored menu visibility, changing counts and disappearing pagination between preview and Save, a default relevance menu, URL replay, DOM-only replay, idempotency, generic reuse on an unregistered shop, genuine autocomplete warnings, and duplicate dropdown rejection.

The complete release gate is `npm run test:release`. It includes static checks, 115 deterministic tests, shared-core coverage thresholds, and the packaged Chromium regressions for existing shop support and replay lifecycle behavior.

The final release gate passed with zero test failures or skips. Shared-core coverage is 99.57 percent of lines, 91.82 percent of branches, and 100 percent of functions. Existing Idealo, Decathlon, MediaMarkt, Cyberport, generic shop, cancellation, origin, context, and worker recovery browser regressions passed alongside the new dropdown cases.

## Manual retest

Reload FilterVault at `chrome://extensions`, refresh the supplied listing, and save a new configuration. The popup should show category and pack size as two filters, with both selected pack sizes listed together. Clear those selections and replay the saved configuration. Existing configurations do not automatically lose previously captured duplicate or navigation criteria; recreate the affected configuration from the current page.
