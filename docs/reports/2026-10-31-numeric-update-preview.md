# Numeric saved-filter update previews

## Cause and change

GitHub Actions run 41046040733 failed in the packaged Chromium suite because the saved-filter update preview showed `Minimum price` without the new value `60`. The numeric capture retained the replay value, but the preview preferred its label-only observed representation.

The preview now reads numeric values from existing DOM bindings and displays the control label with its value. Lower and upper range endpoints retain their identity, including when both endpoints have the same number. Update and Undo use the same formatter. Friendly select labels and URL-only representations retain their existing behavior, with desired values as the fallback for empty observations.

Capture criteria, stored records, replay mappings, permissions and persistence schemas remain unchanged. The generated support report was refreshed for the runtime source fingerprint.

## Regression coverage

Deterministic cases cover changed prices, zero, Undo, equal range endpoints, older captures, missing labels, native select labels and non-mutation of captured data. The packaged update case now checks a price change from 25 to 60 and its reverse Undo preview, alongside cancellation, persistence, replay and stale-confirmation rejection.

## Validation

- Focused update tests: 18 passed.
- Static validation and all deterministic tests: 153 passed.
- Coverage gates passed: 99.86 percent lines, 93.39 percent branches, 99.55 percent functions.
- Packaged Chromium suite: passed, including numeric Update and Undo previews, cancellation, persistence, replacement replay, stale-confirmation rejection, all existing shop fixtures, Library scoping and generic namespaced filters.
- `git diff --check`: passed.

The first local release invocation reached Chromium after passing core checks, but the sandbox blocked browser startup. The packaged suite was restarted with the required execution permission. These are fixture-based extension integration checks; no new live-shop acceptance is claimed.
