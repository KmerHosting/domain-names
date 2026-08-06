import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Json = Record<string, any>;
class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const bytes = atob(normalized);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function secret(name: string) {
  const { data, error } = await db.rpc("domain_secret", { p_name: name });
  const value = clean(data);
  if (error || !value) throw new HttpError(503, "secret_missing", `${name} is not configured.`);
  return value;
}

async function decryptSensitive(value: string | null | undefined) {
  if (!value) return "";
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) throw new HttpError(500, "decrypt_failed", "Sensitive order data is invalid.");
  const master = await secret("domain_data_encryption_key");
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(master)));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivPart) }, key, fromBase64Url(cipherPart));
  return decoder.decode(plain);
}

async function authorize(req: Request) {
  const supplied = clean(req.headers.get("x-domain-cron-secret"));
  const expected = await secret("domain_internal_cron_secret");
  if (!supplied || await sha256(supplied) !== await sha256(expected)) {
    throw new HttpError(401, "invalid_automation_secret", "Automation authorization failed.");
  }
}

function pick(object: any, paths: string[]) {
  for (const path of paths) {
    let current = object;
    for (const key of path.split(".")) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (current !== undefined && current !== null && clean(current) !== "") return current;
  }
  return undefined;
}

function providerMessage(body: Json, status: number) {
  return clean(pick(body, ["error.message", "error.details", "message", "operationMessage", "reason", "title", "raw"])) ||
    `DomainNameAPI request failed (${status}).`;
}

async function registrar(
  environment: "production" | "ote",
  path: string,
  method = "GET",
  body: Json | Json[] | null = null,
  query: Json = {},
) {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: path,
    p_method: method,
    p_body: body,
    p_query: query,
    p_environment: environment,
  });
  if (error) throw new HttpError(502, "provider_proxy_failed", error.message, error);
  const result = data as Json;
  if (!result || Number(result.status) >= 400) {
    const status = Number(result?.status || 502);
    throw new HttpError(status >= 500 ? 502 : status, "provider_error", providerMessage(result?.body || {}, status), result?.body || {});
  }
  return result.body as Json;
}

function contactDto(contact: Json, contactType: string) {
  return {
    contactType,
    firstName: clean(contact.first_name).slice(0, 80),
    lastName: clean(contact.last_name).slice(0, 80),
    companyName: clean(contact.company_name).slice(0, 256) || null,
    eMail: clean(contact.email).slice(0, 256),
    phoneCountryCode: clean(contact.phone_country_code).replace(/\D/g, "").slice(0, 3),
    phone: clean(contact.phone).replace(/\D/g, "").slice(0, 16),
    faxCountryCode: clean(contact.fax_country_code).replace(/\D/g, "").slice(0, 3) || null,
    fax: clean(contact.fax).replace(/\D/g, "").slice(0, 15) || null,
    address: clean(contact.address).slice(0, 256),
    city: clean(contact.city).slice(0, 80),
    state: clean(contact.state).slice(0, 80),
    postalCode: clean(contact.postal_code).slice(0, 10),
    country: clean(contact.country).toUpperCase().slice(0, 2),
    discloseFlag: false,
    isEmailVerified: Boolean(contact.registrar_verified),
  };
}

function contactRoles(contact: Json) {
  return [
    contactDto(contact, "Registrant"),
    contactDto(contact, "Admin"),
    contactDto(contact, "Tech"),
    contactDto(contact, "Billing"),
  ];
}

function providerSuccess(payload: Json) {
  if (payload?.success === false || payload?.isSuccess === false || payload?.error) return false;
  const status = clean(payload?.status || payload?.result || payload?.data?.status).toLowerCase().replace(/[\s_-]+/g, "");
  return !status || ["active", "ok", "success", "successful", "completed", "true", "pending", "transferpending"].includes(status);
}

