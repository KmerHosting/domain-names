import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { exactDnaPrice, normalizeDnaCatalog, type DnaCatalogPrice } from "./dna-catalog.ts";
import { directDnaRequest, DnaRequestError } from "./dna-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();

type Json = Record<string, any>;
type Environment = "production" | "ote";
type Operation = "registration" | "transfer" | "renewal" | "restore";

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const normalizeDomain = (value: unknown) => clean(value).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
const validDomain = (value: string) => value.length >= 3 && value.length <= 253 && value.includes(".") && value.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
const domainTld = (domainName: string) => `.${domainName.split(".").at(-1)}`;

function allowedOrigin(origin: string | null) {
  if (!origin) return "*";
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === "domain.kmerhosting.com" || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return origin;
  } catch {}
  return "https://domain.kmerhosting.com";
}

function cors(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key",
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

function pathOf(req: Request) {
  const pathname = new URL(req.url).pathname;
  const marker = "/domain-order-guard";
  const index = pathname.indexOf(marker);
  return (index >= 0 ? pathname.slice(index + marker.length) : pathname).replace(/\/+$/, "") || "/";
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function secret(name: string) {
  const { data, error } = await db.rpc("domain_secret", { p_name: name });
  const value = clean(data);
  if (error || !value) throw new HttpError(503, "secret_missing", `Required server secret ${name} is missing.`);
  return value;
}

async function encryptSensitive(value: string) {
  if (!value) return null;
  const master = await secret("domain_data_encryption_key");
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(master)));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value)));
  return `${base64Url(iv)}.${base64Url(encrypted)}`;
}

async function authenticatedUser(req: Request) {
  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "authentication_required", "Sign in is required.");
  const tokenHash = await sha256(authorization.slice(7).trim());
  const { data: session } = await db.from("domain_sessions").select("*")
    .eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", now()).maybeSingle();
  if (!session) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: user } = await db.from("domain_users").select("*").eq("id", session.user_id).maybeSingle();
  if (!user || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  return user as Json;
}

async function platformConfig() {
  const { data, error } = await db.from("domain_config").select("*").eq("id", true).single();
  if (error || !data) throw new HttpError(500, "configuration_missing", "Domain platform configuration is missing.");
  if (data.maintenance_mode) throw new HttpError(503, "maintenance_mode", clean(data.checkout_pause_message) || "Domain orders are temporarily paused.");
  const environment = clean(data.registrar_environment).toLowerCase();
  if (environment !== "production" && environment !== "ote") throw new HttpError(503, "registrar_environment_invalid", "The domain environment is not configured correctly.");
  return { ...data, registrar_environment: environment as Environment } as Json & { registrar_environment: Environment };
}

function pick(object: any, paths: string[]) {
  for (const path of paths) {
    let current = object;
    for (const key of path.split(".")) {
      if (!current || typeof current !== "object") { current = undefined; break; }
      current = current[key];
    }
    if (current !== undefined && current !== null && clean(current) !== "") return current;
  }
  return undefined;
}

async function providerRequest(environment: Environment, path: string, method = "GET", body: Json | Json[] | null = null, query: Json = {}) {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: path,
    p_method: method,
    p_body: body,
    p_query: query,
    p_environment: environment,
  });
  if (error) throw new HttpError(502, "registrar_gateway_failed", "The shared registrar gateway could not complete the request.", error);
  const envelope = (data || {}) as Json;
  const status = Number(envelope.status || 0);
  const payload = (envelope.body || {}) as Json;
  if (!status || status < 200 || status >= 300) {
    const message = clean(payload?.error?.message || payload?.error?.details || payload?.message || payload?.details || payload?.title || payload?.raw) || `DomainNameAPI request failed (${status || 502}).`;
    throw new HttpError(status >= 500 ? 502 : status || 502, "provider_error", message, {
      providerHttpStatus: status || null,
      providerBody: payload,
      registrarEnvironment: environment,
    });
  }
  return payload;
}

