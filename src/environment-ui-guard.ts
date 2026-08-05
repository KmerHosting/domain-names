import { api, getSession } from "./api";

type DomainEnvironmentRow = {
  id: string;
  domain_name: string;
  registrar_environment?: string | null;
  environment_is_current?: boolean | null;
};

type OrderEnvironmentRow = {
  id: string;
  domain_name: string;
  registrar_environment?: string | null;
};

type EnvironmentSnapshot = {
  domains: DomainEnvironmentRow[];
  orders: OrderEnvironmentRow[];
  fetchedAt: number;
};

let snapshotPromise: Promise<EnvironmentSnapshot> | null = null;
let lastRun = 0;

function isTestEnvironment(value?: string | null) {
  const env = String(value || "production").toLowerCase();
  return env === "ote" || env === "test" || env === "sandbox";
}

function labelFor(value?: string | null) {
  return isTestEnvironment(value) ? "TEST / OTE" : "LIVE";
}

function ensureStyles() {
  if (document.getElementById("khd-environment-ui-style")) return;
  const style = document.createElement("style");
  style.id = "khd-environment-ui-style";
  style.textContent = `
    .khd-env-badge{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:3px 8px;border-radius:999px;border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;font-size:11px;font-weight:900;letter-spacing:.02em;vertical-align:middle;text-transform:uppercase;white-space:nowrap}
    .khd-env-badge-live{border-color:#bbf7d0;background:#f0fdf4;color:#166534}
    .khd-env-warning{margin:0 0 18px;padding:14px 16px;border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;border-radius:14px;font-weight:700;line-height:1.45}
    .khd-env-warning strong{display:block;color:#7c2d12;margin-bottom:3px}
    .khd-env-readonly{opacity:.72;cursor:not-allowed!important}
  `;
  document.head.appendChild(style);
}

async function fetchSnapshot(): Promise<EnvironmentSnapshot> {
  if (!getSession()) return { domains: [], orders: [], fetchedAt: Date.now() };
  if (snapshotPromise) return snapshotPromise;

  snapshotPromise = Promise.allSettled([
    api<{ domains: DomainEnvironmentRow[] }>("/domains"),
    api<{ domains: DomainEnvironmentRow[]; orders: OrderEnvironmentRow[] }>("/dashboard"),
    api<{ orders: OrderEnvironmentRow[] }>("/orders"),
  ]).then((results) => {
    const domainsById = new Map<string, DomainEnvironmentRow>();
    const ordersById = new Map<string, OrderEnvironmentRow>();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const value: any = result.value;
      for (const domain of value.domains || []) {
        if (domain?.id && domain?.domain_name) domainsById.set(domain.id, domain);
      }
      for (const order of value.orders || []) {
        if (order?.id && order?.domain_name) ordersById.set(order.id, order);
      }
    }
    return { domains: [...domainsById.values()], orders: [...ordersById.values()], fetchedAt: Date.now() };
  }).finally(() => {
    window.setTimeout(() => { snapshotPromise = null; }, 30_000);
  });

  return snapshotPromise;
}

function makeBadge(environment?: string | null) {
  const badge = document.createElement("span");
  badge.className = isTestEnvironment(environment) ? "khd-env-badge" : "khd-env-badge khd-env-badge-live";
  badge.textContent = labelFor(environment);
  badge.dataset.khdEnvBadge = "true";
  return badge;
}

function addBadge(container: Element, environment?: string | null, key?: string) {
  if (!isTestEnvironment(environment)) return;
  const badgeKey = key || environment || "unknown";
  if (container.querySelector(`[data-khd-env-key="${CSS.escape(badgeKey)}"]`)) return;
  const badge = makeBadge(environment);
  badge.dataset.khdEnvKey = badgeKey;
  container.appendChild(badge);
}

function findBestContainer(element: Element) {
  return element.closest(".domain-cell,.domain-list-main,.title-with-status,.order-main,.order-card,.domain-list-card,tr,h1,strong,td,span") || element;
}

function markVisibleDomain(domain: DomainEnvironmentRow) {
  if (!isTestEnvironment(domain.registrar_environment)) return;
  const domainName = String(domain.domain_name || "").toLowerCase();
  if (!domainName) return;
  const candidates = document.querySelectorAll("main a,main td,main strong,main h1,main span,main .domain-list-main,main .order-main,main .title-with-status");
  for (const candidate of Array.from(candidates)) {
    const text = String(candidate.textContent || "").toLowerCase();
    if (!text.includes(domainName)) continue;
    addBadge(findBestContainer(candidate), domain.registrar_environment, `domain-${domain.id}`);
  }
}

function markVisibleOrder(order: OrderEnvironmentRow) {
  if (!isTestEnvironment(order.registrar_environment)) return;
  const domainName = String(order.domain_name || "").toLowerCase();
  if (!domainName) return;
  const cards = document.querySelectorAll("main .order-card,main tr,main .activity-item");
  for (const card of Array.from(cards)) {
    const text = String(card.textContent || "").toLowerCase();
    if (!text.includes(domainName)) continue;
    addBadge(card, order.registrar_environment, `order-${order.id}`);
  }
}

function addReadonlyWarning(domain: DomainEnvironmentRow) {
  if (!isTestEnvironment(domain.registrar_environment)) return;
  const path = window.location.pathname;
  const detailPath = `/dashboard/domains/${domain.id}`;
  const managePath = `/dashboard/domains/${domain.id}/manage`;
  if (path !== detailPath && path !== managePath) return;
  const content = document.querySelector(".dashboard-content,.native-page-main .dashboard-content,main");
  if (!content || content.querySelector(".khd-env-warning")) return;
  const warning = document.createElement("div");
  warning.className = "khd-env-warning";
  warning.innerHTML = `<strong>TEST / OTE domain</strong>This domain belongs to the DomainNameAPI test environment. It is shown for reference only while the platform is live. Provider actions are blocked in production.`;
  content.prepend(warning);

  const actionSelectors = [
    ".detail-grid button",
    ".dns-add-row button",
    ".native-action-card button",
    "form button[type='submit']",
  ];
  for (const selector of actionSelectors) {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(selector))) {
      if (button.closest(".sidebar,.dashboard-header,.public-header,.footer")) continue;
      button.disabled = true;
      button.classList.add("khd-env-readonly");
      button.title = "Blocked: this is a TEST / OTE domain while the platform is live.";
    }
  }
}

async function applyEnvironmentMarkers() {
  if (Date.now() - lastRun < 400) return;
  lastRun = Date.now();
  ensureStyles();
  const snapshot = await fetchSnapshot();
  for (const domain of snapshot.domains) {
    markVisibleDomain(domain);
    addReadonlyWarning(domain);
  }
  for (const order of snapshot.orders) markVisibleOrder(order);
}

function scheduleApply() {
  window.requestAnimationFrame(() => { void applyEnvironmentMarkers(); });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scheduleApply, { once: true });
} else {
  scheduleApply();
}

const observer = new MutationObserver(scheduleApply);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("focus", scheduleApply);
window.addEventListener("popstate", scheduleApply);
