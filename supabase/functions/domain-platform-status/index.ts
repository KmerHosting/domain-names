import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function allowedOrigin(origin: string | null): string {
  if (!origin) return "*";
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === "domain.kmerhosting.com" || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return origin;
  } catch {}
  return "https://domain.kmerhosting.com";
}

function headers(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== "GET") return json(req, { error: "method_not_allowed" }, 405);

  const { data, error } = await db.from("domain_config")
    .select("registrar_environment,maintenance_mode,checkout_pause_message,brand_name,support_email,payment_mode,wallet_topup_mode")
    .eq("id", true).single();

  if (error || !data) return json(req, { checkoutEnabled: false, maintenanceMode: true, message: "Platform status is unavailable." }, 503);

  const checkoutEnabled = data.registrar_environment === "production" && data.maintenance_mode === false;
  return json(req, {
    ok: true,
    brandName: data.brand_name || "KmerHosting Domains",
    checkoutEnabled,
    maintenanceMode: Boolean(data.maintenance_mode),
    liveMode: data.registrar_environment === "production",
    registrarEnvironment: data.registrar_environment,
    paymentMode: data.payment_mode || "wallet_only",
    topupMode: data.wallet_topup_mode || "manual_support",
    message: checkoutEnabled
      ? "Domain ordering is live. Orders are paid from the customer account balance."
      : (data.checkout_pause_message || "Domain ordering is temporarily unavailable during maintenance."),
    supportEmail: data.support_email || "support@kmerhosting.com",
  });
});
