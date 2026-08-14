import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();
type Environment = "ote" | "production";
type Json = Record<string, any>;

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const responseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: responseHeaders });

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireAdmin(req: Request) {
  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "authentication_required", "Administrator access is required.");
  }
  const tokenHash = await sha256(authorization.slice(7).trim());
  const { data: session } = await db.from("domain_sessions")
    .select("user_id,session_version")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", now())
    .maybeSingle();
  if (!session) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: user } = await db.from("domain_users")
    .select("id,role,status,session_version")
    .eq("id", session.user_id)
    .maybeSingle();
  if (!user || user.role !== "admin" || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) {
    throw new HttpError(403, "admin_required", "Administrator access is required.");
  }
}

function environmentLabel(environment: Environment) {
  return environment === "ote" ? "TEST / OTE" : "LIVE / Production";
}

async function latestSnapshot(environment: Environment, successOnly = false) {
  let query = db.from("domain_provider_balance_snapshots")
    .select("balance,provider_http_status,provider_payload,status,error_message,checked_at")
    .eq("registrar_environment", environment)
    .eq("currency", "USD")
    .order("checked_at", { ascending: false })
    .limit(1);
  if (successOnly) query = query.eq("status", "success").not("balance", "is", null);
  const { data } = await query.maybeSingle();
  return data || null;
}

function snapshotResult(environment: Environment, snapshot: Json, refreshError?: string, refreshHttpStatus?: number | null) {
  const balance = Number(snapshot.balance);
  const payload = (snapshot.provider_payload || {}) as Json;
  const tryAmount = Number(payload.tryBalance);
  return {
    environment,
    label: environmentLabel(environment),
    endpoint: "deposit/accounts/me",
    httpStatus: Number(snapshot.provider_http_status || 0) || null,
    refreshHttpStatus: refreshHttpStatus ?? null,
    currency: "USD",
    Balance: Number.isFinite(balance) ? balance.toFixed(2) : "0.00",
    usdBalance: Number.isFinite(balance) ? balance : null,
    tryBalance: Number.isFinite(tryAmount) ? tryAmount : null,
    tryBalanceMeaning: "TRY/TL currency balance; not test balance",
    OperationResult: "CACHED",
    source: "DomainNameAPI verified snapshot",
    balanceSource: "snapshot",
    cached: true,
    checkedAt: snapshot.checked_at,
    refreshError: refreshError || null,
    warning: refreshError ? `Live provider refresh unavailable; showing the last verified balance. ${refreshError}` : null,
    dnaSdkSemantics: "nodejs-dna V3.0.1 GetCurrentBalance('USD')",
  };
}

async function rememberSuccess(environment: Environment, status: number, body: Json, usd: number) {
  await db.from("domain_provider_balance_snapshots").insert({
    registrar_environment: environment,
    currency: "USD",
    balance: usd,
    provider_http_status: status,
    provider_payload: {
      usdBalance: usd,
      tryBalance: body.tryBalance ?? null,
      resellerId: body.resellerId ?? null,
      resellerName: body.resellerName ?? null,
      resellerGroupName: body.resellerGroupName ?? null,
    },
    status: "success",
    error_message: null,
    checked_at: now(),
  });
}

async function rememberFailure(environment: Environment, status: number | null, message: string) {
  await db.from("domain_provider_balance_snapshots").insert({
    registrar_environment: environment,
    currency: "USD",
    balance: null,
    provider_http_status: status,
    provider_payload: {},
    status: "failed",
    error_message: message.slice(0, 500),
    checked_at: now(),
  });
}

