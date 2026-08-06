import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();

type Json = Record<string, any>;
class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-domain-cron-secret",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secret(name: string) {
  const { data, error } = await db.rpc("domain_secret", { p_name: name });
  const value = clean(data);
  if (error || !value) throw new HttpError(503, "secret_missing", `${name} is not configured.`);
  return value;
}

async function authorize(req: Request) {
  const supplied = clean(req.headers.get("x-domain-cron-secret"));
  const expected = await secret("domain_internal_cron_secret");
  if (!supplied || await sha256(supplied) !== await sha256(expected)) {
    throw new HttpError(401, "invalid_automation_secret", "Automation authorization failed.");
  }
}

async function config() {
  const { data, error } = await db.from("domain_config").select("*").eq("id", true).single();
  if (error || !data) throw new HttpError(500, "configuration_missing", "Domain configuration is missing.");
  return data as Json;
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

async function registrar(path: string, method = "GET", body: Json | null = null, query: Json = {}) {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: path,
    p_method: method,
    p_body: body,
    p_query: query,
    p_environment: "production",
  });
  if (error) throw new HttpError(502, "provider_proxy_failed", error.message, error);
  const result = data as Json;
  if (!result || Number(result.status) >= 400) {
    const providerBody = result?.body || {};
    const status = Number(result?.status || 502);
    const message = clean(pick(providerBody, ["error.message", "error.details", "message", "operationMessage", "reason", "raw"])) ||
      `DomainNameAPI request failed (${status}).`;
    throw new HttpError(status >= 500 ? 502 : status, "provider_error", message, providerBody);
  }
  return result.body as Json;
}

async function queueEmail(row: Json) {
  await db.from("domain_email_outbox").upsert(row, { onConflict: "event_key", ignoreDuplicates: true });
}

async function notify(userId: string, type: string, title: string, message: string, data: Json = {}) {
  await db.from("domain_notifications").insert({ user_id: userId, type, title, message, data });
}

async function providerBalance() {
  const payload = await registrar("/api/v1/deposit/accounts/me");
  const value = Number(payload.usdBalance ?? payload.data?.usdBalance);
  if (!Number.isFinite(value)) throw new HttpError(503, "provider_balance_unreadable", "Provider USD balance could not be read.");
  return money(value);
}

async function exactRenewalPrice(tld: string) {
  const { data } = await db.from("domain_tld_period_prices").select("*")
    .eq("tld", tld).eq("operation", "renewal").eq("period_years", 1).eq("registrar_environment", "production").maybeSingle();
  if (!data || Number(data.provider_cost_usd) <= 0 || Number(data.customer_price_usd) <= 0) {
    throw new HttpError(409, "renewal_price_missing", "Exact one-year renewal pricing is unavailable.", { tld });
  }
  return data as Json;
}

