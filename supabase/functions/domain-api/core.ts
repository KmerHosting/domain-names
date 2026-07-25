import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const secretCache = new Map<string, { value: string; expires: number }>();
let configCache: { value: DomainConfig; expires: number } | null = null;

export type Json = Record<string, any>;
export type DomainConfig = {
  site_url: string;
  company_name: string;
  brand_name: string;
  support_email: string;
  registrar_environment: "ote" | "production";
  registrar_ote_base_url: string;
  registrar_production_base_url: string;
  registrar_reseller_id: string | null;
  camerpay_base_url: string;
  payment_currency: string;
  usd_to_xaf_rate: number;
  payment_sandbox: boolean;
  default_nameservers: string[];
  otp_ttl_minutes: number;
  session_ttl_days: number;
  renewal_notice_days: number[];
  auto_renew_charge_days: number;
  expiry_grace_days: number;
  max_job_attempts: number;
  maintenance_mode: boolean;
  mailtrap_api_url: string;
  mailtrap_sender_email: string;
  mailtrap_sender_name: string;
  camerpay_callback_url: string;
  camerpay_return_url: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeEmail(value: unknown): string {
  return clean(value).toLowerCase();
}

export function normalizeDomain(value: unknown): string {
  return clean(value).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
}

export function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function validDomain(value: string): boolean {
  if (value.length < 3 || value.length > 253 || !value.includes(".")) return false;
  return value.split(".").every((label) =>
    label.length > 0 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

export function getTld(domain: string): string {
  const labels = domain.split(".");
  return labels.length > 1 ? `.${labels.at(-1)}` : "";
}

export function normalizePhone(value: unknown): string {
  return clean(value).replace(/[^\d+]/g, "");
}

export function clientIp(req: Request): string {
  return clean(req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip")) || "unknown";
}

export function userAgent(req: Request): string {
  return clean(req.headers.get("user-agent")).slice(0, 500);
}

export function functionPath(req: Request): string {
  const p = new URL(req.url).pathname;
  const marker = "/domain-api";
  const i = p.indexOf(marker);
  const value = i >= 0 ? p.slice(i + marker.length) : p;
  return value === "" ? "/" : value.replace(/\/+$/, "") || "/";
}

export function allowedOrigin(origin: string | null): string {
  if (!origin) return "*";
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (
      host === "domain.kmerhosting.com" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".vercel.app")
    ) return origin;
  } catch { /* ignored */ }
  return "https://domain.kmerhosting.com";
}

export function corsHeaders(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-camerpay-signature, x-signature, x-domain-cron-secret, idempotency-key",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function bodyJson(req: Request): Promise<Json> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Content-Type application/json is required.");
  }
  const parsed = await req.json().catch(() => null);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new ApiError(400, "invalid_json", "A JSON object is required.");
  }
  return parsed as Json;
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toBase64Url(arr);
}

export function randomCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

