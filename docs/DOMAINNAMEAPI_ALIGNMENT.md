# DomainNameAPI alignment

This portal is a domain-name platform. It does not expose SSL-certificate products or sub-reseller/account-reselling products.

## Provider environments

- Production API: `https://api.domainresellerapi.com/api/v1`
- OTE API: `https://ote.domainresellerapi.com/api/v1`
- Customer-facing search and paid orders use production.
- Provider-mutating automated tests must use OTE.
- Every local domain, order, quote, DNS record and job carries or derives a registrar environment.
- Cross-environment write jobs are blocked in PostgreSQL.

## Official endpoint mapping

| Capability | Method | DomainNameAPI endpoint |
| --- | --- | --- |
| Search | POST | `/domains/search` |
| Bulk search | POST | `/domains/bulk-search` |
| Domain information | GET | `/domains/info?DomainName=` |
| Register with contacts | POST | `/domains/register-with-contacts` |
| Transfer check | POST | `/domains/transfers/check` |
| Transfer submit | POST | `/domains/transfer` |
| Transfer status | POST | `/domains/transfers/query` |
| Transfer cancel | POST | `/domains/transfers/cancel` |
| Transfer approve | POST | `/domains/transfers/approve` |
| Transfer reject | POST | `/domains/transfers/reject` |
| Renew eligibility | POST | `/domains/renew/check` |
| Renew | POST | `/domains/renew` |
| Restore | POST | `/domains/restore` |
| Lock / unlock | POST | `/domains/lock` and `/domains/unlock` with `{domainName}` |
| Privacy | POST | `/domains/privacy` with `privacyStatus` |
| Nameservers | PUT | `/domains/dns/name-server` |
| List DNS zone | GET | `/domains/zones?domainName=` |
| Create DNS record | POST | `/domains/zones?domainName=` |
| Modify DNS record | PUT | `/domains/zones?domainName=&recordName=` |
| Delete DNS record | DELETE | `/domains/zones?domainName=&Name=&Record=&RecordType=` |
| Apply DNS zone | POST | `/domains/zones/apply?domainName=` |
| Add child nameserver | POST | `/domains/dns/host` |
| Edit child nameserver | PUT | `/domains/dns/host` |
| Delete child nameserver | DELETE | `/domains/dns/host?DomainName=&HostName=` |
| Get forwarding | GET | `/domains/forwards?domainName=` |
| Create forwarding | POST | `/domains/forwards` |
| Delete forwarding | DELETE | `/domains/forwards?DomainName=` |
| Create contact | POST | `/contacts` with `{ contact }` |
| Update contact | PUT | `/contacts/{handleCode}` with `{ contact }` |
| Contact verification status | GET | `/contacts/verification/check` |
| Request verification | POST | `/contacts/verification/request` |
| TLD catalog | GET | `/products/tlds` |
| Exact product price | GET | `/products/info` |
| Provider domains | GET | `/domains` |
| Provider order | GET | `/order/{orderCode}` |
| Provider balance | GET | `/deposit/accounts/me` |
| Provider transactions | GET | `/deposit/transactions` |

## Canonical payload rules

### Contact roles

The local canonical roles are:

- `Registrant`
- `Administrative`
- `Technical`
- `Billing`

DomainNameAPI registration/update payloads use:

- `Registrant`
- `Admin`
- `Tech`
- `Billing`

The adapter performs this mapping. UI and database code must not invent additional aliases.

### Registration

A registration request is built from an unexpired production quote and includes:

- `domainName`
- exact supported `period`
- 2–13 `nameServers`
- `isLocked`
- `privacyEnabled` only when supported
- four contact roles
- validated `tldAttributes`

Required TLD attributes and allowed values come from the provider catalog.

### Child nameservers

`ipAddresses` is an array of objects:

```json
[
  { "ipAddress": "192.0.2.10", "ipVersion": "v4" },
  { "ipAddress": "2001:db8::10", "ipVersion": "v6" }
]
```

### DNS records

The local API accepts A, AAAA, CNAME, MX, TXT, NS, SRV and CAA records. It converts structured fields into DomainNameAPI `zoneStruct`, sends the create/update/delete request, calls `/domains/zones/apply`, and only then marks the local record active.

## Pricing and billing invariants

- Currency is USD.
- Customer account top-ups are manual support credits through `support@kmerhosting.com`.
- External checkout providers are retired and return HTTP 410.
- Direct balance replacement is blocked by a database trigger.
- Manual credits are atomic, idempotent and audited.
- Each paid domain operation requires an unexpired production provider quote.
- Exact period pricing is stored in `domain_tld_period_prices`.
- Restore uses the provider restore price, never the renewal price.
- Premium registrations require the exact premium price returned by search.
- Customer price must be at least provider cost plus the configured margin.
- Provider balance is verified immediately before wallet payment and again before the registrar write.
- The provider write runs only after the wallet payment commits.
- A terminal provisioning failure refunds the customer wallet idempotently.

## Test policy

Allowed production tests:

- health endpoints
- authentication with deliberately invalid credentials
- public domain search
- provider catalog, balance and reconciliation reads

Provider-mutating tests are prohibited in production. Registration, transfer, renewal, restore, DNS, contact, lock, privacy, forwarding and child-nameserver test writes must use OTE and dedicated OTE data.

## Current automated workers

- Domain job worker: paid registration, transfer, renewal, restore and environment-safe synchronization.
- Domain automation: lifecycle reminders, exact-price balance-aware auto-renewal and synchronization queueing.
- Provider catalog: daily production TLD/period/restore/attribute synchronization.
- DNS synchronization: explicit user synchronization and provider-backed changes.

Legacy payment polling and duplicate transfer/catalog workers are unscheduled.
