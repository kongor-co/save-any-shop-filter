# Saved filter updates validation

Date: 2026-10-29

## Implemented behavior

Adjust the filters on the original shop and listing, open Library, and choose Update on the saved configuration. A preview shows added, removed, and changed criteria, capture coverage, and omitted controls before confirmation. Cancel preserves the saved entry.

Confirmation captures the page again and rejects stale page state or a changed saved record. The replacement retains the record ID, name, and creation date. Its replay health returns to Unknown until Replay verifies the replacement settings. Different origins, listing contexts, search queries, context criteria, and empty captures cannot replace the configuration. An active replay using that record blocks Update and Undo.

More actions offers Undo last filter update. Only the preceding capture is kept locally. Undo preserves a subsequent rename and clears replay verification. The backup is excluded from exports, duplicates, and imports, and deletion removes it.

Existing capture and replay mappings, retailer schemas, permissions, saved-state schema 4, and mapping version 5 remain in use. The Undo sidecar has an independent format version. Replay preparation coordinates with updates while releasing the record lock before navigation. Late replay metadata is checked against the captured content revision.

## Automated validation

| Check | Result |
|---|---|
| `npm run check` | Passed, including runtime syntax, manifest, permission and support-evidence checks plus 143 tests |
| `npm run test:coverage` | Passed, 143 tests, no failures or skips |
| Core line coverage | 99.85% |
| Core branch coverage | 93.07% |
| Core function coverage | 99.52% |
| New packaged browser case syntax | Passed |
| `git diff --check` | Passed |

The deterministic suite includes all existing retailer route contracts and replay lifecycle tests. New cases cover preview, context checks, replacement identity, one-version Undo, rename, stale confirmation, racing updates, active replay in another tab, quota failure, legacy migration, corruption isolation, and existing export, duplicate, import, and delete behavior. A fast navigation completion regression checks that replay metadata cannot deadlock with record coordination.

## Built-in browser validation

The actual popup files were served from a temporary localhost fixture in the built-in browser. A test-only Chrome boundary connected the popup to the actual service-worker orchestration and in-memory storage harness using fictitious shop data. Saved Nike and current Adidas values provided a visible replacement.

- Preview displayed the before and after values.
- Cancel left Nike saved.
- Confirmation replaced Nike with Adidas while preserving the single Library entry and its name.
- Undo displayed the reverse change and restored Nike.
- Details confirmed the stored values after each operation.

This validates the popup flow against the controlled worker harness. It does not establish real Chrome extension API integration or live-storefront acceptance. Packaged regression cases were added to `scripts/saved-update-browser-cases.mjs`, including replay of replacement criteria and stale-page rejection, but the packaged browser suite was not run locally during this change. The full release gate therefore still requires that run. No new live retailer verification is claimed.
