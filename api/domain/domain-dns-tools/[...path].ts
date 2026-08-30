export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_FUNCTIONS_BASE =
  process.env.SUPABASE_FUNCTIONS_BASE ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1";
const PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";
const COOKIE_NAME = "khd_domain_session";

function cookieValue(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function requestPath(url: URL): string {
  const marker = "/api/domain/domain-dns-tools";
  const index = url.pathname.indexOf(marker);
  const path = index >= 0 ? url.pathname.slice(index + marker.length) : "/";
  return path.replace(/\/+$/, "") || "/";
}

function mapDnsPath(path: string): string {
  const recordsRoot = path.match(/^\/domains\/([0-9a-f-]+)\/records$/i);
  if (recordsRoot) return `/domains/${recordsRoot[1]}/dns`;

  const recordOne = path.match(/^\/domains\/([0-9a-f-]+)\/records\/([0-9a-f-]+)$/i);
  if (recordOne) return `/domains/${recordOne[1]}/dns/${recordOne[2]}`;

  const retry = path.match(/^\/domains\/([0-9a-f-]+)\/records\/([0-9a-f-]+)\/retry$/i);
  if (retry) return `/domains/${retry[1]}/dns/${retry[2]}/retry`;

  const sync = path.match(/^\/domains\/([0-9a-f-]+)\/sync$/i);
  if (sync) return `/domains/${sync[1]}/dns/sync`;

  return path;
}

function safeDnsRecord(value: Record<string, any> | null): Record<string, any> | null {
  if (!value) return null;
  return {
    id: value.id,
    domain_id: value.domain_id,
    name: String(value.name || "@"),
    type: String(value.type || "").toUpperCase(),
    contents: Array.isArray(value.contents) ? value.contents.map((item: unknown) => String(item ?? "").trim()).filter(Boolean).slice(0, 100) : [],
    ttl: Number(value.ttl || 3600),
    priority: value.priority == null ? null : Number(value.priority),
    weight: value.weight == null ? null : Number(value.weight),
    port: value.port == null ? null : Number(value.port),
    target: value.target == null ? null : String(value.target).trim() || null,
    flag: value.flag == null ? null : Number(value.flag),
    tag: value.tag == null ? null : String(value.tag).trim() || null,
    status: String(value.status || "pending"),
    source: String(value.source || "local") === "provider" ? "synced" : String(value.source || "local"),
    synced_at: value.synced_at || null,
    updated_at: value.updated_at || null,
  };
}

function safeDnsDomain(value: Record<string, any>): Record<string, any> {
  return {
    id: value.id,
    domainName: value.domainName || value.domain_name || "",
    nameservers: Array.isArray(value.nameservers) ? value.nameservers.map((item: unknown) => String(item ?? "").trim()).filter(Boolean).slice(0, 13) : [],
    environment: value.environment || value.registrar_environment || "production",
    status: String(value.status || "pending"),
    expiresAt: value.expiresAt || value.expires_at || null,
    registeredAt: value.registeredAt || value.registered_at || null,
    autoRenew: Boolean(value.autoRenew ?? value.auto_renew),
    privacyEnabled: Boolean(value.privacyEnabled ?? value.privacy_enabled),
    locked: Boolean(value.locked),
    eppStatuses: Array.isArray(value.eppStatuses || value.epp_statuses)
      ? (value.eppStatuses || value.epp_statuses).map((item: unknown) => String(item ?? "").trim()).filter(Boolean).slice(0, 20)
      : [],
    lastSyncedAt: value.lastSyncedAt || value.last_synced_at || null,
  };
}

function normalizeDnsPayload(payload: Record<string, any>): Record<string, any> {
  if (!payload || typeof payload !== "object") return payload;
  const output = { ...payload };
  delete output.provider;
  if (payload.domain && typeof payload.domain === "object") output.domain = safeDnsDomain(payload.domain);
  if (Array.isArray(payload.records)) output.records = payload.records.map((item: Record<string, any>) => safeDnsRecord(item)).filter(Boolean);
  if (Object.prototype.hasOwnProperty.call(payload, "record")) output.record = safeDnsRecord(payload.record);
  if (payload.dns && typeof payload.dns === "object") {
    output.dns = {
      currentNameservers: Array.isArray(payload.dns.currentNameservers) ? payload.dns.currentNameservers.map((item: unknown) => String(item ?? "").trim()).filter(Boolean).slice(0, 13) : [],
      managedNameservers: Array.isArray(payload.dns.managedNameservers) ? payload.dns.managedNameservers.map((item: unknown) => String(item ?? "").trim()).filter(Boolean).slice(0, 13) : [],
      dnsManagedActive: Boolean(payload.dns.dnsManagedActive),
      domainConfirmed: Boolean(payload.dns.domainConfirmed ?? payload.dns.providerConfirmed),
      warning: payload.dns.warning || null,
    };
  }
  if (payload.domain && Array.isArray(payload.records)) {
    const rawDomain = payload.domain as Record<string, any>;
    const dns = (output.dns || {}) as Record<string, any>;
    output.synced = Boolean(payload.synced);
    output.managedDns = Boolean(payload.managedDns ?? dns.dnsManagedActive);
    output.warning = payload.warning ?? dns.warning ?? null;
    output.lastRefreshedAt = payload.lastRefreshedAt ?? payload.providerSyncAt ?? rawDomain.lastSyncedAt ?? rawDomain.last_synced_at ?? null;
    output.syncError = payload.syncError ?? payload.providerError ?? null;
  }
  return output;
}

function responseHeaders(contentType: string): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-KHD-Session-Mode", "http-only-cookie");
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const upstreamPath = mapDnsPath(requestPath(url));
    const method = req.method.toUpperCase();
    const requestBody = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

    const headers = new Headers();
    const accept = req.headers.get("Accept");
    const contentType = req.headers.get("Content-Type");
    const idempotencyKey = req.headers.get("Idempotency-Key");
    if (accept) headers.set("Accept", accept);
    if (contentType) headers.set("Content-Type", contentType);
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    if (PUBLISHABLE_KEY) headers.set("apikey", PUBLISHABLE_KEY);

    const cookieToken = cookieValue(req.headers.get("Cookie"), COOKIE_NAME);
    const suppliedAuth = req.headers.get("Authorization");
    if (cookieToken) headers.set("Authorization", `Bearer ${cookieToken}`);
    else if (suppliedAuth) headers.set("Authorization", suppliedAuth);

    const upstreamUrl = new URL(
      `${SUPABASE_FUNCTIONS_BASE.replace(/\/$/, "")}/domain-dns-tools${upstreamPath}`,
    );
    upstreamUrl.search = url.search;

    const upstream = await fetch(upstreamUrl.toString(), {
      method,
      headers,
      body: requestBody,
      redirect: "manual",
    });

    const upstreamContentType = upstream.headers.get("Content-Type") || "";
    const outHeaders = responseHeaders(upstreamContentType);
    if (upstreamContentType.toLowerCase().includes("application/json")) {
      let payload = await upstream.json().catch(() => ({})) as Record<string, any>;
      payload = normalizeDnsPayload(payload);
      return new Response(JSON.stringify(payload), { status: upstream.status, headers: outHeaders });
    }

    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: outHeaders });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "dns_proxy_failed",
        message: "The DNS service could not complete this request.",
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
