import { adminApi, formatDate, getSession } from "./api";

const TLD_PROVIDER_SYNC_API_URL =
  import.meta.env.VITE_DOMAIN_TLD_PROVIDER_SYNC_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-tld-provider-sync";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function append<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text: string, cls?: string) {
  const node = el(tag, cls, text);
  parent.appendChild(node);
  return node;
}

function notify(message: string, kind: "success" | "error" = "success") {
  let box = document.getElementById("khd-admin-tools-message");
  if (!box) {
    box = el("div");
    box.id = "khd-admin-tools-message";
    document.body.appendChild(box);
  }
  box.className = `khd-admin-tools-message ${kind}`;
  box.textContent = message;
  window.setTimeout(() => box?.remove(), 7000);
}

function button(label: string, action: () => Promise<void> | void, cls = "khd-admin-tool-button") {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", async () => {
    const old = b.textContent || label;
    b.textContent = "Working…";
    b.disabled = true;
    try { await action(); }
    catch (error) { notify(error instanceof Error ? error.message : "Operation failed.", "error"); }
    finally { b.textContent = old; b.disabled = false; }
  });
  return b;
}

async function providerTldSync(mode: "catalog" | "prices" | "sync", extra = "") {
  const token = getSession()?.token;
  if (!token) throw new Error("Admin session is required.");
  const res = await fetch(`${TLD_PROVIDER_SYNC_API_URL}?mode=${mode}&environment=production&margin=30&max=1000${extra}`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(payload.message || payload.error || `Provider sync failed (${res.status}).`));
  return payload as any;
}

function renderText(target: HTMLElement, lines: string[]) {
  target.textContent = lines.filter(Boolean).join("\n");
}

function summarizeCatalogSync(data: any) {
  const catalog = data?.catalog || {};
  const prices = data?.prices || null;
  return [
    "Provider TLD catalog imported from DomainNameAPI.",
    `Provider items returned: ${catalog.providerItems ?? 0}`,
    `TLDs imported/updated: ${catalog.importedProviderTlds ?? 0}`,
    `TLDs with provider catalog prices: ${catalog.tldsWithCatalogPrices ?? 0}`,
    "Customer prices are provider cost +30%.",
    prices ? `Fallback price checks updated: ${prices.updated ?? 0}` : "No fallback product-info calls were needed for this action.",
  ];
}

async function refreshTables() {
  window.dispatchEvent(new Event("focus"));
}

function heading(title: string, description: string) {
  const wrap = el("div", "card-heading");
  const inner = el("div");
  append(inner, "h2", title);
  append(inner, "p", description);
  wrap.appendChild(inner);
  return wrap;
}

function cleanupAdminToolbox() {
  if (window.location.pathname !== "/admin") {
    document.querySelectorAll("#khd-admin-super-tools").forEach((node) => node.remove());
    return;
  }
  const nodes = Array.from(document.querySelectorAll("#khd-admin-super-tools"));
  nodes.slice(1).forEach((node) => node.remove());
}

function protectSelfAdminRow() {
  if (window.location.pathname !== "/admin") return;
  document.querySelectorAll<HTMLTableRowElement>(".admin-table-wrap tbody tr").forEach((row) => {
    const roleText = row.querySelector("td:nth-child(2)")?.textContent?.trim().toLowerCase();
    if (roleText !== "admin") return;
    row.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
      if (/suspend/i.test(btn.textContent || "")) {
        btn.disabled = true;
        btn.dataset.selfAdmin = "true";
        btn.title = "The active admin account cannot suspend itself.";
      }
    });
  });
}

