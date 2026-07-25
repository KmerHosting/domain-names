# DomainNameAPI provider coverage

The production backend now exposes the remaining DomainNameAPI capabilities through the Supabase Edge Function `domain-provider` and supporting workers.

## Public/customer-safe endpoints

- `GET /capabilities`
- `POST /transfers/check`
- `POST /contacts/{contactId}/provider`
- `GET /contacts/{contactId}/provider`
- `PUT /contacts/{contactId}/provider`
- `POST /contacts/{contactId}/verification`
- `POST /domains/{domainId}/renew-check`
- `POST /domains/{domainId}/transfer-query`
- `POST /domains/{domainId}/restore` with `confirm: true`
- `PUT /domains/{domainId}/contacts`
- `GET /domains/{domainId}/forwards`
- `POST /domains/{domainId}/forwards`
- `DELETE /domains/{domainId}/forwards`
- `POST /domains/{domainId}/glue-hosts`
- `PUT /domains/{domainId}/glue-hosts/{hostId}`
- `DELETE /domains/{domainId}/glue-hosts/{hostId}`
- `GET /orders/{orderId}/provider-status`

## Admin-only endpoints

Admin-only endpoints require a signed-in `domain_users.role = 'admin'` account.

- `GET /admin/account`
- `GET /admin/transactions`
- `GET /admin/provider-domains`
- `GET /admin/products`
- `GET /admin/products/tlds`
- `POST /admin/products/tlds/sync`
- `GET /admin/products/info`

## Supporting Edge Functions

- `domain-search-fast` uses the official `/api/v1/domains/bulk-search` endpoint when multiple domains are searched, and falls back to individual `/search` if the provider bulk call fails.
- `domain-transfer-worker` runs every minute and handles paid `transfer_domain` jobs using the encrypted EPP/auth code, then clears the stored code after provider submission.
- `domain-documents` generates invoice and receipt PDFs with PDFKit.

## Current provider limitation

The platform implements the official zone endpoints:

- `GET /api/v1/domains/zones`
- `POST /api/v1/domains/zones`
- `PUT /api/v1/domains/zones`
- `DELETE /api/v1/domains/zones`
- `POST /api/v1/domains/zones/apply`

The tested OT&E account still returns provider-side `403`, `429`, or `500` responses for zone operations. The UI now marks failed DNS records as `failed` instead of leaving them silently pending. DomainNameAPI must enable or fix Zone/DNS API access for the reseller environment before those operations can succeed at the provider layer.
