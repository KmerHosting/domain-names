import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const encoder = new TextEncoder();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const marker = "/domain-registrar-proxy";
    const index = url.pathname.indexOf(marker);
    const path = index >= 0 ? url.pathname.slice(index + marker.length) : "";
    const method = req.method.toUpperCase();

    if (!/^\/api\/v1\/[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) {
      return json(400, { error: "invalid_registrar_path" });
    }
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
      return json(405, { error: "method_not_allowed" });
    }

    const { data: config, error: configError } = await db
      .from("domain_config")
      .select("registrar_environment,registrar_reseller_id")
      .eq("id", true)
      .single();
    if (configError || !config) return json(503, { error: "registrar_config_unavailable" });

    const secretName = config.registrar_environment === "production"
      ? "domain_registrar_api_key"
      : "domain_registrar_ote_api_key";
    const { data: expectedKey, error: secretError } = await db.rpc("domain_secret", { p_name: secretName });
    if (secretError || !expectedKey) return json(503, { error: "registrar_secret_unavailable" });

    const suppliedReseller = (req.headers.get("__reseller") || "").trim();
    const suppliedKey = (req.headers.get("x-api-key") || "").trim();
    const resellerOk = await constantTimeEqual(suppliedReseller, String(config.registrar_reseller_id || ""));
    const keyOk = await constantTimeEqual(suppliedKey, String(expectedKey));
    if (!resellerOk || !keyOk) return json(401, { error: "invalid_registrar_credentials" });

    let body: unknown = null;
    if (method !== "GET") {
      const raw = await req.text();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return json(400, { error: "invalid_json" });
        }
      }
    }

    const query = Object.fromEntries(url.searchParams.entries());
    const { data, error } = await db.rpc("domain_registrar_proxy", {
      p_path: path,
      p_method: method,
      p_body: body,
      p_query: query,
    });
    if (error) {
      console.error("domain_registrar_proxy RPC failed", error.code, error.message);
      return json(502, { error: "registrar_proxy_failed" });
    }

    const envelope = data || {};
    return json(Number(envelope.status || 502), envelope.body || {});
  } catch (error) {
    console.error("domain-registrar-proxy failure", error);
    return json(500, { error: "internal_error" });
  }
});