function searchInfo(payload: Json) { return (payload.info || payload.data?.info || payload.data || payload) as Json; }
function isAvailable(payload: Json) { const info = searchInfo(payload); const status = clean(info.status ?? payload.status ?? info.available ?? payload.available).toLowerCase().replace(/[\s_-]+/g, ""); return ["available", "true", "1", "free"].includes(status); }
function bulkSearchResult(payload: Json, domainName: string) {
  const rows = Array.isArray(payload)
    ? payload
    : [payload.infos, payload.data?.infos, payload.items, payload.data?.items].find(Array.isArray) || [];
  const match = rows.find((item: Json) => clean(item?.domainName || item?.info?.domainName).toLowerCase() === domainName);
  if (!match) throw new HttpError(502, "provider_search_result_missing", "DomainNameAPI did not return an availability result for this domain.");
  return match as Json;
}
function booleanValue(value: unknown) { return [true, 1, "1", "true", "yes", "enabled", "active"].includes(value as any); }
function positive(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? round2(number) : null; }

async function providerBalance(environment: Environment, requiredUsd: number) {
  const payload = await providerRequest(environment, "/api/v1/deposit/accounts/me", "GET", null, { currency: "USD" });
  const raw = pick(payload, ["usdBalance", "data.usdBalance", "account.usdBalance", "result.usdBalance"]);
  const usdBalance = Number(raw);
  if (!Number.isFinite(usdBalance) || usdBalance < 0) {
    throw new HttpError(502, "provider_usd_balance_unreadable", "DomainNameAPI did not return a readable usdBalance.", {
      registrarEnvironment: environment,
      providerField: "usdBalance",
    });
  }
  const amount = round2(usdBalance);
  if (amount < requiredUsd) {
    throw new HttpError(409, "provider_usd_balance_low", environment === "ote" ? "The OTE registrar USD balance is too low for this test order." : "The live registrar USD balance is too low to fulfill this order.", {
      registrarEnvironment: environment,
      requiredUsd,
      availableUsd: amount,
      providerField: "usdBalance",
      providerSource: "DomainNameAPI",
    });
  }
  return {
    amount,
    verifiedAt: now(),
    skipped: false,
    source: "DomainNameAPI",
    field: "usdBalance",
    tryBalanceMeaning: "TRY/TL currency balance; not test balance",
  };
}

async function tldData(environment: Environment, tld: string) {
  const payload = await providerRequest(environment, "/api/v1/products/tlds", "GET", null, {
    Currency: "USD",
    SkipCount: 0,
    MaxResultCount: 1000,
  });
  const data = normalizeDnaCatalog(payload, environment).find((item) => item.tld === tld);
  if (!data) throw new HttpError(409, "tld_not_sellable", "DomainNameAPI does not currently offer this extension.", { tld, registrarEnvironment: environment });
  return data;
}

function exactPeriodPrice(tld: DnaCatalogPrice, operation: Operation, years: number, environment: Environment) {
  const data = exactDnaPrice(tld, operation, years);
  if (!data) throw new HttpError(409, "period_price_missing", "DomainNameAPI does not offer this operation and period.", { tld: tld.tld, operation, years, registrarEnvironment: environment });
  return data;
}

function validateAttributes(tld: Json, raw: unknown) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Json : {};
  const definitions = Array.isArray(tld.provider_attributes) ? tld.provider_attributes : [];
  const allowed = new Set(definitions.map((definition: Json) => clean(definition.key)).filter(Boolean));
  const result: Json = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new HttpError(400, "unknown_tld_attribute", `Unknown registry field: ${key}.`, { key });
    result[key] = typeof value === "boolean" ? String(value).toLowerCase() : clean(value);
  }
  for (const definition of definitions) {
    const key = clean(definition.key);
    const value = clean(result[key]);
    if (definition.isRequired && !value) throw new HttpError(400, "tld_attribute_required", `${definition.description || key} is required for this extension.`, { key });
    const options = Array.isArray(definition.options) ? definition.options.map((option: any) => clean(option?.value ?? option)).filter(Boolean) : [];
    if (value && options.length && !options.includes(value)) throw new HttpError(400, "invalid_tld_attribute", `${definition.description || key} has an invalid value.`, { key, options });
  }
  return result;
}

