import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

type Json = Record<string, any>;
class HttpError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
const clean = (v: unknown) => String(v ?? "").trim();
const now = () => new Date().toISOString();
function allowedOrigin(origin: string | null) { if (!origin) return "*"; try { const host = new URL(origin).hostname.toLowerCase(); if (host === "domain.kmerhosting.com" || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return origin; } catch {} return "https://domain.kmerhosting.com"; }
function cors(req: Request): HeadersInit { return { "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")), "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET,OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" }; }
function json(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors(req) }); }
function pathOf(req: Request) { const p = new URL(req.url).pathname; const marker = "/domain-operations-monitor"; const i = p.indexOf(marker); return (i >= 0 ? p.slice(i + marker.length) : p).replace(/\/+$/, "") || "/"; }
async function sha256(value: string) { const d = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); return Array.from(d).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function admin(req: Request) { const authorization = clean(req.headers.get("authorization")); if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "authentication_required", "Authentication is required."); const tokenHash = await sha256(authorization.slice(7).trim()); const { data: session } = await db.from("domain_sessions").select("*").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", now()).maybeSingle(); if (!session) throw new HttpError(401, "invalid_session", "Session expired or invalid."); const { data: user } = await db.from("domain_users").select("id,email,role,status,session_version").eq("id", session.user_id).maybeSingle(); if (!user || user.status !== "active" || user.role !== "admin" || Number(user.session_version) !== Number(session.session_version)) throw new HttpError(403, "admin_required", "Administrator access is required."); return user as Json; }
async function sqlView(name: string) { try { const { data, error } = await db.from(name).select("*"); if (error) return { error: error.message, rows: [] }; return { rows: data || [] }; } catch (e) { return { error: e instanceof Error ? e.message : String(e), rows: [] }; } }
async function summary(req: Request) {
  await admin(req);
  const { data: config } = await db.from("domain_config").select("registrar_environment,payment_sandbox,maintenance_mode,provider_low_balance_threshold_usd,checkout_pause_message").eq("id", true).maybeSingle();
  const { data: domains } = await db.from("domain_domains").select("registrar_environment,status,domain_name,expires_at,created_at").order("created_at", { ascending: false });
  const { data: orders } = await db.from("domain_orders").select("id,order_number,domain_name,type,status,price_usd,paid_at,completed_at,created_at,failure_message,registrar_environment").order("created_at", { ascending: false }).limit(50);
  const { data: payments } = await db.from("domain_payments").select("id,status,amount_xaf,merchant_invoice_id,created_at,paid_at,processed_at").order("created_at", { ascending: false }).limit(50);
  const { data: deadJobs } = await db.from("domain_jobs").select("id,type,status,attempts,max_attempts,last_error,created_at,updated_at,domain_id,order_id").eq("status", "dead").order("updated_at", { ascending: false }).limit(50);
  const { data: failedJobs } = await db.from("domain_jobs").select("id,type,status,attempts,max_attempts,last_error,created_at,updated_at,domain_id,order_id").in("status", ["failed", "retrying"]).order("updated_at", { ascending: false }).limit(50);
  const { data: dns } = await db.from("domain_dns_records").select("id,domain_id,type,name,status,source,last_operation,last_error,synced_at,updated_at,registrar_environment").order("updated_at", { ascending: false }).limit(100);
  const { data: tlds } = await db.from("domain_tld_prices").select("tld,enabled,provider_available,registration_cost_usd,renewal_cost_usd,transfer_cost_usd,registration_price_usd").eq("enabled", true);
  const crons = await sqlView("domain_admin_cron_status");
  const issues = await sqlView("domain_operational_issues");
  const domainRows = domains || [];
  const orderRows = orders || [];
  const paymentRows = payments || [];
  const dnsRows = dns || [];
  const tldRows = tlds || [];
  const by = (rows: Json[], key: string) => rows.reduce((acc: Json, row: Json) => { const v = clean(row[key]) || "unknown"; acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  const paidUnfinished = orderRows.filter((o) => o.paid_at && !["completed", "refunded", "cancelled"].includes(clean(o.status)));
  const paidRefunded = orderRows.filter((o) => o.paid_at && clean(o.status) === "refunded");
  const staleDns = dnsRows.filter((r) => ["stale", "failed", "deleting"].includes(clean(r.status)) || clean(r.last_error));
  const sellableWithoutCosts = tldRows.filter((t) => t.enabled && (!t.registration_cost_usd || !t.renewal_cost_usd || !t.transfer_cost_usd));
  const readiness = [
    { key: "checkout_config", ok: Boolean(config && !config.maintenance_mode && !config.payment_sandbox && config.registrar_environment === "production"), message: "Checkout config is production/live/off-maintenance." },
    { key: "dead_jobs", ok: !deadJobs?.length, count: deadJobs?.length || 0, message: "Dead jobs should be reviewed or archived." },
    { key: "paid_unfinished_orders", ok: paidUnfinished.length === 0, count: paidUnfinished.length, message: "Paid orders should be completed/refunded/cancelled." },
    { key: "dns_failed_or_stale", ok: staleDns.length === 0, count: staleDns.length, message: "DNS failed/stale records should be retried or synced." },
    { key: "tld_costs", ok: sellableWithoutCosts.length === 0, count: sellableWithoutCosts.length, message: "Enabled TLDs should have provider costs." }
  ];
  return json(req, { ok: true, generatedAt: now(), config, counts: { domainsByEnvironment: by(domainRows, "registrar_environment"), domainsByStatus: by(domainRows, "status"), ordersByStatus: by(orderRows, "status"), paymentsByStatus: by(paymentRows, "status"), dnsByStatus: by(dnsRows, "status") }, deadJobs: deadJobs || [], failedJobs: failedJobs || [], paidUnfinished, paidRefunded, staleDns, tlds: { enabled: tldRows.length, sellableWithoutCosts }, cron: crons.rows || [], operationalIssues: issues.rows || [], readiness });
}
Deno.serve(async (req) => { if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) }); try { const path = pathOf(req); if (req.method === "GET" && (path === "/" || path === "/health")) return json(req, { ok: true, service: "KmerHosting Domain Operations Monitor", version: 1, timestamp: now() }); if (req.method === "GET" && path === "/summary") return await summary(req); return json(req, { error: "not_found", message: "Endpoint not found." }, 404); } catch (e) { if (e instanceof HttpError) return json(req, { error: e.code, message: e.message, details: e.details }, e.status); console.error(e); return json(req, { error: "internal_error", message: e instanceof Error ? e.message : "Unexpected error." }, 500); } });