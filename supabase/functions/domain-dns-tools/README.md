# domain-dns-tools

Dedicated customer DNS management Edge Function.

This function is deployed with custom session authentication and `verify_jwt = false`, matching the rest of the custom domain portal auth stack.

Implemented endpoints:

- `GET /domains/:domainId/dns`
  - Returns the domain, local DNS records, current registrar environment and managed-DNS status.
- `POST /domains/:domainId/dns/sync`
  - Reads zone records from DomainNameAPI and imports/upserts them into `domain_dns_records`.
  - Non-mutating provider call only.
- `POST /domains/:domainId/dns`
  - Validates and creates a provider DNS record.
- `PUT /domains/:domainId/dns/:recordId`
  - Validates and updates a provider DNS record.
- `DELETE /domains/:domainId/dns/:recordId`
  - Deletes a provider DNS record and removes the local row after provider success.
- `POST /domains/:domainId/dns/:recordId/retry`
  - Retries the last failed create/update/delete style DNS operation.
- `PUT /domains/:domainId/nameservers`
  - Validates 2 to 13 nameservers and updates provider nameservers.

Record validation implemented by type:

- `A`: IPv4 values.
- `AAAA`: IPv6 values.
- `CNAME`: one hostname target; apex CNAME blocked; CNAME coexistence conflicts blocked.
- `MX`: priority plus hostname target.
- `TXT`: non-empty text values.
- `NS`: nameserver hostnames.
- `SRV`: priority, weight, port and target.
- `CAA`: flag, tag and value.

Environment safety:

- The function compares the domain `registrar_environment` with the active `domain_config.registrar_environment` before any provider mutation.
- Cross-environment domains are blocked before provider calls.
- The lower-level registrar proxy also blocks cross-environment provider calls.

Frontend integration:

- `src/dns-settings-page.tsx` adds the full DNS settings page at `/dashboard/domains/:domainId/dns`.
- `src/dns-settings-link.ts` disables the old simple DNS/nameserver forms on the legacy domain detail page and points users to the complete DNS settings page.
- `src/api.ts` exports `dnsToolsApi`.
- `src/main.tsx` routes the DNS settings path before the old TanStack router.
