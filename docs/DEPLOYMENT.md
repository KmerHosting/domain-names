# Production checklist

## 1. Registrar

- Install the OT&E key in `domain_registrar_ote_api_key`.
- Test availability, contact payloads, registration, nameservers and DNS.
- Install the production key in `domain_registrar_api_key`.
- Fund the DomainNameAPI reseller account.
- Review the sell prices in `domain_tld_prices`.
- Change `domain_config.registrar_environment` from `ote` to `production`.

## 2. CamerPay

- Replace the test token with the live token.
- Configure the callback URL to the deployed Edge Function.
- Configure the return URL to `https://domain.kmerhosting.com/payment/return`.
- Confirm the HMAC header and signed payload in a real low-value transaction.
- Verify Orange Money, MTN MoMo, card and PayPal methods independently.

## 3. Email

- Validate `support@kmerhosting.com` in Mailtrap.
- Add SPF, DKIM and DMARC records.
- Confirm OTP, payment, provisioning, transfer and expiry templates.

## 4. Frontend

- Deploy to Vercel.
- Add the two public `VITE_*` variables.
- Connect `domain.kmerhosting.com`.
- Test SPA deep links.
- Verify CORS from the production domain.

## 5. Legal and policy

Publish terms of service, privacy policy, refund policy, domain registration agreement, transfer agreement, renewal/expiration policy and abuse reporting procedure.

## 6. Operational acceptance

- Create and verify a test user.
- Create a registrant contact.
- Search a domain in OT&E.
- Create a registration order.
- Complete CamerPay sandbox checkout.
- Confirm the webhook is stored once.
- Confirm exactly one registrar job is created.
- Confirm the result email is sent.
- Confirm nameserver and DNS changes.
- Simulate an expiry reminder.
- Review Supabase security and performance advisors.
