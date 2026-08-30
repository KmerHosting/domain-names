export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_FUNCTIONS_BASE = process.env.SUPABASE_FUNCTIONS_BASE || "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1";
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
const COOKIE_NAME = "khd_domain_session";
const SUPPORT_EMAIL = "support@kmerhosting.com";
const AUTH_SUCCESS_PATHS = new Set(["/auth/login", "/auth/login/verify", "/auth/register/verify", "/auth/password-reset/verify", "/auth/kmerhosting/exchange"]);
const PUBLIC_SERVICES = new Set(["domain-api", "domain-platform-status", "domain-search-fast"]);
const ALLOWED_SERVICES = new Set(["domain-api","domain-payment-status","domain-wallet","domain-admin","domain-admin-user-safety","domain-admin-monitor","domain-operations-monitor","domain-search-fast","domain-ops","domain-documents","domain-order-guard","domain-customer-tools","domain-dns-tools","domain-platform-status"]);

function jsonResponse(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
function cookieValue(cookieHeader: string | null, name: string): string { if (!cookieHeader) return ""; for (const part of cookieHeader.split(";")) { const [rawKey, ...rest] = part.trim().split("="); if (rawKey === name) return decodeURIComponent(rest.join("=")); } return ""; }
function cookieMaxAge(expiresAt: unknown): number { const ms = new Date(String(expiresAt || "")).getTime() - Date.now(); if (!Number.isFinite(ms) || ms <= 0) return 0; return Math.max(0, Math.floor(ms / 1000)); }
function sessionCookie(token: string, expiresAt: unknown): string { return [`${COOKIE_NAME}=${encodeURIComponent(token)}`,"Path=/","HttpOnly","Secure","SameSite=Lax",`Max-Age=${cookieMaxAge(expiresAt)}`].join("; "); }
function clearCookie(): string { return [`${COOKIE_NAME}=`,"Path=/","HttpOnly","Secure","SameSite=Lax","Max-Age=0"].join("; "); }
function parseRoute(url: URL): { service: string; upstreamPath: string } { const marker = "/api/domain/"; const index = url.pathname.indexOf(marker); const rest = index >= 0 ? url.pathname.slice(index + marker.length) : ""; const [service, ...pathParts] = rest.split("/").filter(Boolean); if (!service || !ALLOWED_SERVICES.has(service)) throw jsonResponse({ error: "service_not_allowed", message: "Domain API service is not allowed." }, 404); return { service, upstreamPath: `/${pathParts.join("/")}`.replace(/\/$/, "") || "/" }; }
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
    source: String(value.source || "local"),
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
      providerConfirmed: Boolean(payload.dns.providerConfirmed),
      warning: payload.dns.warning || null,
    };
  }
  if (payload.domain && Array.isArray(payload.records)) {
    const rawDomain = payload.domain as Record<string, any>;
    const dns = (output.dns || {}) as Record<string, any>;
    output.synced = Boolean(payload.synced);
    output.managedDns = Boolean(payload.managedDns ?? dns.dnsManagedActive);
    output.warning = payload.warning ?? dns.warning ?? null;
    output.providerSyncAt = payload.providerSyncAt ?? rawDomain.lastSyncedAt ?? rawDomain.last_synced_at ?? null;
    output.providerError = payload.providerError ?? null;
  }
  return output;
}