function installAdminToolbox() {
  cleanupAdminToolbox();
  protectSelfAdminRow();
  if (window.location.pathname !== "/admin" || !getSession()) return;
  if (document.getElementById("khd-admin-super-tools")) return;

  const root = document.querySelector(".admin-main, .dashboard-content, main") || document.body;
  const panel = el("section", "card khd-admin-super-tools");
  panel.id = "khd-admin-super-tools";
  panel.appendChild(heading("Admin maintenance", "Provider catalog, provider prices and operational cleanup."));
  append(panel, "p", "Import provider catalog reads the TLD list and prices directly from DomainNameAPI /products/tlds. It does not use the old local seed list.", "khd-admin-help");

  const output = el("pre", "khd-admin-tools-output", "Choose one maintenance action. Results will be summarized here.");
  const grid = el("div", "khd-admin-tools-grid");
  grid.append(
    button("Import provider TLD catalog", async () => {
      const data = await providerTldSync("catalog");
      renderText(output, summarizeCatalogSync(data));
      notify("Provider TLD catalog imported.");
      await refreshTables();
    }),
    button("Update missing prices", async () => {
      const data = await providerTldSync("prices", "&limit=3");
      const p = data?.prices || {};
      renderText(output, [
        "Fallback provider price check completed.",
        `Updated TLD rows: ${p.updated ?? 0}`,
        `Failed checks: ${p.failed ?? 0}`,
        p.rateLimited ? `Provider rate-limit hits: ${p.rateLimited}` : "No provider rate-limit reported.",
      ]);
      notify("Missing price check completed.");
      await refreshTables();
    }, "khd-admin-tool-button secondary"),
    button("Refresh domain statuses", async () => {
      const data: any = await adminApi(`/domains/sync-all?limit=10`, { method: "POST" });
      renderText(output, ["Provider status refresh finished.", `Domains updated: ${data?.synced ?? 0}`, `Domains skipped/failed: ${data?.failed ?? 0}`]);
      notify("Domain status refresh completed.");
      await refreshTables();
    }, "khd-admin-tool-button secondary"),
    button("Check failed DNS", async () => {
      const data = await adminApi<{ dns: Array<Record<string, any>> }>("/dns?status=failed");
      renderFailedDns(output, data.dns || []);
    }, "khd-admin-tool-button secondary"),
  );
  panel.append(grid, output);
  root.prepend(panel);
}

function renderFailedDns(output: HTMLElement, rows: Array<Record<string, any>>) {
  output.replaceChildren();
  if (!rows.length) {
    output.textContent = "No failed DNS records.";
    return;
  }
  const wrap = el("div", "khd-admin-mini-list");
  rows.forEach((row) => {
    const item = el("div", "khd-admin-mini-row");
    const label = el("div");
    append(label, "strong", String(row.domain_domains?.domain_name || row.domain_id || "Unknown domain"));
    append(label, "span", `${row.name || "@"} · ${row.type || "record"} · ${(row.contents || []).join(", ")} · ${formatDate(row.updated_at)}`);
    item.append(label, button("Delete local record", async () => {
      if (!confirm("Delete this failed local DNS record?")) return;
      await adminApi(`/dns/${row.id}`, { method: "DELETE" });
      item.remove();
      notify("DNS record deleted.");
    }, "khd-admin-tool-button danger"));
    wrap.appendChild(item);
  });
  output.appendChild(wrap);
}

function injectStyles() {
  if (document.getElementById("khd-admin-super-tools-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-admin-super-tools-styles";
  style.textContent = `.khd-admin-super-tools{margin-bottom:18px}.khd-admin-tools-grid{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 14px}.khd-admin-tools-message{position:fixed;right:18px;top:18px;z-index:200;background:#ecfdf3;color:#027a48;border-radius:12px;padding:12px 14px;font-weight:800;box-shadow:0 18px 42px rgba(15,23,42,.18)}.khd-admin-tools-message.error{background:#fff1f0;color:#b42318}@media(max-width:760px){.khd-admin-tools-grid{display:grid}}`;
  document.head.appendChild(style);
}

function run() {
  injectStyles();
  installAdminToolbox();
  protectSelfAdminRow();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
