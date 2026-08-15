import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  ApiError, Json, audit, bodyJson, clean, clientIp, createSession, db, encryptSensitive,
  enforceRateLimit, functionPath, getConfig, getSecret, getTld, hashPassword, json,
  normalizeDomain, normalizeEmail, normalizePhone, notify, publicUser, queueEmail,
  randomCode, randomReference, requireAuth, runtimeStatus, sendOtp, sha256, userAgent,
  validDomain, validEmail, verifyPassword,
} from "./core.ts";
import {
  camerPayStatus, initiateCamerPay, isPaymentPaid, newInvoiceId, paymentFields,
  searchDomain, verifyCamerPayWebhook,
} from "./providers.ts";
import { markPaymentPaid, runAutomation, runEmails, runJobs } from "./worker.ts";

function errorResponse(req: Request, error: unknown): Response {
  if (error instanceof ApiError) return json(req, { error: error.code, message: error.message, details: error.details }, error.status);
  console.error(error);
  return json(req, { error: "internal_error", message: error instanceof Error ? error.message : "Unexpected server error." }, 500);
}

async function requestOtp(req: Request, purpose: string, body: Json): Promise<Response> {
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) throw new ApiError(400, "invalid_email", "A valid email address is required.");
  await enforceRateLimit(`otp-ip:${clientIp(req)}`, 10, 900);
  await enforceRateLimit(`otp-email:${purpose}:${email}`, 4, 900);
  const cfg = await getConfig();
  let user: Json | null = null;
  if (purpose !== "registration") {
    const found = await db.from("domain_users").select("*").eq("email", email).maybeSingle();
    user = found.data || null;
    if (!user) return json(req, { success: true, message: "If the account exists, an OTP was sent." });
  } else {
    const found = await db.from("domain_users").select("id").eq("email", email).maybeSingle();
    if (found.data) throw new ApiError(409, "email_exists", "An account already exists with this email.");
  }
  const code = randomCode();
  const codeHash = await sha256(`${purpose}:${email}:${code}`);
  let passwordHash: string | null = null;
  const profilePayload: Json = {};
  let recipientName = user?.full_name || clean(body.fullName);
  if (purpose === "registration") {
    const password = clean(body.password);
    passwordHash = await hashPassword(password);
    if (recipientName.length < 2 || recipientName.length > 120) throw new ApiError(400, "invalid_name", "Full name is required.");
    profilePayload.fullName = recipientName;
    profilePayload.phone = normalizePhone(body.phone) || null;
    profilePayload.countryCode = clean(body.countryCode).toUpperCase().slice(0, 2) || null;
  }
  await db.from("domain_otp_challenges").delete().eq("purpose", purpose).eq("email", email).is("consumed_at", null);
  const { data: challenge, error } = await db.from("domain_otp_challenges").insert({
    purpose, user_id: user?.id || null, email, code_hash: codeHash, password_hash: passwordHash,
    profile_payload: profilePayload, expires_at: new Date(Date.now() + cfg.otp_ttl_minutes * 60_000).toISOString(),
    client_ip: clientIp(req),
  }).select("id,expires_at").single();
  if (error) throw new ApiError(500, "otp_create_failed", "Unable to create OTP challenge.", error);
  await sendOtp(email, recipientName, code, purpose);
  await audit(req, `auth.${purpose}.otp_requested`, user?.id || null, "otp", challenge.id);
  return json(req, { success: true, challengeId: challenge.id, expiresAt: challenge.expires_at, message: "OTP sent." });
}

