import { api, formatDate, getSession } from "./api";

type NotificationItem = {
  id: string;
  type?: string;
  title: string;
  message: string;
  read_at?: string | null;
  created_at: string;
};

function ensureStyles() {
  if (document.getElementById("khd-notifications-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-notifications-styles";
  style.textContent = `
    .khd-notifications-backdrop{position:fixed;inset:0;z-index:92;background:rgba(15,23,42,.22);display:flex;justify-content:flex-end;align-items:flex-start;padding:84px 18px 18px}.khd-notifications-panel{width:min(430px,calc(100vw - 24px));max-height:calc(100vh - 110px);overflow:auto;background:#fff;border:1px solid #e5eaf2;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:18px}.khd-notifications-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.khd-notifications-head h2{margin:0;font-size:20px}.khd-notifications-head p{margin:4px 0 0;color:#667085;font-size:13px}.khd-notifications-close{border:0;background:#eef4ff;color:#155eef;border-radius:10px;width:34px;height:34px;font-weight:900;cursor:pointer}.khd-notifications-list{display:grid;gap:10px}.khd-notification-item{display:flex;gap:10px;border:1px solid #edf1f7;border-radius:14px;padding:12px}.khd-notification-dot{width:9px;height:9px;border-radius:999px;background:#155eef;margin-top:5px;flex:0 0 auto}.khd-notification-dot.read{background:#cbd5e1}.khd-notification-item strong{display:block;font-size:14px}.khd-notification-item p{margin:3px 0;color:#344054;font-size:13px;line-height:1.4}.khd-notification-item small{color:#667085}.khd-notifications-empty{border:1px dashed #d6ddea;border-radius:14px;padding:20px;color:#667085;text-align:center}.khd-notifications-error{border:1px solid #fecdca;background:#fff1f0;color:#b42318;border-radius:12px;padding:12px;font-weight:700}@media(max-width:760px){.khd-notifications-backdrop{justify-content:center;padding-top:72px}.khd-notifications-panel{width:100%}}
  `;
  document.head.appendChild(style);
}

function closePanel() {
  document.getElementById("khd-notifications-backdrop")?.remove();
}

async function openPanel() {
  ensureStyles();
  closePanel();
  const backdrop = document.createElement("div");
  backdrop.id = "khd-notifications-backdrop";
  backdrop.className = "khd-notifications-backdrop";
  backdrop.innerHTML = `<aside class="khd-notifications-panel"><div class="khd-notifications-head"><div><h2>Notifications</h2><p>Recent domain, payment and account updates.</p></div><button class="khd-notifications-close" type="button" aria-label="Close notifications">×</button></div><div class="khd-notifications-list"><div class="khd-notifications-empty">Loading notifications…</div></div></aside>`;
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closePanel(); });
  backdrop.querySelector(".khd-notifications-close")?.addEventListener("click", closePanel);
  document.body.appendChild(backdrop);
  const list = backdrop.querySelector<HTMLElement>(".khd-notifications-list")!;
  try {
    const data = await api<{ notifications: NotificationItem[] }>("/dashboard");
    const notifications = data.notifications || [];
    if (!notifications.length) {
      list.innerHTML = `<div class="khd-notifications-empty">No notifications yet.</div>`;
      return;
    }
    list.innerHTML = "";
    notifications.slice(0, 25).forEach((item) => {
      const row = document.createElement("div");
      row.className = "khd-notification-item";
      row.innerHTML = `<span class="khd-notification-dot ${item.read_at ? "read" : ""}"></span><div><strong></strong><p></p><small>${formatDate(item.created_at)}</small></div>`;
      row.querySelector("strong")!.textContent = item.title || "Notification";
      row.querySelector("p")!.textContent = item.message || "";
      list.appendChild(row);
    });
  } catch (error) {
    list.innerHTML = `<div class="khd-notifications-error">${error instanceof Error ? error.message : "Unable to load notifications."}</div>`;
  }
}

function installNotificationsPanel() {
  if ((window as any).__khdNotificationsPanelInstalled) return;
  (window as any).__khdNotificationsPanelInstalled = true;
  ensureStyles();
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest?.(".notification-button") as HTMLAnchorElement | null;
    if (!link) return;
    if (!getSession()) return;
    event.preventDefault();
    void openPanel();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installNotificationsPanel, { once: true });
else installNotificationsPanel();
