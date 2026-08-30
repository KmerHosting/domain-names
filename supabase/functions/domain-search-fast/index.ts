import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

type Json = Record<string, any>;
type Environment = "ote" | "production";

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();

function publicProviderAttributes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((attribute: any) => {
    const options = Array.isArray(attribute.options)
      ? attribute.options.map((option: any) => typeof option === "string" ? option : clean(option?.value)).filter(Boolean)
      : [];
    return {
      key: clean(attribute.key),
      type: clean(attribute.type) || undefined,
      options,
      isRequired: Boolean(attribute.isRequired),
      description: clean(attribute.description) || undefined,
    };
  }).filter((attribute) => attribute.key);
}

function publicCatalogPrice(value: any): Json {
  return {
    tld: clean(value.tld).toLowerCase(),
    popular: Boolean(value.popular),
    is_promo: Boolean(value.is_promo),
    registration_price_usd: Number(value.registration_price_usd || 0),
    renewal_price_usd: Number(value.renewal_price_usd || 0),
    transfer_price_usd: Number(value.transfer_price_usd || 0),
    restore_price_usd: value.restore_price_usd == null ? null : Number(value.restore_price_usd),
    min_years: Number(value.min_years || value.registration_periods?.[0] || 1),
    max_years: Number(value.max_years || value.registration_periods?.at(-1) || value.registration_periods?.[0] || 1),
    registration_periods: Array.isArray(value.registration_periods) ? value.registration_periods.map(Number).filter((period: number) => period > 0) : [],
    renewal_periods: Array.isArray(value.renewal_periods) ? value.renewal_periods.map(Number).filter((period: number) => period > 0) : [],
    transfer_periods: Array.isArray(value.transfer_periods) ? value.transfer_periods.map(Number).filter((period: number) => period > 0) : [],
    supports_privacy: value.supports_privacy !== false,
    provider_attributes: publicProviderAttributes(value.provider_attributes),
  };
}

