import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();

type Json = Record<string, any>;
type LocalStatus = "pending" | "processing" | "paid" | "failed" | "cancelled" | "refunded";

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const clean = (value: unknown): string => String(value ?? "").trim();

function allowedOrigin(origin: string | null): string {
  if (!origin) return "*";
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === "domain.kmerhosting.com" || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) {
      return origin;
    }
  } catch {
    // Fall through to the production origin.
  }
  return "https://domain.kmerhosting.com";
}

function cors(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-domain-cron-secret",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getSecret(name: string): Promise<string> {
  const { data, error } = await db.rpc("domain_secret", { p_name: name });
  const value = clean(data);
  if (error || !value) throw new ApiError(503, "provider_not_configured", `Required server secret ${name} is not configured.`);
  return value;
}

async function requireUser(req: Request): Promise<Json> {
  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new ApiError(401, "authentication_required", "Authentication is required.");
  }
  const tokenHash = await sha256(authorization.slice(7).trim());
  const { data: session, error } = await db.from("domain_sessions").select("*")
    .eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !session) throw new ApiError(401, "invalid_session", "Session expired or invalid.");
  const { data: user, error: userError } = await db.from("domain_users").select("*").eq("id", session.user_id).maybeSingle();
  if (userError || !user || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) {
    throw new ApiError(401, "invalid_session", "Session expired or invalid.");
  }
  return user;
}

