# Security policy

Report technical vulnerabilities to `support@kmerhosting.com`.

Do not include passwords, EPP/auth codes, API keys, payment tokens, webhook secrets or personally identifiable registrant data in public issues.

The following are server-side secrets and must remain in Supabase Vault:

- DomainNameAPI API keys
- CamerPay API and callback secrets
- Mailtrap API token
- Internal cron secret
- Sensitive-field encryption key

The Supabase publishable key is intentionally public and does not grant access to protected tables.