export function randomReference(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${stamp}-${randomToken(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signed).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a.toLowerCase());
  const bb = encoder.encode(b.toLowerCase());
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export async function getConfig(force = false): Promise<DomainConfig> {
  if (!force && configCache && configCache.expires > Date.now()) return configCache.value;
  const { data, error } = await db.from("domain_config").select("*").eq("id", true).single();
  if (error || !data) throw new ApiError(500, "configuration_missing", "Domain portal configuration is missing.", error);
  const value = {
    ...data,
    usd_to_xaf_rate: Number(data.usd_to_xaf_rate),
    otp_ttl_minutes: Number(data.otp_ttl_minutes),
    session_ttl_days: Number(data.session_ttl_days),
    renewal_notice_days: (data.renewal_notice_days || []).map(Number),
    auto_renew_charge_days: Number(data.auto_renew_charge_days),
    expiry_grace_days: Number(data.expiry_grace_days),
    max_job_attempts: Number(data.max_job_attempts),
    default_nameservers: data.default_nameservers || [],
  } as DomainConfig;
  configCache = { value, expires: Date.now() + 30_000 };
  return value;
}

export async function getSecret(name: string, required = true): Promise<string> {
  const cached = secretCache.get(name);
  if (cached && cached.expires > Date.now()) return cached.value;
  const { data, error } = await db.rpc("domain_secret", { p_name: name });
  const value = clean(data);
  if ((error || !value) && required) {
    throw new ApiError(503, "provider_not_configured", `Required server secret ${name} is not configured.`);
  }
  if (value) secretCache.set(name, { value, expires: Date.now() + 60_000 });
  return value;
}

export async function runtimeStatus(): Promise<Json> {
  const { data, error } = await db.rpc("domain_runtime_status");
  if (error) return {};
  return data || {};
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 128) {
    throw new ApiError(400, "weak_password", "Password must contain between 10 and 128 characters.");
  }
  return await bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export type AuthContext = {
  user: Json;
  session: Json;
  token: string;
};

export async function createSession(user: Json, req: Request): Promise<{ token: string; expiresAt: string }> {
  const cfg = await getConfig();
  const token = randomToken(48);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + cfg.session_ttl_days * 86_400_000).toISOString();
  const { error } = await db.from("domain_sessions").insert({
    user_id: user.id,
    token_hash: tokenHash,
    session_version: user.session_version,
    user_agent: userAgent(req),
    client_ip: clientIp(req),
    expires_at: expiresAt,
  });
  if (error) throw new ApiError(500, "session_create_failed", "Unable to create the session.", error);
  return { token, expiresAt };
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const header = clean(req.headers.get("authorization"));
  if (!header.toLowerCase().startsWith("bearer ")) {
    throw new ApiError(401, "authentication_required", "Authentication is required.");
  }
  const token = header.slice(7).trim();
  if (!token) throw new ApiError(401, "invalid_session", "Invalid session.");
  const tokenHash = await sha256(token);
  const { data: session, error } = await db.from("domain_sessions")
    .select("*").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !session) throw new ApiError(401, "invalid_session", "Session expired or invalid.");
  const { data: user, error: userError } = await db.from("domain_users").select("*").eq("id", session.user_id).maybeSingle();
  if (userError || !user || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) {
    throw new ApiError(401, "invalid_session", "Session expired or invalid.");
  }
  if (new Date(session.last_seen_at).getTime() < Date.now() - 300_000) {
    await db.from("domain_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
  }
  return { user, session, token };
}