async function verifyOtp(req: Request, purpose: string, body: Json): Promise<Response> {
  const email = normalizeEmail(body.email);
  const code = clean(body.code);
  if (!validEmail(email) || !/^\d{6}$/.test(code)) throw new ApiError(400, "invalid_otp", "Email and six-digit code are required.");
  await enforceRateLimit(`otp-verify:${clientIp(req)}:${email}`, 12, 900);
  const { data: challenge, error } = await db.from("domain_otp_challenges").select("*")
    .eq("purpose", purpose).eq("email", email).is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !challenge) throw new ApiError(400, "otp_expired", "OTP expired or invalid.");
  if (Number(challenge.attempts) >= Number(challenge.max_attempts)) throw new ApiError(429, "otp_locked", "Too many invalid OTP attempts.");
  const submitted = await sha256(`${purpose}:${email}:${code}`);
  if (submitted !== challenge.code_hash) {
    await db.from("domain_otp_challenges").update({ attempts: Number(challenge.attempts) + 1 }).eq("id", challenge.id);
    throw new ApiError(400, "invalid_otp", "OTP expired or invalid.");
  }
  await db.from("domain_otp_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id);
  let user: Json;
  if (purpose === "registration") {
    const profile = challenge.profile_payload || {};
    const inserted = await db.from("domain_users").insert({
      email, password_hash: challenge.password_hash, full_name: profile.fullName,
      phone: profile.phone || null, country_code: profile.countryCode || null,
      email_verified_at: new Date().toISOString(),
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new ApiError(500, "account_create_failed", "Unable to create account.", inserted.error);
    user = inserted.data;
  } else {
    const found = await db.from("domain_users").select("*").eq("id", challenge.user_id).single();
    if (found.error || !found.data) throw new ApiError(404, "account_not_found", "Account not found.");
    user = found.data;
    if (purpose === "password_reset") {
      const newPassword = clean(body.newPassword);
      const passwordHash = await hashPassword(newPassword);
      const updated = await db.from("domain_users").update({ password_hash: passwordHash, session_version: Number(user.session_version) + 1 }).eq("id", user.id).select("*").single();
      if (updated.error || !updated.data) throw updated.error;
      user = updated.data;
      await db.from("domain_sessions").update({ revoked_at: new Date().toISOString() }).eq("user_id", user.id).is("revoked_at", null);
    }
  }
  const session = await createSession(user, req);
  await db.from("domain_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
  await audit(req, `auth.${purpose}.verified`, user.id, "user", user.id);
  return json(req, { user: publicUser(user), session });
}

async function exchangeKmerHostingSso(req: Request): Promise<Response> {
  const body = await bodyJson(req);
  const ticket = clean(body.ticket);
  if (!ticket || ticket.length < 32 || ticket.length > 512) throw new ApiError(400, "invalid_sso_ticket", "The KmerHosting sign-in ticket is invalid.");
  const { data: grant, error: grantError } = await db.from("dashboard_sso_grants")
    .update({ consumed_at: new Date().toISOString() })
    .eq("ticket_hash", await sha256(ticket)).eq("product", "domain").is("consumed_at", null).gt("expires_at", new Date().toISOString())
    .select("user_id,product_user_id,return_path").maybeSingle();
  if (grantError || !grant) throw new ApiError(401, "sso_ticket_expired", "This KmerHosting sign-in ticket has expired. Return to the central dashboard and try again.");

  const { data: centralUser, error: centralError } = await db.from("dashboard_users")
    .select("id,email,full_name,phone,country_code,status,email_verified_at")
    .eq("id", grant.user_id).eq("status", "active").maybeSingle();
  if (centralError || !centralUser) throw new ApiError(401, "central_account_unavailable", "Your KmerHosting account is unavailable.");

  let localUser: Json | null = null;
  if (grant.product_user_id) {
    const found = await db.from("domain_users").select("*").eq("id", grant.product_user_id).eq("status", "active").maybeSingle();
    localUser = found.data || null;
  }
  if (!localUser) {
    const found = await db.from("domain_users").select("*").eq("email", centralUser.email).eq("status", "active").maybeSingle();
    localUser = found.data || null;
  }
  if (!localUser) {
    const inserted = await db.from("domain_users").insert({
      email: centralUser.email,
      password_hash: await hashPassword(randomReference("KH-SSO") + randomReference("ACCOUNT")),
      full_name: centralUser.full_name || centralUser.email.split("@")[0],
      phone: centralUser.phone || null,
      country_code: centralUser.country_code || null,
      email_verified_at: centralUser.email_verified_at || new Date().toISOString(),
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new ApiError(500, "sso_account_create_failed", "Unable to prepare your Domain account.");
    localUser = inserted.data;
  }
  const { error: identityError } = await db.from("dashboard_product_identities").upsert({
    user_id: centralUser.id, product: "domain", external_user_id: localUser.id, external_email: centralUser.email,
    last_seen_at: new Date().toISOString(), metadata: { provisionedBy: "central_sso" },
  }, { onConflict: "product,external_user_id" });
  if (identityError) throw new ApiError(500, "sso_identity_link_failed", "Unable to link your Domain account.");
  const session = await createSession(localUser, req);
  await db.from("domain_users").update({ last_login_at: new Date().toISOString() }).eq("id", localUser.id);
  await audit(req, "auth.sso.kmerhosting", localUser.id, "user", localUser.id, { centralUserId: centralUser.id });
  return json(req, { user: publicUser(localUser), session, returnPath: clean(grant.return_path) || "/dashboard" });
}

async function handleAuth(req: Request, path: string): Promise<Response | null> {
  if (req.method === "POST" && path === "/auth/kmerhosting/exchange") return await exchangeKmerHostingSso(req);
  if (req.method === "POST" && path === "/auth/register/request") return await requestOtp(req, "registration", await bodyJson(req));
  if (req.method === "POST" && path === "/auth/register/verify") return await verifyOtp(req, "registration", await bodyJson(req));
  if (req.method === "POST" && path === "/auth/login/request") return await requestOtp(req, "login", await bodyJson(req));
  if (req.method === "POST" && path === "/auth/login/verify") return await verifyOtp(req, "login", await bodyJson(req));
  if (req.method === "POST" && path === "/auth/password-reset/request") return await requestOtp(req, "password_reset", await bodyJson(req));
  if (req.method === "POST" && path === "/auth/password-reset/verify") return await verifyOtp(req, "password_reset", await bodyJson(req));
  if (req.method === "POST" && path === "/auth/login") {
    const body = await bodyJson(req);
    const email = normalizeEmail(body.email);
    const password = clean(body.password);
    await enforceRateLimit(`login:${clientIp(req)}:${email}`, 10, 900);
    const { data: user } = await db.from("domain_users").select("*").eq("email", email).maybeSingle();
    if (!user || !await verifyPassword(password, user.password_hash) || user.status !== "active") {
      throw new ApiError(401, "invalid_credentials", "Email or password is invalid.");
    }
    if (!user.email_verified_at) throw new ApiError(403, "email_not_verified", "Email verification is required.");
    const session = await createSession(user, req);
    await db.from("domain_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
    await audit(req, "auth.login.password", user.id, "user", user.id);
    return json(req, { user: publicUser(user), session });
  }
  if (req.method === "POST" && path === "/auth/logout") {
    const auth = await requireAuth(req);
    await db.from("domain_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", auth.session.id);
    return json(req, { success: true });
  }
  return null;
}

async function orderPrice(type: string, tld: string, years: number): Promise<number> {
  const { data: price } = await db.from("domain_tld_prices").select("*").eq("tld", tld).eq("enabled", true).single();
  if (!price) throw new ApiError(400, "unsupported_tld", "This domain extension is not currently offered.");
  const field = type === "registration" ? "registration_price_usd" : type === "transfer" ? "transfer_price_usd" : "renewal_price_usd";
  return Number(price[field]) * years;
}

async function createOrder(req: Request, type: "registration" | "transfer" | "renewal", auth: Json, body: Json): Promise<Response> {
  const cfg = await getConfig();
  const domainName = normalizeDomain(body.domainName);
  if (!validDomain(domainName)) throw new ApiError(400, "invalid_domain", "A valid domain name is required.");
  const tld = getTld(domainName);
  const years = Math.max(1, Math.min(10, Number(body.years || 1)));
  const contactId = clean(body.contactId) || null;
  let contact: Json | null = null;
  if (contactId) {
    const found = await db.from("domain_contacts").select("*").eq("id", contactId).eq("user_id", auth.user.id).maybeSingle();
    contact = found.data || null;
  }
  if ((type === "registration" || type === "transfer") && !contact) throw new ApiError(400, "contact_required", "A registrant contact is required.");
  let domain: Json | null = null;
  if (type === "renewal") {
    const found = await db.from("domain_domains").select("*").eq("domain_name", domainName).eq("user_id", auth.user.id).maybeSingle();
    domain = found.data || null;
    if (!domain) throw new ApiError(404, "domain_not_found", "Domain is not managed by this account.");
  }
  if (type === "registration") {
    const result = await searchDomain(domainName);
    const status = clean(result.available ?? result.isAvailable ?? result.data?.available ?? result.data?.isAvailable ?? result.status).toLowerCase();
    if (["false","unavailable","registered","taken","0"].includes(status)) throw new ApiError(409, "domain_unavailable", "The domain is no longer available.", result);
  }
  const priceUsd = await orderPrice(type, tld, years);
  const amountXaf = Math.ceil(priceUsd * cfg.usd_to_xaf_rate);
  const idempotency = clean(req.headers.get("idempotency-key")) || clean(body.idempotencyKey) || randomReference("IDEMP");
  const existing = await db.from("domain_orders").select("*").eq("user_id", auth.user.id).eq("idempotency_key", idempotency).maybeSingle();
  if (existing.data) return json(req, { order: existing.data, reused: true });
  const prefix = type === "registration" ? "KHD-REG" : type === "transfer" ? "KHD-TRN" : "KHD-REN";
  const authCode = type === "transfer" ? clean(body.authCode) : "";
  if (type === "transfer" && (authCode.length < 4 || authCode.length > 128)) throw new ApiError(400, "auth_code_required", "A valid EPP/auth code is required.");
  const { data: order, error } = await db.from("domain_orders").insert({
    order_number: randomReference(prefix), idempotency_key: idempotency, user_id: auth.user.id,
    contact_id: contact?.id || domain?.contact_id || null, domain_id: domain?.id || null, type, domain_name: domainName, tld,
    years, status: "pending_payment", price_usd: priceUsd, usd_to_xaf_rate: cfg.usd_to_xaf_rate,
    amount_xaf: amountXaf, auth_code_ciphertext: authCode ? await encryptSensitive(authCode) : null,
    nameservers: Array.isArray(body.nameServers) && body.nameServers.length >= 2 ? body.nameServers.map(clean) : (domain?.nameservers?.length ? domain.nameservers : cfg.default_nameservers),
    contact_snapshot: contact || {},
  }).select("*").single();
  if (error || !order) throw new ApiError(500, "order_create_failed", "Unable to create order.", error);
  await audit(req, `order.${type}.created`, auth.user.id, "order", order.id, { domainName });
  return json(req, { order }, 201);
}

async function checkout(req: Request, auth: Json, orderId: string): Promise<Response> {
  const body = await bodyJson(req);
  const { data: order, error } = await db.from("domain_orders").select("*,domain_users(*)").eq("id", orderId).eq("user_id", auth.user.id).single();
  if (error || !order) throw new ApiError(404, "order_not_found", "Order not found.");
  if (order.status === "completed") throw new ApiError(409, "order_completed", "This order is already completed.");
  const existing = await db.from("domain_payments").select("*").eq("order_id", order.id).in("status", ["pending","processing","paid"]).order("created_at", { ascending: false }).limit(1);
  if (existing.data?.[0]?.status === "paid") return json(req, { payment: existing.data[0] });
  if (existing.data?.[0]?.checkout_url) return json(req, { payment: existing.data[0], reused: true });
  const invoice = newInvoiceId();
  const phone = normalizePhone(body.phone || order.domain_users.phone);
  if (phone.length < 9) throw new ApiError(400, "phone_required", "A valid payment phone number is required.");
  const paymentMethod = clean(body.paymentMethod) || null;
  const { data: payment, error: paymentError } = await db.from("domain_payments").insert({
    order_id: order.id, user_id: auth.user.id, merchant_invoice_id: invoice, idempotency_key: invoice,
    amount_xaf: order.amount_xaf, currency: "XAF", payment_method: paymentMethod, status: "pending",
  }).select("*").single();
  if (paymentError || !payment) throw new ApiError(500, "payment_create_failed", "Unable to initialize payment.", paymentError);
  try {
    const initiated = await initiateCamerPay({
      amountXaf: Number(order.amount_xaf), invoiceId: invoice, customerName: order.domain_users.full_name,
      customerEmail: order.domain_users.email, customerPhone: phone, paymentMethod,
    });
    const updated = await db.from("domain_payments").update({
      provider_reference: initiated.providerReference, checkout_url: initiated.checkoutUrl,
      raw_payload: initiated.payload, status: "processing",
    }).eq("id", payment.id).select("*").single();
    await db.from("domain_orders").update({ status: "payment_pending", payment_method: paymentMethod }).eq("id", order.id);
    if (initiated.providerReference) {
      await db.rpc("domain_enqueue_job", {
        p_type: "check_payment", p_idempotency_key: `check-payment:${payment.id}:1`,
        p_user_id: auth.user.id, p_order_id: order.id, p_domain_id: order.domain_id,
        p_payload: { paymentId: payment.id }, p_run_after: new Date(Date.now() + 120_000).toISOString(),
      });
    }
    return json(req, { payment: updated.data });
  } catch (providerError) {
    await db.from("domain_payments").update({ status: "failed", raw_payload: { error: providerError instanceof Error ? providerError.message : "Payment initiation failed" } }).eq("id", payment.id);
    throw providerError;
  }
}

async function protectedRoutes(req: Request, path: string): Promise<Response> {
  const auth = await requireAuth(req);
  if (req.method === "GET" && path === "/me") return json(req, { user: publicUser(auth.user) });
  if (req.method === "PATCH" && path === "/me") {
    const body = await bodyJson(req);
    const updates: Json = {};
    if (body.fullName !== undefined) {
      const name = clean(body.fullName);
      if (name.length < 2 || name.length > 120) throw new ApiError(400, "invalid_name", "Full name is invalid.");
      updates.full_name = name;
    }
    if (body.phone !== undefined) updates.phone = normalizePhone(body.phone) || null;
    if (body.countryCode !== undefined) updates.country_code = clean(body.countryCode).toUpperCase().slice(0,2) || null;
    const result = await db.from("domain_users").update(updates).eq("id", auth.user.id).select("*").single();
    if (result.error) throw result.error;
    return json(req, { user: publicUser(result.data) });
  }
  if (req.method === "GET" && path === "/dashboard") {
    const [domains, orders, notifications, invoices] = await Promise.all([
      db.from("domain_domains").select("*").eq("user_id", auth.user.id).order("created_at", { ascending: false }),
      db.from("domain_orders").select("*").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(10),
      db.from("domain_notifications").select("*").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(10),
      db.from("domain_invoices").select("*").eq("user_id", auth.user.id).order("issued_at", { ascending: false }).limit(10),
    ]);
    return json(req, { domains: domains.data || [], orders: orders.data || [], notifications: notifications.data || [], invoices: invoices.data || [] });
  }
  if (path === "/contacts" && req.method === "GET") {
    const result = await db.from("domain_contacts").select("*").eq("user_id", auth.user.id).order("is_default", { ascending: false }).order("created_at");
    return json(req, { contacts: result.data || [] });
  }
  if (path === "/contacts" && req.method === "POST") {
    const b = await bodyJson(req);
    const email = normalizeEmail(b.email || auth.user.email);
    if (!validEmail(email)) throw new ApiError(400, "invalid_email", "A valid contact email is required.");
    const payload = {
      user_id: auth.user.id, label: clean(b.label) || "Default", first_name: clean(b.firstName), last_name: clean(b.lastName),
      company_name: clean(b.companyName) || null, email, phone_country_code: clean(b.phoneCountryCode).replace(/\D/g, ""),
      phone: clean(b.phone).replace(/\D/g, ""), fax_country_code: clean(b.faxCountryCode).replace(/\D/g, "") || null,
      fax: clean(b.fax).replace(/\D/g, "") || null, address: clean(b.address), city: clean(b.city), state: clean(b.state),
      postal_code: clean(b.postalCode), country: clean(b.country).toUpperCase(), is_default: Boolean(b.isDefault),
    };
    for (const key of ["first_name","last_name","phone_country_code","phone","address","city","state","postal_code","country"]) {
      if (!payload[key as keyof typeof payload]) throw new ApiError(400, "contact_incomplete", `Contact field ${key} is required.`);
    }
    if (payload.country.length !== 2) throw new ApiError(400, "invalid_country", "Use a two-letter country code.");
    if (payload.is_default) await db.from("domain_contacts").update({ is_default: false }).eq("user_id", auth.user.id);
    const result = await db.from("domain_contacts").insert(payload).select("*").single();
    if (result.error) throw result.error;
    return json(req, { contact: result.data }, 201);
  }
  const contactMatch = path.match(/^\/contacts\/([0-9a-f-]+)$/i);
  if (contactMatch && req.method === "PUT") {
    const b = await bodyJson(req);
    const allowed: Json = {};
    const map: Record<string,string> = { label:"label",firstName:"first_name",lastName:"last_name",companyName:"company_name",email:"email",phoneCountryCode:"phone_country_code",phone:"phone",faxCountryCode:"fax_country_code",fax:"fax",address:"address",city:"city",state:"state",postalCode:"postal_code",country:"country",isDefault:"is_default" };
    for (const [from,to] of Object.entries(map)) if (b[from] !== undefined) allowed[to] = typeof b[from] === "string" ? clean(b[from]) : b[from];
    if (allowed.email) allowed.email = normalizeEmail(allowed.email);
    if (allowed.country) allowed.country = clean(allowed.country).toUpperCase();
    if (allowed.is_default) await db.from("domain_contacts").update({ is_default: false }).eq("user_id", auth.user.id);
    const result = await db.from("domain_contacts").update(allowed).eq("id", contactMatch[1]).eq("user_id", auth.user.id).select("*").single();
    if (result.error) throw new ApiError(404, "contact_not_found", "Contact not found.");
    return json(req, { contact: result.data });
  }
  if (contactMatch && req.method === "DELETE") {
    const used = await db.from("domain_domains").select("id").eq("contact_id", contactMatch[1]).eq("user_id", auth.user.id).limit(1);
    if (used.data?.length) throw new ApiError(409, "contact_in_use", "This contact is assigned to a domain.");
    await db.from("domain_contacts").delete().eq("id", contactMatch[1]).eq("user_id", auth.user.id);
    return json(req, { success: true });
  }
  if (req.method === "GET" && path === "/domains") {
    const result = await db.from("domain_domains").select("*").eq("user_id", auth.user.id).order("created_at", { ascending: false });
    return json(req, { domains: result.data || [] });
  }
  const domainMatch = path.match(/^\/domains\/([0-9a-f-]+)$/i);
  if (domainMatch && req.method === "GET") {
    const result = await db.from("domain_domains").select("*,domain_dns_records(*),domain_contacts(*)").eq("id", domainMatch[1]).eq("user_id", auth.user.id).single();
    if (result.error) throw new ApiError(404, "domain_not_found", "Domain not found.");
    return json(req, { domain: result.data });
  }
  const autoMatch = path.match(/^\/domains\/([0-9a-f-]+)\/auto-renew$/i);
  if (autoMatch && req.method === "PUT") {
    const b = await bodyJson(req);
    const result = await db.from("domain_domains").update({ auto_renew: Boolean(b.enabled) }).eq("id", autoMatch[1]).eq("user_id", auth.user.id).select("*").single();
    if (result.error) throw new ApiError(404, "domain_not_found", "Domain not found.");
    return json(req, { domain: result.data });
  }
  const nsMatch = path.match(/^\/domains\/([0-9a-f-]+)\/nameservers$/i);
  if (nsMatch && req.method === "PUT") {
    const b = await bodyJson(req);
    const ns = Array.isArray(b.nameServers) ? b.nameServers.map(clean).filter(Boolean) : [];
    if (ns.length < 2 || ns.length > 13) throw new ApiError(400, "invalid_nameservers", "Provide between 2 and 13 nameservers.");
    const domain = await db.from("domain_domains").select("*").eq("id", nsMatch[1]).eq("user_id", auth.user.id).single();
    if (domain.error) throw new ApiError(404, "domain_not_found", "Domain not found.");
    await db.rpc("domain_enqueue_job", {
      p_type: "update_nameservers", p_idempotency_key: `nameservers:${domain.data.id}:${await sha256(JSON.stringify(ns))}`,
      p_user_id: auth.user.id, p_domain_id: domain.data.id, p_payload: { nameServers: ns },
    });
    return json(req, { success: true, status: "queued" }, 202);
  }
  const dnsCollection = path.match(/^\/domains\/([0-9a-f-]+)\/dns$/i);
  if (dnsCollection && req.method === "GET") {
    const owned = await db.from("domain_domains").select("id").eq("id", dnsCollection[1]).eq("user_id", auth.user.id).single();
    if (owned.error) throw new ApiError(404, "domain_not_found", "Domain not found.");
    const result = await db.from("domain_dns_records").select("*").eq("domain_id", dnsCollection[1]).order("name");
    return json(req, { records: result.data || [] });
  }
  if (dnsCollection && req.method === "POST") {
    const owned = await db.from("domain_domains").select("*").eq("id", dnsCollection[1]).eq("user_id", auth.user.id).single();
    if (owned.error) throw new ApiError(404, "domain_not_found", "Domain not found.");
    const b = await bodyJson(req);
    const type = clean(b.type).toUpperCase();
    const contents = Array.isArray(b.contents) ? b.contents.map(clean).filter(Boolean) : [clean(b.content)].filter(Boolean);
    if (!["A","AAAA","CNAME","MX","TXT","NS","SRV","CAA"].includes(type) || !contents.length) throw new ApiError(400, "invalid_dns_record", "DNS record is invalid.");
    const result = await db.from("domain_dns_records").insert({
      domain_id: owned.data.id, user_id: auth.user.id, name: clean(b.name) || "@", type, contents,
      ttl: Math.max(1, Math.min(86400, Number(b.ttl || 3600))), priority: b.priority === undefined ? null : Number(b.priority), status: "pending",
    }).select("*").single();
    if (result.error) throw result.error;
    await db.rpc("domain_enqueue_job", {
      p_type: "create_dns_record", p_idempotency_key: `dns-create:${result.data.id}`, p_user_id: auth.user.id,
      p_domain_id: owned.data.id, p_payload: { recordId: result.data.id },
    });
    return json(req, { record: result.data, status: "queued" }, 202);
  }
  const dnsItem = path.match(/^\/domains\/([0-9a-f-]+)\/dns\/([0-9a-f-]+)$/i);
  if (dnsItem && req.method === "PUT") {
    const record = await db.from("domain_dns_records").select("*,domain_domains!inner(user_id)").eq("id", dnsItem[2]).eq("domain_id", dnsItem[1]).eq("domain_domains.user_id", auth.user.id).single();
    if (record.error) throw new ApiError(404, "dns_record_not_found", "DNS record not found.");
    const b = await bodyJson(req);
    const updates: Json = { status: "pending" };
    if (b.name !== undefined) updates.name = clean(b.name) || "@";
    if (b.type !== undefined) updates.type = clean(b.type).toUpperCase();
    if (b.contents !== undefined || b.content !== undefined) updates.contents = Array.isArray(b.contents) ? b.contents.map(clean).filter(Boolean) : [clean(b.content)].filter(Boolean);
    if (b.ttl !== undefined) updates.ttl = Math.max(1, Math.min(86400, Number(b.ttl)));
    if (b.priority !== undefined) updates.priority = b.priority === null ? null : Number(b.priority);
    const updated = await db.from("domain_dns_records").update(updates).eq("id", record.data.id).select("*").single();
    if (updated.error) throw updated.error;
    await db.rpc("domain_enqueue_job", {
      p_type: "update_dns_record", p_idempotency_key: `dns-update:${record.data.id}:${Date.now()}`, p_user_id: auth.user.id,
      p_domain_id: dnsItem[1], p_payload: { recordId: record.data.id, oldName: record.data.name },
    });
    return json(req, { record: updated.data, status: "queued" }, 202);
  }
  if (dnsItem && req.method === "DELETE") {
    const record = await db.from("domain_dns_records").select("*,domain_domains!inner(user_id)").eq("id", dnsItem[2]).eq("domain_id", dnsItem[1]).eq("domain_domains.user_id", auth.user.id).single();
    if (record.error) throw new ApiError(404, "dns_record_not_found", "DNS record not found.");
    await db.from("domain_dns_records").update({ status: "deleting" }).eq("id", record.data.id);
    await db.rpc("domain_enqueue_job", {
      p_type: "delete_dns_record", p_idempotency_key: `dns-delete:${record.data.id}`, p_user_id: auth.user.id,
      p_domain_id: dnsItem[1], p_payload: { recordId: record.data.id },
    });
    return json(req, { success: true, status: "queued" }, 202);
  }
  if (req.method === "GET" && path === "/orders") {
    const result = await db.from("domain_orders").select("*,domain_payments(*)").eq("user_id", auth.user.id).order("created_at", { ascending: false });
    return json(req, { orders: result.data || [] });
  }
  if (req.method === "POST" && path === "/orders/registration") return await createOrder(req, "registration", auth, await bodyJson(req));
  if (req.method === "POST" && path === "/orders/transfer") return await createOrder(req, "transfer", auth, await bodyJson(req));
  if (req.method === "POST" && path === "/orders/renewal") return await createOrder(req, "renewal", auth, await bodyJson(req));
  const checkoutMatch = path.match(/^\/orders\/([0-9a-f-]+)\/checkout$/i);
  if (checkoutMatch && req.method === "POST") return await checkout(req, auth, checkoutMatch[1]);
  const orderMatch = path.match(/^\/orders\/([0-9a-f-]+)$/i);
  if (orderMatch && req.method === "GET") {
    const result = await db.from("domain_orders").select("*,domain_payments(*),domain_invoices(*)").eq("id", orderMatch[1]).eq("user_id", auth.user.id).single();
    if (result.error) throw new ApiError(404, "order_not_found", "Order not found.");
    return json(req, { order: result.data });
  }
  const paymentMatch = path.match(/^\/payments\/([0-9a-f-]+)\/status$/i);
  if (paymentMatch && req.method === "GET") {
    const { data: payment, error } = await db.from("domain_payments").select("*").eq("order_id", paymentMatch[1]).eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !payment) throw new ApiError(404, "payment_not_found", "Payment not found.");
    if (payment.status !== "paid" && payment.provider_reference) {
      const payload = await camerPayStatus(payment.provider_reference);
      await db.from("domain_payments").update({ raw_payload: payload }).eq("id", payment.id);
      if (isPaymentPaid(payload, Number(payment.amount_xaf))) await markPaymentPaid(payment, payload);
    }
    const refreshed = await db.from("domain_payments").select("*").eq("id", payment.id).single();
    return json(req, { payment: refreshed.data });
  }
  if (req.method === "GET" && path === "/notifications") {
    const result = await db.from("domain_notifications").select("*").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(100);
    return json(req, { notifications: result.data || [] });
  }
  const notificationMatch = path.match(/^\/notifications\/([0-9a-f-]+)\/read$/i);
  if (notificationMatch && req.method === "PUT") {
    await db.from("domain_notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationMatch[1]).eq("user_id", auth.user.id);
    return json(req, { success: true });
  }
  if (req.method === "GET" && path === "/invoices") {
    const result = await db.from("domain_invoices").select("*,domain_orders(domain_name,type,order_number)").eq("user_id", auth.user.id).order("issued_at", { ascending: false });
    return json(req, { invoices: result.data || [] });
  }
  if (req.method === "GET" && path === "/admin/runtime") {
    if (auth.user.role !== "admin") throw new ApiError(403, "forbidden", "Administrator access is required.");
    return json(req, { runtime: await runtimeStatus(), config: await getConfig() });
  }
  throw new ApiError(404, "not_found", "Endpoint not found.");
}

async function publicRoutes(req: Request, path: string): Promise<Response | null> {
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    const cfg = await getConfig();
    return json(req, {
      ok: true, service: "KmerHosting Domains API", company: cfg.company_name,
      environment: cfg.registrar_environment, maintenance: cfg.maintenance_mode,
      runtime: await runtimeStatus(), timestamp: new Date().toISOString(),
    });
  }
  if (req.method === "GET" && path === "/prices") {
    const result = await db.from("domain_tld_prices").select("*").eq("enabled", true).order("popular", { ascending: false }).order("registration_price_usd");
    return json(req, { currency: "USD", prices: result.data || [] });
  }
  if (req.method === "POST" && path === "/domains/check") {
    await enforceRateLimit(`domain-check:${clientIp(req)}`, 30, 60);
    const body = await bodyJson(req);
    const values = Array.isArray(body.domains) ? body.domains : [body.domainName];
    const domains = [...new Set(values.map(normalizeDomain).filter(validDomain))].slice(0, 20);
    if (!domains.length) throw new ApiError(400, "invalid_domain", "At least one valid domain is required.");
    const results = [];
    for (const domainName of domains) {
      const registrar = await searchDomain(domainName);
      const tld = getTld(domainName);
      const price = await db.from("domain_tld_prices").select("*").eq("tld", tld).eq("enabled", true).maybeSingle();
      results.push({ domainName, registrar, price: price.data || null });
    }
    return json(req, { results });
  }
  return null;
}

async function webhook(req: Request): Promise<Response> {
  const raw = await req.text();
  let payload: Json = {};
  try { payload = JSON.parse(raw || "{}"); } catch { throw new ApiError(400, "invalid_webhook", "Webhook payload is invalid."); }
  const signature = clean(req.headers.get("x-camerpay-signature") || req.headers.get("x-signature") || req.headers.get("signature"));
  const verified = await verifyCamerPayWebhook(raw, payload, signature);
  if (!verified) throw new ApiError(401, "invalid_webhook_signature", "Webhook signature is invalid.");
  const fields = paymentFields(payload);
  const eventKey = `camerpay:${fields.uuid || fields.reference || fields.invoice}:${fields.status}:${fields.amount ?? ""}`;
  const inserted = await db.from("domain_webhook_events").upsert({
    provider: "camerpay", event_key: eventKey, signature, verified: true, payload,
  }, { onConflict: "event_key", ignoreDuplicates: true }).select("id,processed_at").maybeSingle();
  if (inserted.data?.processed_at) return json(req, { success: true, duplicate: true });
  let query = db.from("domain_payments").select("*");
  if (fields.invoice) query = query.eq("merchant_invoice_id", fields.invoice);
  else if (fields.reference) query = query.eq("provider_reference", fields.reference);
  else return json(req, { success: true, ignored: true });
  const paymentResult = await query.maybeSingle();
  if (!paymentResult.data) return json(req, { success: true, ignored: true });
  await db.from("domain_payments").update({
    raw_payload: payload, provider_reference: fields.reference || paymentResult.data.provider_reference,
    verified_webhook: true,
  }).eq("id", paymentResult.data.id);
  if (isPaymentPaid(payload, Number(paymentResult.data.amount_xaf))) await markPaymentPaid(paymentResult.data, payload);
  await db.from("domain_webhook_events").update({ processed_at: new Date().toISOString() }).eq("event_key", eventKey);
  return json(req, { success: true });
}

async function automation(req: Request): Promise<Response> {
  const supplied = clean(req.headers.get("x-domain-cron-secret"));
  const expected = await getSecret("domain_internal_cron_secret");
  if (!supplied || await sha256(supplied) !== await sha256(expected)) throw new ApiError(401, "invalid_automation_secret", "Automation authorization failed.");
  return json(req, { success: true, result: await runAutomation() });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" } });
  const path = functionPath(req);
  try {
    if (path === "/webhooks/camerpay" && req.method === "POST") return await webhook(req);
    if (path === "/automation" && req.method === "POST") return await automation(req);
    if (path === "/internal/jobs" && req.method === "POST") {
      const supplied = clean(req.headers.get("x-domain-cron-secret"));
      const expected = await getSecret("domain_internal_cron_secret");
      if (!supplied || await sha256(supplied) !== await sha256(expected)) throw new ApiError(401, "invalid_automation_secret", "Authorization failed.");
      return json(req, { jobs: await runJobs(`manual-${crypto.randomUUID()}`), emails: await runEmails() });
    }
    const authResponse = await handleAuth(req, path);
    if (authResponse) return authResponse;
    const publicResponse = await publicRoutes(req, path);
    if (publicResponse) return publicResponse;
    return await protectedRoutes(req, path);
  } catch (error) {
    return errorResponse(req, error);
  }
});
