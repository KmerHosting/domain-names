import { getSession } from "./api";

const PROVIDER_API_URL =
  import.meta.env.VITE_DOMAIN_PROVIDER_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-provider";
const DOMAIN_API_URL =
  import.meta.env.VITE_DOMAIN_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-api";

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

function removeProviderLauncher() {
  document.getElementById("khd-provider-launcher")?.remove();
  document.getElementById("khd-provider-panel")?.remove();
}

function cleanBillingPanelsOutsideOrders() {
  const isOrdersPage = window.location.pathname === "/dashboard/orders";
  document.querySelectorAll("#khd-documents-panel").forEach((node) => node.remove());

  const panels = Array.from(document.querySelectorAll<HTMLElement>("section.card, .card"))
    .filter((node) => /Invoices & receipts/i.test(node.textContent || ""));

  if (!isOrdersPage) {
    panels.forEach((node) => node.remove());
    return;
  }

  const canonical = document.getElementById("khd-billing-documents");
  for (const panel of panels) {
    if (canonical && panel !== canonical && panel.id !== "khd-billing-documents") panel.remove();
  }
}

async function installDomainAdvancedTools() {
  const domainId = currentDomainId();
  if (!domainId || document.getElementById("khd-domain-advanced")) return;
  if (!token()) return;

  const card = el("section", "card khd-domain-advanced");
  card.id = "khd-domain-advanced";
  card.innerHTML = `<div class="card-heading"><div><h2>Advanced domain tools</h2><p>Forwarding, glue hosts, transfer status, restore and registrar pre-checks.</p></div></div>`;
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
    .khd-provider-grid{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.khd-provider-button{border:0;border-radius:10px;background:#155eef;color:#fff;padding:9px 12px;font-weight:800;cursor:pointer}.khd-provider-button.secondary{background:#eef4ff;color:#155eef}.khd-provider-button.danger{background:#d92d20;color:white}.khd-provider-button:disabled{opacity:.55;cursor:not-allowed}.khd-provider-output{max-height:360px;overflow:auto;background:#0f172a;color:#dbeafe;border-radius:14px;padding:14px;font-size:12px;white-space:pre-wrap}.khd-provider-message{position:fixed;right:18px;top:18px;z-index:140;border-radius:12px;padding:12px 14px;background:#ecfdf3;color:#027a48;font-weight:800;box-shadow:0 18px 42px rgba(15,23,42,.18)}.khd-provider-message.error{background:#fff1f0;color:#b42318}.khd-doc-list{display:grid;gap:10px}.khd-doc-row{border:1px solid #e5eaf2;border-radius:14px;padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center}.khd-doc-row small{display:block;color:#667085;margin-top:3px}.khd-doc-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.khd-provider-muted{color:#667085}.khd-domain-advanced,.khd-contact-provider-tools{margin-top:20px}@media(max-width:760px){.khd-doc-row{display:grid}.khd-doc-actions{justify-content:flex-start}}
  `;
  document.head.appendChild(style);
}

async function runProviderEnhancements() {
  injectProviderStyles();
  removeProviderLauncher();
  cleanBillingPanelsOutsideOrders();
  document.getElementById("khd-domain-advanced")?.remove();
  document.getElementById("khd-contact-provider-tools")?.remove();
}

function boot() {
  void runProviderEnhancements();
  const observer = new MutationObserver(() => void runProviderEnhancements());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
