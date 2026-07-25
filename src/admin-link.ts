import { api, getSession, type User } from "./api";

const ADMIN_LINK_ID = "khd-admin-nav-link";
const ADMIN_LINK_CLASS = "khd-admin-nav-link";

function removeDuplicateAdminLinks(nav?: HTMLElement | null) {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(`a.${ADMIN_LINK_CLASS}, #${ADMIN_LINK_ID}`));
  links.forEach((link, index) => {
    if (!nav || link.parentElement !== nav || index > 0) link.remove();
  });
}

async function installAdminLink() {
  const nav = document.querySelector<HTMLElement>(".sidebar-nav");
  removeDuplicateAdminLinks(nav);
  if (!getSession()) return;
  if (!window.location.pathname.startsWith("/dashboard")) return;
  if (!nav) return;
  if (nav.querySelector(`#${ADMIN_LINK_ID}`)) return;
  try {
    const me = await api<{ user: User }>("/me");
    if (me.user.role !== "admin") return;
    const link = document.createElement("a");
    link.id = ADMIN_LINK_ID;
    link.className = ADMIN_LINK_CLASS;
    link.href = "/admin";
    link.innerHTML = `<span style="display:inline-grid;place-items:center;width:19px;height:19px;border-radius:6px;background:#155eef;color:#fff;font-size:11px;font-weight:800">A</span> Admin`;
    nav.appendChild(link);
    removeDuplicateAdminLinks(nav);
  } catch {
    // Ignore. The backend still protects /admin.
  }
}

function bootAdminLink() {
  void installAdminLink();
  const observer = new MutationObserver(() => void installAdminLink());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootAdminLink, { once: true });
else bootAdminLink();
