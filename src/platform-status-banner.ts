import { createElement, useEffect, useState } from "react";
import type { CSSProperties } from "react";

const STATUS_API_URL = import.meta.env.VITE_DOMAIN_PLATFORM_STATUS_API_URL || "/api/domain/domain-platform-status";
const ME_API_URL = "/api/domain/domain-api/me";

type PlatformStatus = {
  checkoutEnabled?: boolean;
  maintenanceMode?: boolean;
  liveMode?: boolean;
  registrarEnvironment?: "ote" | "production";
  message?: string;
  supportEmail?: string;
};

type ViewerRole = "customer" | "admin" | null;

export function PlatformStatusBanner() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [viewerRole, setViewerRole] = useState<ViewerRole | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    fetch(STATUS_API_URL, { headers: { Accept: "application/json" }, credentials: "include" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload.message || "Platform status is unavailable."));
        return payload as PlatformStatus;
      })
      .then((payload) => { if (!cancelled) setStatus(payload); })
      .catch(() => undefined);

    fetch(ME_API_URL, { headers: { Accept: "application/json" }, credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json().catch(() => ({})) as { user?: { role?: unknown } };
        return payload.user?.role === "admin" ? "admin" : "customer";
      })
      .then((role) => { if (!cancelled) setViewerRole(role); })
      .catch(() => { if (!cancelled) setViewerRole(null); });

    return () => { cancelled = true; };
  }, []);

  if (!status) return null;

  const live = status.registrarEnvironment === "production" || status.liveMode === true;
  const maintenance = Boolean(status.maintenanceMode);
  const isAdmin = viewerRole === "admin";

  // Maintenance has absolute visual priority and is visible to everyone,
  // regardless of authentication, role, or selected registrar environment.
  // Outside maintenance, normal LIVE status is admin-only while TEST/OTE
  // remains visible to everyone to prevent sandbox operations being mistaken for LIVE.
  if (!maintenance && live) {
    if (viewerRole === undefined) return null;
    if (!isAdmin) return null;
  }

  const style: CSSProperties = {
    position: "relative", zIndex: 20,
    background: maintenance ? "#fef2f2" : live ? "#f0fdf4" : "#fff7ed",
    color: maintenance ? "#991b1b" : live ? "#166534" : "#9a3412",
    borderBottom: `1px solid ${maintenance ? "#fecaca" : live ? "#bbf7d0" : "#fed7aa"}`,
    padding: "9px 16px", fontWeight: 900, textAlign: "center", fontSize: "13px", lineHeight: 1.4,
  };
  const small: CSSProperties = { display: "block", fontWeight: 700, opacity: 0.86, marginTop: "2px" };
  const link: CSSProperties = { marginLeft: "10px", color: "inherit", textDecoration: "underline", fontWeight: 900 };

  const title = maintenance ? "MAINTENANCE" : live ? "LIVE / PRODUCTION" : "TEST / OTE";
  const detail = maintenance
    ? String(status.message || "Domain ordering is temporarily unavailable. Registrar operations are paused until maintenance mode is disabled.")
    : live
      ? "New orders use DomainNameAPI production. TEST records remain isolated."
      : "New orders use DomainNameAPI OTE. LIVE provider funds are not used by TEST records.";

  return createElement(
    "div",
    { id: "khd-platform-status-banner", className: `khd-platform-status-banner ${maintenance ? "is-maintenance" : live ? "is-live" : "is-test"}`, style },
    `${title} — ${detail}`,
    isAdmin ? createElement("a", { href: "/admin/environments", style: link }, "Environment & balances") : null,
    maintenance ? createElement("small", { style: small }, `Support: ${status.supportEmail || "support@kmerhosting.com"}`) : null,
  );
}
