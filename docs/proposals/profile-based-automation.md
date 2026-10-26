# Proposal: profile-based automation

## Status

Exploration only. This proposal preserves a useful concept from `auto-filter-assistant-2` without importing its implementation.

## Problem

Saved configurations are ideal for restoring a specific shopping route. Users may also want reusable preferences such as shoe size, clothing size, preferred brands, colors, materials, or default sorting across several searches.

## Proposed model

Add an optional local profile containing typed attributes. A retailer mapping may translate a supported attribute into a normal FilterVault criterion or approved action plan.

The profile must not bypass existing safety layers:

```text
profile value
  -> explicit retailer mapping
  -> validated criterion or action plan
  -> normal replay executor
  -> criterion-level verification
```

## Required safeguards

- Profile use is opt-in per retailer.
- Values stay in local extension storage.
- Sensitive free-form values are not eligible.
- Every mapping declares supported value types and normalization.
- Unmapped values are skipped visibly.
- Automatic use requires optional per-origin permission.
- A failed application does not change the saved profile.
- Existing cancellation and replay deadlines apply.

## Delivery sequence

1. Define a small typed attribute schema.
2. Add storage migration and import validation.
3. Implement one deterministic fixture using existing route semantics.
4. Present a preview before application.
5. Verify every applied value through the existing coverage model.
6. Run a limited live pilot before adding another retailer.

## Decision gate

Do not implement this feature until core retailer regressions are stable and continuous integration runs the complete release gate.
