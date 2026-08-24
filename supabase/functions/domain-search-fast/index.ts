import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { normalizeDnaCatalog, type DnaCatalogPrice } from "../_shared/dna-catalog.ts";
import { directDnaRequest, DnaRequestError } from "../_shared/dna-client.ts";

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

async function dnaConfiguration(): Promise<{ environment: Environment; resellerId: string; apiKey: string }> {
  const { data, error } = await db.from("domain_config")
    .select("registrar_environment,registrar_reseller_id")
    .eq("id", true)
    .single();
  if (error) throw new HttpError(500, "configuration_missing", "Domain platform configuration is unavailable.", error);
  const value = clean(data?.registrar_environment).toLowerCase();
  const environment: Environment = value === "ote" ? "ote" : "production";
  const resellerId = clean(data?.registrar_reseller_id);
  const secretName = environment === "production" ? "domain_registrar_api_key" : "domain_registrar_ote_api_key";
  const { data: secretValue, error: secretError } = await db.rpc("domain_secret", { p_name: secretName });
  const apiKey = clean(secretValue);
  if (!resellerId || secretError || !apiKey) {
    throw new HttpError(503, "registrar_not_configured", `DomainNameAPI ${environment.toUpperCase()} credentials are unavailable.`);
  }
  return { environment, resellerId, apiKey };
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

async function registrar(config: { environment: Environment; resellerId: string; apiKey: string }, path: string, method = "GET", body?: unknown, query: Json = {}) {
  try {
    return await directDnaRequest({ ...config, path, method, body, query });
  } catch (error) {
    if (error instanceof DnaRequestError) {
      throw new HttpError(error.status >= 500 ? error.status : error.status || 502, "registrar_error", error.message, {
        providerHttpStatus: error.status || null,
        providerBody: error.payload,
      });
    }
    throw error;
  }
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

function normalizeProviderResult(domainName: string, raw: any, environment: Environment) {
  const normalized = normalizeStatus(raw);
  return {
    ...(typeof raw === "object" && raw ? raw : {}),
    domainName,
    available: normalized.available,
    isAvailable: normalized.available,
    status: normalized.status,
    availabilitySource: environment,
    error: normalized.known ? null : "unknown_availability_status",
  };
}

function infos(payload: any): Json[] {
  if (Array.isArray(payload)) return payload;
  const candidates = [payload?.infos, payload?.data?.infos, payload?.items, payload?.results, payload?.data?.items];
  return candidates.find(Array.isArray) || [];
}

async function liveCatalog(config: { environment: Environment; resellerId: string; apiKey: string }) {
  const payload = await registrar(config, "/api/v1/products/tlds", "GET", undefined, {
    Currency: "USD",
    SkipCount: 0,
    MaxResultCount: 1000,
  });
  const prices = normalizeDnaCatalog(payload, config.environment);
  if (!prices.length) throw new HttpError(502, "provider_catalog_empty", "DomainNameAPI returned an empty TLD catalog.");
  return prices;
}

async function pricesFor(domains: string[], config: { environment: Environment; resellerId: string; apiKey: string }) {
  const requested = new Set(domains.map(tld));
  const map = new Map<string, DnaCatalogPrice>();
  for (const price of await liveCatalog(config)) if (requested.has(price.tld)) map.set(price.tld, price);
  return map;
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
  const [prices, rawSearch] = await Promise.all([
    pricesFor(domains, config),
    registrar(config, "/api/v1/domains/bulk-search", "POST", domains.map((domainName) => ({ domainName }))),
  ]);
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
          ? normalizeProviderResult(domainName, item, environment)
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
    providerRequestCount: supported.length ? 1 : 0,
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
        prices: await liveCatalog(config),
        registrarEnvironment: environment,
        testMode: environment === "ote",
        priceSource: "DomainNameAPI live catalog",
        markupPercent: 30,
        generatedAt: now(),
      });
    }
    if (req.method === "GET") {
      return json(req, {
        ok: true,
        service: "KmerHosting Bulk Domain Search",
        dnaVersion: "3.0.1",
        endpoints: ["domains/bulk-search", "products/tlds"],
        priceSource: "DomainNameAPI live catalog",
        markupPercent: 30,
        maxDomains: 20,
        timestamp: now(),
      });
    }
    if (req.method === "POST") return await check(req);
    throw new HttpError(405, "method_not_allowed", "Method not allowed.");
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json(req, { error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
