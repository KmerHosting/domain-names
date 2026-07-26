import { api, customerToolsApi, getSession } from "./api";

type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  label?: string;
};

function token() {
  return getSession()?.token || "";
}

function currentDomainId() {
  return window.location.pathname.match(/\/dashboard\/domains\/([0-9a-f-]+)/i)?.[1] || "";
}

function isContactsRoute() {
  return window.location.pathname === "/dashboard/contacts";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function append<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text: string, cls?: string) {
  const node = el(tag, cls, text);
  parent.appendChild(node);
  return node;
}

function cardHeading(title: string, text: string) {
  const heading = el("div", "card-heading");
  const wrap = el("div");
  append(wrap, "h2", title);
  append(wrap, "p", text);
  heading.appendChild(wrap);
  return heading;
}

function input(name: string, placeholder: string, required = true) {
  const node = el("input") as HTMLInputElement;
  node.name = name;
  node.placeholder = placeholder;
  node.required = required;
  return node;
}

function notify(message: string, kind: "success" | "error" = "success") {
  let box = document.getElementById("khd-customer-tools-message");
  if (!box) {
    box = el("div");
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
    b.disabled = true;
    try {
      await action();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Operation failed.", "error");
    } finally {
      b.textContent = old;
      b.disabled = false;
    }
  });
  return b;
}

function cleanupRouteBlocks() {
  const onDomain = Boolean(currentDomainId());
  if (!onDomain) {
    document.getElementById("khd-customer-domain-tools")?.remove();
    document.getElementById("khd-transfer-code-modal")?.remove();
  }
  if (!isContactsRoute()) document.getElementById("khd-contact-verification")?.remove();

  for (const selector of ["#khd-customer-domain-tools", "#khd-contact-verification"]) {
    const nodes = Array.from(document.querySelectorAll(selector));
    nodes.slice(1).forEach((node) => node.remove());
  }
}

function showTransferCode(domainName: string, code: string, warning: string) {
  document.getElementById("khd-transfer-code-modal")?.remove();
  const back = el("div", "khd-modal-backdrop");
  back.id = "khd-transfer-code-modal";
  const modal = el("div", "khd-modal-card");
  const head = el("div", "khd-modal-head");
  const title = el("div");
  append(title, "h2", "Transfer code");
  append(title, "p", domainName);
  const close = el("button", undefined, "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => back.remove());
  head.append(title, close);
  append(modal, "p", warning, "khd-warning-text");
  append(modal, "pre", code, "khd-secret-code");
  const actions = el("div", "khd-modal-actions");
  actions.append(
    button("Copy code", async () => { await navigator.clipboard.writeText(code); notify("Transfer code copied."); }),
    button("Close", async () => back.remove(), "khd-customer-action secondary"),
  );
  modal.append(head, actions);
  back.appendChild(modal);
  document.body.appendChild(back);
}

function installDomainCustomerTools() {
  const domainId = currentDomainId();
  if (!domainId || !token() || document.getElementById("khd-customer-domain-tools")) return;
  const content = document.querySelector(".dashboard-content");
  if (!content) return;

  const card = el("section", "card khd-customer-domain-tools");
  card.id = "khd-customer-domain-tools";
  card.appendChild(cardHeading("Domain tools", "Transfer, forwarding, restore and child nameserver tools for this domain."));

  const grid = el("div", "khd-customer-tools-grid");
  grid.append(
    button("Show transfer code", async () => {
      if (!confirm("Show the transfer code for this domain? Keep it private.")) return;
      const result = await customerToolsApi<{ domainName: string; transferCode: string; warning?: string }>(`/domains/${domainId}/transfer-code`, { method: "POST", body: { confirm: true } });
      showTransferCode(result.domainName, result.transferCode, result.warning || "Keep this code private.");
    }),
    button("Restore expired domain", async () => {
      if (!confirm("Restore may be billable and only works for eligible expired domains. Continue?")) return;
      await customerToolsApi(`/domains/${domainId}/restore`, { method: "POST", body: { confirm: true } });
      notify("Restore request submitted.");
      window.setTimeout(() => window.location.reload(), 900);
    }, "khd-customer-action secondary"),
  );
  card.appendChild(grid);

  const forwarding = el("div", "khd-subtool");
  append(forwarding, "h3", "Web forwarding");
  append(forwarding, "p", "Redirect this domain to another website.");
  const forwardingForm = el("form", "khd-customer-form") as HTMLFormElement;
  forwardingForm.append(input("redirectAddress", "https://example.com"));
  const select = el("select") as HTMLSelectElement;
  select.name = "forwardType";
  for (const [value, label] of [["Permanent", "Permanent redirect"], ["Temporary", "Temporary redirect"]]) {
    const option = el("option", undefined, label) as HTMLOptionElement;
    option.value = value;
    select.appendChild(option);
  }
  forwardingForm.append(select, el("button", undefined, "Save forwarding"));
  forwardingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await customerToolsApi(`/domains/${domainId}/forwarding`, { method: "PUT", body: Object.fromEntries(new FormData(forwardingForm)) });
      notify("Forwarding updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Forwarding failed.", "error");
    }
  });
  forwarding.append(
    forwardingForm,
    button("Remove forwarding", async () => {
      if (!confirm("Remove web forwarding for this domain?")) return;
      await customerToolsApi(`/domains/${domainId}/forwarding`, { method: "DELETE" });
      notify("Forwarding removed.");
    }, "khd-link-button"),
  );
  card.appendChild(forwarding);

  const glue = el("div", "khd-subtool");
  append(glue, "h3", "Child nameserver");
  append(glue, "p", "Create a host such as ns1 using an IP address. Use this only when you run your own nameserver.");
  const glueForm = el("form", "khd-customer-form") as HTMLFormElement;
  glueForm.append(input("hostName", "ns1"), input("ipAddress", "192.0.2.10"), el("button", undefined, "Create child nameserver"));
  glueForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(glueForm));
    try {
      await customerToolsApi(`/domains/${domainId}/glue-hosts`, { method: "POST", body: { hostName: raw.hostName, ipAddress: raw.ipAddress } });
      notify("Child nameserver submitted.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Child nameserver failed.", "error");
    }
  });
  glue.appendChild(glueForm);
  card.appendChild(glue);
  content.appendChild(card);
}

