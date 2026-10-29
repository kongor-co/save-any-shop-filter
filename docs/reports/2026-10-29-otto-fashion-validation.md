# OTTO fashion filter validation

Date: 2026-10-29

## Cause

The reported listing uses `stil=elegant,erotisch`, `us-groessen=s`, and `zielgruppe=damen`. OTTO schema version 2 did not recognize these parameter names, so none became saved route criteria. The page exposes each selected option twice: its original checkbox or radio button and a custom removal chip. Generic capture could not resolve the originals unambiguously, and correctly refused to turn removal chips into replay actions. With zero replayable criteria, Save was disabled.

Read-only inspection in the built-in browser confirmed the live original input names and values, the S size button, the selected Damen radio button, and the four corresponding removal chips. The fix uses those observed identities.

## Change

OTTO route schema version 3 adds style, US size, and target-group descriptors. The two styles form one criterion. US size retains the physical lowercase `s` while displaying S, and the audience retains `damen` while displaying Damen. Comma-separated and repeated choices preserve their original query representation.

The existing content evidence contract requires both checked original controls and matching visible removal chips before replay is verified. The generic executor is unchanged. Contradictory or missing evidence still produces warnings and route-only results. Unknown shops do not inherit the OTTO parameter definitions.

The saved-state schema, mapping version, permissions, existing appliance filters, Update, and Undo remain unchanged. Version 2 bindings continue to use the existing validator and replay paths.

## Validation

| Check | Result |
|---|---|
| `npm run check` | Passed, 146 tests with no failures or skips |
| `npm run test:coverage` | Passed, 99.86% lines, 93.00% branches, 99.53% functions |
| Built-in browser local fixture | Passed, 17 capture, Save, reset, replay, and negative checks |
| Browser case syntax | Passed |
| `git diff --check` | Passed |

The fixture runs the actual content executor in a browser DOM matching the observed control structure, including custom elements with open shadow roots. A controlled Chrome message boundary connects captured snapshots to the actual worker Save orchestration and in-memory storage. At that boundary, the local fixture URL is represented as the canonical OTTO URL for the worker. Replay uses the actual content executor on the local URL with the saved query bindings. This fixture validates the declared control behavior without claiming real extension API integration or a live storefront Save and replay pass.

It confirms:

- three filter groups representing all four selected options;
- no unresolved duplicates or unsupported controls for this fixture;
- Save eligibility and persistence of all three groups;
- zero selected controls after reset;
- complete replay with all three criteria visibly verified;
- repeated replay without clicking removal chips;
- unchecked originals cannot be verified by matching chips;
- missing size chips and incorrect audience labels remain unverified;
- extra checked style choices remain warnings.

The existing deterministic retailer, saved-update, storage, and replay-lifecycle tests pass. The cross-shop fixture now includes a second OTTO category. Its metadata assertion checks all twelve approved schema identities and unique scenario names rather than requiring exactly twelve scenarios.

`scripts/otto-fashion-browser-cases.mjs` adds packaged-extension cases to the existing OTTO browser suite. That packaged suite was not run locally during this change. Full packaged and live storefront acceptance remain separate release checks. No new live Verified status is claimed.

## Retest

Reload the unpacked extension and refresh the OTTO listing. Open FilterVault on the reported URL. Expect style choices elegant and erotisch, US size S, and target group Damen, grouped as three saved settings. Save the configuration, clear these choices on the shop, and use Replay to check their restoration. Any unrelated unsupported controls should continue to be reported.