function pick(object: any, paths: string[]): unknown {
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

function providerFields(payload: Json): { status: string; reference: string; amount: number | null } {
  const status = clean(pick(payload, ["status", "payment_status", "paymentStatus", "data.status", "data.payment_status"])).toLowerCase();
  const reference = clean(pick(payload, [
    "transaction_uuid", "uuid", "reference", "transaction_id", "transactionId", "payment_id",
    "data.transaction_uuid", "data.uuid", "data.reference", "data.transaction_id", "data.payment_id",
  ]));
  const rawAmount = Number(pick(payload, ["amount", "paid_amount", "data.amount", "data.paid_amount"]));
  return { status, reference, amount: Number.isFinite(rawAmount) ? rawAmount : null };
}

function localStatus(providerStatus: string): LocalStatus {
  if (["paid", "success", "successful", "completed", "approved", "confirmed", "succeeded", "done", "vire", "viré"].includes(providerStatus)) return "paid";
  if (providerStatus === "refunded") return "refunded";
  if (["cancelled", "canceled"].includes(providerStatus)) return "cancelled";
  if (["failed", "declined", "expired", "error"].includes(providerStatus)) return "failed";
  if (["processing", "initiated", "in_progress", "in-progress"].includes(providerStatus)) return "processing";
  return "pending";
}

async function camerPayStatus(providerReference: string): Promise<Json> {
  const [{ data: config, error: configError }, token] = await Promise.all([
    db.from("domain_config").select("camerpay_base_url").eq("id", true).single(),
    getSecret("domain_camerpay_api_token"),
  ]);
  if (configError || !config) throw new ApiError(500, "configuration_missing", "Payment configuration is missing.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `${String(config.camerpay_base_url).replace(/\/$/, "")}/api/payment/${encodeURIComponent(providerReference)}/status`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: controller.signal },
    );
    const raw = await response.text();
    let payload: Json = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 2_000) }; }
    if (!response.ok) {
      throw new ApiError(502, "payment_provider_error", clean(payload.message || payload.error) || `CamerPay status failed (${response.status}).`, payload);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(504, "payment_provider_timeout", "CamerPay did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyNonPaidStatus(payment: Json, status: LocalStatus, payload: Json, reference: string): Promise<void> {
  await db.from("domain_payments").update({
    status,
    raw_payload: payload,
    provider_reference: reference || payment.provider_reference,
    updated_at: new Date().toISOString(),
  }).eq("id", payment.id);

  if (["failed", "cancelled", "refunded"].includes(status)) {
    await db.from("domain_orders").update({
      status,
      failure_message: status === "failed" ? "CamerPay reported that the payment failed." : null,
      updated_at: new Date().toISOString(),
    }).eq("id", payment.order_id).in("status", ["pending_payment", "payment_pending"]);
  } else {
    await db.from("domain_orders").update({ status: "payment_pending", updated_at: new Date().toISOString() })
      .eq("id", payment.order_id).in("status", ["pending_payment", "payment_pending"]);
  }
}

async function checkOne(payment: Json): Promise<{ payment: Json; order: Json; providerStatus: string | null; finalized: boolean }> {
  let providerStatus: string | null = null;
  if (payment.status !== "paid" && payment.provider_reference) {
    const payload = await camerPayStatus(payment.provider_reference);
    const fields = providerFields(payload);
    providerStatus = fields.status || null;
    const status = localStatus(fields.status);

    if (status === "paid" && (fields.amount === null || fields.amount >= Number(payment.amount_xaf))) {
      const { error } = await db.rpc("domain_finalize_paid_payment", {
        p_payment_id: payment.id,
        p_provider_reference: fields.reference || payment.provider_reference,
        p_provider_status: fields.status,
        p_paid_amount: fields.amount,
        p_payload: payload,
      });
      if (error) throw new ApiError(500, "payment_finalization_failed", "Unable to finalize the confirmed payment.", error);
    } else {
      await applyNonPaidStatus(payment, status === "paid" ? "processing" : status, payload, fields.reference);
    }
  }

  const [{ data: refreshedPayment, error: paymentError }, { data: order, error: orderError }] = await Promise.all([
    db.from("domain_payments").select("*").eq("id", payment.id).single(),
    db.from("domain_orders").select("*").eq("id", payment.order_id).single(),
  ]);
  if (paymentError || !refreshedPayment || orderError || !order) throw new ApiError(404, "payment_not_found", "Payment or order was not found.");
  return {
    payment: refreshedPayment,
    order,
    providerStatus,
    finalized: Boolean(refreshedPayment.status === "paid" && refreshedPayment.processed_at),
  };
}

async function enforceCheckRateLimit(userId: string): Promise<void> {
  const key = `payment-poll:${userId}`;
  const now = new Date();
  const { data } = await db.from("domain_rate_limits").select("*").eq("key", key).maybeSingle();
  if (!data || new Date(data.window_started_at).getTime() <= now.getTime() - 300_000) {
    await db.from("domain_rate_limits").upsert({ key, hits: 1, window_started_at: now.toISOString(), blocked_until: null, updated_at: now.toISOString() });
    return;
  }
  const hits = Number(data.hits) + 1;
  await db.from("domain_rate_limits").update({ hits, updated_at: now.toISOString() }).eq("key", key);
  if (hits > 75) throw new ApiError(429, "rate_limited", "Too many payment checks. Try again shortly.");
}

async function userCheck(req: Request): Promise<Response> {
  const user = await requireUser(req);
  await enforceCheckRateLimit(user.id);
  const body = await req.json().catch(() => ({})) as Json;
  const orderId = clean(body.orderId);
  const invoice = clean(body.invoice);
  if (!orderId && !invoice) throw new ApiError(400, "payment_reference_required", "Order ID or payment invoice is required.");

  let query = db.from("domain_payments").select("*").eq("user_id", user.id);
  query = orderId ? query.eq("order_id", orderId) : query.eq("merchant_invoice_id", invoice);
  const { data: payment, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !payment) throw new ApiError(404, "payment_not_found", "Payment not found.");
  const result = await checkOne(payment);
  return json(req, {
    ...result,
    checkedAt: new Date().toISOString(),
    polling: { intervalSeconds: 5, recommendedWindowSeconds: 300, serverIntervalSeconds: 60, webhookRequired: false },
  });
}

async function internalPoll(req: Request): Promise<Response> {
  const supplied = clean(req.headers.get("x-domain-cron-secret"));
  const expected = await getSecret("domain_internal_cron_secret");
  if (!supplied || await sha256(supplied) !== await sha256(expected)) {
    throw new ApiError(401, "invalid_automation_secret", "Authorization failed.");
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: payments, error } = await db.from("domain_payments").select("*")
    .in("status", ["pending", "processing"]).not("provider_reference", "is", null)
    .gte("created_at", cutoff).order("created_at", { ascending: true }).limit(20);
  if (error) throw error;

  let checked = 0;
  let paid = 0;
  let terminal = 0;
  let failed = 0;
  const queue = [...(payments || [])];
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) {
      const payment = queue.shift();
      if (!payment) return;
      try {
        const result = await checkOne(payment);
        checked++;
        if (result.payment.status === "paid") paid++;
        else if (["failed", "cancelled", "refunded"].includes(result.payment.status)) terminal++;
      } catch (error) {
        failed++;
        console.error("payment-poll-failed", payment.id, error);
      }
    }
  });
  await Promise.all(workers);
  return json(req, { success: true, checked, paid, terminal, failed, at: new Date().toISOString() });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const path = new URL(req.url).pathname.replace(/^.*\/domain-payment-status/, "") || "/";
  try {
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      return json(req, { ok: true, service: "KmerHosting Domain Payment Polling", webhookRequired: false, timestamp: new Date().toISOString() });
    }
    if (req.method === "POST" && path === "/check") return await userCheck(req);
    if (req.method === "POST" && path === "/internal/poll") return await internalPoll(req);
    throw new ApiError(404, "not_found", "Endpoint not found.");
  } catch (error) {
    if (error instanceof ApiError) return json(req, { error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json(req, { error: "internal_error", message: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
