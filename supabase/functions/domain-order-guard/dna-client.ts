export type DnaEnvironment = "ote" | "production";
export type DnaJson = Record<string, any>;

export class DnaRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload: unknown = null,
  ) {
    super(message);
  }
}

const clean = (value: unknown) => String(value ?? "").trim();

function providerMessage(payload: DnaJson, status: number) {
  const values = [
    payload?.error?.message,
    payload?.error?.details,
    payload?.message,
    payload?.operationMessage,
    payload?.reason,
    payload?.title,
    payload?.raw,
  ];
  return values.map(clean).find(Boolean) || `DomainNameAPI request failed (${status}).`;
}

export async function directDnaRequest(input: {
  environment: DnaEnvironment;
  resellerId: string;
  apiKey: string;
  path: string;
  method?: string;
  body?: unknown;
  query?: DnaJson;
  timeoutMs?: number;
}) {
  if (!/^\/api\/v1\/[A-Za-z0-9_./-]+$/.test(input.path) || input.path.includes("..")) {
    throw new DnaRequestError(400, "Invalid DomainNameAPI path.");
  }

  const baseUrl = input.environment === "production"
    ? "https://api.domainresellerapi.com"
    : "https://ote.domainresellerapi.com";
  const url = new URL(`${baseUrl}${input.path}`);
  for (const [key, value] of Object.entries(input.query || {})) {
    if (value !== null && value !== undefined && clean(value)) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs || 25_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: input.method || "GET",
      headers: {
        "__reseller": input.resellerId,
        "X-API-KEY": input.apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "KmerHosting-Domains/1.0",
      },
      body: input.body === undefined || input.body === null ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DnaRequestError(504, "DomainNameAPI did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let payload: DnaJson = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw: raw.slice(0, 4000) };
  }
  if (!response.ok) throw new DnaRequestError(response.status, providerMessage(payload, response.status), payload);
  return payload;
}
