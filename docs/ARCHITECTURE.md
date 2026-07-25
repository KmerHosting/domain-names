# Architecture

## Trust boundaries

The browser can access only the public Edge Function URL and the Supabase publishable key. All database writes are performed by `domain-api` with the service-role client after custom session validation.

RLS is enabled on every `domain_*` table. There are no customer policies on sensitive tables. The only anonymous database read policy is the enabled TLD price catalogue.

## Components

### Frontend

The React SPA uses TanStack Router for code-based routing and TanStack Query for server-state caching. The custom session token is stored in local storage and sent as a Bearer token to the Edge Function.

### Custom identity

`domain_users` is independent from Supabase Auth. Registration and passwordless sign-in use email OTP challenges. Password sign-in uses bcrypt. `session_version` invalidates every active session after a password reset or account security action.

### Payments

Orders and payments use separate idempotency keys. CamerPay status can be accepted only when:

- the signature is valid for webhooks;
- the invoice or provider reference matches a stored payment;
- the paid amount is at least the expected XAF amount;
- the operation has not already been processed.

### Registrar

The registrar client selects OT&E or production from `domain_config`. It uses the Swagger-defined `__reseller` and `X-API-KEY` headers and `/api/v1` endpoints.

### Jobs

`domain_jobs` is claimed with `FOR UPDATE SKIP LOCKED`. Jobs are idempotent and use exponential retry delays. The queue supports registration, transfer, renewal, domain synchronization, nameserver changes, DNS changes and payment checks.

### Email

Authentication OTP emails are synchronous because the user is waiting for the code. All lifecycle and billing emails use `domain_email_outbox` and automatic retry.

### Cron

`pg_cron` invokes the Edge Function automation endpoint every five minutes using a Vault-backed internal secret. Each run performs lifecycle checks, queues registrar synchronization, processes jobs, sends mail and deletes expired sessions/challenges.

## Data isolation

Every application-owned table starts with `domain_`. No migration changes permissions or defaults for wFileManager or another application in the shared Supabase project.
