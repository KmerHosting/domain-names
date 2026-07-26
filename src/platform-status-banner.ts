const STATUS_API_URL =
  import.meta.env.VITE_DOMAIN_PLATFORM_STATUS_API_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-platform-status";

function ensureStyles() {
  if (document.getElementById("khd-platform-status-style")) return;
  const style = document.createElement("style");
  style.id = "khd-platform-status-style";
  style.textContent = `
    .khd-platform-status-banner{position:relative;z-index:2;background:#fff7ed;color:#9a3412;border-bottom:1px solid #fed7aa;padding:10px 16px;font-weight:800;text-align:center;font-size:14px;line-height:1.4}
    .khd-platform-status-banner strong{color:#7c2d12}
    .khd-platform-status-banner small{display:block;font-weight:700;color:#9a3412;opacity:.88;margin-top:2px}
  `;
  document.head.appendChild(style);
}

async function installPlatformStatusBanner() {
  if (document.getElementById("khd-platform-status-banner")) return;
  try {
    const res = await fetch(STATUS_API_URL, { headers: { Accept: "application/json" } });
    const status = await res.json().catch(() => ({}));
    if (status.checkoutEnabled) return;
    ensureStyles();
    const banner = document.createElement("div");
    banner.id = "khd-platform-status-banner";
    banner.className = "khd-platform-status-banner";
    const prefix = document.createElement("strong");
    prefix.textContent = "Test mode. ";
    const details = document.createElement("small");
    details.textContent = "Checkout is disabled until DomainNameAPI production and CamerPay live mode are enabled.";
    banner.appendChild(prefix);
    banner.appendChild(document.createTextNode(String(status.message || "Domain purchases are temporarily paused.")));
    banner.appendChild(details);
    document.body.prepend(banner);
  } catch {
    // Do not block the app if the status endpoint is temporarily unavailable.
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installPlatformStatusBanner, { once: true });
else installPlatformStatusBanner();