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

  const sync = path.match(/^\/domains\/([0-9a-f-]+)\/sync$/i);
  if (sync) return `/domains/${sync[1]}/dns/sync`;

  return path;
}

function normalizeDnsPayload(payload: Record<string, any>): Record<string, any> {
  if (!payload?.domain || !Array.isArray(payload?.records)) return payload;

  const rawDomain = payload.domain as Record<string, any>;
  const dns = (payload.dns || {}) as Record<string, any>;
  return {
    ...payload,
    domain: {
      ...rawDomain,
      id: rawDomain.id,
      domainName: rawDomain.domainName || rawDomain.domain_name,
      nameservers: Array.isArray(rawDomain.nameservers) ? rawDomain.nameservers : [],
      environment: rawDomain.environment || rawDomain.registrar_environment,
    },
    synced: true,
    managedDns: Boolean(payload.managedDns ?? dns.dnsManagedActive),
    warning: payload.warning ?? dns.warning ?? null,
    providerError: payload.providerError ?? null,
  };
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
        message: error instanceof Error ? error.message : "DNS API proxy failed.",
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
