import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();
type Json = Record<string, any>;
type Environment = "ote" | "production";
const clean = (value: unknown) => String(value ?? "").trim();
const responseHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: responseHeaders });

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireAdmin(req: Request) {
  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new Error("authentication_required");
  const { data: session } = await db.from("domain_sessions")
    .select("user_id,session_version")
    .eq("token_hash", await sha256(authorization.slice(7).trim()))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!session) throw new Error("invalid_session");
  const { data: user } = await db.from("domain_users")
    .select("id,role,status,session_version")
    .eq("id", session.user_id)
    .maybeSingle();
  if (!user || user.role !== "admin" || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) {
    throw new Error("admin_required");
  }
}

function providerAccountFromSummary(row: Json) {
  const environment = row.environment as Environment;
  const balance = row.provider_balance_usd === null || row.provider_balance_usd === undefined
    ? null
    : Number(row.provider_balance_usd);
  return {
    environment,
    label: environment === "ote" ? "TEST / OTE" : "LIVE / Production",
    source: "DomainNameAPI verified snapshot",
    sourceOfTruth: true,
    balanceSource: "snapshot",
    cached: true,
    usdBalance: Number.isFinite(balance) ? balance : null,
    tryBalance: null,
    tryBalanceCurrency: "TRY/TL",
    checkedAt: row.provider_balance_checked_at || null,
    endpoint: environment === "ote"
      ? "https://ote.domainresellerapi.com/api/v1/deposit/accounts/me"
      : "https://api.domainresellerapi.com/api/v1/deposit/accounts/me",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    await requireAdmin(req);
    const [{ data: config }, { data: summary }, { data: credits }] = await Promise.all([
      db.from("domain_config")
        .select("customer_checkout_environment,registrar_environment,maintenance_mode,payment_mode,wallet_topup_mode")
        .eq("id", true)
        .single(),
      db.from("domain_environment_summary")
        .select("environment,display_name,is_test,enabled,customer_checkout_enabled,domains,orders,open_jobs,dns_records,provider_balance_usd,provider_balance_checked_at")
        .order("is_test", { ascending: false }),
      db.from("domain_user_balance_matrix")
        .select("user_id,email,role,status,ote_balance_usd,production_balance_usd,checkout_environment,checkout_balance_usd")
        .order("email"),
    ]);

    const environments = summary || [];
    const registrarAccounts = environments.map(providerAccountFromSummary);
    return json({
      ok: true,
      config,
      environments,
      registrarAccounts,
      customerCredits: {
        source: "KmerHosting customer ledger",
        sourceOfTruthForCustomerBilling: true,
        notDomainNameApiBalance: true,
        rows: credits || [],
      },
      semantics: {
        oteProviderBalance: "last verified usdBalance from the OTE API host",
        liveProviderBalance: "last verified usdBalance from the production API host",
        tryBalance: "TRY/TL currency balance; never a test-mode balance",
        customerCredit: "KmerHosting per-user billing credit; separate from DomainNameAPI reseller funds",
      },
      note: "Environment status reads the verified provider snapshot cache and does not make another DomainNameAPI request. Use the provider balance endpoint for an explicit refresh.",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    const status = message === "authentication_required" || message === "invalid_session" ? 401 : message === "admin_required" ? 403 : 500;
    return json({ error: message, message }, status);
  }
});
