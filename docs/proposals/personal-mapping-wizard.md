# Proposal: personal mapping wizard

## Status

Exploration only. This proposal preserves mapping ideas from `auto-filter-assistant-2` while retaining FilterVault validation and replay guarantees.

## Problem

Retailer interfaces change frequently, and some shops use custom controls that cannot be safely supported through generic discovery. An advanced user could teach the extension how a visible control corresponds to a known local attribute or criterion.

## Proposed workflow

1. The user starts mapping mode for the current retailer.
2. The extension limits selection to the active listing or filter surface.
3. The user selects a filter group, option, or commit control.
4. FilterVault records semantic context plus a structural fingerprint.
5. The user confirms the intended value and expected final state.
6. A dry run resolves the mapping and verifies the result.
7. Only a successful, validator-approved mapping can be enabled.

## Mapping health

Suggested states:

- `UNTESTED`: created or imported but not validated on the current page.
- `HEALTHY`: resolution and verification succeeded recently.
- `DEGRADED`: fallback evidence was required or some optional evidence changed.
- `BROKEN`: the control cannot be resolved or verified.
- `DISABLED`: explicitly turned off by the user.
- `PERMISSION_REQUIRED`: origin access is not currently granted.

## Data rules

- Store declarative locators and fingerprints, never executable script text.
- Scope selectors to a verified filter surface.
- Store normalized labels separately from original evidence.
- Reject ambiguous matches.
- Let personal mappings override official mappings only by explicit user choice.
- Preserve the official mapping so the override can be removed safely.
- Export personal mappings separately from saved shopping configurations.

## Required tests

- Unique and ambiguous element selection
- Layout drift and stale fingerprints
- Hidden or virtualized options
- Required Apply or Save actions
- Permission denial
- Cancellation during mapping and replay
- Host isolation
- Malicious imports
- Upgrade and rollback behavior

## Decision gate

Build this only after a small prototype proves that mapping creation, drift detection, and rollback can remain understandable to a non-technical user.
