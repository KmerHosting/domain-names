import { createClient } from "@supabase/supabase-js";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

type Json = Record<string, unknown>;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function pathOf(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const marker = "/domain-api";
  const index = pathname.indexOf(marker);
  const path = index >= 0 ? pathname.slice(index + marker.length) : pathname;
  return path.replace(/\/+$/, "") || "/";
}

async function digest(value: string): Promise<string> {
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(result, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/**
 * Verifies a server-to-server request from api.kmerhosting.com.
 * Returns null for ordinary browser/session traffic.
 */
export async function gatewayAuth(request: Request): Promise<{ user: Json; session: Json; token: string } | null> {
  const timestamp = clean(request.headers.get("x-kmerhosting-gateway-timestamp"));
  const requestId = clean(request.headers.get("x-kmerhosting-gateway-request-id"));
  const userId = clean(request.headers.get("x-kmerhosting-gateway-user-id"));
  const signature = clean(request.headers.get("x-kmerhosting-gateway-signature"));
  const present = [timestamp, requestId, userId, signature].some(Boolean);
  if (!present) return null;
  if (![timestamp, requestId, userId, signature].every(Boolean)) throw new Error("Invalid API gateway authentication.");
  if (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f]{64}$/i.test(signature)) {
    throw new Error("Invalid API gateway authentication.");
  }
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 300_000) throw new Error("Expired API gateway authentication.");

  const secret = clean(Deno.env.get("KMERHOSTING_GATEWAY_SECRET"));
  if (!secret || secret.length < 32) throw new Error("API gateway authentication is not configured.");
  const bodyHash = await digest(await request.clone().text());
  const canonical = [timestamp, requestId, request.method.toUpperCase(), pathOf(request), bodyHash, userId].join(".");
  if (!same(await sign(secret, canonical), signature.toLowerCase())) throw new Error("Invalid API gateway authentication.");

  const { data: user, error } = await db.from("domain_users").select("*").eq("id", userId).eq("status", "active").maybeSingle();
  if (error || !user) throw new Error("API gateway account is unavailable.");
  return { user: user as Json, session: { id: `gateway:${requestId}`, user_id: userId }, token: `gateway:${requestId}` };
}
