# KmerHosting Domain Portal

Customer-facing domain registration platform for **KmerHosting LLC**, designed for deployment at `domain.kmerhosting.com`.

## Stack

- React 19 + TypeScript + Vite
- TanStack Router and TanStack Query
- Supabase Postgres, Vault, Edge Functions, pg_cron and pg_net
- DomainNameAPI for search, registration, transfers, renewals, nameservers and DNS
- CamerPay for XAF checkout
- Mailtrap for OTP and transactional email

The frontend is static and can be deployed on Vercel. It never receives a Supabase service-role key, CamerPay token, Mailtrap token or registrar API key.

## Authentication design

This application intentionally does **not** use `auth.users`. Accounts are stored in prefixed tables:

- `domain_users`
- `domain_otp_challenges`
- `domain_sessions`
- `domain_rate_limits`

Passwords are hashed with bcrypt in the Edge Function. OTP codes and session tokens are stored only as SHA-256 hashes. This keeps the domain application isolated from the other applications sharing the KmerHosting Supabase project.

## Automated lifecycle

1. Customer creates an order.
2. CamerPay creates the checkout and returns a hosted payment URL.
3. A signed webhook or status check confirms payment.
4. An idempotent job registers, transfers or renews the domain.
5. Registrar state is synchronized periodically.
6. Mail and dashboard notifications report the result.
7. Renewal reminders run at 60, 30, 14, 7, 3 and 1 days.
8. Auto-renew creates a renewal order before expiry and sends the customer a payment request.
9. Failed external operations use exponential retries and eventually surface a technical error.

Mobile-money and redirect-based payment methods still require customer authorization. The platform automates everything before and after that authorization; it does not silently debit a customer without a reusable mandate supplied by the payment provider.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:5173`.

## Production build

```bash
npm run typecheck
npm run build
```

The output is written to `dist/`.

## Vercel

1. Import this repository.
2. Framework preset: **Vite**.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add:
   - `VITE_DOMAIN_API_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. Attach `domain.kmerhosting.com`.
7. Point the DNS record to Vercel.

`vercel.json` contains the SPA fallback and baseline security headers.

## Supabase deployment

The live KmerHosting Supabase project already contains the `domain_*` schema, `domain-api` Edge Function and `domain-portal-automation` cron job.

For another project:

```bash
supabase db push
supabase functions deploy domain-api --no-verify-jwt
```

Required Vault entries:

- `domain_mailtrap_token`
- `domain_camerpay_api_token`
- `domain_camerpay_callback_secret`
- `domain_registrar_ote_api_key`
- `domain_registrar_api_key`
- `domain_internal_cron_secret`
- `domain_data_encryption_key`

Provider secrets must never be added to frontend environment variables or committed to Git.

## Current safety default

`domain_config.registrar_environment` is set to `ote`. Switch to `production` only after:

- registrar test searches and registrations pass;
- customer prices are validated;
- DomainNameAPI account balance is funded;
- CamerPay live credentials are installed;
- webhook signatures are verified in live mode;
- legal pages and registration agreements are published.

## Repository layout

```text
src/                         React/TanStack frontend
supabase/functions/domain-api
supabase/migrations/
docs/
vercel.json
```

## Branding

**KmerHosting Domains**  
From KmerHosting LLC  
Support: `support@kmerhosting.com`
