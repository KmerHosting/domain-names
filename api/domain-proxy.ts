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
const SUPPORT_EMAIL = "support@kmerhosting.com";
const AUTH_SUCCESS_PATHS = new Set([
  "/auth/login",
  "/auth/login/verify",
  "/auth/register/verify",
  "/auth/password-reset/verify",
  "/auth/kmerhosting/exchange",
]);
const PUBLIC_SERVICES = new Set([
  "domain-api",
  "domain-platform-status",
  "domain-search-fast",
]);
const ALLOWED_SERVICES = new Set([
  "domain-api",
  "domain-wallet",
  "domain-admin",
  "domain-admin-monitor",
  "domain-operations-monitor",
  "domain-search-fast",
  "domain-documents",
  "domain-order-guard",
  "domain-customer-tools",
  "domain-dns-tools",
  "domain-platform-status",
]);
const RETIRED_SERVICES = new Set([
  "domain-payment-status",
  "domain-order-poller",
  "domain-checkout",
  "domain-camerpay-webhook",
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

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
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${cookieMaxAge(expiresAt)}`,
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

function routeFromRewrite(url: URL): { service: string; upstreamPath: string } {
  const service = String(url.searchParams.get("__service") || "").trim();
  const rawPath = String(url.searchParams.get("__path") || "").trim();
  const path = rawPath.replace(/^\/+|\/+$/g, "");

  url.searchParams.delete("__service");
  url.searchParams.delete("__path");

  if (RETIRED_SERVICES.has(service)) {
    throw jsonResponse({
      error: "external_payments_removed",
      message: `External payment providers have been removed. Pay from the USD account balance or contact ${SUPPORT_EMAIL} for a manual credit.`,
      supportEmail: SUPPORT_EMAIL,
    }, 410);
  }

  if (!service || !ALLOWED_SERVICES.has(service)) {
    throw jsonResponse({ error: "service_not_allowed", message: "Domain API service is not allowed." }, 404);
  }

  return { service, upstreamPath: path ? `/${path}` : "/" };
}

async function responseFromUpstream(upstream: Response, service: string, upstreamPath: string): Promise<Response> {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-KHD-Session-Mode", "http-only-cookie");

  const contentType = upstream.headers.get("Content-Type") || "";
  if (contentType) headers.set("Content-Type", contentType);
  const isLogout = service === "domain-api" && upstreamPath === "/auth/logout";

  if (contentType.toLowerCase().includes("application/json")) {
    const payload = await upstream.json().catch(() => ({})) as Record<string, any>;
    if (service === "domain-api" && AUTH_SUCCESS_PATHS.has(upstreamPath) && payload?.session?.token) {
      headers.append("Set-Cookie", sessionCookie(String(payload.session.token), payload.session.expiresAt));
      payload.session = { expiresAt: payload.session.expiresAt, mode: "httpOnlyCookie" };
    }
    if (isLogout) headers.append("Set-Cookie", clearCookie());
    return new Response(JSON.stringify(payload), { status: upstream.status, headers });
  }

  if (isLogout) headers.append("Set-Cookie", clearCookie());
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const { service, upstreamPath } = routeFromRewrite(url);
    const method = req.method.toUpperCase();

    if (
      service === "domain-api" &&
      (/^\/orders\/[0-9a-f-]+\/checkout$/i.test(upstreamPath) ||
        /^\/payments\//i.test(upstreamPath) ||
        upstreamPath === "/webhooks/camerpay")
    ) {
      return jsonResponse({
        error: "external_payments_removed",
        message: `External checkout has been removed. Pay from the USD account balance or contact ${SUPPORT_EMAIL} for a manual credit.`,
        supportEmail: SUPPORT_EMAIL,
      }, 410);
    }

    const requestBody = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
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

    const upstream = await fetch(upstreamUrl.toString(), { method, headers, body: requestBody, redirect: "manual" });
    return await responseFromUpstream(upstream, service, upstreamPath);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: "proxy_failed", message: error instanceof Error ? error.message : "Domain API proxy failed." }, 502);
  }
}
