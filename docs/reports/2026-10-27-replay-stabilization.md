# Replay stabilization validation

Validation date: 27 October 2026

The version 0.3 working tree passes the complete local release gate after replay stabilization. This report records deterministic and packaged Chromium evidence. It does not promote any retailer to live Verified support.

Replay now inspects context before applying filters, presents uncertainty for user confirmation, and ties that confirmation to the inspected document and context. Context comparison tolerates property reordering by Chrome storage. Preflight errors produce a terminal report instead of leaving replay waiting indefinitely.

Replay starts are serialized per tab. Chrome script injection supplies the execution document ID. A restarted worker reconnects to the existing executor and accepts its running or completed result without redispatching the action plan. Missing executors, stale documents, incompatible checkpoints, and document replacement stop continuation. Material search or category changes are checked during actions and waits.

Cancellation prevents later interaction steps, including a pending commit. Unfinished criteria are reported as not attempted. Mapping targets are resolved again between steps and checked against their declared control type. Commit actions require a filter-application label and cannot use the purchase control in the security fixture.

Import validation rejects replay URLs outside the saved origin, URL credentials, unsupported mapping versions, invalid verification rules, unknown executable step fields, oversized locator chains, excessive action counts, and invalid timeouts. Limits are 32 steps per binding, 512 steps per state, 10 locators per chain, and 8000 milliseconds per step. A replay retains one execution deadline, capped at 90 seconds. Explicit context confirmation starts a fresh execution budget after the user's review.

Required criteria with route-only evidence produce a partial result. Warnings on presentation criteria can produce completion with warnings only after required criteria are verified. Popup labels and mapping health preserve the distinction between URL evidence and storefront verification. Inventory unavailability alone does not mark a mapping broken.

Saved-state schema version 4 remains current and version 3 remains migratable. Temporary replay checkpoints use version 3. Existing user changes were preserved, and the predecessor repositories were not changed.

## Validation results

Command: `npm run test:release`

Runtime: Node.js 22.23.3 with the installed Playwright Chromium runtime.

| Check | Result |
|---|---|
| Manifest, permissions, runtime files, JavaScript syntax | Passed |
| Deterministic tests | 90 passed, zero failures or skips |
| Shared-core line coverage | 99.28 percent, minimum 95 percent |
| Shared-core branch coverage | 91.01 percent, minimum 80 percent |
| Shared-core function coverage | 100 percent, minimum 90 percent |
| Packaged Chromium suite | Passed |
| Whitespace and patch validation | Passed |

The packaged browser regressions verified changed-context confirmation through the popup, no mutation before confirmation, incompatible-context rejection, hostile-origin import rejection, cancellation during a wait, rejection of concurrent starts, popup reload after cancellation, actual service-worker termination during replay, exactly one commit after worker reconnection, stopping after user search changes, optional presentation warnings, changed control types, and purchase-control rejection.

The existing generic, Idealo, Decathlon, capture coverage, local Library, import/export, accessibility, and cancellation-race scenarios also passed. The context confirmation screen was visually inspected.

Remaining release work is live storefront acceptance using the exact unpacked build. These fixture results establish the tested execution and lifecycle behavior; they do not establish compatibility with current retailer layouts, redirects, consent walls, or bot challenges.
