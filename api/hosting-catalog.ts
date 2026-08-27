export const config = { runtime: "edge" };

const UPSTREAM = "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/hosting-api-gateway/catalog";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok || !Array.isArray(payload.plans)) {
      return json({ error: "catalog_unavailable", message: "Shared Hosting catalog is temporarily unavailable." }, 502);
    }

    return json({ plans: payload.plans, syncedAt: new Date().toISOString() });
  } catch {
    return json({ error: "catalog_unavailable", message: "Shared Hosting catalog is temporarily unavailable." }, 502);
  }
}
