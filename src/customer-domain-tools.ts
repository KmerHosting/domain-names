import { api, getSession } from "./api";

const TOOLS_API_URL =
  import.meta.env.VITE_DOMAIN_CUSTOMER_TOOLS_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-customer-tools";
const DOMAIN_API_URL =
  import.meta.env.VITE_DOMAIN_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-api";

type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  label?: string;
  registrar_handle?: string | null;
};

function token() {
  return getSession()?.token || "";
}

function headers(json = true) {
  const h = new Headers();
  h.set("Accept", "application/json");
  if (json) h.set("Content-Type", "application/json");
  if (token()) h.set("Authorization", `Bearer ${token()}`);
  return h;
}

async function tool(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${TOOLS_API_URL}${path}`, {
    method,
    headers: headers(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(payload.message || payload.error || `Request failed (${res.status}).`));
  return payload;
}

async function domainApi(path: string) {
  const res = await fetch(`${DOMAIN_API_URL}${path}`, { headers: headers(false) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(payload.message || payload.error || `Request failed (${res.status}).`));
  return payload;
}

function currentDomainId() {
  return window.location.pathname.match(/\/dashboard\/domains\/([0-9a-f-]+)/i)?.[1] || "";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notify(message: string, kind: "success" | "error" = "success") {
  let box = document.getElementById("khd-customer-tools-message");
  if (!box) {
    box = document.createElement("div");
    box.id = "khd-customer-tools-message";
    document.body.appendChild(box);
  }
  box.className = `khd-customer-tools-message ${kind}`;
  box.textContent = message;
  window.setTimeout(() => box?.remove(), 6500);
}

function button(label: string, action: () => Promise<void> | void, cls = "khd-customer-action") {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", async () => {
    const old = b.textContent || label;
    b.textContent = "Working…";
    (b as HTMLButtonElement).disabled = true;
    try { await action(); }
    catch (error) { notify(error instanceof Error ? error.message : "Operation failed.", "error"); }
    finally { b.textContent = old; (b as HTMLButtonElement).disabled = false; }
  });
  return b;
}

function showTransferCode(domainName: string, code: string, warning: string) {
  document.getElementById("khd-transfer-code-modal")?.remove();
  const back = el("div", "khd-modal-backdrop");
  back.id = "khd-transfer-code-modal";
  back.innerHTML = `<div class="khd-modal-card"><div class="khd-modal-head"><div><h2>Transfer code</h2><p>${domainName}</p></div><button type="button" aria-label="Close">×</button></div><p class="khd-warning-text"></p><pre class="khd-secret-code"></pre><div class="khd-modal-actions"></div></div>`;
  back.querySelector(".khd-warning-text")!.textContent = warning;
  back.querySelector(".khd-secret-code")!.textContent = code;
  back.querySelector("button")!.addEventListener("click", () => back.remove());
  const actions = back.querySelector(".khd-modal-actions")!;
  actions.append(
    button("Copy code", async () => { await navigator.clipboard.writeText(code); notify("Transfer code copied."); }),
    button("Close", async () => back.remove(), "khd-customer-action secondary"),
  );
  document.body.appendChild(back);
}

function installDomainCustomerTools() {
  const domainId = currentDomainId();
  if (!domainId || !token()) return;
  if (document.getElementById("khd-customer-domain-tools")) return;
  const content = document.querySelector(".dashboard-content");
  if (!content) return;

  const card = el("section", "card khd-customer-domain-tools");
  card.id = "khd-customer-domain-tools";
  card.innerHTML = `<div class="card-heading"><div><h2>Domain tools</h2><p>Transfer, forwarding, restore and child nameserver tools for this domain.</p></div></div>`;

  const grid = el("div", "khd-customer-tools-grid");
  grid.append(
    button("Show transfer code", async () => {
      if (!confirm("Show the transfer code for this domain? Keep it private.")) return;
      const result = await tool(`/domains/${domainId}/transfer-code`, "POST", { confirm: true });
      showTransferCode(result.domainName, result.transferCode, result.warning || "Keep this code private.");
    }),
    button("Restore expired domain", async () => {
      if (!confirm("Restore may be billable and only works for eligible expired domains. Continue?")) return;
      await tool(`/domains/${domainId}/restore`, "POST", { confirm: true });
      notify("Restore request submitted.");
      window.setTimeout(() => window.location.reload(), 900);
    }, "khd-customer-action secondary"),
  );
  card.appendChild(grid);

  const forwarding = el("div", "khd-subtool");
  forwarding.innerHTML = `<h3>Web forwarding</h3><p>Redirect this domain to another website.</p><form class="khd-customer-form"><input name="redirectAddress" placeholder="https://example.com" required /><select name="forwardType"><option value="Permanent">Permanent redirect</option><option value="Temporary">Temporary redirect</option></select><button>Save forwarding</button></form><button type="button" class="khd-link-button">Remove forwarding</button>`;
  forwarding.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement));
    try { await tool(`/domains/${domainId}/forwarding`, "PUT", raw); notify("Forwarding updated."); }
    catch (error) { notify(error instanceof Error ? error.message : "Forwarding failed.", "error"); }
  });
  forwarding.querySelector(".khd-link-button")!.addEventListener("click", async () => {
    if (!confirm("Remove web forwarding for this domain?")) return;
    try { await tool(`/domains/${domainId}/forwarding`, "DELETE"); notify("Forwarding removed."); }
    catch (error) { notify(error instanceof Error ? error.message : "Forwarding removal failed.", "error"); }
  });
  card.appendChild(forwarding);

  const glue = el("div", "khd-subtool");
  glue.innerHTML = `<h3>Child nameserver</h3><p>Create a host such as ns1 using an IP address. Use this only when you run your own nameserver.</p><form class="khd-customer-form"><input name="hostName" placeholder="ns1" required /><input name="ipAddress" placeholder="192.0.2.10" required /><button>Create child nameserver</button></form>`;
  glue.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement));
    try { await tool(`/domains/${domainId}/glue-hosts`, "POST", { hostName: raw.hostName, ipAddress: raw.ipAddress }); notify("Child nameserver submitted."); }
    catch (error) { notify(error instanceof Error ? error.message : "Child nameserver failed.", "error"); }
  });
  card.appendChild(glue);

  content.appendChild(card);
}

async function installContactVerification() {
  if (!window.location.pathname.includes("/dashboard/contacts") || !token()) return;
  if (document.getElementById("khd-contact-verification")) return;
  const content = document.querySelector(".dashboard-content");
  if (!content) return;
  let contacts: Contact[] = [];
  try { contacts = (await domainApi("/contacts")).contacts || []; }
  catch { return; }
  const card = el("section", "card khd-contact-verification");
  card.id = "khd-contact-verification";
  card.innerHTML = `<div class="card-heading"><div><h2>Contact verification</h2><p>Send or resend verification for saved registrant contacts.</p></div></div>`;
  const list = el("div", "khd-contact-verification-list");
  if (!contacts.length) list.innerHTML = `<p class="khd-muted">No contact to verify.</p>`;
  for (const contact of contacts) {
    const row = el("div", "khd-contact-verification-row");
    const label = el("div");
    label.innerHTML = `<strong>${contact.first_name} ${contact.last_name}</strong><span>${contact.email} · ${contact.label || "Contact"}</span>`;
    row.append(label, button("Send verification", async () => {
      await tool(`/contacts/${contact.id}/verification`, "POST");
      notify(`Verification sent to ${contact.email}.`);
    }, "khd-customer-action secondary"));
    list.appendChild(row);
  }
  card.appendChild(list);
  content.appendChild(card);
}

function renameDnsButtons() {
  document.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    if (b.textContent?.trim() === "Apply pending DNS") b.textContent = "Retry DNS changes";
  });
}

function improveFailedDnsRows() {
  document.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
    if (!/Failed/i.test(row.textContent || "")) return;
    if (row.querySelector(".khd-dns-failed-note")) return;
    const cell = row.querySelector("td:nth-child(5)");
    if (!cell) return;
    const note = el("small", "khd-dns-failed-note", "Not applied. You can delete it or retry.");
    cell.appendChild(note);
  });
}

function injectStyles() {
  if (document.getElementById("khd-customer-tools-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-customer-tools-styles";
  style.textContent = `
    .khd-customer-domain-tools,.khd-contact-verification{margin-top:18px}.khd-customer-tools-grid{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 16px}.khd-customer-action{border:0;border-radius:10px;background:#155eef;color:white;font-weight:800;padding:9px 13px;cursor:pointer}.khd-customer-action.secondary{background:#eef4ff;color:#155eef}.khd-customer-action:disabled{opacity:.55;cursor:not-allowed}.khd-subtool{border-top:1px solid #edf1f7;padding-top:14px;margin-top:14px}.khd-subtool h3{margin:0 0 4px}.khd-subtool p,.khd-muted{color:#667085;font-size:13px;margin:0 0 10px}.khd-customer-form{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:end}.khd-customer-form input,.khd-customer-form select{border:1px solid #d8e0eb;border-radius:10px;padding:10px 12px;font:inherit;background:#fff;color:#172033}.khd-customer-form button,.khd-link-button{border:0;border-radius:10px;background:#155eef;color:#fff;font-weight:800;padding:10px 12px;cursor:pointer}.khd-link-button{background:transparent;color:#155eef;padding:8px 0}.khd-contact-verification-list{display:grid;gap:10px}.khd-contact-verification-row{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #edf1f7;border-radius:14px;padding:12px}.khd-contact-verification-row span{display:block;color:#667085;font-size:13px;margin-top:3px}.khd-dns-failed-note{display:block;color:#b42318;margin-top:4px;font-size:11px}.khd-customer-tools-message{position:fixed;right:18px;top:18px;z-index:160;border-radius:12px;padding:12px 14px;background:#ecfdf3;color:#027a48;font-weight:800;box-shadow:0 18px 42px rgba(15,23,42,.18)}.khd-customer-tools-message.error{background:#fff1f0;color:#b42318}.khd-modal-backdrop{position:fixed;inset:0;z-index:150;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:18px}.khd-modal-card{width:min(520px,100%);background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(15,23,42,.25)}.khd-modal-head{display:flex;justify-content:space-between;gap:16px}.khd-modal-head h2{margin:0}.khd-modal-head p{margin:4px 0 0;color:#667085}.khd-modal-head button{border:0;border-radius:10px;width:36px;height:36px;background:#eef4ff;color:#155eef;font-size:24px}.khd-warning-text{color:#b42318}.khd-secret-code{background:#0f172a;color:#dbeafe;border-radius:14px;padding:14px;white-space:pre-wrap;word-break:break-all}.khd-modal-actions{display:flex;gap:10px;justify-content:flex-end}@media(max-width:760px){.khd-customer-form{grid-template-columns:1fr}.khd-contact-verification-row{display:grid}.khd-modal-actions{justify-content:flex-start}}
  `;
  document.head.appendChild(style);
}

function run() {
  injectStyles();
  installDomainCustomerTools();
  void installContactVerification();
  renameDnsButtons();
  improveFailedDnsRows();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
