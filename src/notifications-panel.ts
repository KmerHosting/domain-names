import { customerToolsApi, formatDate, getSession } from "./api";

type NotificationItem = {
  id: string;
  type?: string;
  title: string;
  message: string;
  read_at?: string | null;
  created_at: string;
};

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

function ensureStyles() {
  if (document.getElementById("khd-notifications-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-notifications-styles";
  style.textContent = `.khd-notifications-backdrop{position:fixed;inset:0;z-index:92;background:rgba(15,23,42,.22);display:flex;justify-content:flex-end;align-items:flex-start;padding:84px 18px 18px}.khd-notifications-panel{width:min(430px,calc(100vw - 24px));max-height:calc(100vh - 110px);overflow:auto;background:#fff;border:1px solid #e5eaf2;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:18px}.khd-notifications-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.khd-notifications-head h2{margin:0;font-size:20px}.khd-notifications-head p{margin:4px 0 0;color:#667085;font-size:13px}.khd-notifications-actions{display:flex;gap:8px;align-items:center}.khd-notifications-close,.khd-notifications-readall{border:0;background:#eef4ff;color:#155eef;border-radius:10px;min-height:34px;padding:0 10px;font-weight:900;cursor:pointer}.khd-notifications-list{display:grid;gap:10px}.khd-notification-item{display:flex;gap:10px;border:1px solid #edf1f7;border-radius:14px;padding:12px}.khd-notification-dot{width:9px;height:9px;border-radius:999px;background:#155eef;margin-top:5px;flex:0 0 auto}.khd-notification-dot.read{background:#cbd5e1}.khd-notification-item strong{display:block;font-size:14px}.khd-notification-item p{margin:3px 0;color:#344054;font-size:13px;line-height:1.4}.khd-notification-item small{color:#667085}.khd-notification-read{margin-top:6px;border:0;background:#f2f4f7;border-radius:8px;padding:6px 8px;font-size:12px;font-weight:800;cursor:pointer}.khd-notifications-empty{border:1px dashed #d6ddea;border-radius:14px;padding:20px;color:#667085;text-align:center}.khd-notifications-error{border:1px solid #fecdca;background:#fff1f0;color:#b42318;border-radius:12px;padding:12px;font-weight:700}@media(max-width:760px){.khd-notifications-backdrop{justify-content:center;padding-top:72px}.khd-notifications-panel{width:100%}}`;
  document.head.appendChild(style);
}

function closePanel() {
  document.querySelectorAll("#khd-notifications-backdrop").forEach((node) => node.remove());
}

function panelSkeleton() {
  const backdrop = el("div", "khd-notifications-backdrop");
  backdrop.id = "khd-notifications-backdrop";
  const aside = el("aside", "khd-notifications-panel");
  const head = el("div", "khd-notifications-head");
  const title = el("div");
  append(title, "h2", "Notifications");
  append(title, "p", "Recent domain, payment and account updates.");
  const actions = el("div", "khd-notifications-actions");
  const readAll = el("button", "khd-notifications-readall", "Read all");
  readAll.type = "button";
  readAll.addEventListener("click", async () => {
    await customerToolsApi("/notifications/read-all", { method: "POST" });
    void openPanel();
  });
  const close = el("button", "khd-notifications-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close notifications");
  close.addEventListener("click", closePanel);
  actions.append(readAll, close);
  head.append(title, actions);
  const list = el("div", "khd-notifications-list");
  append(list, "div", "Loading notifications…", "khd-notifications-empty");
  aside.append(head, list);
  backdrop.appendChild(aside);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closePanel(); });
  return { backdrop, list };
}

async function openPanel() {
  ensureStyles();
  closePanel();
  const { backdrop, list } = panelSkeleton();
  document.body.appendChild(backdrop);
  try {
    const data = await customerToolsApi<{ notifications: NotificationItem[]; unread: number }>("/notifications");
    const notifications = data.notifications || [];
    list.replaceChildren();
    if (!notifications.length) {
      append(list, "div", "No notifications yet.", "khd-notifications-empty");
      return;
    }
    notifications.slice(0, 50).forEach((item) => {
      const row = el("div", "khd-notification-item");
      row.appendChild(el("span", item.read_at ? "khd-notification-dot read" : "khd-notification-dot"));
      const content = el("div");
      append(content, "strong", item.title || "Notification");
      append(content, "p", item.message || "");
      append(content, "small", formatDate(item.created_at));
      if (!item.read_at) {
        const read = el("button", "khd-notification-read", "Mark as read");
        read.type = "button";
        read.addEventListener("click", async () => {
          await customerToolsApi(`/notifications/${item.id}/read`, { method: "POST" });
          void openPanel();
        });
        content.appendChild(read);
      }
      row.appendChild(content);
      list.appendChild(row);
    });
  } catch (error) {
    list.replaceChildren();
    append(list, "div", error instanceof Error ? error.message : "Unable to load notifications.", "khd-notifications-error");
  }
}

function installNotificationsPanel() {
  if ((window as any).__khdNotificationsPanelInstalled) return;
  (window as any).__khdNotificationsPanelInstalled = true;
  ensureStyles();
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest?.(".notification-button") as HTMLElement | null;
    if (!link || !getSession()) return;
    event.preventDefault();
    void openPanel();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installNotificationsPanel, { once: true });
else installNotificationsPanel();
