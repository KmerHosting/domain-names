import { api, customerToolsApi, getSession } from "./api";

type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  label?: string;
};

type ButtonKind = "primary" | "secondary" | "tertiary" | "ghost" | "danger--tertiary";

function token() {
  return getSession() ? "session" : "";
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
  const heading = el("div", "card-heading khd-card-heading");
  const wrap = el("div");
  append(wrap, "h2", title);
  append(wrap, "p", text, "khd-card-description");
  heading.appendChild(wrap);
  return heading;
}

function inputField(
  name: string,
  labelText: string,
  placeholder: string,
  options: {
    required?: boolean;
    type?: string;
    helperText?: string;
    autocomplete?: string;
    inputMode?: string;
    pattern?: string;
    maxLength?: number;
  } = {},
) {
  const item = el("div", "cds--form-item khd-carbon-field");
  const id = `khd-field-${name.replace(/[^a-z0-9-]/gi, "-")}`;
  const label = el("label", "cds--label", labelText);
  label.htmlFor = id;
  const wrapper = el("div", "cds--text-input__field-wrapper");
  const node = el("input", "cds--text-input") as HTMLInputElement;
  node.id = id;
  node.name = name;
  node.type = options.type || "text";
  node.placeholder = placeholder;
  node.required = options.required ?? true;
  if (options.autocomplete) node.setAttribute("autocomplete", options.autocomplete);
  if (options.inputMode) node.inputMode = options.inputMode as HTMLInputElement["inputMode"];
  if (options.pattern) node.pattern = options.pattern;
  if (options.maxLength !== undefined) node.maxLength = options.maxLength;
  wrapper.appendChild(node);
  item.append(label, wrapper);
  if (options.helperText) append(item, "div", options.helperText, "cds--form__helper-text");
  return item;
}

function selectField(
  name: string,
  labelText: string,
  options: Array<[string, string]>,
) {
  const item = el("div", "cds--form-item cds--select khd-carbon-field");
  const id = `khd-select-${name.replace(/[^a-z0-9-]/gi, "-")}`;
  const label = el("label", "cds--label", labelText);
  label.htmlFor = id;
  const wrapper = el("div", "cds--select-input__wrapper");
  const select = el("select", "cds--select-input") as HTMLSelectElement;
  select.id = id;
  select.name = name;
  options.forEach(([value, text]) => {
    const option = el("option", undefined, text) as HTMLOptionElement;
    option.value = value;
    select.appendChild(option);
  });
  wrapper.appendChild(select);
  item.append(label, wrapper);
  return item;
}

function carbonButtonClass(kind: ButtonKind, size?: "sm") {
  return `cds--btn cds--btn--${kind}${size ? " cds--btn--sm" : ""} khd-carbon-button`;
}

function submitButton(label: string, kind: ButtonKind = "primary") {
  const button = el("button", carbonButtonClass(kind), label) as HTMLButtonElement;
  button.type = "submit";
  return button;
}

function notify(message: string, kind: "success" | "error" = "success") {
  let box = document.getElementById("khd-customer-tools-message");
  if (!box) {
    box = el("div");
    box.id = "khd-customer-tools-message";
    document.body.appendChild(box);
  }
  box.className = `khd-customer-tools-message ${kind}`;
  box.setAttribute("role", kind === "error" ? "alert" : "status");
  box.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  box.textContent = message;
  window.setTimeout(() => box?.remove(), 6500);
}

