import { adminApi, formatDate, formatMoney, getSession } from "./api";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function notify(message: string, kind: "success" | "error" = "success") {
  let box = document.getElementById("khd-admin-tools-message");
  if (!box) {
    box = document.createElement("div");
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
    (b as HTMLButtonElement).disabled = true;
    try { await action(); }
    catch (error) { notify(error instanceof Error ? error.message : "Operation failed.", "error"); }
    finally { b.textContent = old; (b as HTMLButtonElement).disabled = false; }
  });
  return b;
}

function renderJson(target: HTMLElement, data: unknown) {
  target.textContent = JSON.stringify(data, null, 2).slice(0, 18000);
}

async function refreshTables() {
  window.dispatchEvent(new Event("focus"));
}

function installAdminToolbox() {
  if (window.location.pathname !== "/admin" || !getSession()) return;
  if (document.getElementById("khd-admin-super-tools")) return;
  const root = document.querySelector(".admin-main, .dashboard-content, main") || document.body;
  const panel = el("section", "card khd-admin-super-tools");
  panel.id = "khd-admin-super-tools";
  panel.innerHTML = `<div class="card-heading"><div><h2>Admin sync & CRUD actions</h2><p>Synchronize provider state, pricing, jobs and operational records.</p></div></div>`;
  const output = el("pre", "khd-admin-tools-output", "Actions output will appear here.");
  const grid = el("div", "khd-admin-tools-grid");
  grid.append(
    button("Sync TLD costs +30%", async () => {
      const limit = prompt("How many enabled TLDs to sync now?", "30");
      if (limit === null) return;
      const data = await adminApi(`/tlds/sync?margin=30&limit=${encodeURIComponent(limit)}`, { method: "POST" });
      renderJson(output, data);
      notify("TLD provider sync completed.");
      await refreshTables();
    }),
    button("Apply +30% margin", async () => {
      const data = await adminApi("/tlds/apply-margin?margin=30", { method: "POST" });
      renderJson(output, data);
      notify("Prices updated from stored provider costs.");
      await refreshTables();
    }, "khd-admin-tool-button secondary"),
    button("Sync all domains", async () => {
      const limit = prompt("How many domains to sync now?", "20");
      if (limit === null) return;
      const data = await adminApi(`/domains/sync-all?limit=${encodeURIComponent(limit)}`, { method: "POST" });
      renderJson(output, data);
      notify("Domain sync completed.");
      await refreshTables();
    }, "khd-admin-tool-button secondary"),
    button("Load failed DNS", async () => {
      const data = await adminApi<{ dns: Array<Record<string, any>> }>("/dns?status=failed");
      renderFailedDns(output, data.dns || []);
    }, "khd-admin-tool-button secondary"),
    button("Load contacts", async () => renderJson(output, await adminApi("/contacts")), "khd-admin-tool-button secondary"),
    button("Load settings", async () => renderJson(output, await adminApi("/config")), "khd-admin-tool-button secondary"),
  );
  panel.append(grid, output);
  root.prepend(panel);
}

function renderFailedDns(output: HTMLElement, rows: Array<Record<string, any>>) {
  output.innerHTML = "";
  if (!rows.length) {
    output.textContent = "No failed DNS records.";
    return;
  }
  const wrap = el("div", "khd-admin-mini-list");
  rows.forEach((row) => {
    const item = el("div", "khd-admin-mini-row");
    const label = el("div");
    label.innerHTML = `<strong>${row.domain_domains?.domain_name || row.domain_id}</strong><span>${row.name} · ${row.type} · ${(row.contents || []).join(", ")} · ${formatDate(row.updated_at)}</span>`;
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

function enhanceAdminTables() {
  if (window.location.pathname !== "/admin") return;
  document.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
    if (row.dataset.khdEnhanced) return;
    const text = row.textContent || "";
    const idLike = row.querySelector("button")?.closest("tr");
    if (!idLike || !/Retry|Cancel|Auto-renew|Disable|Enable|Set price/i.test(text)) return;
    row.dataset.khdEnhanced = "1";
  });
}

function injectStyles() {
  if (document.getElementById("khd-admin-super-tools-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-admin-super-tools-styles";
  style.textContent = `
    .khd-admin-super-tools{margin-bottom:18px}.khd-admin-tools-grid{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 14px}.khd-admin-tool-button{border:0;border-radius:10px;background:#155eef;color:white;font-weight:800;padding:9px 12px;cursor:pointer}.khd-admin-tool-button.secondary{background:#eef4ff;color:#155eef}.khd-admin-tool-button.danger{background:#d92d20;color:white}.khd-admin-tool-button:disabled{opacity:.55;cursor:not-allowed}.khd-admin-tools-output{max-height:420px;overflow:auto;background:#0f172a;color:#dbeafe;border-radius:14px;padding:14px;font-size:12px;white-space:pre-wrap}.khd-admin-tools-message{position:fixed;right:18px;top:18px;z-index:200;background:#ecfdf3;color:#027a48;border-radius:12px;padding:12px 14px;font-weight:800;box-shadow:0 18px 42px rgba(15,23,42,.18)}.khd-admin-tools-message.error{background:#fff1f0;color:#b42318}.khd-admin-mini-list{display:grid;gap:10px}.khd-admin-mini-row{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #334155;border-radius:12px;padding:10px}.khd-admin-mini-row span{display:block;color:#cbd5e1;font-size:12px;margin-top:3px}@media(max-width:760px){.khd-admin-mini-row{display:grid}.khd-admin-tools-grid{display:grid}}
  `;
  document.head.appendChild(style);
}

function run() {
  injectStyles();
  installAdminToolbox();
  enhanceAdminTables();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
