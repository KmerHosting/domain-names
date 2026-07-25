import { formatDate, formatMoney, getSession } from "./api";

const SEARCH_API_URL = import.meta.env.VITE_DOMAIN_SEARCH_API_URL || "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-search-fast";
const OPS_API_URL = import.meta.env.VITE_DOMAIN_OPS_API_URL || "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-ops";
const DOCUMENTS_API_URL = import.meta.env.VITE_DOMAIN_DOCUMENTS_API_URL || "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-documents";
const ORDER_GUARD_API_URL = import.meta.env.VITE_DOMAIN_ORDER_GUARD_API_URL || "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-order-guard";

type BillingDocument = {
  invoice_id: string;
  invoice_number: string;
  order_id: string;
  order_number: string;
  domain_name: string;
  order_type: string;
  amount_usd: number | string;
  amount_xaf: number | string;
  issued_at: string;
};

let billingDocumentsCache: BillingDocument[] | null = null;
let billingDocumentsLoading = false;

function headersFrom(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || {});
  const session = getSession();
  if (session?.token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${session.token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return headers;
}

function currentDomainId(): string | null {
  return window.location.pathname.match(/\/dashboard\/domains\/([0-9a-f-]+)/i)?.[1] || null;
}

function notify(message: string, kind: "success" | "error" = "success") {
  let box = document.getElementById("khd-runtime-message");
  if (!box) {
    box = document.createElement("div");
    box.id = "khd-runtime-message";
    document.body.appendChild(box);
  }
  box.className = `khd-runtime-message ${kind}`;
  box.textContent = message;
  window.setTimeout(() => box?.remove(), 4500);
}

async function ops(path: string, method = "POST", body?: unknown) {
  const headers = headersFrom({});
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${OPS_API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.message || payload.error || `Request failed (${response.status})`));
  return payload;
}

async function listBillingDocuments(): Promise<BillingDocument[]> {
  if (billingDocumentsCache) return billingDocumentsCache;
  if (billingDocumentsLoading) return [];
  billingDocumentsLoading = true;
  try {
    const response = await fetch(`${DOCUMENTS_API_URL}/invoices`, { headers: headersFrom({}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload.message || payload.error || "Unable to load billing documents."));
    billingDocumentsCache = Array.isArray(payload.invoices) ? payload.invoices : [];
    return billingDocumentsCache;
  } finally {
    billingDocumentsLoading = false;
  }
}

async function downloadDocument(path: string, filename: string) {
  const response = await fetch(`${DOCUMENTS_API_URL}${path}`, { headers: headersFrom({ Accept: "application/pdf" }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(String(payload.message || payload.error || `Download failed (${response.status}).`));
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

function installOfficialFetchRoutes() {
  if ((window as any).__khdOfficialFetchRoutesInstalled) return;
  (window as any).__khdOfficialFetchRoutesInstalled = true;
  const previousFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, window.location.origin);
    const method = String(init?.method || "GET").toUpperCase();

    if (url.pathname.endsWith("/domain-api/domains/check") && method === "POST") {
      return previousFetch(SEARCH_API_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: init?.body, signal: init?.signal });
    }
    if (url.pathname.endsWith("/domain-api/orders/registration") && method === "POST") {
      return previousFetch(ORDER_GUARD_API_URL, { method: "POST", headers: headersFrom(init), body: init?.body, signal: init?.signal });
    }
    const nameservers = url.pathname.match(/\/domain-api\/domains\/([0-9a-f-]+)\/nameservers$/i);
    if (nameservers && (method === "PUT" || method === "POST")) {
      return previousFetch(`${OPS_API_URL}/domains/${nameservers[1]}/nameservers`, { method: "PUT", headers: headersFrom(init), body: init?.body, signal: init?.signal });
    }
    const dnsRoot = url.pathname.match(/\/domain-api\/domains\/([0-9a-f-]+)\/dns$/i);
    if (dnsRoot && method === "POST") {
      return previousFetch(`${OPS_API_URL}/domains/${dnsRoot[1]}/dns`, { method: "POST", headers: headersFrom(init), body: init?.body, signal: init?.signal });
    }
    const dnsOne = url.pathname.match(/\/domain-api\/domains\/([0-9a-f-]+)\/dns\/([0-9a-f-]+)$/i);
    if (dnsOne && ["PUT", "DELETE"].includes(method)) {
      return previousFetch(`${OPS_API_URL}/domains/${dnsOne[1]}/dns/${dnsOne[2]}`, { method, headers: headersFrom(init), body: init?.body, signal: init?.signal });
    }
    return previousFetch(input, init);
  };
}

function enhanceSettingRows() {
  const domainId = currentDomainId();
  if (!domainId) return;
  document.querySelectorAll<HTMLElement>(".setting-row").forEach((row) => {
    const text = row.textContent || "";
    const isLock = /Domain lock/i.test(text);
    const isPrivacy = /WHOIS privacy/i.test(text);
    if (!isLock && !isPrivacy) return;
    const key = isLock ? "lock" : "privacy";
    if (row.querySelector(`[data-khd-${key}-button]`)) return;
    const active = /active/i.test(text) && !/disabled/i.test(text);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "khd-inline-action";
    button.setAttribute(`data-khd-${key}-button`, "true");
    button.textContent = isLock ? (active ? "Unlock" : "Lock") : (active ? "Disable privacy" : "Enable privacy");
    button.addEventListener("click", async () => {
      button.disabled = true;
      const targetState = !active;
      const oldText = button.textContent || "Saving";
      button.textContent = "Saving…";
      try {
        await ops(`/domains/${domainId}/${key}`, "POST", { enabled: targetState });
        notify(isLock ? "Domain lock updated." : "WHOIS privacy updated.");
        window.setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Operation failed.", "error");
        button.disabled = false;
        button.textContent = oldText;
      }
    });
    row.appendChild(button);
  });
}

function enhanceDnsTools() {
  const domainId = currentDomainId();
  if (!domainId) return;
  const headings = Array.from(document.querySelectorAll<HTMLElement>(".card-heading"));
  const dnsHeading = headings.find((node) => /DNS records/i.test(node.textContent || ""));
  if (!dnsHeading || dnsHeading.querySelector(".khd-dns-tools")) return;
  const tools = document.createElement("div");
  tools.className = "khd-dns-tools";
  const processButton = document.createElement("button");
  processButton.type = "button";
  processButton.className = "khd-inline-action";
  processButton.textContent = "Retry DNS changes";
  processButton.addEventListener("click", async () => {
    processButton.disabled = true;
    processButton.textContent = "Retrying…";
    try {
      const result = await ops(`/domains/${domainId}/dns/process-pending`, "POST");
      notify(`DNS retry completed: ${result.processed || 0} processed, ${result.failed || 0} failed.`);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      notify(error instanceof Error ? error.message : "DNS retry failed.", "error");
      processButton.disabled = false;
      processButton.textContent = "Retry DNS changes";
    }
  });
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "khd-inline-action secondary";
  refreshButton.textContent = "Refresh DNS";
  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing…";
    try {
      const result = await ops(`/domains/${domainId}/dns/refresh`, "POST");
      notify(`DNS synchronized: ${result.synced || 0} record sets.`);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      notify(error instanceof Error ? error.message : "DNS refresh failed.", "error");
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh DNS";
    }
  });
  tools.append(processButton, refreshButton);
  dnsHeading.appendChild(tools);
}

