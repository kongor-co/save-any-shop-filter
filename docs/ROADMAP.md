# FilterVault roadmap

## Current baseline

Version 0.3 provides hostname-aware route handling for twelve German storefronts, deterministic local storage, conservative capture, criterion-level replay results, context review, bounded import plans, and document-bound worker recovery. Packaged Chromium regressions cover cancellation within a plan and real service-worker termination. Retailer verification still requires separate live acceptance.

The canonical repository also runs deterministic, coverage, security, and packaged browser gates in GitHub Actions.

## Priority 1: protect the baseline

- Keep all release tests green on every behavior change.
- Re-run live acceptance before changing a retailer from Limited or Compatible to Verified.
- Track retailer layout drift through fixture updates and criterion-specific diagnostics.
- Keep Chrome permissions minimal and origin access optional.
- Improve Decathlon, Idealo, and other known adapter gaps only with reproducible fixtures.

## Priority 2: maintainability

- Keep continuous integration aligned with the local release command.
- Maintain the generated support matrix and isolated live acceptance scenarios.
- Add issue templates for retailer regressions and new retailer requests.
- Define a repeatable release checklist and versioning policy.
- Keep dated evidence under `docs/reports` rather than mixing it with current guidance.

## Priority 3: careful product expansion

- Evaluate reusable profile values as an optional layer above saved configurations.
- Prototype a personal mapping wizard for advanced users.
- Add explicit mapping-health diagnostics.
- Consider structural fingerprints only as supporting evidence, never as a replacement for semantic verification.
- Consider opt-in automatic application only after permission, cancellation, and rollback behavior is tested.

Detailed constraints are recorded in the proposal documents.

## Explicit non-goals

- Universal automation of arbitrary web controls
- Login, checkout, payment, address, consent, or CAPTCHA automation
- Silent capture of free-form or sensitive fields
- Exact product or result-count equality as verification
- Broad support claims based only on reaching a URL
- Copying predecessor codebases into the canonical implementation

## Release rule

No feature ships merely because it worked once on a live page. It needs deterministic coverage, bounded failure behavior, honest user-visible support state, and a passing packaged extension test.
