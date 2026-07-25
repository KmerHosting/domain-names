import { getSession } from "./api";

const PROVIDER_API_URL =
  import.meta.env.VITE_DOMAIN_PROVIDER_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-provider";
const DOCS_API_URL =
  import.meta.env.VITE_DOMAIN_DOCUMENTS_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-documents";
const DOMAIN_API_URL =
  import.meta.env.VITE_DOMAIN_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-api";

type ProviderState = {
  role?: string;
  capabilities?: Array<Record<string, any>>;
  recentLogs?: Array<Record<string, any>>;
};

function token() {
  return getSession()?.token || "";
}

function authHeaders(json = true) {
  const h = new Headers();
  if (token()) h.set("Authorization", `Bearer ${token()}`);
  h.set("Accept", "application/json");
  if (json) h.set("Content-Type", "application/json");
  return h;
}

async function provider(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${PROVIDER_API_URL}${path}`, {
    method,
    headers: authHeaders(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(payload.message || payload.error || `Provider request failed (${res.status}).`));
  return payload;
}

async function domainApi(path: string) {
  const res = await fetch(`${DOMAIN_API_URL}${path}`, { headers: authHeaders(false) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(payload.message || payload.error || `Request failed (${res.status}).`));
  return payload;
}

async function downloadDocument(path: string, filename: string) {
  const res = await fetch(`${DOCS_API_URL}${path}`, { headers: authHeaders(false) });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(String(payload.message || payload.error || `Document download failed (${res.status}).`));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function notify(message: string, kind: "success" | "error" = "success") {
  let box = document.getElementById("khd-provider-message");
  if (!box) {
    box = document.createElement("div");
    box.id = "khd-provider-message";
    document.body.appendChild(box);
  }
  box.className = `khd-provider-message ${kind}`;
  box.textContent = message;
  setTimeout(() => box?.remove(), 6000);
}

function currentDomainId(): string | null {
  return window.location.pathname.match(/\/dashboard\/domains\/([0-9a-f-]+)/i)?.[1] || null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, action: () => Promise<void> | void, cls = "khd-provider-button") {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", async () => {
    const old = b.textContent || label;
    b.textContent = "Working…";
    (b as HTMLButtonElement).disabled = true;
    try {
      await action();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Operation failed.", "error");
    } finally {
      b.textContent = old;
      (b as HTMLButtonElement).disabled = false;
    }
  });
  return b;
}

function renderJson(target: HTMLElement, payload: unknown) {
  target.textContent = JSON.stringify(payload, null, 2).slice(0, 12000);
}

async function loadCapabilities(): Promise<ProviderState | null> {
  if (!token()) return null;
  try {
    return await provider("/capabilities");
  } catch {
    return null;
  }
}

function installAdminProviderPanel(state: ProviderState) {
  if (document.getElementById("khd-provider-launcher")) return;
  const launcher = el("button", "khd-provider-launcher", "Provider API");
  launcher.id = "khd-provider-launcher";
  document.body.appendChild(launcher);

  launcher.addEventListener("click", () => {
    document.getElementById("khd-provider-panel")?.remove();
    const panel = el("aside", "khd-provider-panel");
    panel.id = "khd-provider-panel";
    const header = el("div", "khd-provider-panel-header");
    header.innerHTML = `<div><small>DomainNameAPI</small><h2>Provider operations</h2><p>${state.role === "admin" ? "Admin access enabled" : "Customer-safe actions only"}</p></div>`;
    header.appendChild(button("×", async () => panel.remove(), "khd-provider-close"));
    panel.appendChild(header);

    const output = el("pre", "khd-provider-output", "Select an operation.");
    const adminGrid = el("div", "khd-provider-grid");
    if (state.role === "admin") {
      adminGrid.append(
        button("Provider balance", async () => renderJson(output, await provider("/admin/account"))),
        button("Provider transactions", async () => renderJson(output, await provider("/admin/transactions?MaxResultCount=25"))),
        button("Provider domains", async () => renderJson(output, await provider("/admin/provider-domains?MaxResultCount=25"))),
        button("Products", async () => renderJson(output, await provider("/admin/products?MaxResultCount=25"))),
        button("TLD list", async () => renderJson(output, await provider("/admin/products/tlds?MaxResultCount=50&Currency=USD"))),
        button("Sync TLD costs", async () => renderJson(output, await provider("/admin/products/tlds/sync?max=250&currency=USD", "POST"))),
        button("Product .com info", async () => renderJson(output, await provider("/admin/products/info?ProductName=com&OrderType=1&Period=1"))),
      );
    }
    adminGrid.append(
      button("Capability matrix", async () => renderJson(output, await provider("/capabilities"))),
      button("Transfer check", async () => {
        const domainName = prompt("Domain name to check for transfer:") || "";
        const authCode = prompt("EPP/Auth code:") || "";
        if (!domainName || !authCode) return;
        renderJson(output, await provider("/transfers/check", "POST", { domainName, authCode }));
      }),
    );
    panel.append(adminGrid, output);
    document.body.appendChild(panel);
  });
}

async function installDocumentsPanel() {
  if (!window.location.pathname.includes("/dashboard/orders")) return;
  if (document.getElementById("khd-documents-panel")) return;
  if (!token()) return;
  let invoices: Array<Record<string, any>> = [];
  try {
    const payload = await fetch(`${DOCS_API_URL}/invoices`, { headers: authHeaders(false) }).then((r) => r.json());
    invoices = payload.invoices || [];
  } catch {
    return;
  }
  const card = el("section", "card khd-documents-card");
  card.id = "khd-documents-panel";
  card.innerHTML = `<div class="card-heading"><div><h2>Invoices & receipts</h2><p>Download server-generated PDF documents powered by PDFKit.</p></div></div>`;
  if (!invoices.length) {
    card.appendChild(el("p", "khd-provider-muted", "No invoice is available yet."));
  } else {
    const list = el("div", "khd-doc-list");
    invoices.forEach((invoice) => {
      const row = el("div", "khd-doc-row");
      const label = el("div");
      label.innerHTML = `<strong>${invoice.invoice_number || "Invoice"}</strong><small>${invoice.domain_name || invoice.domain_orders?.domain_name || "Domain order"} · ${invoice.status || "paid"}</small>`;
      const actions = el("div", "khd-doc-actions");
      actions.append(
        button("Invoice PDF", async () => downloadDocument(`/invoices/${invoice.id}.pdf`, `${invoice.invoice_number || "invoice"}.pdf`), "khd-provider-button secondary"),
        button("Receipt PDF", async () => downloadDocument(`/orders/${invoice.order_id}/receipt.pdf`, `receipt-${invoice.invoice_number || invoice.order_id}.pdf`), "khd-provider-button"),
      );
      row.append(label, actions);
      list.appendChild(row);
    });
    card.appendChild(list);
  }
  const content = document.querySelector(".dashboard-content");
  const firstCard = document.querySelector(".dashboard-content .card");
  if (content) content.insertBefore(card, firstCard || null);
}

async function installDomainAdvancedTools() {
  const domainId = currentDomainId();
  if (!domainId || document.getElementById("khd-domain-advanced")) return;
  if (!token()) return;
  const card = el("section", "card khd-domain-advanced");
  card.id = "khd-domain-advanced";
  card.innerHTML = `<div class="card-heading"><div><h2>Advanced provider tools</h2><p>Forwarding, glue hosts, transfer status, restore and registrar pre-checks.</p></div></div>`;
  const output = el("pre", "khd-provider-output", "Provider responses will appear here.");
  const grid = el("div", "khd-provider-grid");
  grid.append(
    button("Renew check", async () => renderJson(output, await provider(`/domains/${domainId}/renew-check`, "POST", { years: 1 }))),
    button("Transfer query", async () => renderJson(output, await provider(`/domains/${domainId}/transfer-query`, "POST"))),
    button("Get forwarding", async () => renderJson(output, await provider(`/domains/${domainId}/forwards`))),
    button("Create forwarding", async () => {
      const url = prompt("Redirect URL, including https://") || "";
      if (!url) return;
      renderJson(output, await provider(`/domains/${domainId}/forwards`, "POST", { redirectAddress: url, forwardType: "Permanent" }));
    }),
    button("Delete forwarding", async () => renderJson(output, await provider(`/domains/${domainId}/forwards`, "DELETE"))),
    button("Update contacts", async () => renderJson(output, await provider(`/domains/${domainId}/contacts`, "PUT", {}))),
    button("Add glue host", async () => {
      const hostName = prompt("Host name, for example ns1") || "";
      const ip = prompt("IP address, IPv4 or IPv6") || "";
      if (!hostName || !ip) return;
      renderJson(output, await provider(`/domains/${domainId}/glue-hosts`, "POST", { hostName, ipAddresses: [ip] }));
    }),
    button("Restore domain", async () => {
      if (!confirm("Restore can be billable. Continue only if this domain is expired/redemption.")) return;
      renderJson(output, await provider(`/domains/${domainId}/restore`, "POST", { confirm: true }));
    }, "khd-provider-button danger"),
  );
  card.append(grid, output);
  document.querySelector(".dashboard-content")?.appendChild(card);
}

async function installContactProviderTools() {
  if (!window.location.pathname.includes("/dashboard/contacts")) return;
  if (document.getElementById("khd-contact-provider-tools")) return;
  if (!token()) return;
  let contacts: Array<Record<string, any>> = [];
  try {
    contacts = (await domainApi("/contacts")).contacts || [];
  } catch {
    return;
  }
  const card = el("section", "card khd-contact-provider-tools");
  card.id = "khd-contact-provider-tools";
  card.innerHTML = `<div class="card-heading"><div><h2>Provider contact handles</h2><p>Create, sync and verify DomainNameAPI contact handles.</p></div></div>`;
  const output = el("pre", "khd-provider-output", "Contact provider responses will appear here.");
  const list = el("div", "khd-doc-list");
  contacts.forEach((contact) => {
    const row = el("div", "khd-doc-row");
    const label = el("div");
    label.innerHTML = `<strong>${contact.first_name} ${contact.last_name}</strong><small>${contact.email} · ${contact.registrar_handle || "No provider handle"}</small>`;
    const actions = el("div", "khd-doc-actions");
    actions.append(
      button("Create handle", async () => renderJson(output, await provider(`/contacts/${contact.id}/provider`, "POST")), "khd-provider-button"),
      button("Read", async () => renderJson(output, await provider(`/contacts/${contact.id}/provider`)), "khd-provider-button secondary"),
      button("Update", async () => renderJson(output, await provider(`/contacts/${contact.id}/provider`, "PUT")), "khd-provider-button secondary"),
      button("Resend verification", async () => renderJson(output, await provider(`/contacts/${contact.id}/verification`, "POST")), "khd-provider-button secondary"),
    );
    row.append(label, actions);
    list.appendChild(row);
  });
  card.append(list, output);
  document.querySelector(".dashboard-content")?.appendChild(card);
}

function injectProviderStyles() {
  if (document.getElementById("khd-provider-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-provider-styles";
  style.textContent = `
    .khd-provider-launcher{position:fixed;right:18px;bottom:78px;z-index:62;border:0;border-radius:999px;background:#0f172a;color:#fff;padding:11px 16px;font-weight:800;box-shadow:0 16px 38px rgba(15,23,42,.28);cursor:pointer}.khd-provider-panel{position:fixed;right:0;top:0;bottom:0;z-index:100;width:min(620px,100vw);overflow:auto;background:#fff;color:#172033;padding:22px;box-shadow:-20px 0 50px rgba(15,23,42,.22)}.khd-provider-panel-header{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid #e5eaf2;padding-bottom:16px;margin-bottom:16px}.khd-provider-panel-header small{color:#667085;text-transform:uppercase;font-weight:800}.khd-provider-panel-header h2{margin:4px 0}.khd-provider-close{border:0;border-radius:10px;background:#f1f5f9;width:36px;height:36px;font-size:22px;cursor:pointer}.khd-provider-grid{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.khd-provider-button{border:0;border-radius:10px;background:#155eef;color:#fff;padding:9px 12px;font-weight:800;cursor:pointer}.khd-provider-button.secondary{background:#eef4ff;color:#155eef}.khd-provider-button.danger{background:#d92d20;color:white}.khd-provider-button:disabled{opacity:.55;cursor:not-allowed}.khd-provider-output{max-height:360px;overflow:auto;background:#0f172a;color:#dbeafe;border-radius:14px;padding:14px;font-size:12px;white-space:pre-wrap}.khd-provider-message{position:fixed;right:18px;top:18px;z-index:140;border-radius:12px;padding:12px 14px;background:#ecfdf3;color:#027a48;font-weight:800;box-shadow:0 18px 42px rgba(15,23,42,.18)}.khd-provider-message.error{background:#fff1f0;color:#b42318}.khd-doc-list{display:grid;gap:10px}.khd-doc-row{border:1px solid #e5eaf2;border-radius:14px;padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center}.khd-doc-row small{display:block;color:#667085;margin-top:3px}.khd-doc-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.khd-provider-muted{color:#667085}.khd-domain-advanced,.khd-contact-provider-tools,.khd-documents-card{margin-top:20px}@media(max-width:760px){.khd-doc-row{display:grid}.khd-doc-actions{justify-content:flex-start}.khd-provider-launcher{right:12px;bottom:70px}}
  `;
  document.head.appendChild(style);
}

async function runProviderEnhancements() {
  if (!(window as any).__khdProviderEnhancementsBooted) {
    (window as any).__khdProviderEnhancementsBooted = true;
    injectProviderStyles();
    const state = await loadCapabilities();
    if (state) installAdminProviderPanel(state);
  }
  await installDocumentsPanel();
  await installDomainAdvancedTools();
  await installContactProviderTools();
}

function boot() {
  void runProviderEnhancements();
  const observer = new MutationObserver(() => void runProviderEnhancements());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