async function activeRenewal(domainId: string) {
  const { data } = await db.from("domain_orders").select("id,status")
    .eq("domain_id", domainId).eq("type", "renewal")
    .in("status", ["pending_payment", "payment_pending", "paid", "processing", "completed"])
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

async function automaticRenewal(domain: Json, platform: Json) {
  if (domain.registrar_environment !== "production" || !domain.auto_renew) return { status: "skipped" };
  if (await activeRenewal(domain.id)) return { status: "existing" };

  const { data: user } = await db.from("domain_users").select("*").eq("id", domain.user_id).eq("status", "active").maybeSingle();
  if (!user) return { status: "user_missing" };

  const periodPrice = await exactRenewalPrice(domain.tld);
  const customerPrice = money(Number(periodPrice.customer_price_usd));
  const providerCost = money(Number(periodPrice.provider_cost_usd));

  if (Number(user.balance_usd) < customerPrice) {
    await notify(
      user.id,
      "renewal_balance_low",
      "Renewal balance required",
      `${domain.domain_name} is due for renewal, but your USD account balance is insufficient. Contact ${platform.support_email} for a manual credit.`,
      { domainId: domain.id, requiredUsd: customerPrice, balanceUsd: Number(user.balance_usd) },
    );
    await queueEmail({
      event_key: `renewal-balance-low:${domain.id}:${String(domain.expires_at).slice(0, 10)}`,
      user_id: user.id,
      domain_id: domain.id,
      recipient_email: user.email,
      recipient_name: user.full_name,
      template: "renewal_payment_required",
      subject: `Balance required — ${domain.domain_name}`,
      payload: {
        name: user.full_name,
        domainName: domain.domain_name,
        message: `Your account needs $${customerPrice.toFixed(2)} to renew this domain. Contact ${platform.support_email}.`,
      },
    });
    return { status: "insufficient_balance", requiredUsd: customerPrice };
  }

  const availableProviderBalance = await providerBalance();
  if (availableProviderBalance < providerCost) {
    await notify(
      user.id,
      "renewal_delayed",
      "Renewal temporarily delayed",
      `${domain.domain_name} could not be renewed automatically because the registrar account requires funding. Support has been alerted.`,
      { domainId: domain.id },
    );
    await db.from("domain_operational_issues").upsert({
      issue_key: `provider-balance-renewal:${domain.id}`,
      severity: "critical",
      status: "open",
      title: "Provider balance blocks renewal",
      message: `${domain.domain_name}: required $${providerCost}, available $${availableProviderBalance}`,
      entity_type: "domain",
      entity_id: domain.id,
      metadata: { requiredUsd: providerCost, availableUsd: availableProviderBalance },
      updated_at: now(),
    }, { onConflict: "issue_key" });
    return { status: "provider_balance_low" };
  }

  await registrar("/api/v1/domains/renew/check", "POST", { domainName: domain.domain_name, period: 1 });
  const { data: quote, error: quoteError } = await db.from("domain_provider_quotes").insert({
    user_id: user.id,
    domain_id: domain.id,
    domain_name: domain.domain_name,
    tld: domain.tld,
    operation: "renewal",
    period_years: 1,
    provider_cost_usd: providerCost,
    customer_price_usd: customerPrice,
    eligible: true,
    source: "auto_renew_domainnameapi",
    provider_payload: periodPrice.provider_payload || {},
    reason: "auto_renew_eligible",
    premium_detected: false,
    provider_balance_usd: availableProviderBalance,
    provider_balance_verified_at: now(),
    registrar_environment: "production",
    provider_currency: "USD",
    provider_price_group: periodPrice.price_group || "Reseller",
    pricing_metadata: { automatic: true, periodPrice },
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }).select("*").single();
  if (quoteError || !quote) throw quoteError;

  const { data: order, error: orderError } = await db.rpc("domain_create_order_from_quote", {
    p_user_id: user.id,
    p_quote_id: quote.id,
    p_contact_id: domain.contact_id,
    p_domain_id: domain.id,
    p_nameservers: domain.nameservers || [],
    p_auth_code_ciphertext: null,
    p_tld_attributes: {},
    p_contact_snapshot: {},
    p_idempotency_key: `auto-renew:${domain.id}:${domain.expires_at}`,
    p_privacy_requested: Boolean(domain.privacy_enabled),
    p_lock_requested: Boolean(domain.locked),
  });
  if (orderError || !order) throw orderError;

  const { data: payment, error: paymentError } = await db.rpc("domain_wallet_pay_order", {
    p_user_id: user.id,
    p_order_id: order.id,
  });
  if (paymentError) throw paymentError;
  return { status: "paid_and_queued", orderId: order.id, quoteId: quote.id, payment };
}

async function lifecycleSweep() {
  const platform = await config();
  const currentDate = new Date();
  const horizon = new Date(currentDate.getTime() + 61 * 86_400_000).toISOString();
  const { data: domains } = await db.from("domain_domains").select("*,domain_users(email,full_name,status)")
    .in("status", ["active", "transfer_pending", "expired", "grace", "redemption"])
    .lte("expires_at", horizon).limit(1000);
  const notices = Array.isArray(platform.renewal_notice_days) ? platform.renewal_notice_days.map(Number) : [30, 15, 7, 3, 1];
  let reminders = 0;
  let renewals = 0;
  let failed = 0;
  let syncQueued = 0;

  for (const domain of domains || []) {
    if (!domain.expires_at || !domain.domain_users || domain.domain_users.status !== "active") continue;
    const days = Math.ceil((new Date(domain.expires_at).getTime() - currentDate.getTime()) / 86_400_000);
    const notice = notices.find((value: number) => days <= value && days > value - 1);
    if (notice !== undefined && Number(domain.last_reminder_days) !== notice) {
      await queueEmail({
        event_key: `renewal-reminder:${domain.id}:${notice}:${String(domain.expires_at).slice(0, 10)}`,
        user_id: domain.user_id,
        domain_id: domain.id,
        recipient_email: domain.domain_users.email,
        recipient_name: domain.domain_users.full_name,
        template: "renewal_reminder",
        subject: `${domain.domain_name} expires in ${notice} day${notice === 1 ? "" : "s"}`,
        payload: {
          name: domain.domain_users.full_name,
          domainName: domain.domain_name,
          expiresAt: domain.expires_at,
          days: notice,
          autoRenew: domain.auto_renew,
        },
      });
      await db.from("domain_domains").update({ last_reminder_days: notice, updated_at: now() }).eq("id", domain.id);
      reminders++;
    }

    if (
      domain.auto_renew &&
      domain.registrar_environment === "production" &&
      days <= Number(platform.auto_renew_charge_days || 7) &&
      days >= 0
    ) {
      try {
        const result = await automaticRenewal(domain, platform);
        if (result.status === "paid_and_queued") renewals++;
      } catch (error) {
        failed++;
        await db.from("domain_operational_issues").upsert({
          issue_key: `auto-renew:${domain.id}:${String(domain.expires_at).slice(0, 10)}`,
          severity: "high",
          status: "open",
          title: "Automatic renewal failed",
          message: error instanceof Error ? error.message : String(error),
          entity_type: "domain",
          entity_id: domain.id,
          metadata: { domainName: domain.domain_name },
          updated_at: now(),
        }, { onConflict: "issue_key" });
      }
    }

    if (days < 0 && domain.status === "active") {
      await db.from("domain_domains").update({ status: "expired", updated_at: now() }).eq("id", domain.id);
    }
  }

  const { data: due } = await db.from("domain_domains").select("id,user_id,registrar_environment")
    .lte("next_sync_at", now()).neq("status", "cancelled").limit(200);
  for (const domain of due || []) {
    try {
      await db.rpc("domain_enqueue_job", {
        p_type: "sync_domain",
        p_idempotency_key: `sync:${domain.id}:${Math.floor(Date.now() / 21_600_000)}`,
        p_user_id: domain.user_id,
        p_order_id: null,
        p_domain_id: domain.id,
        p_payload: { environment: domain.registrar_environment },
        p_run_after: now(),
      });
      syncQueued++;
    } catch {
      // The next lifecycle pass can retry the synchronization queue.
    }
  }

  await db.from("domain_sessions").delete().lt("expires_at", now());
  await db.from("domain_otp_challenges").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
  await db.from("domain_rate_limits").delete().lt("updated_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  return { reminders, autoRenewalsPaid: renewals, autoRenewFailures: failed, syncQueued };
}

function escapeHtml(value: unknown) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

async function renderEmail(template: string, payload: Json) {
  const platform = await config();
  const name = clean(payload.name) || "Customer";
  const domain = clean(payload.domainName);
  const days = Number(payload.days);
  const expires = clean(payload.expiresAt).slice(0, 10);
  let title = clean(payload.title) || "KmerHosting Domains notification";
  let paragraphs = [clean(payload.message) || "There is an update in your domain account."];
  let url = `${platform.site_url}/dashboard`;

  if (template === "renewal_reminder") {
    title = `${domain} expires in ${days} day${days === 1 ? "" : "s"}`;
    paragraphs = [
      `Your domain ${domain} expires on ${expires}.`,
      payload.autoRenew
        ? "Automatic renewal is enabled and will use your USD account balance."
        : "Automatic renewal is disabled.",
    ];
    url = `${platform.site_url}/dashboard/domains`;
  }
  if (template === "renewal_payment_required") {
    title = `Balance required for ${domain}`;
    paragraphs = [
      clean(payload.message) || `Add funds to your USD account balance before ${domain} expires.`,
      `Manual credits are handled by ${platform.support_email}.`,
    ];
    url = `${platform.site_url}/dashboard/wallet`;
  }
  if (template === "domain_ready") {
    title = `${domain} is ready`;
    paragraphs = [`The domain operation for ${domain} completed successfully.`];
    url = `${platform.site_url}/dashboard/domains`;
  }

  const text = `Hello ${name},\n\n${title}\n\n${paragraphs.join("\n\n")}\n\nOpen: ${url}\n\nSupport: ${platform.support_email}\nKmerHosting LLC`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:30px auto;border:1px solid #e5eaf2;border-radius:16px;padding:28px"><small>KmerHosting Domains</small><h2>${escapeHtml(title)}</h2><p>Hello ${escapeHtml(name)},</p>${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#155eef;color:#fff;padding:12px 18px;border-radius:9px;text-decoration:none">Open dashboard</a></p><small>Support: ${escapeHtml(platform.support_email)}</small></div></body></html>`;
  return { text, html, category: `domain-${template}` };
}

async function processEmailOutbox() {
  const { data: rows, error } = await db.rpc("domain_claim_emails", { p_limit: 30 });
  if (error) throw error;
  const platform = await config();
  const token = await secret("domain_mailtrap_token");
  let sent = 0;
  let failed = 0;

  for (const row of rows || []) {
    try {
      const body = await renderEmail(row.template, row.payload || {});
      const response = await fetch(platform.mailtrap_api_url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          from: { email: platform.mailtrap_sender_email, name: platform.mailtrap_sender_name },
          to: [{ email: row.recipient_email, name: row.recipient_name || "Customer" }],
          subject: row.subject,
          ...body,
        }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`Mail provider rejected message (${response.status}): ${raw.slice(0, 300)}`);
      await db.from("domain_email_outbox").update({ status: "sent", sent_at: now(), last_error: null }).eq("id", row.id);
      sent++;
    } catch (error) {
      const dead = Number(row.attempts) >= 8;
      const delayMinutes = Math.min(360, 2 ** Math.max(0, Number(row.attempts) - 1));
      await db.from("domain_email_outbox").update({
        status: dead ? "dead" : "failed",
        next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      }).eq("id", row.id);
      failed++;
    }
  }
  return { claimed: rows?.length || 0, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  try {
    if (req.method === "GET") return json({ ok: true, service: "KmerHosting Domain Automation", version: 2, timestamp: now() });
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
    await authorize(req);
    const lifecycle = await lifecycleSweep();
    const emails = await processEmailOutbox();
    return json({ success: true, lifecycle, emails, registrarWrites: "only-after-valid-wallet-payment", at: now() });
  } catch (error) {
    console.error(error);
    if (error instanceof HttpError) return json({ error: error.code, message: error.message, details: error.details }, error.status);
    return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error.", details: error }, 500);
  }
});
