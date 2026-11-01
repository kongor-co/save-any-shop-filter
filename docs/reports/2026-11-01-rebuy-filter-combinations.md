# reBuy filter capture and replay validation

Date: 2026-11-01

The reported Sony headphone configuration now captures, saves and replays successfully. Its category, Sony brand, `f_prop_position_earphonespeaker=ohrumschließend` and `sortBy=price_asc` were independently verified against the live storefront. The passing capture had no omissions.

## Causes and implementation

The generic page classifier missed reBuy product listings when the filter menus were closed. It consequently classified a valid listing as a product detail page. reBuy now has explicit listing recognition based on its listing components, with separate exclusions for product, account, checkout and category-directory pages. Listings with zero results remain eligible.

The existing route schema also assumed a fixed category depth and did not cover all property fields or scalar-to-array transitions. The updated schema handles `f_prop_*` and `f_variant_*` fields dynamically, including scalar, repeated, bracketed and mixed values. Nested audio categories are distinguished from brands. Existing phone and notebook routes remain covered. Saved-filter updates distinguish headphone and speaker listings.

Desktop and compact reBuy layouts expose different selected-state controls. Verification now reads native desktop sorting, compact radio menus, facet removal links, price inputs, display-size controls and boolean filters. Price verification accounts for cents in URLs and euros in inputs. Condition-specific price sorts are supported. Capture restores menus that it opens and does not click filter options or removal chips.

Sensitive parameter names remain excluded. In particular, `earphonespeaker` is a product property and is not mistaken for a private telephone-number field. Contradictory controls still produce an unresolved or partial result.

The extension popup, styling, Settings, permissions and storage format were not changed.

## Live acceptance

Every passing case performed capture, persisted Save, navigation to a reset route, and replay. Every captured criterion was verified from storefront controls. All passing cases had zero omissions.

| Listing | Selected sample plus ascending price sort | Result |
|---|---|---|
| Sony headphones | Headphone position: ohrumschließend | PASS |
| Phones | Release year: 2026 | PASS |
| Tablets and e-readers | Release year: 2026 | PASS |
| Cameras and accessories | Manufacturer: Insta360 | PASS |
| Wearables | Manufacturer: Apple | PASS |
| Consoles and accessories | Manufacturer: ASUS | PASS |
| Apple notebooks | Release year: 2026 | PASS |
| Audio and HiFi | Manufacturer: Amazon | PASS |
| Books | Product type: Adressbuch | PASS |
| Films | Language: Deutsch | PASS |
| Video games | VR game: Ja | PASS |
| Music | Product type: Audio-CD | PASS |
| Gift vouchers | Minimum price: 10 euros | PASS |
| Apple Mac mini | Release year: 2026 | PASS |

The [category acceptance record](../acceptance/records/2026-11-01T10-23-10-917Z.json) contains 13 passes and a Sony case blocked by a late cookie-consent banner. The [focused Sony rerun](../acceptance/records/2026-11-01T10-43-56-344Z.json) passed after the test harness handled that necessary-cookie choice. Both records retain the actual outcomes and runtime fingerprints. Consent handling is confined to the isolated test profile.

The directory's Apple marketing landing page has no listing filter surface and remains intentionally excluded. Product pages, account pages, checkout and the category directory were also tested as exclusions.

## Deterministic coverage

The live directory survey identified 50 distinct facet fields across 14 directory entrypoints, plus the reported Sony listing. The [catalog inventory](../../tests/fixtures/rebuy-catalog.json) records the observed fields, sample values and related paths.

| Check | Result |
|---|---|
| Every facet-presence subset for each surveyed listing configuration | 117,681 URL-state combinations passed |
| All 50 surveyed fields plus an unfamiliar future property name | Scalar, repeated, bracketed and mixed encodings passed |
| Packaged extension capture, Save, reset and verified replay | 16 complete configurations passed |
| Responsive controls | Compact radio sorting and desktop native sorting passed |
| Additional behavior | Unicode, punctuation, cents, display sizes, availability, sale, condition sorts, both hosts and repeat replay passed |
| Defensive behavior | Contradictory selection, excluded pages and inactive defaults passed |
| Full release command | `npm run test:release` passed |
| Unit suite | 172 passed, zero failures |
| Shared modules and route schemas coverage | 99.87 percent lines, 93.63 percent branches, 99.56 percent functions |

The full packaged browser suite also passed the existing Idealo, Decathlon, MediaMarkt, Cyberport, Shop Apotheke, Home24, OTTO, generic webshop, replay lifecycle, Library, saved-update and Settings regressions.

## Coverage limits

The 117,681 combinations exhaust the presence or absence of the recorded facet fields within the surveyed configurations. They use sample values and reconstructed controls. They are not 117,681 live storefront visits, and some synthetic combinations can have no matching products.

The live checks cover the 14 cases listed above. They do not exhaust every changing catalog value, every nested category, every combination of values, or every viewport. The implementation uses the shared reBuy filter protocol rather than an allowlist of those sample values. Future storefront changes or attributes without independent control evidence can still require additional support.

To repeat the live checks, run `npm run test:live -- --shop rebuy-de --record`. To repeat only the reported case, add `--scenario rebuy-sony-headphones`. Run `npm run support:update` after recording evidence.

Reload the unpacked extension and refresh an already open reBuy tab before testing the updated content script.
