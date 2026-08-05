# Registrar environment separation

Production migration applied on 2026-08-05.

Purpose:

- Add `registrar_environment` markers to local domain data.
- Mark historical DomainNameAPI OT&E/test domains as `ote`.
- Keep production data marked as `production`.
- Show test elements in the UI instead of silently mixing them with live objects.
- Block cross-environment operations before provider-side changes.

Applied database changes:

- `domain_current_registrar_environment()` returns the current platform registrar environment.
- `registrar_environment` columns were added to:
  - `domain_domains`
  - `domain_orders`
  - `domain_provider_quotes`
  - `domain_dns_records`
- Existing test metadata rows were marked as `ote`.
- New rows default to the active environment from `domain_config`.
- Check constraints allow only `ote` or `production`.
- Indexes were added for environment-aware lookups.
- `domain_domains_with_environment` view exposes:
  - `environment_is_current`
  - `registrar_environment_label`
- Triggers block writes when a domain/order/quote/DNS record does not match the active registrar environment.
- Job trigger blocks provider jobs for cross-environment targets.

Additional provider guard:

- `domain_registrar_proxy` and `domain_registrar_proxy_env` now check the local domain marker before HTTP calls to DomainNameAPI.
- If a local domain is `ote` and the request is `production`, the proxy fails before contacting DomainNameAPI.
- No live registration, renewal, transfer, restore, DNS, forwarding, or glue-host provider call was made during this migration.