async function responseFromUpstream(upstream: Response, service: string, upstreamPath: string): Promise<Response> {
  const headers = new Headers(); headers.set("Cache-Control", "no-store"); headers.set("X-Content-Type-Options", "nosniff"); headers.set("X-KHD-Session-Mode", "http-only-cookie");
  const contentType = upstream.headers.get("Content-Type") || ""; if (contentType) headers.set("Content-Type", contentType);
  const isLogout = service === "domain-api" && upstreamPath === "/auth/logout"; const isJson = contentType.toLowerCase().includes("application/json");
  if (isJson) {
    let payload = await upstream.json().catch(() => ({})) as Record<string, any>;
    if (service === "domain-api" && AUTH_SUCCESS_PATHS.has(upstreamPath) && payload?.session?.token) { headers.append("Set-Cookie", sessionCookie(String(payload.session.token), payload.session.expiresAt)); payload.session = { expiresAt: payload.session.expiresAt, mode: "httpOnlyCookie" }; }
    if (service === "domain-dns-tools") payload = normalizeDnsPayload(payload);
    if (isLogout) headers.append("Set-Cookie", clearCookie());
    return new Response(JSON.stringify(payload), { status: upstream.status, headers });
  }
  if (isLogout) headers.append("Set-Cookie", clearCookie());
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url); let { service, upstreamPath } = parseRoute(url); const method = req.method.toUpperCase(); let requestBody = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
    if (service === "domain-api" && (/^\/orders\/[0-9a-f-]+\/checkout$/i.test(upstreamPath) || upstreamPath === "/webhooks/camerpay")) return jsonResponse({ error: "external_payments_removed", message: `External checkout has been removed. Pay from your account balance or contact ${SUPPORT_EMAIL} for a manual credit.`, supportEmail: SUPPORT_EMAIL }, 410);
    if (service === "domain-payment-status" && method !== "GET") return jsonResponse({ error: "external_payments_removed", message: `External payment polling has been removed. Contact ${SUPPORT_EMAIL} if your balance needs to be credited.`, supportEmail: SUPPORT_EMAIL }, 410);
    const adminCredit = service === "domain-admin" ? upstreamPath.match(/^\/users\/([0-9a-f-]+)\/wallet-credit$/i) : null;
    if (adminCredit && method === "POST") { let payload: Record<string, unknown> = {}; try { payload = JSON.parse(new TextDecoder().decode(requestBody || new ArrayBuffer(0)) || "{}") as Record<string, unknown>; } catch { return jsonResponse({ error: "invalid_json", message: "A JSON object is required." }, 400); } service = "domain-wallet"; upstreamPath = "/admin/credit"; requestBody = new TextEncoder().encode(JSON.stringify({ ...payload, userId: adminCredit[1] })).buffer; }
    if (service === "domain-admin" && /^\/users\/[0-9a-f-]{36}$/i.test(upstreamPath) && (method === "PATCH" || method === "DELETE")) service = "domain-admin-user-safety";
    if (service === "domain-api" && upstreamPath === "/domains/check" && method === "POST") { service = "domain-search-fast"; upstreamPath = "/"; }
    if (service === "domain-dns-tools") upstreamPath = mapDnsPath(upstreamPath);
    const upstreamUrl = new URL(`${SUPABASE_FUNCTIONS_BASE.replace(/\/$/, "")}/${service}${upstreamPath}`); upstreamUrl.search = url.search;
    const headers = new Headers(); const accept = req.headers.get("Accept"), contentType = req.headers.get("Content-Type"), idempotencyKey = req.headers.get("Idempotency-Key"); if (accept) headers.set("Accept", accept); if (contentType) headers.set("Content-Type", contentType); if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey); if (PUBLISHABLE_KEY) headers.set("apikey", PUBLISHABLE_KEY);
    const cookieToken = cookieValue(req.headers.get("Cookie"), COOKIE_NAME); const suppliedAuth = req.headers.get("Authorization"); if (cookieToken) headers.set("Authorization", `Bearer ${cookieToken}`); else if (suppliedAuth && !PUBLIC_SERVICES.has(service)) headers.set("Authorization", suppliedAuth);
    const upstream = await fetch(upstreamUrl.toString(), { method, headers, body: requestBody, redirect: "manual" });
    return await responseFromUpstream(upstream, service, upstreamPath);
  } catch (error) { if (error instanceof Response) return error; return jsonResponse({ error: "proxy_failed", message: error instanceof Error ? error.message : "Domain API proxy failed." }, 502); }
}
