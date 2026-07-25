import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

type Json = Record<string, any>;
class HttpError extends Error { constructor(public status:number, public code:string, message:string, public details?:unknown){ super(message); } }
const clean = (v: unknown) => String(v ?? "").trim();
function cors(req: Request): HeadersInit { return { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-domain-cron-secret", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" }; }
function json(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors(req) }); }
function price(cost: number, marginPercent: number) { return Math.ceil(cost * (1 + marginPercent / 100) * 100) / 100; }
async function cronOk(req: Request) {
  const header = clean(req.headers.get("x-domain-cron-secret"));
  if (!header) return false;
  const { data } = await db.rpc("domain_secret", { p_name: "domain_internal_cron_secret" });
  return header === clean(data);
}
async function adminOk(req: Request) {
  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  const encoder = new TextEncoder();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(authorization.slice(7).trim())));
  const tokenHash = Array.from(digest).map((b)=>b.toString(16).padStart(2,"0")).join("");
  const { data: session } = await db.from("domain_sessions").select("user_id,session_version").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!session) return false;
  const { data: user } = await db.from("domain_users").select("role,status,session_version").eq("id", session.user_id).maybeSingle();
  return user?.role === "admin" && user?.status === "active" && Number(user?.session_version) === Number(session.session_version);
}
async function authorized(req: Request) { return await cronOk(req) || await adminOk(req); }
async function registrar(path: string, query: Json) {
  const { data, error } = await db.rpc("domain_registrar_proxy", { p_path: path, p_method: "GET", p_body: null, p_query: query });
  if (error) throw new HttpError(502, "provider_proxy_failed", error.message, error);
  const out = data as Json;
  if (!out || Number(out.status) >= 400) throw new HttpError(Number(out?.status || 502), "provider_error", `Provider returned ${out?.status || "unknown"}.`, out?.body || {});
  return out.body as Json;
}
function productCost(payload: any): number | null {
  const v = payload?.sellingPrice ?? payload?.data?.sellingPrice ?? payload?.price ?? payload?.amount;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
async function syncOne(tldRow: Json, marginPercent: number) {
  const name = String(tldRow.tld).replace(/^\./, "");
  const result: Json = { tld: tldRow.tld, ok: false, costs: {}, errors: {} };
  const update: Json = { provider_sync_attempts: Number(tldRow.provider_sync_attempts || 0) + 1, updated_at: new Date().toISOString() };
  for (const [field, orderType] of [["registration", 1], ["renewal", 2], ["transfer", 3]] as const) {
    try {
      const payload = await registrar("/api/v1/products/info", { ProductName: name, OrderType: orderType, Period: 1, Currency: "USD" });
      const cost = productCost(payload);
      if (cost) {
        update[`${field}_cost_usd`] = cost;
        update[`${field}_price_usd`] = price(cost, marginPercent);
        result.costs[field] = cost;
      } else {
        result.errors[field] = "missing_price";
      }
    } catch (err) {
      result.errors[field] = err instanceof Error ? err.message : String(err);
      if (/429|rate|timeout/i.test(String(result.errors[field]))) break;
    }
  }
  const gotRegistration = update.registration_cost_usd !== undefined;
  update.price_source = gotRegistration ? `provider_product_info_plus_${marginPercent}` : "provider_sync_failed";
  update.last_synced_at = gotRegistration ? new Date().toISOString() : tldRow.last_synced_at;
  update.provider_sync_error = Object.keys(result.errors).length ? JSON.stringify(result.errors).slice(0, 600) : null;
  update.provider_next_sync_at = gotRegistration ? new Date(Date.now() + 7 * 86400_000).toISOString() : new Date(Date.now() + Math.min(1440, 5 * update.provider_sync_attempts) * 60_000).toISOString();
  const { error } = await db.from("domain_tld_prices").update(update).eq("tld", tldRow.tld);
  if (error) throw error;
  result.ok = gotRegistration;
  return result;
}
async function run(req: Request) {
  if (!(await authorized(req))) throw new HttpError(401, "unauthorized", "Unauthorized.");
  const body = await req.json().catch(() => ({})) as Json;
  const limit = Math.max(1, Math.min(5, Number(body.limit || new URL(req.url).searchParams.get("limit") || 1)));
  const marginPercent = Math.max(0, Math.min(200, Number(body.marginPercent || new URL(req.url).searchParams.get("margin") || 30)));
  const { data: rows, error } = await db.from("domain_tld_prices")
    .select("*")
    .eq("enabled", true)
    .or("registration_cost_usd.is.null,provider_next_sync_at.lte." + new Date().toISOString())
    .order("registration_cost_usd", { ascending: true, nullsFirst: true })
    .order("provider_next_sync_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const results = [];
  for (const row of rows || []) results.push(await syncOne(row, marginPercent));
  return json(req, { ok: true, synced: results.length, results });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    if (req.method === "GET") return json(req, { ok: true, service: "KmerHosting TLD Progressive Sync", timestamp: new Date().toISOString() });
    if (req.method === "POST") return await run(req);
    throw new HttpError(405, "method_not_allowed", "Method not allowed.");
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.code, message: e.message, details: e.details }, e.status);
    console.error(e);
    return json(req, { error: "internal_error", message: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});