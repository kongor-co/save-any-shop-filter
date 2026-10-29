# FilterVault documentation

## Current guidance

- [Architecture](ARCHITECTURE.md): module boundaries, data flow, and extension points.
- [Roadmap](ROADMAP.md): prioritized future work and explicit non-goals.
- [Test strategy](TEST_STRATEGY.md): test layers, release gate, and retailer acceptance policy.
- [Support evidence](SUPPORT.md): generated route coverage and dated live scenario results.
- [Live acceptance](LIVE_ACCEPTANCE.md): isolated retailer runs, evidence recording, and manual CI.
- [Contributing](../CONTRIBUTING.md): development workflow and completion criteria.

## Research inventories

The [OTTO parameter inventory](research/otto-parameters-2026-10-29/README.md) records the October 29, 2026 public category sitemap scan and browser observations. It separates published query names, live URL evidence, and control-only field names, with listing-path mappings and explicit completeness limits.

## Product proposals

- [Profile-based automation](proposals/profile-based-automation.md)
- [Personal mapping wizard](proposals/personal-mapping-wizard.md)

These proposals preserve useful ideas from predecessor prototypes. They are not commitments and should not be implemented without the stated safety gates.

## Historical evidence

- [OTTO fashion filter validation, October 2026](reports/2026-10-29-otto-fashion-validation.md)
- [Saved filter updates validation, October 2026](reports/2026-10-29-saved-filter-updates.md)
- [OTTO filter validation, October 2026](reports/2026-10-27-otto-filter-validation.md)
- [Home24 filter validation, October 2026](reports/2026-10-27-home24-filter-validation.md)
- [Shop Apotheke dropdown validation, October 2026](reports/2026-10-27-shop-apotheke-dropdown-validation.md)
- [Cyberport and range-control validation, October 2026](reports/2026-10-27-cyberport-range-validation.md)
- [MediaMarkt and generic facet validation, October 2026](reports/2026-10-27-mediamarkt-facets.md)
- [Live acceptance infrastructure validation, October 2026](reports/2026-10-27-live-acceptance.md)
- [Replay stabilization validation, October 2026](reports/2026-10-27-replay-stabilization.md)
- [Cross-shop QA report, August 2026](reports/2026-08-cross-shop.md)
- [Release test report, August 2026](reports/2026-08-release.md)
- [Post-QA implementation plan](archive/2026-08-post-qa-plan.md)
- [Post-QA implementation report](archive/2026-08-post-qa-report.md)

Files under `reports` and `archive` describe a point in time. Current behavior is defined by source code, tests, and current guidance.
