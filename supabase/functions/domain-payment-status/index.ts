import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPPORT_EMAIL = "support@kmerhosting.com";

function headers(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(req) });
  if (req.method === "GET") {
    return json(req, {
      ok: true,
      service: "KmerHosting Domain Payments",
      paymentMode: "wallet_only",
      externalPaymentProvider: false,
      supportEmail: SUPPORT_EMAIL,
      timestamp: new Date().toISOString(),
    });
  }
  return json(req, {
    error: "external_payments_removed",
    message: `External payment processing has been removed. Pay orders from your account balance or contact ${SUPPORT_EMAIL} for a manual credit.`,
    supportEmail: SUPPORT_EMAIL,
  }, 410);
});
