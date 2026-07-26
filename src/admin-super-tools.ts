import { adminApi, formatDate, formatMoney, getSession } from "./api";

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
    `Customer margin: +${data?.marginPercent ?? 30}%`,
    prices ? `Fallback product-info rows updated: ${prices.updated ?? 0}` : "No fallback product-info calls were needed for this action.",
  ];
}

function summarizeProviderAccount(data: any) {
  const p = data?.provider || data || {};
  const balance = p.balance ?? p.amount ?? p.availableBalance ?? p.data?.balance ?? p.deposit ?? null;
  const currency = p.currency ?? p.data?.currency ?? "USD";
  return [
    "Provider account loaded.",
    balance === null || balance === undefined ? "Balance: not returned by provider" : `Balance: ${balance} ${currency}`,
    p.accountCode ? `Account: ${p.accountCode}` : "",
    p.resellerId ? "Reseller account: configured" : "",
  ];
}

function summarizeProviderTransactions(data: any) {
  const payload = data?.provider || data || {};
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data) ? payload.data : Array.isArray(payload.results) ? payload.results : [];
  return [
    "Provider transactions loaded.",
    `Transactions returned: ${items.length}`,
    items.slice(0, 6).map((item: any) => {
      const amount = item.amount ?? item.price ?? item.balance ?? "";
      const date = item.createdAt ?? item.date ?? item.transactionDate ?? "";
      const label = item.description ?? item.type ?? item.status ?? "transaction";
      return `- ${label}${amount !== "" ? ` · ${amount}` : ""}${date ? ` · ${date}` : ""}`;
    }).join("\n"),
  ];
}

function summarizeProviderLogs(data: any) {
  const rows = Array.isArray(data?.logs) ? data.logs : [];
  return [
    "Recent provider logs.",
    `Rows: ${rows.length}`,
    rows.slice(0, 8).map((row: any) => `- ${row.sync_type || "log"} · ${row.status || "unknown"} · ${formatDate(row.created_at)}${row.error_message ? ` · ${row.error_message}` : ""}`).join("\n"),
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
  panel.appendChild(heading("Provider operations", "Use these actions to reconcile the platform with DomainNameAPI and provider state."));
  append(panel, "p", "Client pages stay simple. This admin panel shows provider account, provider TLD catalog, provider prices, provider logs, domain sync and DNS cleanup.", "khd-admin-help");

  const output = el("pre", "khd-admin-tools-output", "Choose a provider/admin action. A short summary will appear here.");
  const grid = el("div", "khd-admin-tools-grid");
  grid.append(
    button("Provider account", async () => {
      const data = await adminApi("/provider/account");
      renderText(output, summarizeProviderAccount(data));
    }),
    button("Provider transactions", async () => {
      const data = await adminApi("/provider/transactions?limit=20");
      renderText(output, summarizeProviderTransactions(data));
    }, "khd-admin-tool-button secondary"),
    button("Import provider TLD catalog", async () => {
      const data = await adminApi("/tlds/sync?mode=catalog&margin=30&max=1000", { method: "POST" });
      renderText(output, summarizeCatalogSync(data));
      notify("Provider TLD catalog imported.");
      await refreshTables();
    }),
    button("Update missing prices", async () => {
      const data: any = await adminApi("/tlds/sync?mode=prices&margin=30&limit=3", { method: "POST" });
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
    button("Provider logs", async () => {
      const data = await adminApi("/provider/logs?limit=30");
      renderText(output, summarizeProviderLogs(data));
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
