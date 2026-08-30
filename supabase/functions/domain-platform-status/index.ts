import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

function allowedOrigin(origin: string | null): string {
  if (!origin) return "*";
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === "domain.kmerhosting.com" || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return origin;
  } catch {}
  return "https://domain.kmerhosting.com";
}
function headers(req: Request): HeadersInit { return { "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")), "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET,OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" }; }
function json(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: headers(req) }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== "GET") return json(req, { error: "method_not_allowed" }, 405);
  const { data, error } = await db.from("domain_config")
    .select("customer_checkout_environment,registrar_environment,maintenance_mode,checkout_pause_message,brand_name,support_email,payment_mode,wallet_topup_mode")
    .eq("id", true).single();
  if (error || !data) return json(req, { checkoutEnabled: false, maintenanceMode: true, message: "Platform status is unavailable." }, 503);
  const environment = data.customer_checkout_environment === "production" || data.customer_checkout_environment === "ote"
    ? data.customer_checkout_environment
    : data.registrar_environment === "production" ? "production" : "ote";
  const maintenanceMode = Boolean(data.maintenance_mode);
  const checkoutEnabled = !maintenanceMode;
  const liveMode = environment === "production";
  return json(req, {
    ok: true,
    brandName: data.brand_name || "KmerHosting Domains",
    checkoutEnabled,
    maintenanceMode,
    liveMode,
    testMode: environment === "ote",
    registrarEnvironment: environment,
    customerCheckoutEnvironment: environment,
    message: maintenanceMode
      ? (data.checkout_pause_message || "Domain ordering is temporarily unavailable during maintenance.")
      : liveMode
        ? "New domain orders are processed in live mode."
        : "New domain orders are currently using test mode. No live registration is created.",
    supportEmail: data.support_email || "support@kmerhosting.com",
  });
});
