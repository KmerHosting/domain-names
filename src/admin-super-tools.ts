import { adminApi, formatDate, getSession } from "./api";

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

function summarizeProviderSync(data: any) {
  const details = Array.isArray(data?.details) ? data.details : [];
  const rateLimited = details.filter((d: any) => String(d.error || "").includes("429")).length;
  const periodErrors = details.filter((d: any) => /period/i.test(String(d.error || ""))).length;
  const otherErrors = Math.max(0, details.length - rateLimited - periodErrors);
  return [
    "TLD price sync started.",
    `Updated TLD rows: ${data?.synced ?? 0}`,
    `Skipped/failed rows: ${data?.failed ?? 0}`,
    rateLimited ? `Provider rate limit hit on ${rateLimited} price checks. This is normal when too many prices are requested at once. The background sync will continue progressively.` : "No provider rate limit reported in this run.",
    periodErrors ? `${periodErrors} price checks need a different provider period. Those TLDs should be reviewed later.` : "",
    otherErrors ? `${otherErrors} other provider errors were hidden from the UI. Check logs only if prices remain missing.` : "",
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
  panel.appendChild(heading("Admin maintenance", "Use these only when you need to reconcile the platform with provider state."));
  append(panel, "p", "Price sync is intentionally small per click because the provider rate-limits product price checks. A 429 means the provider asked us to slow down, not that the platform is broken.", "khd-admin-help");

  const output = el("pre", "khd-admin-tools-output", "Choose one maintenance action. Results will be summarized here.");
  const grid = el("div", "khd-admin-tools-grid");
  grid.append(
    button("Update a few TLD prices", async () => {
      const data = await adminApi(`/tlds/sync?margin=30&limit=3`, { method: "POST" });
      renderText(output, summarizeProviderSync(data));
      notify("TLD price sync run completed.");
      await refreshTables();
    }),
    button("Re-apply +30% margin", async () => {
      const data: any = await adminApi("/tlds/apply-margin?margin=30", { method: "POST" });
      renderText(output, ["Stored provider costs were recalculated with a +30% customer margin.", `Updated TLD rows: ${data?.updated ?? 0}`]);
      notify("Prices recalculated from stored provider costs.");
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
