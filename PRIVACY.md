# FilterVault privacy notice

FilterVault stores the page context and filter configuration needed to save and restore your selected shopping filters locally in your browser. This can include retailer hostnames, category or search context, selected filter values, timestamps, declarative locators, and mapping health.

The MVP has no backend, analytics, telemetry, advertising, or cloud synchronization. Saved configurations are not transmitted to a FilterVault server. Export happens only when you explicitly request it.

FilterVault excludes known tracking parameters, session/authentication parameters, credentials, payment fields, address fields, account forms, checkout inputs, and unrelated page content. It never automates login, MFA, consent choices, CAPTCHA challenges, purchases, or checkout.

Persistent saved states use Chrome's local extension storage. Active replay checkpoints use in-memory session storage and are not automatically resumed after a browser restart. Removing the extension clears its local extension storage according to Chrome's storage behavior.
