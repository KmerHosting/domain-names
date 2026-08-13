import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();
type Environment = "ote" | "production";
type Json = Record<string, any>;
class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const responseHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: responseHeaders });

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireAdmin(req: Request) {
  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "authentication_required", "Administrator access is required.");
  const tokenHash = await sha256(authorization.slice(7).trim());
  const { data: session } = await db.from("domain_sessions").select("user_id,session_version").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", now()).maybeSingle();
  if (!session) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: user } = await db.from("domain_users").select("id,role,status,session_version").eq("id", session.user_id).maybeSingle();
  if (!user || user.role !== "admin" || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) throw new HttpError(403, "admin_required", "Administrator access is required.");
}

async function providerBalance(environment: Environment) {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: "/api/v1/deposit/accounts/me",
    p_method: "GET",
    p_body: null,
    p_query: { currency: "USD" },
    p_environment: environment,
  });
  if (error) throw new HttpError(502, "provider_proxy_failed", error.message, error);
  const out = data as Json;
  const status = Number(out?.status || 0);
  if (!out || status >= 400) throw new HttpError(status >= 500 ? 502 : status || 502, "provider_error", clean(out?.body?.message || out?.body?.error || `DomainNameAPI request failed (${status || "unknown"}).`), out?.body || out);
  const body = (out.body || {}) as Json;
  const usd = Number(body.usdBalance);
  const tryAmount = Number(body.tryBalance);
  return {
    environment,
    label: environment === "ote" ? "TEST / OTE" : "LIVE / Production",
    endpoint: "deposit/accounts/me",
    httpStatus: status || 200,
    currency: "USD",
    Balance: Number.isFinite(usd) ? usd.toFixed(2) : "0.00",
    usdBalance: Number.isFinite(usd) ? usd : null,
    tryBalance: Number.isFinite(tryAmount) ? tryAmount : null,
    tryBalanceMeaning: "TRY/TL currency balance; not test balance",
    provider: {
      resellerId: body.resellerId ?? null,
      resellerName: body.resellerName ?? null,
      resellerGroupName: body.resellerGroupName ?? null,
    },
    OperationResult: Number.isFinite(usd) ? "SUCCESS" : "FAILED",
    source: "DomainNameAPI REST",
    dnaSdkSemantics: "nodejs-dna V3.0.1 GetCurrentBalance('USD')",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
    await requireAdmin(req);
    const requested = new URL(req.url).searchParams.get("environment")?.toLowerCase();
    const environments: Environment[] = requested === "ote" || requested === "test"
      ? ["ote"]
      : requested === "production" || requested === "live"
        ? ["production"]
        : ["ote", "production"];
    const balances: Json[] = [];
    for (const environment of environments) {
      try { balances.push(await providerBalance(environment)); }
      catch (error) { balances.push({ environment, label: environment === "ote" ? "TEST / OTE" : "LIVE / Production", OperationResult: "FAILED", message: error instanceof Error ? error.message : "Balance request failed.", source: "DomainNameAPI REST" }); }
    }
    const { data: config } = await db.from("domain_config").select("customer_checkout_environment,registrar_environment,maintenance_mode").eq("id", true).single();
    return json({
      ok: true,
      service: "KmerHosting DomainNameAPI Reseller Balances",
      dnaVersion: "3.0.1",
      authoritativeSource: "DomainNameAPI deposit/accounts/me",
      checkoutEnvironment: config?.customer_checkout_environment || config?.registrar_environment || "ote",
      maintenanceMode: Boolean(config?.maintenance_mode),
      balances,
      note: "Provider balances are never created or edited by KmerHosting. OTE and LIVE are distinguished by the DomainNameAPI base URL. tryBalance is the TRY/TL currency balance.",
      generatedAt: now(),
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