function button(
  label: string,
  action: () => Promise<void> | void,
  kind: ButtonKind = "primary",
  size?: "sm",
) {
  const b = el("button", carbonButtonClass(kind, size), label) as HTMLButtonElement;
  b.type = "button";
  b.addEventListener("click", async () => {
    const old = b.textContent || label;
    b.textContent = "Working…";
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
    try {
      await action();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Operation failed.", "error");
    } finally {
      b.textContent = old;
      b.disabled = false;
      b.removeAttribute("aria-busy");
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
  const modal = el("div", "cds--modal-container khd-modal-card");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const head = el("div", "khd-modal-head");
  const title = el("div");
  append(title, "h2", "Transfer code");
  append(title, "p", domainName, "khd-modal-domain");
  const close = button("×", () => back.remove(), "ghost", "sm");
  close.setAttribute("aria-label", "Close transfer code");
  head.append(title, close);
  append(modal, "p", warning, "khd-warning-text");
  append(modal, "pre", code, "cds--snippet khd-secret-code");
  const actions = el("div", "khd-modal-actions");
  actions.append(
    button("Copy code", async () => {
      await navigator.clipboard.writeText(code);
      notify("Transfer code copied.");
    }),
    button("Close", () => back.remove(), "secondary"),
  );
  modal.append(head, actions);
  back.appendChild(modal);
  back.addEventListener("click", (event) => {
    if (event.target === back) back.remove();
  });
  back.addEventListener("keydown", (event) => {
    if (event.key === "Escape") back.remove();
  });
  document.body.appendChild(back);
  close.focus();
}

function confirmAction(
  title: string,
  message: string,
  confirmLabel = "Continue",
  kind: ButtonKind = "primary",
): Promise<boolean> {
  return new Promise((resolve) => {
    const back = el("div", "khd-modal-backdrop");
    back.id = "khd-action-confirm-modal";
    const modal = el("div", "cds--modal-container khd-modal-card");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const head = el("div", "khd-modal-head");
    const titleWrap = el("div");
    append(titleWrap, "h2", title);
    const close = button("×", () => finish(false), "ghost", "sm");
    close.setAttribute("aria-label", "Close confirmation");
    head.append(titleWrap, close);
    append(modal, "p", message, "khd-modal-copy");
    const actions = el("div", "khd-modal-actions");

    const finish = (result: boolean) => {
      back.remove();
      resolve(result);
    };

    actions.append(
      button("Cancel", () => finish(false), "secondary"),
      button(confirmLabel, () => finish(true), kind),
    );
    modal.append(head, actions);
    back.appendChild(modal);
    back.addEventListener("click", (event) => {
      if (event.target === back) finish(false);
    });
    back.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
    });
    document.body.appendChild(back);
    close.focus();
  });
}

function installDomainCustomerTools() {
  const domainId = currentDomainId();
  if (!domainId || !token() || document.getElementById("khd-customer-domain-tools")) return;
  const content = document.querySelector(".dashboard-content");
  if (!content) return;

  const card = el("section", "carbon-dashboard-panel khd-customer-domain-tools");
  card.id = "khd-customer-domain-tools";
  card.appendChild(cardHeading("Domain tools", "Transfer, forwarding, restore and child nameserver tools for this domain."));

  const grid = el("div", "khd-customer-tools-grid");
  grid.append(
    button("Show transfer code", async () => {
      if (!(await confirmAction("Show transfer code", "The transfer code can start a transfer. Keep it private.", "Show code"))) return;
      const result = await customerToolsApi<{ domainName: string; transferCode: string; warning?: string }>(`/domains/${domainId}/transfer-code`, { method: "POST", body: { confirm: true } });
      showTransferCode(result.domainName, result.transferCode, result.warning || "Keep this code private.");
    }),
    button("Restore expired domain", async () => {
      if (!(await confirmAction("Restore expired domain", "Restore may be billable and only works for eligible expired domains.", "Restore", "primary"))) return;
      await customerToolsApi(`/domains/${domainId}/restore`, { method: "POST", body: { confirm: true } });
      notify("Restore request submitted.");
      window.setTimeout(() => window.location.reload(), 900);
    }, "secondary"),
  );
  card.appendChild(grid);

  const forwarding = el("div", "khd-subtool");
  append(forwarding, "h3", "Web forwarding");
  append(forwarding, "p", "Redirect this domain to another website.", "khd-subtool-description");
  const forwardingForm = el("form", "khd-customer-form carbon-form-stack") as HTMLFormElement;
  forwardingForm.append(
    inputField("redirectAddress", "Destination URL", "https://example.com", { type: "url", autocomplete: "url" }),
    selectField("forwardType", "Forwarding mode", [["Standard", "Standard redirect"], ["Frame", "Frame redirect"]]),
    submitButton("Save forwarding"),
  );
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
      if (!(await confirmAction("Remove web forwarding", "This removes the redirect for this domain.", "Remove", "danger--tertiary"))) return;
      await customerToolsApi(`/domains/${domainId}/forwarding`, { method: "DELETE" });
      notify("Forwarding removed.");
    }, "ghost", "sm"),
  );
  card.appendChild(forwarding);

  const glue = el("div", "khd-subtool");
  append(glue, "h3", "Child nameserver");
  append(glue, "p", "Create a host such as ns1 using an IP address. Use this only when you run your own nameserver.", "khd-subtool-description");
  const glueForm = el("form", "khd-customer-form carbon-form-stack") as HTMLFormElement;
  glueForm.append(
    inputField("hostName", "Host name", "ns1", { helperText: "Use a host under this domain." }),
    inputField("ipAddress", "IP address", "192.0.2.10", { type: "text", inputMode: "text" }),
    submitButton("Create child nameserver"),
  );
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

let contactVerificationLoading = false;

async function installContactVerification() {
  if (!isContactsRoute() || !token() || document.getElementById("khd-contact-verification") || contactVerificationLoading) return;
  const content = document.querySelector(".dashboard-content");
  if (!content) return;
  contactVerificationLoading = true;
  try {
    const contacts = (await api<{ contacts: Contact[] }>("/contacts")).contacts || [];
    if (document.getElementById("khd-contact-verification")) return;
    const card = el("section", "carbon-dashboard-panel khd-contact-verification");
    card.id = "khd-contact-verification";
    card.appendChild(cardHeading("Contact readiness", "Validate required fields before using a contact for registration or transfer."));
    const list = el("div", "khd-contact-verification-list");
    if (!contacts.length) append(list, "p", "No contact to verify.", "khd-muted");
    for (const contact of contacts) {
      const row = el("div", "carbon-contact-row khd-contact-verification-row");
      const label = el("div", "khd-contact-verification-copy");
      append(label, "strong", `${contact.first_name} ${contact.last_name}`);
      append(label, "span", `${contact.email} · ${contact.label || "Contact"}`);
      row.append(label, button("Validate contact", async () => {
        const result = await customerToolsApi<{ message?: string }>(`/contacts/${contact.id}/verification`, { method: "POST" });
        notify(result.message || `Contact ${contact.email} is ready.`);
      }, "secondary", "sm"));
      list.appendChild(row);
    }
    card.appendChild(list);
    content.appendChild(card);
  } catch {
    // The primary contacts page still remains usable when verification is unavailable.
  } finally {
    contactVerificationLoading = false;
  }
}

function improveFailedDnsRows() {
  if (!/\/dns$/i.test(window.location.pathname)) return;
  document.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
    if (!/Failed/i.test(row.textContent || "") || row.querySelector(".khd-dns-failed-note")) return;
    const cell = row.querySelector("td:nth-child(5)");
    if (cell) cell.appendChild(el("small", "khd-dns-failed-note", "Not applied. You can delete it or retry."));
  });
}

function run() {
  cleanupRouteBlocks();
  installDomainCustomerTools();
  void installContactVerification();
  improveFailedDnsRows();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
