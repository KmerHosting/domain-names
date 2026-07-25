import {
  ApiError, Json, clean, constantTimeEqual, getConfig, getSecret, hmacHex,
  paidStatus, pick, randomReference,
} from "./core.ts";

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(504, "provider_timeout", "The external provider did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function registrarCall(path: string, method = "GET", body?: unknown, query?: Record<string, string | number | boolean | null | undefined>): Promise<Json> {
  const cfg = await getConfig();
  const reseller = clean(cfg.registrar_reseller_id);
  if (!reseller) throw new ApiError(503, "registrar_not_configured", "Domain registrar reseller ID is not configured.");
  const secretName = cfg.registrar_environment === "production" ? "domain_registrar_api_key" : "domain_registrar_ote_api_key";
  const apiKey = await getSecret(secretName);
  const base = (cfg.registrar_environment === "production" ? cfg.registrar_production_base_url : cfg.registrar_ote_base_url).replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && value !== undefined && String(value) !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetchWithTimeout(url.toString(), {
    method,
    headers: {
      "__reseller": reseller,
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "KmerHosting-Domains/1.0",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let payload: Json = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 2000) }; }
  if (!response.ok) {
    const message = clean(pick(payload, ["error.message","message","error","title","raw"])) || `Registrar request failed (${response.status}).`;
    throw new ApiError(response.status >= 500 ? 502 : response.status, "registrar_error", message, payload);
  }
  return payload;
}

export async function searchDomain(domainName: string): Promise<Json> {
  return await registrarCall("/api/v1/domains/search", "POST", { domainName });
}

export async function registerDomain(input: {
  domainName: string;
  period: number;
  nameServers: string[];
  contact: Json;
  privacy: boolean;
}): Promise<Json> {
  const base = {
    firstName: input.contact.first_name,
    lastName: input.contact.last_name,
    companyName: input.contact.company_name || null,
    eMail: input.contact.email,
    phoneCountryCode: clean(input.contact.phone_country_code).replace(/\D/g, ""),
    phone: clean(input.contact.phone).replace(/\D/g, ""),
    faxCountryCode: clean(input.contact.fax_country_code).replace(/\D/g, "") || null,
    fax: clean(input.contact.fax).replace(/\D/g, "") || null,
    address: input.contact.address,
    city: input.contact.city,
    state: input.contact.state,
    postalCode: input.contact.postal_code,
    country: clean(input.contact.country).toUpperCase(),
    isHidden: Boolean(input.privacy),
    isEmailVerified: false,
  };
  const contacts = ["Administrative","Billing","Technical","Registrant"].map((contactType) => ({ ...base, contactType }));
  return await registrarCall("/api/v1/domains/register-with-contacts", "POST", {
    domainName: input.domainName,
    period: input.period,
    nameServers: input.nameServers,
    contacts,
    tldAttributes: {},
    useTrusteeContact: Boolean(input.privacy),
  });
}

export async function transferDomain(input: { domainName: string; period: number; authCode: string; contact?: Json | null }): Promise<Json> {
  let contacts: Json[] | undefined;
  if (input.contact) {
    const c = input.contact;
    const base = {
      firstName: c.first_name, lastName: c.last_name, companyName: c.company_name || null,
      eMail: c.email, phoneCountryCode: clean(c.phone_country_code).replace(/\D/g, ""),
      phone: clean(c.phone).replace(/\D/g, ""), faxCountryCode: clean(c.fax_country_code).replace(/\D/g, "") || null,
      fax: clean(c.fax).replace(/\D/g, "") || null, address: c.address, city: c.city, state: c.state,
      postalCode: c.postal_code, country: clean(c.country).toUpperCase(), isHidden: false, isEmailVerified: false,
    };
    contacts = ["Administrative","Billing","Technical","Registrant"].map((contactType) => ({ ...base, contactType }));
  }
  return await registrarCall("/api/v1/domains/transfer", "POST", {
    domainName: input.domainName, period: input.period, authCode: input.authCode, ...(contacts ? { contacts } : {}),
  });
}

export async function renewDomain(domainName: string, period: number): Promise<Json> {
  return await registrarCall("/api/v1/domains/renew", "POST", { domainName, period });
}

export async function domainInfo(domainName: string): Promise<Json> {
  return await registrarCall("/api/v1/domains/info", "GET", undefined, { DomainName: domainName });
}

export async function updateNameServers(domainName: string, nameServers: string[]): Promise<Json> {
  return await registrarCall("/api/v1/domains/dns/name-server", "PUT", { domainName, nameServers });
}

export async function createZoneRecord(domainName: string, record: { name: string; type: string; contents: string[]; ttl: number }): Promise<Json> {
  return await registrarCall("/api/v1/domains/zones", "POST", {
    zoneStruct: { name: record.name, type: record.type, contents: record.contents, ttl: record.ttl },
  }, { domainName });
}

export async function updateZoneRecord(domainName: string, oldName: string, record: { name: string; type: string; contents: string[]; ttl: number }): Promise<Json> {
  return await registrarCall("/api/v1/domains/zones", "PUT", {
    zoneStruct: { name: record.name, type: record.type, contents: record.contents, ttl: record.ttl },
  }, { domainName, recordName: oldName });
}