async function installContactVerification() {
  if (!isContactsRoute() || !token() || document.getElementById("khd-contact-verification")) return;
  const content = document.querySelector(".dashboard-content");
  if (!content) return;
  let contacts: Contact[] = [];
  try {
    contacts = (await api<{ contacts: Contact[] }>("/contacts")).contacts || [];
  } catch {
    return;
  }
  const card = el("section", "card khd-contact-verification");
  card.id = "khd-contact-verification";
  card.appendChild(cardHeading("Contact verification", "Send or resend verification for saved registrant contacts."));
  const list = el("div", "khd-contact-verification-list");
  if (!contacts.length) append(list, "p", "No contact to verify.", "khd-muted");
  for (const contact of contacts) {
    const row = el("div", "khd-contact-verification-row");
    const label = el("div");
    append(label, "strong", `${contact.first_name} ${contact.last_name}`);
    append(label, "span", `${contact.email} · ${contact.label || "Contact"}`);
    row.append(label, button("Send verification", async () => {
      await customerToolsApi(`/contacts/${contact.id}/verification`, { method: "POST" });
      notify(`Verification sent to ${contact.email}.`);
    }, "khd-customer-action secondary"));
    list.appendChild(row);
  }
  card.appendChild(list);
  content.appendChild(card);
}

function improveFailedDnsRows() {
  if (!currentDomainId()) return;
  document.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
    if (!/Failed/i.test(row.textContent || "") || row.querySelector(".khd-dns-failed-note")) return;
    const cell = row.querySelector("td:nth-child(5)");
    if (cell) cell.appendChild(el("small", "khd-dns-failed-note", "Not applied. You can delete it or retry."));
  });
}

function injectStyles() {
  if (document.getElementById("khd-customer-tools-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-customer-tools-styles";
  style.textContent = `.khd-customer-domain-tools,.khd-contact-verification{margin-top:18px}.khd-customer-tools-grid{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 16px}.khd-customer-action{border:0;border-radius:10px;background:#155eef;color:white;font-weight:800;padding:9px 13px;cursor:pointer}.khd-customer-action.secondary{background:#eef4ff;color:#155eef}.khd-customer-action:disabled{opacity:.55;cursor:not-allowed}.khd-subtool{border-top:1px solid #edf1f7;padding-top:14px;margin-top:14px}.khd-subtool h3{margin:0 0 4px}.khd-subtool p,.khd-muted{color:#667085;font-size:13px;margin:0 0 10px}.khd-customer-form{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:end}.khd-customer-form input,.khd-customer-form select{border:1px solid #d8e0eb;border-radius:10px;padding:10px 12px;font:inherit;background:#fff;color:#172033}.khd-customer-form button,.khd-link-button{border:0;border-radius:10px;background:#155eef;color:#fff;font-weight:800;padding:10px 12px;cursor:pointer}.khd-link-button{background:transparent;color:#155eef;padding:8px 0}.khd-contact-verification-list{display:grid;gap:10px}.khd-contact-verification-row{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #edf1f7;border-radius:14px;padding:12px}.khd-contact-verification-row span{display:block;color:#667085;font-size:13px;margin-top:3px}.khd-dns-failed-note{display:block;color:#b42318;margin-top:4px;font-size:11px}.khd-customer-tools-message{position:fixed;right:18px;top:18px;z-index:160;border-radius:12px;padding:12px 14px;background:#ecfdf3;color:#027a48;font-weight:800;box-shadow:0 18px 42px rgba(15,23,42,.18)}.khd-customer-tools-message.error{background:#fff1f0;color:#b42318}.khd-modal-backdrop{position:fixed;inset:0;z-index:150;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:18px}.khd-modal-card{width:min(520px,100%);background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(15,23,42,.25)}.khd-modal-head{display:flex;justify-content:space-between;gap:16px}.khd-modal-head h2{margin:0}.khd-modal-head p{margin:4px 0 0;color:#667085}.khd-modal-head button{border:0;border-radius:10px;width:36px;height:36px;background:#eef4ff;color:#155eef;font-size:24px}.khd-warning-text{color:#b42318}.khd-secret-code{background:#0f172a;color:#dbeafe;border-radius:14px;padding:14px;white-space:pre-wrap;word-break:break-all}.khd-modal-actions{display:flex;gap:10px;justify-content:flex-end}@media(max-width:760px){.khd-customer-form{grid-template-columns:1fr}.khd-contact-verification-row{display:grid}.khd-modal-actions{justify-content:flex-start}}`;
  document.head.appendChild(style);
}

function run() {
  cleanupRouteBlocks();
  injectStyles();
  installDomainCustomerTools();
  void installContactVerification();
  improveFailedDnsRows();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