function cors(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

function publicErrorMessage(error: HttpError): string {
  if (/^registrar_/.test(error.code)) return "Domain search is temporarily unavailable. Try again shortly.";
  return error.status >= 500
    ? "Domain information is temporarily unavailable. Try again shortly."
    : error.message;
}

function normalizeDomain(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function validDomain(value: string) {
  return value.length >= 3 && value.length <= 253 && value.includes(".") && value.split(".").every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

const tld = (domainName: string) => `.${domainName.split(".").at(-1)}`;

function pick(object: any, paths: string[]) {
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

type RegistrarConfig = { environment: Environment };

async function dnaConfiguration(): Promise<RegistrarConfig> {
  const { data, error } = await db.from("domain_config")
    .select("registrar_environment")
    .eq("id", true)
    .single();
  if (error) throw new HttpError(500, "configuration_missing", "Domain platform configuration is unavailable.", error);
  const value = clean(data?.registrar_environment).toLowerCase();
  if (value !== "ote" && value !== "production") throw new HttpError(503, "registrar_environment_invalid", "The registrar environment is invalid.");
  return { environment: value as Environment };
}

async function enforceSearchRateLimit(req: Request) {
  const forwarded = clean(req.headers.get("x-forwarded-for")).split(",")[0].trim();
  const ip = forwarded || clean(req.headers.get("cf-connecting-ip")) || clean(req.headers.get("x-real-ip")) || "unknown";
  const key = `bulk-domain-search:${ip}`;
  const { data } = await db.from("domain_rate_limits").select("hits,window_started_at,blocked_until").eq("key", key).maybeSingle();
  const current = Date.now();
  if (data?.blocked_until && new Date(data.blocked_until).getTime() > current) {
    throw new HttpError(429, "search_rate_limited", "Too many domain searches. Try again in a few seconds.");
  }
  const started = data?.window_started_at ? new Date(data.window_started_at).getTime() : 0;
  if (!data || !started || current - started >= 10_000) {
    await db.from("domain_rate_limits").upsert({ key, hits: 1, window_started_at: now(), blocked_until: null, updated_at: now() });
    return;
  }
  const hits = Number(data.hits || 0) + 1;
  if (hits > 5) {
    const blockedUntil = new Date(current + 10_000).toISOString();
    await db.from("domain_rate_limits").update({ hits, blocked_until: blockedUntil, updated_at: now() }).eq("key", key);
    throw new HttpError(429, "search_rate_limited", "Too many domain searches. Try again in a few seconds.");
  }
  await db.from("domain_rate_limits").update({ hits, updated_at: now() }).eq("key", key);
}

async function registrar(config: RegistrarConfig, path: string, method = "GET", body?: unknown, query: Json = {}) {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: path,
    p_method: method,
    p_body: body ?? null,
    p_query: query,
    p_environment: config.environment,
  });
  if (error) throw new HttpError(502, "registrar_gateway_failed", "The shared registrar gateway could not complete the request.", error);
  const envelope = (data || {}) as Json;
  const status = Number(envelope.status || 0);
  const payload = (envelope.body || {}) as Json;
  if (!status || status < 200 || status >= 300) {
    const message = clean(payload?.error?.message || payload?.error?.details || payload?.message || payload?.details || payload?.title || payload?.raw) || "The domain service could not complete this request.";
    throw new HttpError(status >= 500 ? 502 : status || 502, "registrar_error", message, {
      providerHttpStatus: status || null,
      providerBody: payload,
      registrarEnvironment: config.environment,
    });
  }
  return payload;
}

function normalizeStatus(raw: any): { available: boolean; known: boolean; status: string } {
  const rawValue = pick(raw, [
    "info.status", "status", "availabilityStatus", "data.info.status", "data.status",
    "available", "isAvailable", "info.available", "data.available", "data.isAvailable",
  ]);
  const status = clean(rawValue).toLowerCase().replace(/[\s_-]+/g, "");
  const available = ["available", "true", "free", "1"].includes(status);
  const unavailable = ["notavailable", "notavailablepremium", "unavailable", "registered", "taken", "false", "0", "reserved", "blocked"].includes(status);
  return {
    available,
    known: available || unavailable,
    status: available ? "available" : unavailable ? "unavailable" : status || "unknown",
  };
}

function providerInfo(raw: any): Json {
  return (raw?.info || raw?.data?.info || raw?.data || raw || {}) as Json;
}

function boolish(value: unknown) {
  return [true, 1, "1", "true", "yes", "available"].includes(value as any);
}

function normalizeProviderResult(domainName: string, raw: any, environment: Environment, catalogPrice?: Json) {
  const normalized = normalizeStatus(raw);
  const info = providerInfo(raw);
  const premium = boolish(info.isPremium ?? info.premium);
  const providerPrice = Number(info.price ?? info.premiumPrice ?? raw?.price);
  const basePrice = Number(catalogPrice?.registration_price_usd || 0);
  const customerPriceUsd = premium && Number.isFinite(providerPrice) && providerPrice > 0
    ? Math.round(Math.max(providerPrice * 1.30, basePrice) * 100) / 100
    : basePrice > 0 ? basePrice : null;
  return {
    domainName,
    available: normalized.available,
    isAvailable: normalized.available,
    status: normalized.known ? normalized.status : "unknown",
    isPremium: premium,
    customerPriceUsd,
    availabilitySource: environment,
    error: normalized.known ? null : "unknown_availability_status",
  };
}

function infos(payload: any): Json[] {
  if (Array.isArray(payload)) return payload;
  const candidates = [payload?.infos, payload?.data?.infos, payload?.items, payload?.results, payload?.data?.items];
  return candidates.find(Array.isArray) || [];
}

async function pricesFor(domains: string[]) {
  const requested = new Set(domains.map(tld));
  const map = new Map<string, Json>();
  const { data, error } = await db
    .from("domain_tld_prices")
    .select("tld,enabled,popular,registration_price_usd,renewal_price_usd,transfer_price_usd,restore_price_usd,min_years,max_years,supports_privacy,is_promo,registration_periods,renewal_periods,transfer_periods,provider_attributes")
    .in("tld", [...requested])
    .eq("enabled", true)
    .eq("provider_available", true);
  if (error) throw new HttpError(500, "catalog_unavailable", "The synchronized TLD catalog is unavailable.", error);
  for (const price of data || []) map.set(clean(price.tld).toLowerCase(), publicCatalogPrice(price));
  return map;
}

async function publicCatalog() {
  const { data, error } = await db
    .from("domain_tld_prices")
    .select("tld,enabled,popular,registration_price_usd,renewal_price_usd,transfer_price_usd,restore_price_usd,min_years,max_years,supports_privacy,is_promo,registration_periods,renewal_periods,transfer_periods,provider_attributes")
    .eq("enabled", true)
    .eq("provider_available", true)
    .order("popular", { ascending: false })
    .order("registration_price_usd", { ascending: true });
  if (error) throw new HttpError(500, "catalog_unavailable", "The synchronized TLD catalog is unavailable.", error);
  return (data || []).map(publicCatalogPrice);
}

async function check(req: Request) {
  await enforceSearchRateLimit(req);
  const body = await req.json().catch(() => ({})) as Json;
  const values = Array.isArray(body.domains) ? body.domains : [body.domainName || body.domain];
  const normalized = values.map(normalizeDomain).filter(Boolean);
  const invalid = [...new Set(normalized.filter((domainName) => !validDomain(domainName)))];
  const domains = [...new Set(normalized.filter(validDomain))].slice(0, 20);
  if (!domains.length) throw new HttpError(400, "invalid_domain", "At least one valid domain is required.", { invalid });

  const config = await dnaConfiguration();
  const environment = config.environment;
  const prices = await pricesFor(domains);
  const supported = domains.filter((domainName) => prices.has(tld(domainName)));
  const unsupported = domains.filter((domainName) => !prices.has(tld(domainName))).map((domainName) => ({
    domainName,
    registrar: {
      domainName,
      available: false,
      isAvailable: false,
      status: "unsupported",
      availabilitySource: environment,
      error: "unsupported_tld",
    },
    price: null,
  }));

  const providerResults: Json[] = [];
  if (supported.length) {
    const rawSearch = await registrar(
      config,
      "/api/v1/domains/bulk-search",
      "POST",
      supported.map((domainName) => ({ domainName })),
    );
    const byDomain = new Map<string, Json>();
    for (const info of infos(rawSearch)) {
      const domainName = clean(info.domainName || info.info?.domainName || info.data?.domainName).toLowerCase();
      if (domainName) byDomain.set(domainName, info);
    }
    for (const domainName of supported) {
      const item = byDomain.get(domainName);
      providerResults.push({
        domainName,
        registrar: item
          ? normalizeProviderResult(domainName, item, environment, prices.get(tld(domainName)))
          : {
              domainName,
              available: false,
              isAvailable: false,
              status: "unknown",
              availabilitySource: environment,
              error: "provider_result_missing",
            },
        price: prices.get(tld(domainName)) || null,
      });
    }
  }

  const ordered = new Map([...providerResults, ...unsupported].map((result) => [result.domainName, result]));
  return json(req, {
    results: domains.map((domainName) => ordered.get(domainName)).filter(Boolean),
    bulkSearch: supported.length > 1,
    availabilitySource: environment,
    registrarEnvironment: environment,
    requested: normalized.length,
    accepted: domains.length,
    invalid,
    unsupported: unsupported.length,
    generatedAt: now(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    if (req.method === "GET" && new URL(req.url).pathname.endsWith("/prices")) {
      const config = await dnaConfiguration();
      const environment = config.environment;
      return json(req, {
        prices: await publicCatalog(),
        registrarEnvironment: environment,
        testMode: environment === "ote",
        priceSource: "Current domain catalog",
        generatedAt: now(),
      });
    }
    if (req.method === "GET") {
      return json(req, {
        ok: true,
        service: "KmerHosting Bulk Domain Search",
        priceSource: "Current domain catalog",
        maxDomains: 20,
        timestamp: now(),
      });
    }
    if (req.method === "POST") return await check(req);
    throw new HttpError(405, "method_not_allowed", "Method not allowed.");
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.code, message: publicErrorMessage(error) }, error.status);
    console.error(error);
    return json(req, { error: "internal_error", message: "The domain service could not complete this request." }, 500);
  }
});
