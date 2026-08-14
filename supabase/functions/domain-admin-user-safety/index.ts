import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();
type Json = Record<string, any>;
class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const clean = (value: unknown) => String(value ?? "").trim();
const now = () => new Date().toISOString();
function cors(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "PATCH,DELETE,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}
function json(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors(req) }); }
async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function pathOf(req: Request) {
  const pathname = new URL(req.url).pathname;
  const marker = "/domain-admin-user-safety";
  const index = pathname.indexOf(marker);
  return (index >= 0 ? pathname.slice(index + marker.length) : pathname).replace(/\/+$/, "") || "/";
}
async function requireAdmin(req: Request) {
  const raw = clean(req.headers.get("authorization"));
  if (!raw.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "authentication_required", "Sign in is required.");
  const tokenHash = await sha256(raw.slice(7).trim());
  const { data: session } = await db.from("domain_sessions").select("user_id,session_version").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", now()).maybeSingle();
  if (!session) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: user } = await db.from("domain_users").select("id,email,role,status,session_version").eq("id", session.user_id).maybeSingle();
  if (!user || user.status !== "active" || Number(user.session_version) !== Number(session.session_version)) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  if (user.role !== "admin") throw new HttpError(403, "admin_required", "Administrator access is required.");
  return user as Json;
}
async function countsExcluding(id: string) {
  const [admins, activeAdmins] = await Promise.all([
    db.from("domain_users").select("id", { count: "exact", head: true }).eq("role", "admin").neq("id", id),
    db.from("domain_users").select("id", { count: "exact", head: true }).eq("role", "admin").eq("status", "active").neq("id", id),
  ]);
  return { admins: admins.count || 0, activeAdmins: activeAdmins.count || 0 };
}
async function audit(actorId: string, action: string, targetId: string, metadata: Json = {}) {
  await db.from("domain_audit_logs").insert({ user_id: actorId, action, entity_type: "user", entity_id: targetId, metadata });
}
function databaseGuardError(error: any) {
  const message = clean(error?.message);
  if (String(error?.code || "") === "23514" || /last (active )?administrator/i.test(message)) {
    return new HttpError(409, "administrator_continuity_protected", message || "Administrator continuity protection blocked this action.");
  }
  return error;
}
async function patchUser(req: Request, actor: Json, id: string) {
  const body = await req.json().catch(() => ({})) as Json;
  const { data: target, error: targetError } = await db.from("domain_users").select("id,email,full_name,role,status").eq("id", id).maybeSingle();
  if (targetError || !target) throw new HttpError(404, "user_not_found", "User not found.");
  const patch: Json = {};
  if (body.status !== undefined) {
    const status = clean(body.status);
    if (!["active", "suspended", "deleted"].includes(status)) throw new HttpError(400, "invalid_status", "Invalid user status.");
    if (id === actor.id && status !== "active") throw new HttpError(409, "admin_cannot_suspend_self", "An administrator cannot suspend or delete their own account.");
    if (target.role === "admin" && target.status === "active" && status !== "active") {
      const counts = await countsExcluding(id);
      if (counts.activeAdmins < 1) throw new HttpError(409, "last_active_admin_protected", "The last active administrator cannot be suspended or deleted.");
    }
    patch.status = status;
  }
  if (body.role !== undefined) {
    const role = clean(body.role);
    if (!["customer", "admin"].includes(role)) throw new HttpError(400, "invalid_role", "Invalid user role.");
    if (id === actor.id && role !== "admin") throw new HttpError(409, "admin_cannot_demote_self", "An administrator cannot convert their own account to a customer.");
    if (target.role === "admin" && role !== "admin") {
      const counts = await countsExcluding(id);
      if (counts.admins < 1) throw new HttpError(409, "last_admin_protected", "The last administrator cannot be converted to a customer.");
      if (target.status === "active" && counts.activeAdmins < 1) throw new HttpError(409, "last_active_admin_protected", "The last active administrator cannot be converted to a customer.");
    }
    patch.role = role;
  }
  if (body.fullName !== undefined) patch.full_name = clean(body.fullName);
  if (body.phone !== undefined) patch.phone = clean(body.phone) || null;
  if (body.countryCode !== undefined) patch.country_code = clean(body.countryCode).toUpperCase() || null;
  if (body.balanceUsd !== undefined) throw new HttpError(409, "direct_balance_write_blocked", "Use the environment-specific customer credit action instead.");
  if (!Object.keys(patch).length) throw new HttpError(400, "no_changes", "No supported changes were provided.");
  patch.updated_at = now();
  const result = await db.from("domain_users").update(patch).eq("id", id).select("id,email,full_name,role,status,balance_usd").single();
  if (result.error) throw databaseGuardError(result.error);
  if (patch.status && patch.status !== "active") await db.from("domain_sessions").update({ revoked_at: now() }).eq("user_id", id).is("revoked_at", null);
  await audit(actor.id, "admin.user.update", id, patch);
  return json(req, { user: result.data });
}
async function deleteUser(req: Request, actor: Json, id: string) {
  if (id === actor.id) throw new HttpError(409, "cannot_delete_self", "An administrator cannot delete their own account.");
  const { data: target } = await db.from("domain_users").select("id,role,status").eq("id", id).maybeSingle();
  if (!target) throw new HttpError(404, "user_not_found", "User not found.");
  if (target.role === "admin") {
    const counts = await countsExcluding(id);
    if (counts.admins < 1) throw new HttpError(409, "last_admin_protected", "The last administrator cannot be deleted.");
    if (target.status === "active" && counts.activeAdmins < 1) throw new HttpError(409, "last_active_admin_protected", "The last active administrator cannot be deleted.");
  }
  const result = await db.from("domain_users").update({ status: "deleted", updated_at: now() }).eq("id", id).select("id,email,status").single();
  if (result.error) throw databaseGuardError(result.error);
  await db.from("domain_sessions").update({ revoked_at: now() }).eq("user_id", id).is("revoked_at", null);
  await audit(actor.id, "admin.user.delete", id);
  return json(req, { user: result.data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    const actor = await requireAdmin(req);
    const match = pathOf(req).match(/^\/users\/([0-9a-f-]{36})$/i);
    if (!match) throw new HttpError(404, "not_found", "Endpoint not found.");
    if (req.method === "PATCH") return await patchUser(req, actor, match[1]);
    if (req.method === "DELETE") return await deleteUser(req, actor, match[1]);
    throw new HttpError(405, "method_not_allowed", "Use PATCH or DELETE.");
  } catch (error) {
    if (error instanceof HttpError) return json(req, { error: error.code, message: error.message, details: error.details }, error.status);
    console.error(error);
    return json(req, { error: "internal_error", message: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