async function providerBalance(environment: Environment, forceRefresh: boolean) {
  const recent = await latestSnapshot(environment);
  if (!forceRefresh && recent?.checked_at && Date.now() - new Date(recent.checked_at).getTime() < 60_000) {
    if (recent.status === "success" && recent.balance !== null) return snapshotResult(environment, recent);
    const previousSuccess = await latestSnapshot(environment, true);
    if (previousSuccess) {
      return snapshotResult(
        environment,
        previousSuccess,
        clean(recent.error_message) || "Recent DomainNameAPI refresh failed.",
        Number(recent.provider_http_status || 0) || null,
      );
    }
  }

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
  if (!out || status >= 400) {
    throw new HttpError(
      status >= 500 ? 502 : status || 502,
      "provider_error",
      clean(out?.body?.message || out?.body?.error || `DomainNameAPI request failed (${status || "unknown"}).`),
      { providerHttpStatus: status || null, providerBody: out?.body || out },
    );
  }

  const body = (out.body || {}) as Json;
  const usd = Number(body.usdBalance);
  const tryAmount = Number(body.tryBalance);
  if (!Number.isFinite(usd)) throw new HttpError(502, "provider_balance_missing", "DomainNameAPI did not return usdBalance.", body);
  await rememberSuccess(environment, status || 200, body, usd);

  return {
    environment,
    label: environmentLabel(environment),
    endpoint: "deposit/accounts/me",
    httpStatus: status || 200,
    refreshHttpStatus: status || 200,
    currency: "USD",
    Balance: usd.toFixed(2),
    usdBalance: usd,
    tryBalance: Number.isFinite(tryAmount) ? tryAmount : null,
    tryBalanceMeaning: "TRY/TL currency balance; not test balance",
    provider: {
      resellerId: body.resellerId ?? null,
      resellerName: body.resellerName ?? null,
      resellerGroupName: body.resellerGroupName ?? null,
    },
    OperationResult: "SUCCESS",
    source: "DomainNameAPI REST",
    balanceSource: "live",
    cached: false,
    checkedAt: now(),
    refreshError: null,
    warning: null,
    dnaSdkSemantics: "nodejs-dna V3.0.1 GetCurrentBalance('USD')",
  };
}

async function balanceWithFallback(environment: Environment, forceRefresh: boolean) {
  try {
    return await providerBalance(environment, forceRefresh);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Balance request failed.";
    const httpStatus = error instanceof HttpError
      ? Number((error.details as Json | undefined)?.providerHttpStatus || error.status || 0) || null
      : null;
    await rememberFailure(environment, httpStatus, message);
    const snapshot = await latestSnapshot(environment, true);
    if (snapshot) return snapshotResult(environment, snapshot, message, httpStatus);
    return {
      environment,
      label: environmentLabel(environment),
      OperationResult: "FAILED",
      message,
      refreshHttpStatus: httpStatus,
      source: "DomainNameAPI REST",
      cached: false,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
    await requireAdmin(req);
    const url = new URL(req.url);
    const requested = url.searchParams.get("environment")?.toLowerCase();
    const forceRefresh = ["1", "true", "yes"].includes((url.searchParams.get("refresh") || "").toLowerCase());
    const environments: Environment[] = requested === "ote" || requested === "test"
      ? ["ote"]
      : requested === "production" || requested === "live"
        ? ["production"]
        : ["ote", "production"];
    const balances = [];
    for (const environment of environments) balances.push(await balanceWithFallback(environment, forceRefresh));

    const { data: config } = await db.from("domain_config")
      .select("customer_checkout_environment,registrar_environment,maintenance_mode")
      .eq("id", true)
      .single();
    return json({
      ok: true,
      service: "KmerHosting DomainNameAPI Reseller Balances",
      dnaVersion: "3.0.1",
      authoritativeSource: "DomainNameAPI deposit/accounts/me",
      checkoutEnvironment: config?.customer_checkout_environment || config?.registrar_environment || "ote",
      maintenanceMode: Boolean(config?.maintenance_mode),
      balances,
      note: "A cached value is only the last verified provider balance for display. LIVE order authorization keeps its independent fresh-balance guard.",
      generatedAt: now(),
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
