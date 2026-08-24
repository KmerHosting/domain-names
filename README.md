# KmerHosting Domain Portal

Customer-facing domain registration platform for **KmerHosting LLC**, deployed at `domain.kmerhosting.com`.

## Stack

- React 19 + TypeScript + Vite
- TanStack Router and TanStack Query
- Supabase Postgres, Vault, Edge Functions and pg_cron
- DomainNameAPI for search, registration, transfers, renewals, nameservers and DNS
- Internal USD account balance for order payments
- Mailtrap for OTP and transactional email

The frontend is static and can be deployed on Vercel. It never receives a Supabase service-role key, Mailtrap token or registrar API key.

## Payment model

The platform is **wallet-only**:

1. Support manually credits a customer's USD account balance after verification.
2. Customers contact `support@kmerhosting.com` when they need a balance credit.
3. Registration, transfer and renewal orders are paid from that account balance.
4. An atomic database function debits the balance, records the transaction, creates the paid invoice and queues the registrar operation.
5. External checkout, payment callbacks and payment polling are disabled.

Historical payment rows are retained as accounting records, but no external payment provider is used by the active application.

## Authentication design

This application intentionally does **not** use `auth.users`. Accounts are stored in prefixed tables:

- `domain_users`
- `domain_otp_challenges`
- `domain_sessions`
- `domain_rate_limits`

Passwords are hashed with bcrypt in the Edge Function. OTP codes and session tokens are stored only as SHA-256 hashes. This keeps the domain application isolated from the other applications sharing the KmerHosting Supabase project.

## Automated lifecycle

1. Customer creates an order.
2. The order remains pending until it is paid from the account balance.
3. The wallet transaction is applied atomically and an idempotent job is queued.
4. The job registers, transfers or renews the domain through DomainNameAPI.
5. Registrar state is synchronized periodically.
6. Email and dashboard notifications report the result.
7. Renewal reminders run at 60, 30, 14, 7, 3 and 1 days.
8. Auto-renew creates a renewal order before expiry; the customer pays it from their balance.
9. Failed provider operations use retries and surface an actionable error.

## Local development

```bash
cp .env.example .env.local
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5173`.

## Production build

```bash
bun run typecheck
bun run build
```

The output is written to `dist/`.

## Vercel

1. Import this repository.
2. Framework preset: **Vite**.
3. Build command: `bun run build`.
4. Output directory: `dist`.
5. Configure `SUPABASE_FUNCTIONS_BASE` and `SUPABASE_PUBLISHABLE_KEY` as server-side variables.
6. Keep `VITE_DOMAIN_PROXY_BASE=/api/domain`.
7. Attach `domain.kmerhosting.com`.

`vercel.json` contains the SPA fallback and baseline security headers. Browser requests use the same-origin `/api/domain` proxy so session tokens remain in HttpOnly cookies.

## Supabase deployment

For another project:

```bash
supabase db push
supabase functions deploy domain-api --no-verify-jwt
supabase functions deploy domain-wallet --no-verify-jwt
supabase functions deploy domain-platform-status --no-verify-jwt
```

Required Vault entries:

- `domain_mailtrap_token`
- `domain_registrar_ote_api_key`
- `domain_registrar_api_key`
- `domain_internal_cron_secret`
- `domain_data_encryption_key`

Provider secrets must never be added to frontend environment variables or committed to Git.

## Live safety conditions

`domain_config.registrar_environment` must be `production`. Before accepting orders:

- validate customer prices against provider costs;
- fund the DomainNameAPI USD reseller balance;
- ensure the production registrar key is configured;
- verify order, wallet, job and notification flows;
- publish the required legal and registration terms.

## Repository layout

```text
src/                                      React/TanStack frontend
api/domain/                               Same-origin Vercel proxy
supabase/functions/domain-api             Domain account and order API
supabase/functions/domain-wallet          Wallet payment and manual admin credit API
supabase/functions/domain-platform-status Live/maintenance status API
supabase/migrations/                       Database migrations
```

## Branding

**KmerHosting Domains**  
From KmerHosting LLC  
Support: `support@kmerhosting.com`