function normalizeNameservers(values: unknown, defaults: unknown) {
  const source = Array.isArray(values) && values.length ? values : Array.isArray(defaults) ? defaults : [];
  const nameservers = [...new Set(source.map(clean).map((value) => value.toLowerCase().replace(/\.$/, "")).filter(Boolean))];
  if (nameservers.length < 2 || nameservers.length > 13) throw new HttpError(400, "invalid_nameservers", "Provide between 2 and 13 nameservers.");
  if (!nameservers.every((host) => host.length <= 253 && host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) throw new HttpError(400, "invalid_nameservers", "One or more nameservers are invalid.");
  return nameservers;
}

async function ownedContact(id: string, userId: string) { const { data } = await db.from("domain_contacts").select("*").eq("id", id).eq("user_id", userId).maybeSingle(); if (!data) throw new HttpError(400, "contact_required", "A valid registrant contact is required."); return data as Json; }
async function ownedDomain(id: string, userId: string, environment: Environment) { const { data } = await db.from("domain_domains").select("*").eq("id", id).eq("user_id", userId).maybeSingle(); if (!data) throw new HttpError(404, "domain_not_found", "Domain not found."); if (clean(data.registrar_environment).toLowerCase() !== environment) throw new HttpError(409, "domain_environment_mismatch", "This domain belongs to a different environment."); return data as Json; }
function contactSnapshot(contact: Json) { const { registrar_metadata: _metadata, ...safe } = contact; return safe; }
async function insertQuote(input: Json, environment: Environment) { const { data, error } = await db.from("domain_provider_quotes").insert({ ...input, registrar_environment: environment, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }).select("*").single(); if (error || !data) throw new HttpError(500, "quote_create_failed", "Unable to create the exact quote.", error); return data as Json; }

async function checkoutOrder(userId: string, orderId: string) {
  const { data, error } = await db.rpc("domain_checkout_direct", { p_user_id: userId, p_order_id: orderId });
  if (error) {
    const message = clean(error.message);
    if (message.includes("insufficient_central_credit")) throw new HttpError(409, "insufficient_central_credit", "Your central KmerHosting balance is insufficient for this LIVE order.");
    if (message.includes("central_identity_not_linked")) throw new HttpError(409, "central_identity_not_linked", "This domain account is not linked to the central KmerHosting account.");
    throw new HttpError(500, "direct_checkout_failed", "The order could not be charged and queued.", error);
  }
  return data as Json;
}

async function createOrder(req: Request, operation: Operation) {
  const user = await authenticatedUser(req);
  const cfg = await platformConfig();
  const environment = cfg.registrar_environment;
  const testMode = environment === "ote";
  const body = await req.json().catch(() => ({})) as Json;
  const idempotencyKey = clean(req.headers.get("idempotency-key") || body.idempotencyKey) || `${environment}:${operation}:${crypto.randomUUID()}`;

  const { data: existing } = await db.from("domain_orders").select("*").eq("user_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) {
    if (existing.registrar_environment !== environment) throw new HttpError(409, "idempotency_environment_mismatch", "This request key was already used in another environment.");
    const checkout = await checkoutOrder(user.id, existing.id);
    const { data: paidOrder } = await db.from("domain_orders").select("*").eq("id", existing.id).single();
    return json(req, { order: paidOrder || existing, checkout, reused: true, registrarEnvironment: environment, testMode });
  }

  let domainName = normalizeDomain(body.domainName);
  let domain: Json | null = null;
  let contact: Json | null = null;
  let tld: DnaCatalogPrice;
  let years = Math.max(1, Math.min(10, Math.round(Number(body.years || body.period || 1))));
  let providerPayload: Json = {};
  let providerCost = 0;
  let customerPrice = 0;
  let premium = false;
  let exactProviderCost: number | null = null;
  let source = `catalog_${environment}`;
  let authCipher: string | null = null;
  let nameservers: string[] = [];
  let attributes: Json = {};

  if (operation === "registration") {
    if (!validDomain(domainName)) throw new HttpError(400, "invalid_domain", "A valid domain name is required.");
    contact = await ownedContact(clean(body.contactId), user.id);
    tld = await tldData(environment, domainTld(domainName));
    nameservers = normalizeNameservers(body.nameServers || body.nameservers, cfg.default_nameservers);
    attributes = validateAttributes(tld, body.tldAttributes);
    providerPayload = bulkSearchResult(
      await providerRequest(environment, "/api/v1/domains/bulk-search", "POST", [{ domainName }]),
      domainName,
    );
    if (!isAvailable(providerPayload)) throw new HttpError(409, "domain_unavailable", "The domain is not available for registration.", providerPayload);
    const price = exactPeriodPrice(tld, operation, years, environment);
    providerCost = price.providerCostUsd;
    customerPrice = price.customerPriceUsd;
    const info = searchInfo(providerPayload);
    premium = booleanValue(info.isPremium ?? info.premium);
    if (premium) {
      exactProviderCost = positive(info.price ?? info.premiumPrice ?? providerPayload.price);
      if (!exactProviderCost) throw new HttpError(409, "premium_price_missing", "The exact premium-domain price is unavailable.");
      providerCost = exactProviderCost;
      customerPrice = round2(Math.max(customerPrice, providerCost * 1.30));
      source = `premium_search_${environment}`;
    }
  } else if (operation === "transfer") {
    if (!validDomain(domainName)) throw new HttpError(400, "invalid_domain", "A valid domain name is required.");
    contact = await ownedContact(clean(body.contactId), user.id);
    const authCode = clean(body.authCode);
    if (authCode.length < 4 || authCode.length > 35) throw new HttpError(400, "auth_code_required", "A valid transfer authorization code is required.");
    tld = await tldData(environment, domainTld(domainName));
    const check = await providerRequest(environment, "/api/v1/domains/transfers/check", "POST", { domainName, authCode });
    const transferable = booleanValue(check.transferAvailabilityStatus ?? check.data?.transferAvailabilityStatus);
    if (!transferable) throw new HttpError(409, "transfer_not_available", clean(check.message || check.data?.message) || "The domain is not currently transferable.", check);
    providerPayload = check;
    const price = exactPeriodPrice(tld, operation, years, environment);
    providerCost = price.providerCostUsd;
    customerPrice = price.customerPriceUsd;
    authCipher = await encryptSensitive(authCode);
    nameservers = normalizeNameservers(body.nameServers || body.nameservers, cfg.default_nameservers);
  } else {
    domain = await ownedDomain(clean(body.domainId), user.id, environment);
    domainName = domain.domain_name;
    tld = await tldData(environment, domain.tld || domainTld(domainName));
    if (operation === "renewal") {
      providerPayload = await providerRequest(environment, "/api/v1/domains/info", "GET", null, { DomainName: domainName });
      const providerStatus = clean(providerPayload.status || providerPayload.statusCode || domain.status).toLowerCase();
      if (/redemption|pendingdelete|cancel|suspend/.test(providerStatus)) throw new HttpError(409, "renewal_not_eligible", "This domain is not currently eligible for renewal.", { status: providerStatus });
      const price = exactPeriodPrice(tld, operation, years, environment);
      providerCost = price.providerCostUsd;
      customerPrice = price.customerPriceUsd;
    } else {
      throw new HttpError(503, "restore_not_supported", "Domain restoration is temporarily unavailable because the current official DomainNameAPI REST client does not expose a supported restore operation. No charge was made.");
    }
    nameservers = Array.isArray(domain.nameservers) ? domain.nameservers : [];
  }

  if (!(providerCost > 0) || !(customerPrice > 0)) throw new HttpError(409, "price_missing", "The exact price is unavailable for this operation.");
  if (customerPrice + 0.001 < providerCost * 1.30) throw new HttpError(409, "price_margin_invalid", "The customer price is below the configured minimum margin.", { providerCost, customerPrice });

  const expectedPrice = Number(body.expectedPriceUsd);
  if (Number.isFinite(expectedPrice) && expectedPrice > 0 && Math.abs(customerPrice - expectedPrice) > 0.009) {
    throw new HttpError(
      409,
      "price_changed",
      "The live provider-backed price changed. Review the new amount before trying again. No charge was made.",
      { expectedPriceUsd: round2(expectedPrice), currentPriceUsd: customerPrice, currency: "USD" },
    );
  }

  const balance = await providerBalance(environment, providerCost);
  const quote = await insertQuote({
    user_id: user.id,
    domain_id: domain?.id || null,
    domain_name: domainName,
    tld: tld!.tld,
    operation,
    period_years: years,
    provider_cost_usd: providerCost,
    provider_exact_cost_usd: exactProviderCost,
    customer_price_usd: customerPrice,
    eligible: true,
    source,
    provider_payload: providerPayload,
    reason: testMode ? "ote_test_eligible" : "production_eligible",
    premium_detected: premium,
    provider_balance_usd: balance.amount,
    provider_balance_verified_at: balance.verifiedAt,
    provider_currency: "USD",
    provider_price_group: tld!.provider_price_group || "Reseller",
    pricing_metadata: {
      registrarEnvironment: environment,
      testMode,
      balanceCheckSkipped: balance.skipped,
      providerBalanceSource: balance.source,
      providerBalanceField: balance.field,
      tryBalanceIsTestBalance: false,
      attributes,
      providerLifecycle: tld!.provider_lifecycle || {},
      providerAttributes: tld!.provider_attributes || [],
    },
  }, environment);

  const { data: order, error } = await db.rpc("domain_create_order_from_quote", {
    p_user_id: user.id,
    p_quote_id: quote.id,
    p_contact_id: contact?.id || null,
    p_domain_id: domain?.id || null,
    p_nameservers: nameservers,
    p_auth_code_ciphertext: authCipher,
    p_tld_attributes: attributes,
    p_contact_snapshot: contact ? contactSnapshot(contact) : {},
    p_idempotency_key: idempotencyKey,
    p_privacy_requested: body.privacyEnabled === undefined ? Boolean(tld!.supports_privacy) : Boolean(body.privacyEnabled && tld!.supports_privacy),
    p_lock_requested: body.locked === undefined ? true : Boolean(body.locked),
  });
  if (error || !order) throw new HttpError(500, "order_create_failed", error?.message || "Unable to create the order.", error);

  const checkout = await checkoutOrder(user.id, order.id);
  const { data: paidOrder } = await db.from("domain_orders").select("*").eq("id", order.id).single();

  return json(req, {
    order: paidOrder || order,
    quote,
    checkout,
    billing: {
      mode: testMode ? "ote_test" : "central_credit",
      registrarEnvironment: environment,
      testMode,
      chargedCentralUsd: testMode ? 0 : customerPrice,
      balanceSource: testMode ? "DomainNameAPI OTE usdBalance" : "KmerHosting central balance",
      providerBalanceKind: "DomainNameAPI direct usdBalance",
    },
  }, 201);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    const path = pathOf(req);
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      const cfg = await platformConfig();
      return json(req, {
        ok: true,
        service: "KmerHosting Domain Order Guard",
        version: 8,
        registrarEnvironment: cfg.registrar_environment,
        testMode: cfg.registrar_environment === "ote",
        providerBalanceSource: "DomainNameAPI deposit/accounts/me usdBalance",
        paymentMode: cfg.registrar_environment === "ote" ? "ote_test" : "central_credit",
        timestamp: now(),
      });
    }
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
    const direct = path.match(/^\/(registration|transfer|renewal|restore)$/);
    const legacy = path.match(/^\/orders\/(registration|transfer|renewal|restore)$/);
    const operation = (direct?.[1] || legacy?.[1]) as Operation | undefined;
    if (!operation) throw new HttpError(404, "not_found", "Endpoint not found.");
    return await createOrder(req, operation);
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json(req, { error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
