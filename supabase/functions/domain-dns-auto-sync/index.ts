import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

type Json = Record<string, any>;
type Environment = "ote" | "production";
class HttpError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const upper = (value: unknown) => clean(value).toUpperCase();
const now = () => new Date().toISOString();

function headers(): HeadersInit { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-domain-cron-secret", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }; }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: headers() }); }
function pathOf(req: Request) { const path = new URL(req.url).pathname; const marker = "/domain-dns-auto-sync"; const index = path.indexOf(marker); return (index >= 0 ? path.slice(index + marker.length) : path).replace(/\/+$/, "") || "/"; }
async function sha256(value: string) { const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function secret(name: string) { const { data, error } = await db.rpc("domain_secret", { p_name: name }); const value = clean(data); if (error || !value) throw new HttpError(503, "secret_missing", `${name} is not configured.`); return value; }
async function assertCron(req: Request) { const supplied = clean(req.headers.get("x-domain-cron-secret")); const expected = await secret("domain_internal_cron_secret"); if (!supplied || await sha256(supplied) !== await sha256(expected)) throw new HttpError(401, "invalid_cron_secret", "Invalid cron secret."); }
function iso(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function domainName(item: Json) { return lower(item.domainName || item.domainNameIdn || item.name || item.data?.domainName); }
function providerItems(body: Json): Json[] { for (const value of [body.items, body.data?.items, body.domains, body.data?.domains, body.data, body]) if (Array.isArray(value)) return value; return []; }
function zoneItems(body: Json): Json[] { for (const value of [body.data?.records, body.records, body.data?.zones, body.zones, body.result?.records, body.result, body.data, body]) if (Array.isArray(value)) return value; return []; }
function recordKey(record: Json) { return `${lower(record.name || "@")}::${upper(record.type)}::${record.contents.map(lower).join("|")}::${record.priority ?? ""}`; }
function providerRecord(raw: Json) { const name = lower(raw.name ?? raw.Name ?? raw.host ?? raw.recordName ?? "@").replace(/\.$/, "") || "@"; const type = upper(raw.type ?? raw.Type ?? raw.recordType ?? raw.RecordType); const contents = (Array.isArray(raw.contents) ? raw.contents : Array.isArray(raw.values) ? raw.values : [raw.content ?? raw.value ?? raw.target ?? raw.Record]).map(clean).filter(Boolean); const priorityValue = raw.priority ?? raw.Priority ?? raw.preference ?? null; const metadata: Json = { providerRaw: raw }; if (raw.weight !== undefined) metadata.weight = Number(raw.weight); if (raw.port !== undefined) metadata.port = Number(raw.port); if (raw.flag !== undefined) metadata.flag = Number(raw.flag); if (raw.tag !== undefined) metadata.tag = clean(raw.tag); const record = { name, type, ttl: Number(raw.ttl ?? raw.TTL ?? 3600) || 3600, contents, priority: priorityValue == null ? null : Number(priorityValue), metadata, source: "provider", provider_record_id: clean(raw.id ?? raw.recordId ?? raw.zoneId) || null }; return { ...record, record_key: recordKey(record) }; }

async function provider(environment: Environment, path: string, method = "GET", body: Json | null = null, query: Json = {}) {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", { p_path: path, p_method: method, p_body: body, p_query: query, p_environment: environment });
  if (error) throw new HttpError(502, "provider_proxy_failed", error.message, error);
  const response = data as Json;
  const status = Number(response?.status || 0);
  if (!response || status >= 400) throw new HttpError(status >= 500 ? 502 : status || 502, "provider_error", clean(response?.body?.message || response?.body?.error || `DomainNameAPI failed (${status || "unknown"}).`), response?.body);
  return response.body as Json;
}

function inventoryRow(environment: Environment, item: Json) {
  return {
    registrar_environment: environment,
    domain_name: domainName(item),
    provider_status: clean(item.statusCode || item.status || "active"),
    registrar_domain_id: clean(item.objectId || item.domainId || item.id) || null,
    registered_at: iso(item.startDate || item.creationDate),
    expires_at: iso(item.expirationDate || item.expiresAt),
    nameservers: (item.nameServers || item.nameservers || []).map(clean).filter(Boolean),
    locked: item.lockStatus == null ? null : Boolean(item.lockStatus),
    privacy_enabled: item.privacyProtectionStatus == null ? null : Boolean(item.privacyProtectionStatus),
    provider_payload: item,
    present_at_provider: true,
    last_seen_at: now(),
    updated_at: now(),
  };
}

async function syncDns(domain: Json, environment: Environment) {
  const raw = await provider(environment, "/api/v1/domains/zones", "GET", null, { domainName: domain.domain_name });
  const records = zoneItems(raw).map(providerRecord).filter((record) => record.name && record.type && record.contents.length);
  const seen = records.map((record) => record.record_key);
  for (const record of records) {
    const { error } = await db.from("domain_dns_records").upsert({ domain_id: domain.id, user_id: domain.user_id, ...record, status: "active", registrar_response: record.metadata.providerRaw, registrar_environment: environment, last_operation: "sync", last_error: null, synced_at: now(), updated_at: now() }, { onConflict: "domain_id,record_key" });
    if (error) throw new HttpError(500, "dns_sync_failed", error.message, error);
  }
  let stale = db.from("domain_dns_records").update({ status: "stale", last_operation: "sync", last_error: "Record was not returned by DomainNameAPI.", synced_at: now(), updated_at: now() }).eq("domain_id", domain.id).eq("source", "provider");
  if (seen.length) stale = stale.not("record_key", "in", `(${seen.map((key) => `"${String(key).replaceAll('"', '""')}"`).join(",")})`);
  await stale;
  return records.length;
}

async function syncEnvironment(environment: Environment) {
  const raw = await provider(environment, "/api/v1/domains");
  const items = providerItems(raw).filter((item) => domainName(item));
  const names = new Set(items.map(domainName));
  await db.from("domain_provider_inventory").update({ present_at_provider: false, updated_at: now() }).eq("registrar_environment", environment);
  for (const item of items) {
    const { error } = await db.from("domain_provider_inventory").upsert(inventoryRow(environment, item), { onConflict: "registrar_environment,domain_name" });
    if (error) throw new HttpError(500, "inventory_sync_failed", error.message, error);
  }

  const { data: localDomains, error } = await db.from("domain_domains").select("*").eq("registrar_environment", environment);
  if (error) throw new HttpError(500, "domain_query_failed", error.message, error);
  let confirmed = 0;
  let missing = 0;
  let dnsRecords = 0;
  const failures: Json[] = [];
  for (const local of localDomains || []) {
    if (!names.has(lower(local.domain_name))) {
      missing++;
      await db.from("domain_domains").update({ status: "provider_missing", metadata: { ...(local.metadata || {}), providerMissingAt: now(), providerAuthoritative: true }, updated_at: now() }).eq("id", local.id);
      continue;
    }
    confirmed++;
    const item = items.find((candidate) => domainName(candidate) === lower(local.domain_name))!;
    const row = inventoryRow(environment, item);
    await db.from("domain_domains").update({ status: "active", registrar_domain_id: row.registrar_domain_id || local.registrar_domain_id, registered_at: row.registered_at || local.registered_at, expires_at: row.expires_at || local.expires_at, nameservers: row.nameservers, locked: row.locked ?? local.locked, privacy_enabled: row.privacy_enabled ?? local.privacy_enabled, metadata: { ...(local.metadata || {}), lastProviderInfo: item, providerAuthoritative: true, providerMissingAt: null }, last_synced_at: now(), updated_at: now() }).eq("id", local.id);
    try { dnsRecords += await syncDns(local, environment); } catch (syncError) { failures.push({ domainName: local.domain_name, message: syncError instanceof Error ? syncError.message : String(syncError) }); }
  }
  return { environment, providerDomains: items.length, localConfirmed: confirmed, localMissing: missing, dnsRecords, failures };
}

async function run(req: Request) {
  await assertCron(req);
  const requested = lower(new URL(req.url).searchParams.get("environment"));
  const environments: Environment[] = requested === "ote" ? ["ote"] : requested === "production" ? ["production"] : ["ote", "production"];
  const results = [];
  for (const environment of environments) results.push(await syncEnvironment(environment));
  const failed = results.reduce((count, result) => count + result.failures.length, 0);
  return json({ ok: failed === 0, authoritativeSource: "DomainNameAPI", results, timestamp: now() }, failed ? 207 : 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  try {
    const path = pathOf(req);
    if (req.method === "GET" && (path === "/" || path === "/health")) return json({ ok: true, service: "KmerHosting DomainNameAPI Portfolio and DNS Sync", version: 2, environments: ["ote", "production"], timestamp: now() });
    if (req.method === "POST" && path === "/run") return await run(req);
    return json({ error: "not_found", message: "Endpoint not found." }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