function enhanceUnknownSearchLabels() {
  document.querySelectorAll<HTMLElement>(".search-result").forEach((row) => {
    if (/Unsupported TLD/i.test(row.textContent || "")) {
      const status = row.querySelector<HTMLElement>(".result-domain span");
      if (status) status.textContent = "Unsupported extension";
    }
  });
}

function appendText(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, text: string, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

async function enhanceBillingDocuments() {
  if (window.location.pathname !== "/dashboard/orders" || !getSession()) return;
  const heading = document.querySelector<HTMLElement>(".page-heading");
  if (!heading || document.getElementById("khd-billing-documents")) return;
  const section = document.createElement("section");
  section.id = "khd-billing-documents";
  section.className = "card khd-documents-card";
  const cardHeading = document.createElement("div");
  cardHeading.className = "card-heading";
  const titleWrap = document.createElement("div");
  appendText(titleWrap, "h2", "Invoices & receipts");
  appendText(titleWrap, "p", "Download invoices and receipts for paid orders.");
  cardHeading.appendChild(titleWrap);
  const list = document.createElement("div");
  list.className = "khd-documents-list";
  appendText(list, "div", "Loading invoices and receipts…", "khd-documents-loading");
  section.append(cardHeading, list);
  heading.insertAdjacentElement("afterend", section);
  try {
    const docs = await listBillingDocuments();
    list.replaceChildren();
    if (!docs.length) {
      appendText(list, "p", "No paid invoice yet.", "khd-documents-empty");
      return;
    }
    docs.slice(0, 20).forEach((doc) => {
      const row = document.createElement("div");
      row.className = "khd-document-row";
      const left = document.createElement("div");
      appendText(left, "strong", doc.invoice_number);
      appendText(left, "span", `${doc.domain_name} · ${doc.order_type} · ${formatDate(doc.issued_at)}`);
      const amount = document.createElement("div");
      appendText(amount, "strong", formatMoney(doc.amount_usd));
      appendText(amount, "span", formatMoney(doc.amount_xaf, "XAF"));
      const actions = document.createElement("div");
      actions.className = "khd-document-actions";
      const invoiceButton = document.createElement("button");
      invoiceButton.className = "khd-inline-action secondary";
      invoiceButton.textContent = "Invoice PDF";
      invoiceButton.addEventListener("click", () => downloadDocument(`/invoices/${doc.invoice_id}.pdf`, `${doc.invoice_number}.pdf`).catch((error) => notify(error instanceof Error ? error.message : "Invoice download failed.", "error")));
      const receiptButton = document.createElement("button");
      receiptButton.className = "khd-inline-action";
      receiptButton.textContent = "Receipt PDF";
      receiptButton.addEventListener("click", () => downloadDocument(`/orders/${doc.order_id}/receipt.pdf`, `${doc.order_number}-receipt.pdf`).catch((error) => notify(error instanceof Error ? error.message : "Receipt download failed.", "error")));
      actions.append(invoiceButton, receiptButton);
      row.append(left, amount, actions);
      list.appendChild(row);
    });
  } catch (error) {
    list.replaceChildren();
    appendText(list, "div", error instanceof Error ? error.message : "Unable to load billing documents.", "alert alert-error");
  }
}

function installDomEnhancements() {
  if ((window as any).__khdDomOpsInstalled) return;
  (window as any).__khdDomOpsInstalled = true;
  const run = () => {
    enhanceSettingRows();
    enhanceDnsTools();
    enhanceUnknownSearchLabels();
    void enhanceBillingDocuments();
  };
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}

installOfficialFetchRoutes();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installDomEnhancements, { once: true });
else installDomEnhancements();