export async function deleteZoneRecord(domainName: string, record: { name: string; type: string; contents: string[] }): Promise<Json> {
  return await registrarCall("/api/v1/domains/zones", "DELETE", undefined, {
    domainName, Name: record.name, Record: record.contents[0] || "", RecordType: record.type,
  });
}

export async function initiateCamerPay(input: {
  amountXaf: number;
  invoiceId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  paymentMethod?: string | null;
}): Promise<{ payload: Json; checkoutUrl: string; providerReference: string | null }> {
  const cfg = await getConfig();
  const token = await getSecret("domain_camerpay_api_token");
  const requestBody: Json = {
    amount: input.amountXaf,
    currency: "XAF",
    customer_phone: input.customerPhone,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    merchant_invoice_id: input.invoiceId,
    merchant_callback_url: cfg.camerpay_callback_url,
    merchant_return_url: `${cfg.camerpay_return_url}?invoice=${encodeURIComponent(input.invoiceId)}`,
    idempotency_key: input.invoiceId,
    source: "api",
  };
  if (["orange_money","mtn_momo","stripe","paypal"].includes(clean(input.paymentMethod).toLowerCase())) {
    requestBody.payment_method = clean(input.paymentMethod).toLowerCase();
  }
  const response = await fetchWithTimeout(`${cfg.camerpay_base_url.replace(/\/$/, "")}/api/payment/initiate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(requestBody),
  }, 30_000);
  const raw = await response.text();
  let payload: Json = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 2000) }; }
  if (!response.ok) throw new ApiError(502, "payment_provider_error", clean(payload.message || payload.error) || `CamerPay failed (${response.status}).`, payload);
  const checkoutUrl = clean(pick(payload, [
    "pay_url","payUrl","payment_url","paymentUrl","checkout_url","checkoutUrl","redirect_url","redirectUrl","url","link",
    "data.pay_url","data.payment_url","data.checkout_url","data.redirect_url","data.url","data.link",
  ]));
  if (!/^https?:\/\//i.test(checkoutUrl)) throw new ApiError(502, "payment_link_missing", "CamerPay did not return a payment link.", payload);
  const providerReference = clean(pick(payload, [
    "transaction_uuid","uuid","reference","transaction_id","transactionId","payment_id","paymentId",
    "data.transaction_uuid","data.uuid","data.reference","data.transaction_id","data.payment_id",
  ])) || null;
  return { payload, checkoutUrl, providerReference };
}

export async function camerPayStatus(providerReference: string): Promise<Json> {
  const cfg = await getConfig();
  const token = await getSecret("domain_camerpay_api_token");
  const response = await fetchWithTimeout(`${cfg.camerpay_base_url.replace(/\/$/, "")}/api/payment/${encodeURIComponent(providerReference)}/status`, {
    method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }, 20_000);
  const raw = await response.text();
  let payload: Json = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 2000) }; }
  if (!response.ok) throw new ApiError(502, "payment_provider_error", clean(payload.message || payload.error) || `CamerPay status failed (${response.status}).`, payload);
  return payload;
}

export function paymentFields(payload: Json): { invoice: string; reference: string; status: string; amount: number | null; uuid: string } {
  const invoice = clean(pick(payload, [
    "merchant_invoice_id","merchantInvoiceId","invoice_id","invoiceId","order_reference","data.merchant_invoice_id","data.invoice_id",
  ]));
  const reference = clean(pick(payload, [
    "transaction_uuid","uuid","reference","transaction_id","transactionId","payment_id","data.transaction_uuid","data.uuid","data.reference",
  ]));
  const status = clean(pick(payload, ["status","payment_status","paymentStatus","data.status","data.payment_status"])).toLowerCase();
  const amountValue = Number(pick(payload, ["amount","paid_amount","data.amount","data.paid_amount"]));
  const amount = Number.isFinite(amountValue) ? amountValue : null;
  const uuid = clean(pick(payload, ["uuid","transaction_uuid","data.uuid","data.transaction_uuid"])) || reference;
  return { invoice, reference, status, amount, uuid };
}

export async function verifyCamerPayWebhook(rawBody: string, payload: Json, signature: string): Promise<boolean> {
  if (!signature) return false;
  const secret = await getSecret("domain_camerpay_callback_secret");
  const fields = paymentFields(payload);
  const candidates = [
    await hmacHex(secret, rawBody),
    await hmacHex(secret, `${fields.uuid}|${fields.invoice}|${fields.status}|${fields.amount ?? ""}`),
  ];
  const normalized = signature.replace(/^sha256=/i, "").trim();
  return candidates.some((candidate) => constantTimeEqual(candidate, normalized));
}

export function isPaymentPaid(payload: Json, expectedAmount: number): boolean {
  const fields = paymentFields(payload);
  return paidStatus(fields.status) && (fields.amount === null || fields.amount >= expectedAmount);
}

export function newInvoiceId(): string {
  return randomReference("KHD-PAY");
}
