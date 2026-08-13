import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

type Json = Record<string, any>;
type Environment = "ote" | "production";
class HttpError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

function allowedOrigin(origin: string | null): string { if (!origin) return "*"; try { const host = new URL(origin).hostname.toLowerCase(); if (host === "domain.kmerhosting.com" || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return origin; } catch {} return "https://domain.kmerhosting.com"; }
function cors(req: Request): HeadersInit { return { "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")), "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "Vary": "Origin", "X-Content-Type-Options": "nosniff" }; }
function json(req: Request, body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: cors(req) }); }
async function sha256(value: string): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function functionPath(req: Request): string { const pathname = new URL(req.url).pathname; const marker = "/domain-wallet"; const index = pathname.indexOf(marker); return (index >= 0 ? pathname.slice(index + marker.length) : pathname).replace(/\/+$/, "") || "/"; }
async function body(req: Request): Promise<Json> { if (!req.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "unsupported_media_type", "Content-Type application/json is required."); const payload = await req.json().catch(() => null); if (!payload || Array.isArray(payload) || typeof payload !== "object") throw new HttpError(400, "invalid_json", "A JSON object is required."); return payload as Json; }
async function auth(req: Request): Promise<Json> { const authorization = clean(req.headers.get("authorization")); if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "authentication_required", "Sign in is required."); const tokenHash = await sha256(authorization.slice(7).trim()); const { data: session, error } = await db.from("domain_sessions").select("*").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle(); if (error || !session) throw new HttpError(401, "invalid_session", "Session expired or invalid."); const { data: user, error: userError } = await db.from("domain_users").select("*").eq("id", session.user_id).maybeSingle(); if (userError || !user || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) throw new HttpError(401, "invalid_session", "Session expired or invalid."); return user as Json; }
async function config(): Promise<Json> { const { data, error } = await db.from("domain_config").select("support_email,payment_mode,wallet_topup_mode,maintenance_mode,customer_checkout_environment,registrar_environment").eq("id", true).single(); if (error || !data) throw new HttpError(500, "config_missing", "Domain configuration is missing."); return data as Json; }
function envValue(value: unknown): Environment { const v = clean(value).toLowerCase(); if (v === "production" || v === "live") return "production"; if (v === "ote" || v === "test") return "ote"; throw new HttpError(400, "environment_required", "Choose TEST / OTE or LIVE / production."); }

