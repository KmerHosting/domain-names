import { api, getSession, type User } from "./api";

async function installAdminLink() {
  if (!getSession()) return;
  if (document.getElementById("khd-admin-nav-link")) return;
  if (!window.location.pathname.startsWith("/dashboard")) return;
  const nav = document.querySelector<HTMLElement>(".sidebar-nav");
  if (!nav) return;
  try {
    const me = await api<{ user: User }>("/me");
    if (me.user.role !== "admin") return;
    const link = document.createElement("a");
    link.id = "khd-admin-nav-link";
    link.href = "/admin";
    link.innerHTML = `<span style="display:inline-grid;place-items:center;width:19px;height:19px;border-radius:6px;background:#155eef;color:#fff;font-size:11px;font-weight:800">A</span> Admin`;
    nav.appendChild(link);
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
