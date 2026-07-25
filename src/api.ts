const API_URL =
  import.meta.env.VITE_DOMAIN_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-api";
const PAYMENT_API_URL =
  import.meta.env.VITE_DOMAIN_PAYMENT_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-payment-status";
const PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_DA_Z7P8cQ0CNAA26nekJTg_Tm0LLaO8";

const SESSION_KEY = "kmerhosting-domain-session";
const SESSION_EVENT = "kmerhosting-domain-session-change";

export type Session = {
  token: string;
  expiresAt: string;
};

export type User = {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  countryCode?: string | null;
  role: "customer" | "admin";
  emailVerifiedAt: string;
};

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

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
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.token || new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
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

async function request<T>(baseUrl: string, path: string, options: ApiOptions = {}): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = {
    Accept: "application/json",
    apikey: PUBLISHABLE_KEY,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") clearSession();
    throw new ApiClientError(
      response.status,
      String(payload.error || "request_failed"),
      String(payload.message || `Request failed (${response.status})`),
      payload.details,
    );
  }
  return payload as T;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return await request<T>(API_URL, path, options);
}

export async function paymentApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return await request<T>(PAYMENT_API_URL, path, options);
}

export function formatMoney(value: number | string, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "XAF" ? 0 : 2,
  }).format(Number(value || 0));
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
