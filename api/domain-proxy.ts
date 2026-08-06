import domainProxyHandler, { config } from "./domain/[service]/[...path]";

export { config };

/**
 * Vercel filesystem functions treat `[...path]` in this project as one path
 * segment. The rewrites in vercel.json therefore send every domain API call
 * to this flat function and pass the complete route as query parameters.
 */
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const service = String(url.searchParams.get("__service") || "").trim();
  const routePath = String(url.searchParams.get("__path") || "").replace(/^\/+|\/+$/g, "");

  if (!service) {
    return new Response(JSON.stringify({
      error: "service_required",
      message: "Domain API service is missing.",
    }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  url.searchParams.delete("__service");
  url.searchParams.delete("__path");
  url.pathname = `/api/domain/${encodeURIComponent(service)}${routePath ? `/${routePath}` : ""}`;

  return await domainProxyHandler(new Request(url.toString(), req));
}
