const API_URL = import.meta.env.VITE_DOMAIN_API_URL || "/api/domain/domain-api";
const PAYMENT_API_URL = import.meta.env.VITE_DOMAIN_PAYMENT_API_URL || "/api/domain/domain-payment-status";
const WALLET_API_URL = import.meta.env.VITE_DOMAIN_WALLET_API_URL || "/api/domain/domain-wallet";
const ADMIN_API_URL = import.meta.env.VITE_DOMAIN_ADMIN_API_URL || "/api/domain/domain-admin";
const ADMIN_MONITOR_API_URL = import.meta.env.VITE_DOMAIN_ADMIN_MONITOR_API_URL || "/api/domain/domain-admin-monitor";
const OPERATIONS_MONITOR_API_URL = import.meta.env.VITE_DOMAIN_OPERATIONS_MONITOR_API_URL || "/api/domain/domain-operations-monitor";
const SEARCH_API_URL = import.meta.env.VITE_DOMAIN_SEARCH_API_URL || "/api/domain/domain-search-fast";
const OPS_API_URL = import.meta.env.VITE_DOMAIN_OPS_API_URL || "/api/domain/domain-ops";
const DOCUMENTS_API_URL = import.meta.env.VITE_DOMAIN_DOCUMENTS_API_URL || "/api/domain/domain-documents";
const ORDER_GUARD_API_URL = import.meta.env.VITE_DOMAIN_ORDER_GUARD_API_URL || "/api/domain/domain-order-guard";
const CUSTOMER_TOOLS_API_URL = import.meta.env.VITE_DOMAIN_CUSTOMER_TOOLS_API_URL || "/api/domain/domain-customer-tools";
const DNS_TOOLS_API_URL = import.meta.env.VITE_DOMAIN_DNS_TOOLS_API_URL || "/api/domain/domain-dns-tools";

const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SESSION_META_KEY = "kmerhosting-domain-session-meta";
const LEGACY_SESSION_KEY = "kmerhosting-domain-session";
const SESSION_EVENT = "kmerhosting-domain-session-change";

export type Session = { expiresAt: string; mode?: "httpOnlyCookie" | "localMeta" };
export type User = { id: string; email: string; fullName: string; phone?: string | null; countryCode?: string | null; role: "customer" | "admin"; emailVerifiedAt: string };
export type ApiOptions = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; idempotencyKey?: string; signal?: AbortSignal };

export class ApiClientError extends Error {
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

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_META_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession(session: Session | { token?: string; expiresAt?: string } | null | undefined): void {
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (!session?.expiresAt) {
    localStorage.removeItem(SESSION_META_KEY);
  } else {
    localStorage.setItem(SESSION_META_KEY, JSON.stringify({ expiresAt: session.expiresAt, mode: "httpOnlyCookie" }));
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_META_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function subscribeSession(listener: () => void): () => void {
  const callback = () => listener();
  window.addEventListener(SESSION_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SESSION_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (PUBLISHABLE_KEY && !headers.has("apikey")) headers.set("apikey", PUBLISHABLE_KEY);
  return headers;
}

function visibleEmailInputValue(): string {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="email"], input[type="email"]'));
  return inputs.map((input) => input.value.trim()).find(Boolean) || "";
}

function normalizeOptions(path: string, options: ApiOptions): ApiOptions {
  if (path !== "/auth/login/request") return options;
  const body = (options.body && typeof options.body === "object" && !Array.isArray(options.body) ? options.body : {}) as Record<string, unknown>;
  const email = String(body.email || visibleEmailInputValue() || "").trim().toLowerCase();
  if (!email) throw new ApiClientError(400, "invalid_email", "Enter your email address before requesting a sign-in code.");
  return { ...options, body: { ...body, email } };
}

async function request<T>(baseUrl: string, path = "", options: ApiOptions = {}): Promise<T> {
  const safeOptions = normalizeOptions(path, options);
  const headers = authHeaders();
  if (safeOptions.body !== undefined) headers.set("Content-Type", "application/json");
  if (safeOptions.idempotencyKey) headers.set("Idempotency-Key", safeOptions.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method: safeOptions.method || "GET",
    credentials: "include",
    headers,
    body: safeOptions.body === undefined ? undefined : JSON.stringify(safeOptions.body),
    signal: safeOptions.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearSession();
    throw new ApiClientError(response.status, String(payload.error || "request_failed"), String(payload.message || `Request failed (${response.status})`), payload.details);
  }
  return payload as T;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(API_URL, path, options); }
export async function paymentApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(PAYMENT_API_URL, path, options); }
export async function walletApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(WALLET_API_URL, path, options); }
export async function adminApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(ADMIN_API_URL, path, options); }
export async function adminMonitorApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(ADMIN_MONITOR_API_URL, path, options); }
export async function operationsMonitorApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(OPERATIONS_MONITOR_API_URL, path, options); }
export async function domainSearchApi<T>(path = "", options: ApiOptions = {}): Promise<T> { return request<T>(SEARCH_API_URL, path, options); }
export async function domainOpsApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(OPS_API_URL, path, options); }
export async function domainDocumentsApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(DOCUMENTS_API_URL, path, options); }
export async function orderGuardApi<T>(path = "", options: ApiOptions = {}): Promise<T> { return request<T>(ORDER_GUARD_API_URL, path, options); }
export async function customerToolsApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(CUSTOMER_TOOLS_API_URL, path, options); }
export async function dnsToolsApi<T>(path: string, options: ApiOptions = {}): Promise<T> { return request<T>(DNS_TOOLS_API_URL, path, options); }

export async function downloadDomainDocument(path: string, filename: string): Promise<void> {
  const response = await fetch(`${DOCUMENTS_API_URL}${path}`, {
    credentials: "include",
    headers: authHeaders({ Accept: "application/pdf" }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) clearSession();
    throw new ApiClientError(response.status, String(payload.error || "download_failed"), String(payload.message || "Download failed."), payload.details);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function formatMoney(value: number | string, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: currency === "XAF" ? 0 : 2 }).format(Number(value || 0));
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export function newIdempotencyKey(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
