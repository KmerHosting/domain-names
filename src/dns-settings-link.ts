function domainDetailId() {
  return window.location.pathname.match(/^\/dashboard\/domains\/([0-9a-f-]+)$/i)?.[1] || "";
}

function ensureDnsSettingsLink() {
  const id = domainDetailId();
  if (!id) return;
  const heading = document.querySelector(".page-heading");
  if (!heading || heading.querySelector("[data-khd-dns-settings-link]")) return;
  const actions = heading.querySelector(".heading-actions") || heading;
  const link = document.createElement("a");
  link.href = `/dashboard/domains/${id}/dns`;
  link.className = "button button-primary";
  link.dataset.khdDnsSettingsLink = "true";
  link.textContent = "DNS settings";
  actions.appendChild(link);
}

function cardByHeading(title: string) {
  const headings = Array.from(document.querySelectorAll("h2"));
  const h = headings.find((node) => String(node.textContent || "").trim().toLowerCase() === title.toLowerCase());
  return h?.closest(".card") || null;
}

function disableOldDnsForms() {
  const id = domainDetailId();
  if (!id) return;
  for (const title of ["DNS records", "Nameservers"]) {
    const card = cardByHeading(title);
    if (!card || card.querySelector("[data-khd-dns-settings-notice]")) continue;
    const notice = document.createElement("div");
    notice.className = "alert alert-warning";
    notice.dataset.khdDnsSettingsNotice = "true";
    notice.innerHTML = `Use the complete <a href="/dashboard/domains/${id}/dns">DNS settings</a> page for sync, validation, edit, delete, retry and dynamic nameservers.`;
    card.prepend(notice);
    for (const control of Array.from(card.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button,input,select,textarea"))) {
      if (control.closest("[data-khd-dns-settings-notice]")) continue;
      control.disabled = true;
      control.title = "Use the complete DNS settings page.";
    }
  }
}

function run() {
  window.requestAnimationFrame(() => {
    ensureDnsSettingsLink();
    disableOldDnsForms();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();

const observer = new MutationObserver(run);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", run);
window.addEventListener("focus", run);
