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

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-domain-cron-secret",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
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

async function authorize(req: Request): Promise<string | null> {
  const cronSecret = clean(req.headers.get("x-domain-cron-secret"));
  if (cronSecret && await sha256(cronSecret) === await sha256(await secret("domain_internal_cron_secret"))) {
    return null;
  }

  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "authentication_required", "Administrator access is required.");
  }
  const tokenHash = await sha256(authorization.slice(7).trim());
  const { data: session } = await db.from("domain_sessions").select("user_id")
    .eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", now()).maybeSingle();
  if (!session) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: user } = await db.from("domain_users").select("id,role,status").eq("id", session.user_id).maybeSingle();
  if (!user || user.role !== "admin" || user.status !== "active") {
    throw new HttpError(403, "admin_required", "Administrator access is required.");
  }
  return user.id;
}

async function providerCatalog(environment: "production" | "ote") {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: "/api/v1/products/tlds",
    p_method: "GET",
    p_body: null,
    p_query: { Currency: "USD", SkipCount: 0, MaxResultCount: 1000 },
    p_environment: environment,
  });
  if (error) throw new HttpError(502, "provider_proxy_failed", error.message, error);
  const result = data as Json;
  if (!result || Number(result.status) >= 400) {
    throw new HttpError(502, "provider_error", `DomainNameAPI catalog failed (${result?.status || "unknown"}).`, result?.body);
  }
  return result.body as Json;
}

const array = (value: any): any[] => Array.isArray(value) ? value : [];

function normalizeTld(value: unknown) {
  const text = clean(value).replace(/^\./, "").toLowerCase();
  return /^[a-z0-9-]{2,63}$/.test(text) ? `.${text}` : "";
}

function resellerGroup(item: Json) {
  return array(item.prices).find((group: Json) => clean(group.priceGroup).toLowerCase() === "reseller") ||
    array(item.prices)[0] || {};
}

function operationPrices(group: Json, operation: string) {
  const source = group[operation];
  const rawRows = Array.isArray(source) ? source : source && typeof source === "object" ? [source] : [];
  const byPeriod = new Map<number, Json>();
  for (const raw of rawRows) {
    const period = Math.max(1, Number(raw.period || 1));
    const price = money(Number(raw.price || 0));
    const currency = clean(raw.currency || "USD");
    if (period > 10 || currency !== "USD" || !Number.isFinite(price) || price < 0) continue;
    const previous = byPeriod.get(period);
    if (!previous || Number(previous.price) <= 0 && price > 0) byPeriod.set(period, { period, price, currency });
  }
  return [...byPeriod.values()].sort((left, right) => left.period - right.period);
}

function firstPositive(rows: Json[]) {
  return rows.find((row) => row.period === 1 && row.price > 0) || rows.find((row) => row.price > 0) || null;
}

function lifecycle(item: Json) {
  return {
    failurePeriod: item.failurePeriod,
    paymentPeriod: item.paymentPeriod,
    renewalPeriod: item.renewalPeriod,
    addGracePeriod: item.addGracePeriod,
    registerPeriod: item.registerPeriod,
    transferPeriod: item.transferPeriod,
    deletionHoldPeriod: item.deletionHoldPeriod,
    finalizationPeriod: item.finalizationPeriod,
    autoRenewGracePeriod: item.autoRenewGracePeriod,
    deletionRestorablePeriod: item.deletionRestorablePeriod,
  };
}

async function upsertChunks(table: string, rows: Json[], onConflict: string) {
  const values = table === "domain_tld_period_prices"
    ? [...new Map(rows.map((row) => [`${row.tld}|${row.operation}|${row.period_years}|${row.registrar_environment}`, row])).values()]
    : rows;
  for (let index = 0; index < values.length; index += 100) {
    const { error } = await db.from(table).upsert(values.slice(index, index + 100), { onConflict });
    if (error) throw new HttpError(500, "database_upsert_failed", error.message, { table, error });
  }
}

