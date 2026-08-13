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
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const session = cookieValue(req.headers.get("Cookie"), COOKIE_NAME);
  if (!session) return json({ error: "authentication_required", message: "Administrator access is required." }, 401);
  const anonJwt = process.env.SUPABASE_ANON_KEY || "";
  if (!anonJwt) return json({ error: "server_configuration", message: "SUPABASE_ANON_KEY is not configured." }, 503);
  const upstream = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${anonJwt}`,
      apikey: anonJwt,
      "X-KHD-Session": session,
      Accept: "application/json",
    },
  });
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
