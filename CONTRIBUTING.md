# Contributing to FilterVault

## Repository policy

This is the canonical FilterVault repository. New implementation work belongs here rather than in the archived predecessor repositories.

Use `main` as the integration branch. Create a short-lived branch for one coherent change, for example:

```text
feature/profile-support
fix/decathlon-route-parser
codex/repository-cleanup
```

Keep commits focused. Do not commit generated browser profiles, coverage output, dependency folders, packaged ZIP files, or temporary screenshots.

## Local setup

Requirements:

- Node.js 20 or newer
- Chrome or Chromium for manual extension testing
- Playwright browsers for the packaged browser suite

Install development dependencies:

```powershell
npm ci
```

Load the repository root as an unpacked extension from `chrome://extensions`.

## Required checks

During development, run the narrowest relevant tests first:

```powershell
npm test
npm run test:integration
npm run test:security
```

Before merging a release-affecting change, run:

```powershell
npm run test:release
```

The release command performs static validation, deterministic tests, coverage checks, and packaged Chromium testing. Pull requests to `main` run the same core and browser gates in GitHub Actions.

## Change rules

When adding or modifying retailer support:

1. Add or update a version-controlled route fixture.
2. Test capture, URL sanitation, replay construction, and verification.
3. Prove that host-specific parameters do not leak into generic handling.
4. Report unsupported active controls instead of guessing.
5. Add a deterministic DOM fixture when visible verification or a commit action is claimed.
6. Record a live acceptance result before calling the retailer Verified.

When changing persisted data:

1. Increment the relevant schema version.
2. Add a non-destructive migration.
3. Test older, current, malformed, and future versions.
4. Keep import and export compatibility explicit.

When changing permissions:

1. Explain why the permission is necessary.
2. Prefer optional, per-origin access.
3. Extend the security tests.
4. Update `PRIVACY.md` when data handling changes.

## Definition of done

A change is complete when:

- behavior is deterministic and covered by the appropriate test layer;
- failures identify the affected criterion;
- support labels match actual verification strength;
- privacy and permission boundaries remain intact;
- current documentation is updated; and
- generated artifacts remain outside version control.
