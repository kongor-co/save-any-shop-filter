# FilterVault latest test run

Date: 2026-08-14  
Build: 0.2.0  
Result: Release gates passed; one live storefront was environment-blocked

## Automated results

- Manifest, permission, runtime-file, and JavaScript syntax checks: passed.
- Deterministic suite: 70/70 passed.
- Security/privacy subset: 10/10 passed.
- Storage and cross-shop integration subset: 17/17 passed.
- Shared-core coverage thresholds: passed.
  - Lines: 98.49% (minimum 95%).
  - Branches: 86.03% (minimum 80%).
  - Functions: 98.51% (minimum 90%).
- Packaged Chromium MV3 suite: passed.

The packaged suite exercised capture, Save, route and DOM replay, route-only warnings, five cancellation races, capture instability, unsupported and unresolved controls, default-value omission, sensitive-value exclusion, checkout and restricted-page rejection, popup accessibility, Details, Rename, Duplicate, Delete, Export, and Import.

## Live Browser results

| Storefront | Result | Current evidence |
|---|---|---|
| Amazon.de | Pass | Search phrase and Price: Low to high. |
| Kleinanzeigen | Pass | Apple and 16 GB path facets. |
| Idealo | Pass | Samsung, 12 GB, 8 GB, and lowest-price sort visibly selected. |
| rebuy | Pass with route-only caveat | Galaxy S20, €500 maximum, and ascending result summary; native select still exposes “Beste Ergebnisse.” |
| MediaMarkt | Pass | Price ascending visibly selected. |
| Decathlon | Pass | ADIDAS results and ascending prices. |
| Cyberport | Pass with route-only verification | Search route rendered; the storefront exposes no stable selected sort control in the inspected surface. |
| Zalando | Environment-blocked | Exact target URL retained, but the Browser returned an empty document on the initial attempt and one clean-tab retry. |
| Shop Apotheke | Pass | Price ascending and one category filter. |
| OTTO | Pass | 16 GB, Laptops, and lowest-price sort visibly selected. |
| Autohero | Pass | BMW and lowest-price sort visibly selected. |
| Home24 | Pass | Seller filter and lowest-price sort visibly selected. |

No extension regression was found that requires a code change. Zalando remains covered by the deterministic route contract but cannot be newly certified as a successful live rendering from this run.

