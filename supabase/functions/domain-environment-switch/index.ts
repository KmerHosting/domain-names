import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const clean = (v: unknown) => String(v ?? "").trim();
function json(v: unknown, s = 200) { return new Response(JSON.stringify(v), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
async function sha(v: string) { const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v))); return Array.from(d).map(x => x.toString(16).padStart(2, "0")).join(""); }

async function admin(req: Request) {
  const raw = clean(req.headers.get("authorization"));
  if (!raw.toLowerCase().startsWith("bearer ")) throw new Error("authentication_required");
  const { data: s } = await db.from("domain_sessions").select("user_id,session_version").eq("token_hash", await sha(raw.slice(7).trim())).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!s) throw new Error("invalid_session");
  const { data: u } = await db.from("domain_users").select("id,role,status,session_version").eq("id", s.user_id).maybeSingle();
  if (!u || u.role !== "admin" || u.status !== "active" || Number(u.session_version) !== Number(s.session_version)) throw new Error("admin_required");
  return u;
}

async function syncCatalog(req: Request, environment: string) {
  const authorization = clean(req.headers.get("authorization"));
  const response = await fetch(`${SUPABASE_URL}/functions/v1/domain-tld-provider-sync?environment=${encodeURIComponent(environment)}&margin=30`, {
    method: "POST",
    headers: { "Authorization": authorization, "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.success !== true) {
    const message = clean(payload.message) || clean(payload.error) || `Catalog synchronization failed (${response.status}).`;
    throw new Error(`catalog_sync_failed:${message}`);
  }
  return payload.result ?? null;
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const u = await admin(req);
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const env = clean(b.environment).toLowerCase();
    const confirm = clean(b.confirm).toLowerCase();
    if (!["ote", "production"].includes(env)) return json({ error: "invalid_environment", message: "Choose ote or production." }, 400);
    if (confirm !== env) return json({ error: "confirmation_required", message: `Confirm the target environment by sending confirm=${env}.` }, 409);

    // Exact prices are environment-scoped. Refresh the target catalog before
    // enabling checkout so OTE can never be activated with LIVE-only prices.
    const catalogSync = await syncCatalog(req, env);

    const { data, error } = await db.rpc("domain_set_checkout_environment", { p_environment: env });
    if (error) return json({ error: "environment_change_failed", message: error.message }, 409);
    await db.from("domain_audit_logs").insert({
      user_id: u.id,
      action: "admin.checkout_environment.changed",
      entity_type: "domain_config",
      metadata: { environment: env, testMode: env === "ote", catalogSync },
    });
    return json({ ok: true, result: data, catalogSync, warning: "Existing domains, orders, DNS records and jobs keep their immutable registrar environment." });
  } catch (e) {
    const m = e instanceof Error ? e.message : "internal_error";
    if (m.startsWith("catalog_sync_failed:")) return json({ error: "catalog_sync_failed", message: m.slice("catalog_sync_failed:".length) }, 502);
    return json({ error: m, message: m }, m === "authentication_required" || m === "invalid_session" ? 401 : m === "admin_required" ? 403 : 500);
  }
});