function safeProvider(payload: Json) {
  const result = { ...payload };
  delete result.authCode;
  delete result.authorizationCode;
  delete result.eppCode;
  if (Array.isArray(result.contacts)) {
    result.contacts = result.contacts.map((contact: Json) => ({
      handle: contact.handle || null,
      contactType: contact.contactType || contact.type || null,
      verified: contact.isEmailVerified || contact.verified || false,
    }));
  }
  return result;
}

function iso(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function infoFields(payload: Json, existing: Json = {}) {
  const raw = clean(payload.status || payload.statusCode || payload.domainStatus || payload.data?.status || existing.status).toLowerCase();
  let status = "active";
  if (/transfer/.test(raw)) status = "transfer_pending";
  else if (/redemption/.test(raw)) status = "redemption";
  else if (/pendingdelete/.test(raw)) status = "pending_delete";
  else if (/expire/.test(raw)) status = "expired";
  else if (/suspend|hold/.test(raw)) status = "suspended";
  else if (/fail|cancel/.test(raw)) status = raw.replace(/[^a-z]+/g, "_") || "failed";
  const nameservers = pick(payload, ["nameservers", "nameServers", "data.nameservers", "data.nameServers"]);
  const eppRaw = clean(payload.statusCode || payload.eppStatus || payload.data?.statusCode);
  const epp = eppRaw ? eppRaw.split(",").map(clean).filter(Boolean) : Array.isArray(payload.eppStatuses) ? payload.eppStatuses.map(clean) : [];
  return {
    status,
    expires_at: iso(payload.expirationDate || payload.expiresAt || payload.data?.expirationDate) || existing.expires_at || null,
    registered_at: iso(payload.startDate || payload.creationDate || payload.registeredAt || payload.data?.startDate) || existing.registered_at || null,
    nameservers: Array.isArray(nameservers) && nameservers.length ? nameservers.map(clean).filter(Boolean) : existing.nameservers || [],
    registrar_domain_id: clean(payload.objectId || payload.domainId || payload.id || payload.data?.objectId) || existing.registrar_domain_id || null,
    locked: payload.lockStatus !== undefined ? Boolean(payload.lockStatus) : existing.locked ?? true,
    privacy_enabled: payload.privacyProtectionStatus !== undefined ? Boolean(payload.privacyProtectionStatus) : existing.privacy_enabled ?? false,
    epp_statuses: epp.length ? epp : existing.epp_statuses || [],
    last_synced_at: now(),
    next_sync_at: new Date(Date.now() + (status === "transfer_pending" ? 3_600_000 : 21_600_000)).toISOString(),
  };
}

async function providerBalance(requiredUsd: number) {
  const payload = await registrar("production", "/api/v1/deposit/accounts/me");
  const balance = Number(payload.usdBalance ?? payload.data?.usdBalance ?? 0);
  if (!Number.isFinite(balance) || balance < requiredUsd) {
    throw new HttpError(409, "provider_balance_too_low", "The provider balance is no longer sufficient for this paid order.", {
      requiredUsd,
      availableUsd: Number.isFinite(balance) ? balance : null,
    });
  }
}

async function fetchOrder(id: string) {
  const { data: order, error } = await db.from("domain_orders").select("*").eq("id", id).single();
  if (error || !order) throw new HttpError(404, "order_not_found", "Order not found.");
  const [{ data: user }, { data: contact }, { data: domain }, { data: quote }] = await Promise.all([
    db.from("domain_users").select("*").eq("id", order.user_id).maybeSingle(),
    order.contact_id ? db.from("domain_contacts").select("*").eq("id", order.contact_id).maybeSingle() : Promise.resolve({ data: null } as any),
    order.domain_id ? db.from("domain_domains").select("*").eq("id", order.domain_id).maybeSingle() : Promise.resolve({ data: null } as any),
    order.provider_quote_id ? db.from("domain_provider_quotes").select("*").eq("id", order.provider_quote_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ]);
  return { order: order as Json, user: user as Json | null, contact: contact as Json | null, domain: domain as Json | null, quote: quote as Json | null };
}

function validatePaidOrder(context: { order: Json; quote: Json | null }) {
  const order = context.order;
  const quote = context.quote;
  if (order.status === "completed") return false;
  if (order.status !== "paid" || order.payment_method !== "wallet" || order.registrar_environment !== "production") {
    throw new HttpError(409, "order_not_ready", "Only paid production wallet orders can reach DomainNameAPI.");
  }
  if (!quote || quote.id !== order.provider_quote_id || quote.registrar_environment !== "production" || !quote.eligible) {
    throw new HttpError(409, "provider_quote_invalid", "The provider quote is missing or invalid.");
  }
  if (Number(quote.customer_price_usd) !== Number(order.price_usd) || Number(quote.provider_cost_usd) !== Number(order.provider_required_cost_usd)) {
    throw new HttpError(409, "provider_quote_mismatch", "The order price does not match its provider quote.");
  }
  return true;
}

async function markProcessing(order: Json, request: Json) {
  await db.from("domain_orders").update({
    status: "processing",
    registrar_request: request,
    failure_code: null,
    failure_message: null,
    updated_at: now(),
  }).eq("id", order.id);
}

async function finishOrder(order: Json, response: Json, domainId?: string | null) {
  await db.from("domain_orders").update({
    status: "completed",
    completed_at: now(),
    domain_id: domainId || order.domain_id || null,
    registrar_response: safeProvider(response),
    registrar_order_id: clean(response.orderCode || response.orderId || response.id || response.data?.orderCode) || order.registrar_order_id || null,
    auth_code_ciphertext: null,
    failure_code: null,
    failure_message: null,
    updated_at: now(),
  }).eq("id", order.id);
}

async function assignContactRoles(domainId: string, userId: string, contactId: string) {
  for (const role of ["Registrant", "Administrative", "Technical", "Billing"]) {
    await db.from("domain_contact_assignments").upsert({
      domain_id: domainId,
      user_id: userId,
      contact_id: contactId,
      contact_role: role,
      updated_at: now(),
    }, { onConflict: "domain_id,contact_role" });
  }
}

async function notify(user: Json | null, type: string, title: string, message: string, data: Json) {
  if (user) await db.from("domain_notifications").insert({ user_id: user.id, type, title, message, data });
}

async function queueEmail(user: Json | null, order: Json, domainId: string | null, template: string, subject: string, payload: Json) {
  if (!user) return;
  await db.from("domain_email_outbox").upsert({
    event_key: `${template}:${order.id}`,
    user_id: user.id,
    order_id: order.id,
    domain_id: domainId,
    recipient_email: user.email,
    recipient_name: user.full_name,
    template,
    subject,
    payload,
  }, { onConflict: "event_key", ignoreDuplicates: true });
}

async function synchronizeDomain(domain: Json) {
  let info = await registrar(domain.registrar_environment, "/api/v1/domains/info", "GET", null, { DomainName: domain.domain_name });
  if (domain.status === "transfer_pending") {
    try {
      const transfer = await registrar(domain.registrar_environment, "/api/v1/domains/transfers/query", "POST", { domainName: domain.domain_name });
      info = { ...info, transferQuery: safeProvider(transfer) };
    } catch {
      // Domain info remains the source of truth when transfer query is temporarily unavailable.
    }
  }
  const fields = infoFields(info, domain);
  await db.from("domain_domains").update({
    ...fields,
    metadata: { ...(domain.metadata || {}), lastProviderInfo: safeProvider(info) },
    updated_at: now(),
  }).eq("id", domain.id);
  return { ...domain, ...fields };
}

async function processRegistration(job: Json) {
  const context = await fetchOrder(job.order_id);
  if (!validatePaidOrder(context)) return { skipped: true };
  if (!context.contact) throw new HttpError(400, "contact_missing", "Registration contact is missing.");
  await providerBalance(Number(context.quote!.provider_cost_usd));
  const request = {
    domainName: context.order.domain_name,
    period: Number(context.order.years),
    nameServers: context.order.nameservers || [],
    isLocked: Boolean(context.order.lock_requested),
    privacyEnabled: Boolean(context.order.privacy_requested),
    contacts: contactRoles(context.contact),
    tldAttributes: context.order.tld_attributes || {},
  };
  await markProcessing(context.order, request);
  const response = await registrar("production", "/api/v1/domains/register-with-contacts", "POST", request);
  if (!providerSuccess(response)) throw new HttpError(502, "registration_failed", "DomainNameAPI did not confirm registration.", response);
  let info: Json = response;
  try {
    info = await registrar("production", "/api/v1/domains/info", "GET", null, { DomainName: context.order.domain_name });
  } catch {
    // Registration response remains available if immediate info synchronization is delayed.
  }
  const fields = infoFields(info, {
    nameservers: context.order.nameservers,
    locked: context.order.lock_requested,
    privacy_enabled: context.order.privacy_requested,
  });
  const { data: domain, error } = await db.from("domain_domains").upsert({
    user_id: context.order.user_id,
    contact_id: context.order.contact_id,
    domain_name: context.order.domain_name,
    tld: context.order.tld,
    registrar_environment: "production",
    registrar_order_id: clean(response.orderCode || response.orderId || response.id) || null,
    ...fields,
    auto_renew: true,
    metadata: { registrationResponse: safeProvider(response), lastProviderInfo: safeProvider(info) },
    updated_at: now(),
  }, { onConflict: "domain_name" }).select("*").single();
  if (error || !domain) throw error;
  await assignContactRoles(domain.id, context.order.user_id, context.contact.id);
  await finishOrder(context.order, response, domain.id);
  await notify(context.user, "domain_ready", "Domain ready", `${context.order.domain_name} is active.`, { domainId: domain.id, orderId: context.order.id });
  await queueEmail(context.user, context.order, domain.id, "domain_ready", `${context.order.domain_name} is ready`, {
    name: context.user?.full_name,
    domainName: context.order.domain_name,
    orderNumber: context.order.order_number,
    expiresAt: fields.expires_at,
  });
  return { domainId: domain.id };
}

async function processTransfer(job: Json) {
  const context = await fetchOrder(job.order_id);
  if (!validatePaidOrder(context)) return { skipped: true };
  if (!context.contact) throw new HttpError(400, "contact_missing", "Transfer contact is missing.");
  const authCode = await decryptSensitive(context.order.auth_code_ciphertext);
  if (authCode.length < 4) throw new HttpError(400, "auth_code_missing", "Transfer authorization code is missing.");
  await providerBalance(Number(context.quote!.provider_cost_usd));
  const check = await registrar("production", "/api/v1/domains/transfers/check", "POST", {
    domainName: context.order.domain_name,
    authCode,
  });
  if (!(check.transferAvailabilityStatus ?? check.data?.transferAvailabilityStatus)) {
    throw new HttpError(409, "transfer_not_available", clean(check.message || check.data?.message) || "The transfer is no longer available.", check);
  }
  const request = {
    domainName: context.order.domain_name,
    period: Number(context.order.years),
    authCode,
    contacts: contactRoles(context.contact),
  };
  await markProcessing(context.order, { ...request, authCode: "[encrypted]" });
  const response = await registrar("production", "/api/v1/domains/transfer", "POST", request);
  if (!providerSuccess(response)) throw new HttpError(502, "transfer_failed", "DomainNameAPI did not accept the transfer.", response);
  const { data: domain, error } = await db.from("domain_domains").upsert({
    user_id: context.order.user_id,
    contact_id: context.order.contact_id,
    domain_name: context.order.domain_name,
    tld: context.order.tld,
    registrar_environment: "production",
    registrar_order_id: clean(response.orderCode || response.orderId || response.id) || null,
    status: "transfer_pending",
    auto_renew: true,
    privacy_enabled: false,
    locked: true,
    nameservers: context.order.nameservers || [],
    metadata: { transferResponse: safeProvider(response), transferCheck: safeProvider(check) },
    last_synced_at: now(),
    next_sync_at: new Date(Date.now() + 3_600_000).toISOString(),
    updated_at: now(),
  }, { onConflict: "domain_name" }).select("*").single();
  if (error || !domain) throw error;
  await assignContactRoles(domain.id, context.order.user_id, context.contact.id);
  await finishOrder(context.order, response, domain.id);
  await notify(context.user, "transfer_started", "Transfer started", `Transfer request for ${context.order.domain_name} was submitted.`, { domainId: domain.id, orderId: context.order.id });
  await queueEmail(context.user, context.order, domain.id, "transfer_started", `Transfer started — ${context.order.domain_name}`, {
    name: context.user?.full_name,
    domainName: context.order.domain_name,
    orderNumber: context.order.order_number,
  });
  return { domainId: domain.id };
}

async function processRenewal(job: Json) {
  const context = await fetchOrder(job.order_id);
  if (!validatePaidOrder(context)) return { skipped: true };
  if (!context.domain) throw new HttpError(404, "domain_not_found", "Renewal domain not found.");
  await providerBalance(Number(context.quote!.provider_cost_usd));
  const request = { domainName: context.order.domain_name, period: Number(context.order.years) };
  await registrar("production", "/api/v1/domains/renew/check", "POST", request);
  await markProcessing(context.order, request);
  const response = await registrar("production", "/api/v1/domains/renew", "POST", request);
  if (!providerSuccess(response)) throw new HttpError(502, "renewal_failed", "DomainNameAPI did not confirm renewal.", response);
  let updated = context.domain;
  try {
    updated = await synchronizeDomain(context.domain);
  } catch {
    const base = context.domain.expires_at && new Date(context.domain.expires_at).getTime() > Date.now()
      ? new Date(context.domain.expires_at)
      : new Date();
    base.setUTCFullYear(base.getUTCFullYear() + Number(context.order.years));
    await db.from("domain_domains").update({
      status: "active",
      expires_at: base.toISOString(),
      last_reminder_days: null,
      metadata: { ...(context.domain.metadata || {}), renewalResponse: safeProvider(response) },
      updated_at: now(),
    }).eq("id", context.domain.id);
    updated = { ...context.domain, status: "active", expires_at: base.toISOString() };
  }
  await finishOrder(context.order, response, context.domain.id);
  await notify(context.user, "renewal_completed", "Renewal completed", `${context.order.domain_name} was renewed.`, { domainId: context.domain.id, orderId: context.order.id });
  await queueEmail(context.user, context.order, context.domain.id, "domain_ready", `${context.order.domain_name} renewal completed`, {
    name: context.user?.full_name,
    domainName: context.order.domain_name,
    orderNumber: context.order.order_number,
    expiresAt: updated.expires_at,
  });
  return { domainId: context.domain.id, expiresAt: updated.expires_at };
}

async function processRestore(job: Json) {
  const context = await fetchOrder(job.order_id);
  if (!validatePaidOrder(context)) return { skipped: true };
  if (!context.domain) throw new HttpError(404, "domain_not_found", "Restore domain not found.");
  await providerBalance(Number(context.quote!.provider_cost_usd));
  const request = { domainName: context.order.domain_name };
  await markProcessing(context.order, request);
  const response = await registrar("production", "/api/v1/domains/restore", "POST", request);
  if (!providerSuccess(response)) throw new HttpError(502, "restore_failed", "DomainNameAPI did not accept the restore request.", response);
  await db.from("domain_domains").update({
    status: "restoring",
    metadata: { ...(context.domain.metadata || {}), restoreResponse: safeProvider(response) },
    next_sync_at: new Date(Date.now() + 3_600_000).toISOString(),
    updated_at: now(),
  }).eq("id", context.domain.id);
  await finishOrder(context.order, response, context.domain.id);
  await notify(context.user, "restore_started", "Restore started", `${context.order.domain_name} restore request was submitted.`, { domainId: context.domain.id, orderId: context.order.id });
  return { domainId: context.domain.id };
}

async function processSync(job: Json) {
  const { data: domain } = await db.from("domain_domains").select("*").eq("id", job.domain_id).maybeSingle();
  if (!domain) return { skipped: true };
  return await synchronizeDomain(domain as Json);
}

async function processNameservers(job: Json) {
  const { data: domain } = await db.from("domain_domains").select("*").eq("id", job.domain_id).maybeSingle();
  if (!domain) throw new HttpError(404, "domain_not_found", "Domain not found.");
  const nameservers = Array.isArray(job.payload?.nameServers)
    ? [...new Set(job.payload.nameServers.map(clean).filter(Boolean))]
    : [];
  if (nameservers.length < 2 || nameservers.length > 13) throw new HttpError(400, "invalid_nameservers", "Provide between 2 and 13 nameservers.");
  const response = await registrar(domain.registrar_environment, "/api/v1/domains/dns/name-server", "PUT", {
    domainName: domain.domain_name,
    nameServers: nameservers,
  });
  await db.from("domain_domains").update({
    nameservers,
    metadata: { ...(domain.metadata || {}), nameserverResponse: safeProvider(response) },
    last_synced_at: now(),
    updated_at: now(),
  }).eq("id", domain.id);
  return { domainId: domain.id, nameservers };
}

async function processJob(job: Json) {
  if (job.type === "register_domain") return await processRegistration(job);
  if (job.type === "transfer_domain") return await processTransfer(job);
  if (job.type === "renew_domain") return await processRenewal(job);
  if (job.type === "restore_domain") return await processRestore(job);
  if (job.type === "sync_domain") return await processSync(job);
  if (job.type === "update_nameservers") return await processNameservers(job);
  throw new HttpError(400, "unknown_job", `Unknown domain job type: ${job.type}`);
}

async function run(limit = 20) {
  const worker = `domain-jobs-v2-${crypto.randomUUID()}`;
  const { data: jobs, error } = await db.rpc("domain_claim_jobs", { p_worker: worker, p_limit: limit });
  if (error) throw error;
  let completed = 0;
  let failed = 0;
  let dead = 0;
  for (const job of jobs || []) {
    try {
      const result = await processJob(job);
      await db.from("domain_jobs").update({
        status: "completed",
        completed_at: now(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        payload: { ...(job.payload || {}), result },
      }).eq("id", job.id);
      completed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : clean(error) || "Unknown error";
      const isDead = Number(job.attempts) >= Number(job.max_attempts);
      const delayMinutes = Math.min(360, 2 ** Math.max(0, Number(job.attempts) - 1));
      await db.from("domain_jobs").update({
        status: isDead ? "dead" : "failed",
        run_after: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: message.slice(0, 2000),
      }).eq("id", job.id);
      if (job.order_id && isDead) {
        await db.from("domain_orders").update({
          status: "failed",
          failure_code: error instanceof HttpError ? error.code : "provider_operation_failed",
          failure_message: message,
          updated_at: now(),
        }).eq("id", job.order_id);
        await db.rpc("domain_refund_order_to_wallet", { p_order_id: job.order_id, p_reason: message });
        dead++;
      }
      failed++;
    }
  }
  return { claimed: jobs?.length || 0, completed, failed, dead };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") return json({ ok: true, service: "KmerHosting DomainNameAPI Jobs", version: 2, timestamp: now() });
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
    await authorize(req);
    const body = await req.json().catch(() => ({})) as Json;
    return json({ success: true, result: await run(Math.max(1, Math.min(50, Number(body.limit || 20)))), at: now() });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
