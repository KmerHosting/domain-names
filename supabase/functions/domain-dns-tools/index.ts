import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();

type Json = Record<string, any>;
type Environment = "ote" | "production";
function envOf(v: unknown): Environment { const value = clean(v).toLowerCase(); if (value !== "ote" && value !== "production") throw new HttpError(409, "registrar_environment_invalid", "The domain registrar environment is invalid."); return value as Environment; }
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
const clean = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => clean(v).toLowerCase();
const upper = (v: unknown) => clean(v).toUpperCase();
const now = () => new Date().toISOString();
function allowedOrigin(origin: string | null) {
  if (!origin) return "*";
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (
      host === "domain.kmerhosting.com" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".vercel.app")
    )
      return origin;
  } catch {}
  return "https://domain.kmerhosting.com";
}
function cors(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}
function pathOf(req: Request) {
  const p = new URL(req.url).pathname;
  const marker = "/domain-dns-tools";
  const i = p.indexOf(marker);
  return (i >= 0 ? p.slice(i + marker.length) : p).replace(/\/+$/, "") || "/";
}
async function body(req: Request) {
  return (await req.json().catch(() => ({}))) as Json;
}
async function sha256(value: string) {
  const d = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(d)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function auth(req: Request) {
  const authorization = clean(req.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer "))
    throw new HttpError(
      401,
      "authentication_required",
      "Authentication is required.",
    );
  const tokenHash = await sha256(authorization.slice(7).trim());
  const { data: session } = await db
    .from("domain_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", now())
    .maybeSingle();
  if (!session)
    throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: user } = await db
    .from("domain_users")
    .select("*")
    .eq("id", session.user_id)
    .maybeSingle();
  if (
    !user ||
    user.status !== "active" ||
    Number(user.session_version) !== Number(session.session_version)
  )
    throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  return user as Json;
}
async function config() {
  const { data, error } = await db
    .from("domain_config")
    .select("registrar_environment,default_nameservers")
    .eq("id", true)
    .single();
  if (error || !data)
    throw new HttpError(
      500,
      "config_missing",
      "Domain configuration is missing.",
    );
  return data as Json;
}
async function domain(id: string, user: Json) {
  const q = db.from("domain_domains").select("*").eq("id", id);
  const { data, error } =
    user.role === "admin"
      ? await q.maybeSingle()
      : await q.eq("user_id", user.id).maybeSingle();
  if (error || !data)
    throw new HttpError(404, "domain_not_found", "Domain not found.");
  return data as Json;
}
function assertEnv(d: Json, cfg: Json) {
  if (d.registrar_environment !== cfg.registrar_environment)
    throw new HttpError(
      409,
      "cross_environment_domain",
      `This domain belongs to ${d.registrar_environment}. Current registrar environment is ${cfg.registrar_environment}. Provider actions are blocked.`,
    );
}
async function registrar(
  environment: Environment,
  path: string,
  method = "GET",
  payload?: Json | null,
  query: Json = {},
) {
  const { data, error } = await db.rpc("domain_registrar_proxy_env", {
    p_path: path,
    p_method: method,
    p_body: payload ?? null,
    p_query: query,
    p_environment: environment,
  });
  if (error) throw new HttpError(504, "registrar_proxy_failed", error.message, error);
  const out = data as Json;
  if (!out || Number(out.status) >= 400) {
    const providerBody = out?.body || {};
    throw new HttpError(
      Number(out?.status || 502),
      "provider_error",
      clean(providerBody?.error?.message || providerBody?.error?.details || providerBody?.message || providerBody?.details || `Provider failed (${out?.status || "unknown"}).`),
      providerBody,
    );
  }
  return out.body as Json;
}

async function confirmProviderDomain(d: Json) {
  try {
    return await registrar(envOf(d.registrar_environment), "/api/v1/domains/info", "GET", null, {
      DomainName: d.domain_name,
    });
  } catch (error) {
    if (error instanceof HttpError && [400, 404].includes(error.status))
      throw new HttpError(
        409,
        "provider_domain_missing",
        "This domain is not present in the active DomainNameAPI environment. DNS and nameserver changes are blocked.",
        error.details,
      );
    throw error;
  }
}
async function applyZone(d: Json) {
  return await registrar(envOf(d.registrar_environment), "/api/v1/domains/zones/apply", "POST", null, {
    domainName: d.domain_name,
  });
}
function hostOk(v: string) {
  const s = v.replace(/\.$/, "").toLowerCase();
  if (s === "@") return true;
  return (
    s.length > 0 &&
    s.length <= 253 &&
    s
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}
function relNameOk(v: string) {
  const s = v.toLowerCase();
  if (s === "@") return true;
  return (
    s.length > 0 &&
    s.length <= 253 &&
    s
      .split(".")
      .every((label) => /^_?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}
function ipv4Ok(v: string) {
  const p = v.split(".");
  return (
    p.length === 4 &&
    p.every((x) => /^\d{1,3}$/.test(x) && Number(x) >= 0 && Number(x) <= 255)
  );
}
function ipv6Ok(v: string) {
  return /^[0-9a-f:]+$/i.test(v) && v.includes(":") && v.length <= 45;
}
function ttl(v: unknown) {
  const n = Math.round(Number(v || 3600));
  if (!Number.isFinite(n) || n < 60 || n > 86400)
    throw new HttpError(
      400,
      "invalid_ttl",
      "TTL must be between 60 and 86400 seconds.",
    );
  return n;
}
function intRange(
  v: unknown,
  min: number,
  max: number,
  code: string,
  message: string,
) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max)
    throw new HttpError(400, code, message);
  return n;
}
function contents(b: Json) {
  const raw = Array.isArray(b.contents)
    ? b.contents
    : Array.isArray(b.values)
      ? b.values
      : [b.content ?? b.value ?? b.target].filter((x) => x !== undefined);
  return raw.map(clean).filter(Boolean);
}
function recordKey(r: Json) {
  return `${lower(r.name || "@")}::${upper(r.type)}`;
}

function normalize(b: Json, existing?: Json) {
  const type = upper(b.type ?? existing?.type);
  const name = lower(b.name ?? existing?.name ?? "@").replace(/\.$/, "") || "@";
  if (!relNameOk(name)) throw new HttpError(400, "invalid_record_name", "DNS record name is invalid.");
  if (!["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"].includes(type)) throw new HttpError(400, "invalid_dns_type", "Unsupported DNS record type.");
  const out: Json = {
    name,
    type,
    ttl: ttl(b.ttl ?? existing?.ttl),
    priority: null,
    contents: contents({ ...existing, ...b }),
    metadata: { ...(existing?.metadata || {}) },
  };
  if (type === "A" && (!out.contents.length || !out.contents.every(ipv4Ok))) throw new HttpError(400, "invalid_a_record", "A records require valid IPv4 addresses.");
  if (type === "AAAA" && (!out.contents.length || !out.contents.every(ipv6Ok))) throw new HttpError(400, "invalid_aaaa_record", "AAAA records require valid IPv6 addresses.");
  if (type === "CNAME") {
    if (name === "@") throw new HttpError(400, "apex_cname_blocked", "CNAME at apex is blocked.");
    if (out.contents.length !== 1 || !hostOk(out.contents[0])) throw new HttpError(400, "invalid_cname", "CNAME requires one valid hostname target.");
  }
  if (type === "MX") {
    const fallbackPriority = b.priority ?? existing?.priority;
    out.contents = out.contents.map((value: string) => {
      const match = value.match(/^(\d{1,5})\s+(.+)$/);
      const priority = match ? Number(match[1]) : intRange(fallbackPriority, 0, 65535, "invalid_mx_priority", "MX priority is required.");
      const target = match ? match[2] : value;
      if (!hostOk(target)) throw new HttpError(400, "invalid_mx_record", "MX requires a valid hostname target.");
      return `${priority} ${target.replace(/\.$/, "")}`;
    });
    out.priority = Number(out.contents[0].split(/\s+/, 1)[0]);
  }
  if (type === "TXT" && (!out.contents.length || out.contents.some((x: string) => x.length > 2048))) throw new HttpError(400, "invalid_txt_record", "TXT value is required and must be below 2048 characters.");
  if (type === "NS" && (!out.contents.length || !out.contents.every(hostOk))) throw new HttpError(400, "invalid_ns_record", "NS records require valid hostnames.");
  if (type === "SRV") {
    if (out.contents.length !== 1) throw new HttpError(400, "invalid_srv_record", "SRV requires one canonical value.");
    const canonical = out.contents[0].match(/^(\d{1,5})\s+(\d{1,5})\s+(\d{1,5})\s+(.+)$/);
    const priority = canonical ? Number(canonical[1]) : intRange(b.priority ?? existing?.priority, 0, 65535, "invalid_srv_priority", "SRV priority is required.");
    const weight = canonical ? Number(canonical[2]) : intRange(b.weight ?? existing?.metadata?.weight, 0, 65535, "invalid_srv_weight", "SRV weight is required.");
    const port = canonical ? Number(canonical[3]) : intRange(b.port ?? existing?.metadata?.port, 1, 65535, "invalid_srv_port", "SRV port is required.");
    const target = canonical ? canonical[4] : clean(b.target ?? out.contents[0]);
    if (!hostOk(target)) throw new HttpError(400, "invalid_srv_target", "SRV target must be a valid hostname.");
    out.contents = [`${priority} ${weight} ${port} ${target.replace(/\.$/, "")}`];
    out.priority = priority;
    out.metadata = { ...out.metadata, weight, port, target };
  }
  if (type === "CAA") {
    if (out.contents.length !== 1) throw new HttpError(400, "invalid_caa_record", "CAA requires one canonical value.");
    const canonical = out.contents[0].match(/^(\d{1,3})\s+([a-z0-9]+)\s+"?(.*?)"?$/i);
    const flag = canonical ? Number(canonical[1]) : intRange(b.flag ?? existing?.metadata?.flag ?? 0, 0, 255, "invalid_caa_flag", "CAA flag must be between 0 and 255.");
    const tag = lower(canonical ? canonical[2] : b.tag ?? existing?.metadata?.tag);
    const value = clean(canonical ? canonical[3] : b.value ?? b.content ?? out.contents[0]).replace(/^"|"$/g, "");
    if (!["issue", "issuewild", "iodef", "contactemail", "contactphone", "accounturi"].includes(tag)) throw new HttpError(400, "invalid_caa_tag", "CAA tag is invalid.");
    if (!value) throw new HttpError(400, "invalid_caa_value", "CAA value is required.");
    out.contents = [`${flag} ${tag} "${value}"`];
    out.metadata = { ...out.metadata, flag, tag, value };
  }
  if (!out.contents.length) throw new HttpError(400, "dns_value_required", "At least one DNS value is required.");
  out.record_key = recordKey(out);
  return out;
}

async function assertCnameConflicts(
  domainId: string,
  r: Json,
  selfId?: string,
) {
  const { data, error } = await db
    .from("domain_dns_records")
    .select("id,type,name,status")
    .eq("domain_id", domainId)
    .eq("name", r.name);
  if (error)
    throw new HttpError(500, "dns_conflict_check_failed", "DNS conflicts could not be checked.", error);
  const rows = (data || []).filter(
    (x: Json) => x.id !== selfId && x.status !== "deleting",
  );
  if (r.type === "CNAME" && rows.length)
    throw new HttpError(
      409,
      "cname_conflict",
      "A CNAME cannot coexist with another record at the same name.",
    );
  if (r.type !== "CNAME" && rows.some((x: Json) => x.type === "CNAME"))
    throw new HttpError(
      409,
      "cname_conflict",
      "This name already has a CNAME record.",
    );
}
function managedStatus(d: Json, cfg: Json, providerConfirmed = true) {
  const current = (d.nameservers || []).map(lower).filter(Boolean).sort();
  const managed = (cfg.default_nameservers || [])
    .map(lower)
    .filter(Boolean)
    .sort();
  const same =
    providerConfirmed &&
    current.length >= 2 &&
    managed.length >= 2 &&
    current.length === managed.length &&
    current.every((v: string, i: number) => v === managed[i]);
  return {
    currentNameservers: current,
    managedNameservers: managed,
    dnsManagedActive: same,
    providerConfirmed,
    warning: !providerConfirmed
      ? "This domain is not present at DomainNameAPI. Provider-backed DNS operations are disabled."
      : same
      ? null
      : "This domain is not using the managed DNS nameservers. Local/provider DNS records may not be active publicly.",
  };
}
function providerRecordList(b: any): any[] | null {
  for (const c of [
    b?.data?.records,
    b?.records,
    b?.data?.zones,
    b?.zones,
    b?.result?.records,
    b?.result,
    b?.data,
    b,
  ])
    if (Array.isArray(c)) return c;
  return null;
}
function providerArray(b: any): any[] {
  return providerRecordList(b) || [];
}
function systemRecordType(type: unknown) {
  return ["SOA", "RRSIG", "DNSKEY", "NSEC", "NSEC3"].includes(upper(type));
}
function providerRecord(raw: Json) {
  const name =
    lower(raw.name ?? raw.Name ?? raw.host ?? raw.recordName ?? "@").replace(
      /\.$/,
      "",
    ) || "@";
  const type = upper(raw.type ?? raw.Type ?? raw.recordType ?? raw.RecordType);
  const ttlValue = Number(raw.ttl ?? raw.TTL ?? 3600);
  const rawContents = Array.isArray(raw.contents)
    ? raw.contents
    : Array.isArray(raw.values)
      ? raw.values
      : Array.isArray(raw.records)
        ? raw.records.map((record: any) => typeof record === "string" ? record : record?.content).filter((v: any) => v !== undefined)
        : [raw.content ?? raw.value ?? raw.target ?? raw.Record].filter((v) => v !== undefined);
  const priorityValue = raw.priority ?? raw.Priority ?? raw.preference ?? null;
  const metadata: Json = { providerRaw: raw };
  const row = {
    name,
    type,
    ttl: Number.isFinite(ttlValue) ? ttlValue : 3600,
    contents: rawContents.map(clean).filter(Boolean),
    priority:
      priorityValue === null || priorityValue === undefined
        ? null
        : Number(priorityValue),
    metadata,
    source: "provider",
    provider_record_id: clean(raw.id ?? raw.recordId ?? raw.zoneId) || null,
  };
  return { ...row, record_key: recordKey(row) };
}
async function listDns(req: Request, u: Json, id: string) {
  const cfg = await config();
  const d = await domain(id, u);
  const { data, error: recordsError } = await db
    .from("domain_dns_records")
    .select("*")
    .eq("domain_id", d.id)
    .order("name")
    .order("type");
  if (recordsError)
    throw new HttpError(500, "dns_records_load_failed", "DNS records could not be loaded.", recordsError);
  let providerError: string | null = null;
  let providerConfirmed = false;
  try {
    const info = await confirmProviderDomain(d);
    providerConfirmed = true;
    const providerNameservers =
      info.nameservers ||
      info.nameServers ||
      info.data?.nameservers ||
      info.data?.nameServers;
    if (Array.isArray(providerNameservers)) {
      d.nameservers = providerNameservers.map(clean).filter(Boolean);
      const { error: nameserverSyncError } = await db
        .from("domain_domains")
        .update({
          nameservers: d.nameservers,
          last_synced_at: now(),
          updated_at: now(),
        })
        .eq("id", d.id);
      if (nameserverSyncError)
        throw new HttpError(500, "nameserver_sync_failed", "Provider nameservers were read, but the local domain state could not be saved.", nameserverSyncError);
    }
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
  }
  return json(req, {
    domain: d,
    records: data || [],
    dns: managedStatus(d, cfg, providerConfirmed),
    providerError,
    currentEnvironment: cfg.registrar_environment,
  });
}
async function syncDns(req: Request, u: Json, id: string) {
  const cfg = await config();
  const d = await domain(id, u);
  assertEnv(d, cfg);
  await confirmProviderDomain(d);
  const provider = await registrar(envOf(d.registrar_environment), "/api/v1/domains/zones", "GET", null, {
    domainName: d.domain_name,
  });
  const providerRecords = providerRecordList(provider);
  if (!providerRecords) {
    throw new HttpError(
      502,
      "dns_provider_invalid_response",
      "The registrar returned an invalid DNS zone response. Local records were not changed.",
      { providerKeys: provider && typeof provider === "object" ? Object.keys(provider) : [] },
    );
  }
  const normalized = providerRecords
    .map(providerRecord)
    .filter((r) => r.type && r.name && r.contents.length && !systemRecordType(r.type));
  const seen = normalized.map((r) => r.record_key);
  const upserted: Json[] = [];
  for (const r of normalized) {
    const payload = {
      domain_id: d.id,
      user_id: d.user_id,
      name: r.name,
      type: r.type,
      contents: r.contents,
      ttl: r.ttl,
      priority: r.priority,
      status: "active",
      registrar_response: r.metadata.providerRaw || {},
      source: "provider",
      provider_record_id: r.provider_record_id,
      record_key: r.record_key,
      metadata: r.metadata,
      registrar_environment: d.registrar_environment,
      last_operation: "sync",
      last_error: null,
      synced_at: now(),
      updated_at: now(),
    };
    const { data, error } = await db
      .from("domain_dns_records")
      .upsert(payload, { onConflict: "domain_id,record_key" })
      .select("*")
      .single();
    if (error)
      throw new HttpError(500, "dns_sync_failed", error.message, error);
    upserted.push(data as Json);
  }
  const { data: existingProviderRows, error: existingProviderError } = await db
    .from("domain_dns_records")
    .select("id,record_key")
    .eq("domain_id", d.id)
    .eq("source", "provider");
  if (existingProviderError)
    throw new HttpError(500, "dns_sync_cleanup_failed", "DNS sync cleanup could not be checked.", existingProviderError);
  const staleIds = (existingProviderRows || []).filter((row: Json) => !seen.includes(row.record_key)).map((row: Json) => row.id);
  if (staleIds.length) {
    const { error: staleDeleteError } = await db.from("domain_dns_records").delete().in("id", staleIds);
    if (staleDeleteError)
      throw new HttpError(500, "dns_sync_cleanup_failed", "Stale DNS records could not be removed.", staleDeleteError);
  }
  const { error: domainSyncError } = await db
    .from("domain_domains")
    .update({
      metadata: { ...(d.metadata || {}), lastDnsSyncAt: now() },
      last_synced_at: now(),
      updated_at: now(),
    })
    .eq("id", d.id);
  if (domainSyncError)
    throw new HttpError(500, "dns_sync_state_failed", "DNS synced, but the local domain state could not be saved.", domainSyncError);
  return json(req, {
    success: true,
    imported: upserted.length,
    records: upserted,
    provider,
  });
}
function zoneStruct(r: Json) {
  return {
    name: r.name === "@" ? "" : r.name,
    type: r.type,
    contents: r.contents,
    ttl: r.ttl,
  };
}
function qualifiedRecordName(name: unknown, domainName: string) {
  const domain = domainName.trim().toLowerCase().replace(/\.$/, "");
  const value = clean(name).toLowerCase().replace(/\.$/, "");
  if (!value || value === "@") return domain + ".";
  if (value === domain || value.endsWith("." + domain)) return value + ".";
  return value + "." + domain + ".";
}

async function createRecord(req: Request, u: Json, id: string, b: Json) {
  const cfg = await config();
  const d = await domain(id, u);
  assertEnv(d, cfg);
  await confirmProviderDomain(d);
  const r = normalize(b);
  await assertCnameConflicts(d.id, r);
  const provider = await registrar(
    envOf(d.registrar_environment),
    "/api/v1/domains/zones",
    "POST",
    { zoneStruct: zoneStruct(r) },
    { domainName: d.domain_name },
  );
  await applyZone(d);
  const { data, error } = await db
    .from("domain_dns_records")
    .upsert(
      {
        domain_id: d.id,
        user_id: d.user_id,
        ...r,
        status: "active",
        registrar_response: provider,
        source: "provider",
        registrar_environment: d.registrar_environment,
        last_operation: "create",
        last_error: null,
        synced_at: now(),
        updated_at: now(),
      },
      { onConflict: "domain_id,record_key" },
    )
    .select("*")
    .single();
  if (error)
    throw new HttpError(500, "dns_record_save_failed", error.message, error);
  return json(req, { success: true, record: data, provider }, 201);
}
async function updateRecord(
  req: Request,
  u: Json,
  id: string,
  recordId: string,
  b: Json,
) {
  const cfg = await config();
  const d = await domain(id, u);
  assertEnv(d, cfg);
  await confirmProviderDomain(d);
  const { data: existing, error: existingError } = await db
    .from("domain_dns_records")
    .select("*")
    .eq("id", recordId)
    .eq("domain_id", d.id)
    .maybeSingle();
  if (existingError)
    throw new HttpError(500, "dns_record_load_failed", "DNS record could not be loaded.", existingError);
  if (!existing)
    throw new HttpError(404, "dns_record_not_found", "DNS record not found.");
  if (systemRecordType(existing.type)) {
    throw new HttpError(400, "system_dns_record", "System DNS records are read-only.");
  }
  const r = normalize(b, existing as Json);
  await assertCnameConflicts(d.id, r, recordId);
  const provider = await registrar(
    envOf(d.registrar_environment),
    "/api/v1/domains/zones",
    "PUT",
    { zoneStruct: zoneStruct(r) },
    { domainName: d.domain_name, recordName: existing.name },
  );
  await applyZone(d);
  const { data, error } = await db
    .from("domain_dns_records")
    .update({
      ...r,
      status: "active",
      registrar_response: provider,
      source: "provider",
      last_operation: "update",
      last_error: null,
      synced_at: now(),
      updated_at: now(),
    })
    .eq("id", recordId)
    .select("*")
    .single();
  if (error)
    throw new HttpError(500, "dns_record_update_failed", error.message, error);
  return json(req, { success: true, record: data, provider });
}
async function deleteRecord(
  req: Request,
  u: Json,
  id: string,
  recordId: string,
) {
  const cfg = await config();
  const d = await domain(id, u);
  assertEnv(d, cfg);
  await confirmProviderDomain(d);
  const { data: r, error: recordError } = await db
    .from("domain_dns_records")
    .select("*")
    .eq("id", recordId)
    .eq("domain_id", d.id)
    .maybeSingle();
  if (recordError)
    throw new HttpError(500, "dns_record_load_failed", "DNS record could not be loaded.", recordError);
  if (!r)
    throw new HttpError(404, "dns_record_not_found", "DNS record not found.");
  if (systemRecordType(r.type)) {
    throw new HttpError(400, "system_dns_record", "System DNS records are read-only.");
  }
  try {
    const provider = await registrar(envOf(d.registrar_environment), "/api/v1/domains/zones", "DELETE", null, {
      domainName: d.domain_name,
      Name: qualifiedRecordName(r.name, d.domain_name),
      Record: r.contents?.[0] || "",
      RecordType: r.type,
    });
    await applyZone(d);
    const { error: localDeleteError } = await db.from("domain_dns_records").delete().eq("id", recordId);
    if (localDeleteError)
      throw new HttpError(500, "dns_record_delete_persist_failed", "The provider applied the deletion, but the local record could not be removed.", localDeleteError);
    return json(req, { success: true, provider });
  } catch (e) {
    await db
      .from("domain_dns_records")
      .update({
        status: "failed",
        last_operation: "delete",
        last_error: e instanceof Error ? e.message : String(e),
        updated_at: now(),
      })
      .eq("id", recordId);
    throw e;
  }
}
async function retryRecord(
  req: Request,
  u: Json,
  id: string,
  recordId: string,
) {
  const { data: r } = await db
    .from("domain_dns_records")
    .select("*")
    .eq("id", recordId)
    .eq("domain_id", id)
    .maybeSingle();
  if (!r)
    throw new HttpError(404, "dns_record_not_found", "DNS record not found.");
  return r.last_operation === "delete" || r.status === "deleting"
    ? await deleteRecord(req, u, id, recordId)
    : await updateRecord(req, u, id, recordId, r as Json);
}
function normalizeNameservers(values: unknown) {
  const ns = (Array.isArray(values) ? values : [])
    .map(clean)
    .map((x) => x.replace(/\.$/, "").toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(ns)];
  if (unique.length < 2 || unique.length > 13)
    throw new HttpError(
      400,
      "invalid_nameservers",
      "Provide between 2 and 13 nameservers.",
    );
  if (!unique.every(hostOk))
    throw new HttpError(
      400,
      "invalid_nameservers",
      "One or more nameservers are invalid hostnames.",
    );
  return unique;
}
async function updateNameservers(req: Request, u: Json, id: string, b: Json) {
  const cfg = await config();
  const d = await domain(id, u);
  assertEnv(d, cfg);
  await confirmProviderDomain(d);
  const ns = normalizeNameservers(b.nameServers || b.nameservers);
  const provider = await registrar(envOf(d.registrar_environment), "/api/v1/domains/dns/name-server", "PUT", {
    domainName: d.domain_name,
    nameServers: ns,
  });
  const { data, error } = await db
    .from("domain_domains")
    .update({
      nameservers: ns,
      metadata: { ...(d.metadata || {}), nameserverResponse: provider },
      last_synced_at: now(),
      updated_at: now(),
    })
    .eq("id", d.id)
    .select("*")
    .single();
  if (error)
    throw new HttpError(500, "nameserver_update_failed", error.message, error);
  return json(req, {
    success: true,
    domain: data,
    dns: managedStatus(data as Json, cfg),
    provider,
  });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors(req) });
  try {
    const path = pathOf(req);
    if (req.method === "GET" && (path === "/" || path === "/health"))
      return json(req, {
        ok: true,
        service: "KmerHosting Domain DNS Tools",
        version: 1,
        timestamp: now(),
      });
    const u = await auth(req);
    const root = path.match(/^\/domains\/([0-9a-f-]+)\/dns$/i);
    if (root && req.method === "GET") return await listDns(req, u, root[1]);
    if (root && req.method === "POST")
      return await createRecord(req, u, root[1], await body(req));
    const sync = path.match(/^\/domains\/([0-9a-f-]+)\/dns\/sync$/i);
    if (sync && req.method === "POST") return await syncDns(req, u, sync[1]);
    const one = path.match(/^\/domains\/([0-9a-f-]+)\/dns\/([0-9a-f-]+)$/i);
    if (one && req.method === "PUT")
      return await updateRecord(req, u, one[1], one[2], await body(req));
    if (one && req.method === "DELETE")
      return await deleteRecord(req, u, one[1], one[2]);
    const retry = path.match(
      /^\/domains\/([0-9a-f-]+)\/dns\/([0-9a-f-]+)\/retry$/i,
    );
    if (retry && req.method === "POST")
      return await retryRecord(req, u, retry[1], retry[2]);
    const ns = path.match(/^\/domains\/([0-9a-f-]+)\/nameservers$/i);
    if (ns && req.method === "PUT")
      return await updateNameservers(req, u, ns[1], await body(req));
    return json(
      req,
      { error: "not_found", message: "Endpoint not found." },
      404,
    );
  } catch (e) {
    if (e instanceof HttpError)
      return json(
        req,
        { error: e.code, message: e.message, details: e.details },
        e.status,
      );
    console.error(e);
    return json(
      req,
      {
        error: "internal_error",
        message: e instanceof Error ? e.message : "Unexpected error.",
      },
      500,
    );
  }
});
