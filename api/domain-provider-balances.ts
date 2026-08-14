export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

const FUNCTION_URL = "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-provider-balance";
const COOKIE_NAME = "khd_domain_session";

function cookieValue(header: string | null, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const session = cookieValue(req.headers.get("Cookie"), COOKIE_NAME);
  if (!session) return json({ error: "authentication_required", message: "Administrator access is required." }, 401);

  const headers = new Headers({ Authorization: `Bearer ${session}`, Accept: "application/json" });
  const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (publishable) headers.set("apikey", publishable);

  const inputUrl = new URL(req.url);
  const upstreamUrl = new URL(FUNCTION_URL);
  for (const key of ["environment", "refresh"]) {
    const value = inputUrl.searchParams.get(key);
    if (value) upstreamUrl.searchParams.set(key, value);
  }

  const upstream = await fetch(upstreamUrl, { method: "GET", headers, redirect: "manual" });
  const payload = await upstream.json().catch(() => ({})) as Record<string, any>;
  if (!upstream.ok) return json(payload, upstream.status);

  const balances = Array.isArray(payload.balances)
    ? payload.balances.map((item: Record<string, any>) => ({
        environment: item.environment,
        label: item.label || (item.environment === "ote" ? "TEST / OTE" : "LIVE / Production"),
        currency: "USD",
        rawBalanceKey: "usdBalance",
        balance: Number.isFinite(Number(item.usdBalance)) ? Number(item.usdBalance) : null,
        balanceText: item.Balance ?? null,
        httpStatus: item.httpStatus,
        refreshHttpStatus: item.refreshHttpStatus ?? null,
        dnaVersion: payload.dnaVersion || "3.0.1",
        error: item.OperationResult === "FAILED" ? item.message || item.OperationMessage || "Balance unavailable" : undefined,
        warning: item.warning || item.refreshError || undefined,
        refreshError: item.refreshError || undefined,
        cached: Boolean(item.cached),
        checkedAt: item.checkedAt || payload.generatedAt || null,
        balanceSource: item.balanceSource || (item.cached ? "snapshot" : "live"),
        tryBalance: Number.isFinite(Number(item.tryBalance)) ? Number(item.tryBalance) : null,
        tryBalanceMeaning: "TRY/TL currency balance; not a test balance",
        source: item.source || "DomainNameAPI",
      }))
    : [];

  return json({
    ok: true,
    dnaVersion: payload.dnaVersion || "3.0.1",
    credentialModel: "REST_RESELLER_UUID_PLUS_API_KEY",
    currentEnvironment: payload.checkoutEnvironment || "ote",
    maintenanceMode: Boolean(payload.maintenanceMode),
    balances,
    authoritativeSource: "DomainNameAPI deposit/accounts/me usdBalance",
    cachePolicy: "Last verified provider balance is display-only fallback. LIVE order checks remain fresh and independent.",
    generatedAt: payload.generatedAt || new Date().toISOString(),
  });
}