async function synchronize(environment: "production" | "ote", marginPercent: number, requestedBy: string | null) {
  const startedAt = Date.now();
  const payload = await providerCatalog(environment);
  const items = array(payload.items || payload.data?.items);
  const { data: currentRows } = await db.from("domain_tld_prices").select("tld,enabled,popular");
  const current = new Map((currentRows || []).map((row: Json) => [row.tld, row]));
  const tldRows: Json[] = [];
  const periodRows: Json[] = [];
  const seen: string[] = [];

  for (const item of items) {
    const tld = normalizeTld(item.name || item.tld || item.productName);
    if (!tld) continue;
    seen.push(tld);
    const group = resellerGroup(item);
    const operationMap: Record<string, Json[]> = {
      registration: operationPrices(group, "register"),
      renewal: operationPrices(group, "renew"),
      transfer: operationPrices(group, "transfer"),
      restore: operationPrices(group, "restore"),
    };
    const registration = firstPositive(operationMap.registration);
    const renewal = firstPositive(operationMap.renewal);
    const transfer = firstPositive(operationMap.transfer);
    const restore = firstPositive(operationMap.restore);
    const previous = current.get(tld) as Json | undefined;

    if (environment === "production") {
      tldRows.push({
        tld,
        enabled: previous?.enabled ?? false,
        popular: previous?.popular ?? false,
        provider_available: true,
        provider_product_name: clean(item.name) || tld.slice(1),
        provider_catalog_seen_at: now(),
        provider_catalog_payload: item,
        provider_price_group: clean(group.priceGroup) || "Reseller",
        provider_attributes: array(item.attributes),
        provider_lifecycle: lifecycle(item),
        registration_periods: array(item.registrationPeriods).map(Number).filter((value: number) => value >= 1 && value <= 10),
        renewal_periods: array(item.renewalPeriods).map(Number).filter((value: number) => value >= 1 && value <= 10),
        transfer_periods: operationMap.transfer.map((value) => value.period),
        min_years: Math.max(1, Number(item.minRegistrationPeriod || 1)),
        max_years: Math.min(10, Math.max(1, Number(item.maxRegistrationPeriod || 10))),
        registration_cost_usd: registration?.price ?? null,
        renewal_cost_usd: renewal?.price ?? null,
        transfer_cost_usd: transfer?.price ?? null,
        restore_cost_usd: restore?.price ?? null,
        registration_price_usd: registration ? money(registration.price * (1 + marginPercent / 100)) : 0,
        renewal_price_usd: renewal ? money(renewal.price * (1 + marginPercent / 100)) : 0,
        transfer_price_usd: transfer ? money(transfer.price * (1 + marginPercent / 100)) : 0,
        restore_price_usd: restore ? money(restore.price * (1 + marginPercent / 100)) : null,
        registration_sync_status: registration ? "synced" : "unsupported",
        renewal_sync_status: renewal ? "synced" : "unsupported",
        transfer_sync_status: transfer ? "synced" : "unsupported",
        restore_sync_status: restore ? "synced" : "unsupported",
        registration_sync_error: null,
        renewal_sync_error: null,
        transfer_sync_error: null,
        restore_sync_error: null,
        price_source: "domainnameapi_catalog",
        last_synced_at: now(),
        updated_at: now(),
      });
    }

    if (environment === "production" || current.has(tld)) {
      for (const [operation, prices] of Object.entries(operationMap)) {
        for (const price of prices) {
          periodRows.push({
            tld,
            operation,
            period_years: price.period,
            registrar_environment: environment,
            provider_cost_usd: price.price,
            customer_price_usd: money(price.price * (1 + marginPercent / 100)),
            currency: price.currency,
            price_group: clean(group.priceGroup) || "Reseller",
            provider_payload: price,
            synced_at: now(),
          });
        }
      }
    }
  }

  if (environment === "production") {
    await upsertChunks("domain_tld_prices", tldRows, "tld");
    if (seen.length) {
      await db.from("domain_tld_prices").update({ provider_available: false, enabled: false, updated_at: now() })
        .not("tld", "in", `(${seen.map((value) => `"${value}"`).join(",")})`);
    }
  }
  await upsertChunks("domain_tld_period_prices", periodRows, "tld,operation,period_years,registrar_environment");

  const result = {
    environment,
    providerItems: items.length,
    tldsWritten: tldRows.length,
    periodPricesWritten: new Set(periodRows.map((row) => `${row.tld}|${row.operation}|${row.period_years}|${row.registrar_environment}`)).size,
    marginPercent,
    durationMs: Date.now() - startedAt,
  };
  await db.from("domain_provider_sync_logs").insert({
    sync_type: "domainnameapi_catalog_v6",
    status: "success",
    requested_by: requestedBy,
    payload: result,
  });
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  try {
    if (req.method === "GET") return json({ ok: true, service: "KmerHosting DomainNameAPI Catalog Sync", version: 6, timestamp: now() });
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
    const requestedBy = await authorize(req);
    const url = new URL(req.url);
    const environment: "production" | "ote" = clean(url.searchParams.get("environment")) === "ote" ? "ote" : "production";
    const marginPercent = Math.max(0, Math.min(100, Number(url.searchParams.get("margin") || 30)));
    return json({ success: true, result: await synchronize(environment, marginPercent, requestedBy) });
  } catch (error) {
    console.error(error);
    if (error instanceof HttpError) return json({ error: error.code, message: error.message, details: error.details }, error.status);
    return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error.", details: error }, 500);
  }
});