export function publicUser(user: Json): Json {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    countryCode: user.country_code,
    role: user.role,
    emailVerifiedAt: user.email_verified_at,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

export async function enforceRateLimit(key: string, maxHits: number, windowSeconds: number): Promise<void> {
  const now = new Date();
  const { data } = await db.from("domain_rate_limits").select("*").eq("key", key).maybeSingle();
  if (!data || new Date(data.window_started_at).getTime() <= now.getTime() - windowSeconds * 1000) {
    await db.from("domain_rate_limits").upsert({
      key, hits: 1, window_started_at: now.toISOString(), blocked_until: null, updated_at: now.toISOString(),
    });
    return;
  }
  if (data.blocked_until && new Date(data.blocked_until).getTime() > now.getTime()) {
    throw new ApiError(429, "rate_limited", "Too many requests. Try again later.");
  }
  const hits = Number(data.hits) + 1;
  const blockedUntil = hits > maxHits ? new Date(now.getTime() + windowSeconds * 1000).toISOString() : null;
  await db.from("domain_rate_limits").update({ hits, blocked_until: blockedUntil, updated_at: now.toISOString() }).eq("key", key);
  if (hits > maxHits) throw new ApiError(429, "rate_limited", "Too many requests. Try again later.");
}

export async function audit(req: Request, action: string, userId?: string | null, entityType?: string, entityId?: string, metadata: Json = {}): Promise<void> {
  await db.from("domain_audit_logs").insert({
    user_id: userId || null,
    action,
    entity_type: entityType || null,
    entity_id: entityId || null,
    client_ip: clientIp(req),
    user_agent: userAgent(req),
    metadata,
  });
}

export async function notify(userId: string, type: string, title: string, message: string, data: Json = {}): Promise<void> {
  await db.from("domain_notifications").insert({ user_id: userId, type, title, message, data });
}

export async function queueEmail(params: {
  eventKey: string;
  recipientEmail: string;
  recipientName?: string | null;
  template: string;
  subject: string;
  payload?: Json;
  userId?: string | null;
  orderId?: string | null;
  domainId?: string | null;
}): Promise<void> {
  await db.from("domain_email_outbox").upsert({
    event_key: params.eventKey,
    recipient_email: normalizeEmail(params.recipientEmail),
    recipient_name: params.recipientName || null,
    template: params.template,
    subject: params.subject,
    payload: params.payload || {},
    user_id: params.userId || null,
    order_id: params.orderId || null,
    domain_id: params.domainId || null,
  }, { onConflict: "event_key", ignoreDuplicates: true });
}

export async function sendMail(params: {
  email: string;
  name?: string | null;
  subject: string;
  text: string;
  html: string;
  category: string;
}): Promise<string | null> {
  const cfg = await getConfig();
  const token = await getSecret("domain_mailtrap_token");
  const response = await fetch(cfg.mailtrap_api_url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      from: { email: cfg.mailtrap_sender_email, name: cfg.mailtrap_sender_name },
      to: [{ email: normalizeEmail(params.email), name: params.name || "Customer" }],
      subject: params.subject,
      text: params.text,
      html: params.html,
      category: params.category,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new ApiError(502, "mail_delivery_failed", `Mail provider rejected the message (${response.status}).`, raw.slice(0, 500));
  try {
    const parsed = JSON.parse(raw);
    return clean(parsed.message_ids?.[0] || parsed.message_id || parsed.id) || null;
  } catch {
    return null;
  }
}

export async function sendOtp(email: string, name: string, code: string, purpose: string): Promise<void> {
  const cfg = await getConfig();
  const purposeLabel: Record<string, string> = {
    registration: "verify your new account",
    login: "sign in to your account",
    password_reset: "reset your password",
    email_change: "confirm your email change",
    account_deletion: "confirm account deletion",
  };
  const action = purposeLabel[purpose] || "verify your request";
  const text = `Hello ${name || "Customer"},\n\nUse this one-time code to ${action}: ${code}\n\nThe code expires in ${cfg.otp_ttl_minutes} minutes. If you did not request it, ignore this email.\n\nKmerHosting LLC`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><div style="max-width:560px;margin:auto;padding:28px"><p style="font-size:13px;color:#64748b">KmerHosting Domains</p><h2>${action}</h2><p>Hello ${escapeHtml(name || "Customer")},</p><p>Use this one-time code:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:18px;background:#f1f5f9;border-radius:12px;text-align:center">${code}</div><p>The code expires in ${cfg.otp_ttl_minutes} minutes.</p><p style="font-size:13px;color:#64748b">If you did not request this, ignore this email.</p></div></body></html>`;
  await sendMail({ email, name, subject: `Your KmerHosting verification code: ${code}`, text, html, category: `domain-${purpose}-otp` });
}

export function escapeHtml(value: unknown): string {
  return clean(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]!));
}

export function pick(obj: any, paths: string[]): any {
  for (const path of paths) {
    let current = obj;
    for (const key of path.split(".")) {
      if (current === null || current === undefined || typeof current !== "object") { current = undefined; break; }
      current = current[key];
    }
    if (current !== undefined && current !== null && clean(current) !== "") return current;
  }
  return undefined;
}

export function paidStatus(value: unknown): boolean {
  return ["paid","success","successful","completed","approved","confirmed","succeeded","done","vire","viré"].includes(clean(value).toLowerCase());
}

export function failedStatus(value: unknown): boolean {
  return ["failed","cancelled","canceled","declined","rejected","expired","error"].includes(clean(value).toLowerCase());
}

export async function encryptSensitive(value: string): Promise<string> {
  if (!value) return "";
  const material = await getSecret("domain_data_encryption_key");
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(material)));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value)));
  return `${toBase64Url(iv)}.${toBase64Url(cipher)}`;
}

export async function decryptSensitive(value: string | null | undefined): Promise<string> {
  if (!value) return "";
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) throw new ApiError(500, "decrypt_failed", "Sensitive order data is invalid.");
  const material = await getSecret("domain_data_encryption_key");
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(material)));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivPart) }, key, fromBase64Url(cipherPart));
  return decoder.decode(plain);
}

export function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