async function summary(req: Request): Promise<Response> {
  const user = await auth(req);
  const [balances, transactions, orders, cfg] = await Promise.all([
    db.from("domain_user_environment_balances").select("registrar_environment,balance_usd,updated_at").eq("user_id", user.id),
    db.from("domain_wallet_transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    db.from("domain_orders").select("id,order_number,type,domain_name,status,price_usd,amount_xaf,registrar_environment,created_at,domain_payments(id,provider,status,payment_method,registrar_environment,created_at)").eq("user_id", user.id).in("status", ["pending_payment", "payment_pending", "paid", "processing", "failed"]).order("created_at", { ascending: false }).limit(50),
    config(),
  ]);
  const map: Record<Environment, number> = { ote: 0, production: 0 };
  for (const row of balances.data || []) map[envValue(row.registrar_environment)] = money(row.balance_usd);
  const checkoutEnvironment = envValue(cfg.customer_checkout_environment || cfg.registrar_environment || "ote");
  return json(req, {
    balanceUsd: map[checkoutEnvironment],
    checkoutEnvironment,
    testMode: checkoutEnvironment === "ote",
    balances: {
      ote: { balanceUsd: map.ote, label: "TEST / OTE", testMode: true },
      production: { balanceUsd: map.production, label: "LIVE / Production", testMode: false },
    },
    transactions: transactions.data || [],
    orders: orders.data || [],
    topups: [],
    paymentMode: cfg.payment_mode || "wallet_only",
    topupMode: cfg.wallet_topup_mode || "manual_support",
    supportEmail: cfg.support_email || "support@kmerhosting.com",
    topupInstructions: `Contact ${cfg.support_email || "support@kmerhosting.com"} to request a manual credit and specify TEST or LIVE.`,
  });
}

async function payOrder(req: Request): Promise<Response> {
  const user = await auth(req); const payload = await body(req); const orderId = clean(payload.orderId);
  if (!orderId) throw new HttpError(400, "order_required", "Order ID is required.");
  const { data, error } = await db.rpc("domain_wallet_pay_order", { p_user_id: user.id, p_order_id: orderId });
  if (error) { const message = String(error.message || ""); if (message.includes("insufficient_wallet_balance")) { const cfg = await config(); throw new HttpError(402, "insufficient_wallet_balance", `The balance for this order environment is insufficient. Contact ${cfg.support_email || "support@kmerhosting.com"} for a credit in the same environment.`); } if (message.includes("order_not_found")) throw new HttpError(404, "order_not_found", "Order not found."); if (message.includes("order_not_payable_from_wallet")) throw new HttpError(409, "order_not_payable", "This order cannot be paid from the account balance."); throw error; }
  return json(req, { success: true, result: data });
}

async function adminCredit(req: Request): Promise<Response> {
  const admin = await auth(req); if (admin.role !== "admin") throw new HttpError(403, "admin_required", "Administrator access is required.");
  const payload = await body(req); const userId = clean(payload.userId); const amountUsd = money(payload.amountUsd ?? payload.amount); const environment = envValue(payload.environment || payload.registrarEnvironment); const reason = clean(payload.reason) || "Manual support credit"; const idempotencyKey = clean(req.headers.get("idempotency-key") || payload.idempotencyKey) || crypto.randomUUID();
  if (!userId) throw new HttpError(400, "user_required", "User ID is required."); if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new HttpError(400, "invalid_amount", "Enter a positive USD amount.");
  const { data, error } = await db.rpc("domain_manual_wallet_credit_env", { p_admin_id: admin.id, p_user_id: userId, p_environment: environment, p_amount_usd: amountUsd, p_reason: reason, p_idempotency_key: idempotencyKey });
  if (error) { const message = String(error.message || ""); if (message.includes("wallet_user_not_found")) throw new HttpError(404, "user_not_found", "User not found."); if (message.includes("invalid_credit_amount")) throw new HttpError(400, "invalid_amount", "The credit amount is invalid."); throw error; }
  return json(req, { success: true, result: data, registrarEnvironment: environment, testMode: environment === "ote" });
}

async function topupsRemoved(req: Request): Promise<Response> { const cfg = await config(); return json(req, { error: "manual_topup_required", message: `Online top-ups are disabled. Contact ${cfg.support_email || "support@kmerhosting.com"} for a manual TEST or LIVE account credit.`, supportEmail: cfg.support_email || "support@kmerhosting.com" }, 410); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    const path = functionPath(req);
    if (req.method === "GET" && (path === "/" || path === "/health")) { const cfg = await config(); const checkoutEnvironment = envValue(cfg.customer_checkout_environment || cfg.registrar_environment || "ote"); return json(req, { ok: true, service: "KmerHosting Domain Wallet", version: 3, checkoutEnvironment, testMode: checkoutEnvironment === "ote", paymentMode: cfg.payment_mode || "wallet_only", topupMode: cfg.wallet_topup_mode || "manual_support", supportEmail: cfg.support_email || "support@kmerhosting.com", timestamp: new Date().toISOString() }); }
    if (req.method === "GET" && path === "/summary") return await summary(req);
    if (req.method === "POST" && path === "/pay-order") return await payOrder(req);
    if (req.method === "POST" && path === "/admin/credit") return await adminCredit(req);
    if (path.startsWith("/topups") || path === "/poll") return await topupsRemoved(req);
    return json(req, { error: "not_found", message: "Endpoint not found." }, 404);
  } catch (error) { if (error instanceof HttpError) return json(req, { error: error.code, message: error.message, details: error.details }, error.status); console.error(error); return json(req, { error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500); }
});
