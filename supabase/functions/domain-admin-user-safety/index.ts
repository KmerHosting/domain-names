import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({
    error: "legacy_domain_service_removed",
    message: "This legacy domain endpoint is no longer available. Use the current KmerHosting Domains administration tools.",
  }), { status: 410, headers });
});
