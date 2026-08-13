import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

type Json = Record<string, any>;
type EnvName = "ote" | "production";

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const DNA_VERSION = "3.0.1";
const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();

function allowedOrigin(origin: string | null): string {
  if (!origin) return "*";
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (["domain.kmerhosting.com", "localhost", "127.0.0.1"].includes(host) || host.endsWith(".vercel.app")) return origin;
  } catch {
    // ignore malformed origins
  }
  return "https://domain.kmerhosting.com";
}

function cors(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
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

function basePath(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const marker = "/domain-provider-balance";
  const index = pathname.indexOf(marker);
  return (index >= 0 ? pathname.slice(index + marker.length) : pathname).replace(/\/+$/, "") || "/";
}

async function requireAdmin(req: Request): Promise<Json> {
  const raw = clean(req.headers.get("authorization"));
  if (!raw.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "authentication_required", "Administrator access is required.");
  const tokenHash = await sha256(raw.slice(7).trim());
  const { data: session } = await db.from("domain_sessions").select("*").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", now()).maybeSingle();
  if (!session) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: user } = await db.from("domain_users").select("*").eq("id", session.user_id).maybeSingle();
  if (!user || user.status !== "active" || user.role !== "admin" || Number(user.session_version) !== Number(session.session_version)) {
    throw new HttpError(403, "admin_required", "Administrator access is required.");
  }
  return user as Json;
}

function pick(source: any, paths: string[]): unknown {
  for (const path of paths) {
    let current = source;
    for (const key of path.split(".")) {
      if (current === null || current === undefined || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (current !== undefined && current !== null && clean(current) !== "") return current;
  }
  return undefined;
}

function numeric(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function balanceFromPayload(payload: Json, currency: string): { balance: string; rawBalance: number | null; rawKey: string } {
  const key = `${currency.toLowerCase()}Balance`;
  const raw = numeric(pick(payload, [key, `data.${key}`, "Balance", "balance", "amount", "availableBalance"]));
  return { balance: raw === null ? "0.00" : raw.toFixed(2), rawBalance: raw, rawKey: raw === null ? "not_returned" : key };
}

function dnaEnvelope(environment: EnvName, currency: string, payload: Json, status: number): Json {
  const map: Record<string, { id: number; symbol: string; name: string }> = {
    USD: { id: 2, symbol: "$", name: "USD" },
    TRY: { id: 1, symbol: "TL", name: "TL" },
    EUR: { id: 3, symbol: "€", name: "EUR" },
    GBP: { id: 4, symbol: "£", name: "GBP" },
  };
  const upper = currency.toUpperCase();
  const info = map[upper] || { id: 0, symbol: "", name: upper };
  const balance = balanceFromPayload(payload, upper);
  return {
    environment,
    endpoint: "deposit/accounts/me",
    request: { currency: upper },
    httpStatus: status,
    dnaVersion: DNA_VERSION,
    credentialModel: "REST_RESELLER_UUID_PLUS_API_KEY",
    ErrorCode: 0,
    OperationMessage: "Command completed succesfully.",
    OperationResult: "SUCCESS",
    Balance: balance.balance,
    rawBalance: balance.rawBalance,
    rawBalanceKey: balance.rawKey,
    CurrencyId: info.id,
    CurrencyInfo: null,
    CurrencyName: info.name,
    CurrencySymbol: info.symbol,
    provider: payload,
  };
}

async function registrar(environment: EnvName, currency: string): Promise<Json> {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: "/api/v1/deposit/accounts/me",
    p_method: "GET",
    p_body: null,
    p_query: { currency: currency.toUpperCase() },
    p_environment: environment,
  });
  if (error) throw new HttpError(502, "registrar_proxy_failed", error.message, error);
  const out = data as Json;
  const status = Number(out?.status || 0);
  if (!out || status >= 400) {
    throw new HttpError(status >= 500 ? 502 : status || 502, "registrar_error", clean(out?.body?.message || out?.body?.error || `DomainNameAPI request failed (${status || "unknown"}).`), out?.body || out);
  }
  return dnaEnvelope(environment, currency, (out.body || {}) as Json, status || 200);
}

function requestedEnvironments(req: Request): EnvName[] {
  const env = new URL(req.url).searchParams.get("environment")?.toLowerCase();
  if (env === "ote" || env === "test") return ["ote"];
  if (env === "production" || env === "live") return ["production"];
  return ["ote", "production"];
}

function requestedCurrencies(req: Request): string[] {
  const raw = new URL(req.url).searchParams.get("currency") || "USD";
  return [...new Set(raw.split(/[\s,;]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))].slice(0, 4);
}

async function snapshot(req: Request): Promise<Response> {
  await requireAdmin(req);
  const { data: config } = await db.from("domain_config").select("registrar_environment,payment_sandbox,maintenance_mode,provider_low_balance_threshold_usd").eq("id", true).single();
  const balances: Json[] = [];
  for (const environment of requestedEnvironments(req)) {
    for (const currency of requestedCurrencies(req)) {
      try {
        balances.push(await registrar(environment, currency));
      } catch (error) {
        balances.push({
          environment,
          endpoint: "deposit/accounts/me",
          request: { currency },
          dnaVersion: DNA_VERSION,
          credentialModel: "REST_RESELLER_UUID_PLUS_API_KEY",
          OperationResult: "FAILED",
          ErrorCode: error instanceof HttpError ? error.code : "BALANCE",
          OperationMessage: error instanceof Error ? error.message : "Balance request failed.",
          Balance: "0.00",
          rawBalance: null,
          rawBalanceKey: "not_returned",
        });
      }
    }
  }
  const currentEnvironment = config?.registrar_environment === "production" ? "production" : "ote";
  const current = balances.find((item) => item.environment === currentEnvironment && item.CurrencyName === "USD") || null;
  return json(req, {
    ok: true,
    service: "KmerHosting Domain Provider Balance",
    dnaVersion: DNA_VERSION,
    restEndpoints: {
      production: "https://api.domainresellerapi.com/api/v1",
      ote: "https://ote.domainresellerapi.com/api/v1",
    },
    credentialModel: "REST_RESELLER_UUID_PLUS_API_KEY",
    currentEnvironment,
    paymentSandbox: Boolean(config?.payment_sandbox),
    maintenanceMode: Boolean(config?.maintenance_mode),
    lowBalanceThresholdUsd: Number(config?.provider_low_balance_threshold_usd || 0),
    current,
    balances,
    separationStatus: {
      balanceScopesAreSeparated: true,
      note: "Balances are read per registrar environment. This endpoint never purchases, registers, renews or transfers a domain.",
    },
    generatedAt: now(),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    const path = basePath(req);
    if (req.method === "GET" && (path === "/" || path === "/health")) return json(req, { ok: true, service: "KmerHosting Domain Provider Balance", dnaVersion: DNA_VERSION, timestamp: now() });
    if (req.method === "GET" && (path === "/snapshot" || path === "/admin/balances" || path === "/balances")) return await snapshot(req);
    throw new HttpError(404, "not_found", "Endpoint not found.");
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json(req, { error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
