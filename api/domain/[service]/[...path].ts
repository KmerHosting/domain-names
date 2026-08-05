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
const AUTH_SUCCESS_PATHS = new Set([
  "/auth/login",
  "/auth/login/verify",
  "/auth/register/verify",
  "/auth/password-reset/verify",
]);
const PUBLIC_SERVICES = new Set([
  "domain-api",
  "domain-platform-status",
  "domain-search-fast",
]);
const ALLOWED_SERVICES = new Set([
  "domain-api",
  "domain-payment-status",
  "domain-wallet",
  "domain-admin",
  "domain-admin-monitor",
  "domain-operations-monitor",
  "domain-search-fast",
  "domain-ops",
  "domain-documents",
  "domain-order-guard",
  "domain-customer-tools",
  "domain-dns-tools",
  "domain-platform-status",
]);

function cookieValue(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function cookieMaxAge(expiresAt: unknown): number {
  const ms = new Date(String(expiresAt || "")).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.floor(ms / 1000));
}

function sessionCookie(token: string, expiresAt: unknown): string {
  const maxAge = cookieMaxAge(expiresAt);
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function clearCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

function parseRoute(url: URL): { service: string; upstreamPath: string } {
  const marker = "/api/domain/";
  const index = url.pathname.indexOf(marker);
  const rest = index >= 0 ? url.pathname.slice(index + marker.length) : "";
  const [service, ...pathParts] = rest.split("/").filter(Boolean);
  if (!service || !ALLOWED_SERVICES.has(service)) {
    throw new Response(JSON.stringify({ error: "service_not_allowed", message: "Domain API service is not allowed." }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return { service, upstreamPath: `/${pathParts.join("/")}`.replace(/\/$/, "") || "/" };
}

async function responseFromUpstream(req: Request, upstream: Response, service: string, upstreamPath: string): Promise<Response> {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-KHD-Session-Mode", "http-only-cookie");
  const contentType = upstream.headers.get("Content-Type") || "";
  if (contentType) headers.set("Content-Type", contentType);

  const isLogout = service === "domain-api" && upstreamPath === "/auth/logout";
  const isJson = contentType.toLowerCase().includes("application/json");

  if (isJson) {
    const payload = await upstream.json().catch(() => ({})) as Record<string, any>;
    if (service === "domain-api" && AUTH_SUCCESS_PATHS.has(upstreamPath) && payload?.session?.token) {
      headers.append("Set-Cookie", sessionCookie(String(payload.session.token), payload.session.expiresAt));
      payload.session = { expiresAt: payload.session.expiresAt, mode: "httpOnlyCookie" };
    }
    if (isLogout || upstream.status === 401) headers.append("Set-Cookie", clearCookie());
    return new Response(JSON.stringify(payload), { status: upstream.status, headers });
  }

  if (isLogout || upstream.status === 401) headers.append("Set-Cookie", clearCookie());
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const { service, upstreamPath } = parseRoute(url);
    const upstreamUrl = new URL(`${SUPABASE_FUNCTIONS_BASE.replace(/\/$/, "")}/${service}${upstreamPath}`);
    upstreamUrl.search = url.search;

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
    else if (suppliedAuth && !PUBLIC_SERVICES.has(service)) headers.set("Authorization", suppliedAuth);

    const method = req.method.toUpperCase();
    const upstream = await fetch(upstreamUrl.toString(), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });

    return await responseFromUpstream(req, upstream, service, upstreamPath);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response(JSON.stringify({ error: "proxy_failed", message: error instanceof Error ? error.message : "Domain API proxy failed." }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
