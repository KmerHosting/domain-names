# Implementation status — 25 July 2026

## Deployed in KmerHosting Supabase

- All `domain_*` tables, constraints, indexes and server-only RLS boundaries.
- Custom user accounts, bcrypt passwords, email OTP, hashed bearer sessions and rate limiting.
- `domain-api` Edge Function with domain search, contacts, orders, CamerPay, registrar jobs, DNS, invoices, notifications and lifecycle endpoints.
- Mailtrap transactional email and CamerPay configuration inherited server-side from wFileManager.
- Five-minute `domain-portal-automation` cron with idempotent jobs, exponential retries, domain synchronization and renewal reminders.
- Health, public prices and automation endpoints tested successfully.

## Safe defaults

- Registrar environment is `ote`.
- Frontend receives only the Supabase URL and publishable key.
- EPP transfer codes are encrypted before database storage.
- Provider secrets are read only from Supabase Vault.

## Repository

The source is published in `toscani-tenekeu/domain.kmerhosting.com` on the `main` branch.

## Remaining secure operations

1. Store the registrar OT&E key as `domain_registrar_ote_api_key` in Supabase Vault.
2. Store the registrar production key as `domain_registrar_api_key` in Supabase Vault.
3. Complete an OT&E registration, transfer, renewal, nameserver and DNS acceptance test.
4. Replace CamerPay test credentials with live credentials before production.
5. Deploy the frontend to Vercel and connect `domain.kmerhosting.com`.

Do not switch `domain_config.registrar_environment` to `production` before the OT&E acceptance test passes.
