import { createElement, useEffect, useState } from "react";
import type { CSSProperties } from "react";

const STATUS_API_URL = import.meta.env.VITE_DOMAIN_PLATFORM_STATUS_API_URL || "/api/domain/domain-platform-status";

type PlatformStatus = {
  checkoutEnabled?: boolean;
  maintenanceMode?: boolean;
  liveMode?: boolean;
  registrarEnvironment?: "ote" | "production";
  message?: string;
  supportEmail?: string;
};

export function PlatformStatusBanner() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);

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

    return () => { cancelled = true; };
  }, []);

  if (!status) return null;

  const live = status.registrarEnvironment === "production" || status.liveMode === true;
  const maintenance = Boolean(status.maintenanceMode);
  if (!maintenance && live) return null;

  const style: CSSProperties = {
    position: "relative", zIndex: 20,
    background: maintenance ? "#fef2f2" : live ? "#f0fdf4" : "#fff7ed",
    color: maintenance ? "#991b1b" : live ? "#166534" : "#9a3412",
    borderBottom: `1px solid ${maintenance ? "#fecaca" : live ? "#bbf7d0" : "#fed7aa"}`,
    padding: "9px 16px", fontWeight: 900, textAlign: "center", fontSize: "13px", lineHeight: 1.4,
  };
  const small: CSSProperties = { display: "block", fontWeight: 700, opacity: 0.86, marginTop: "2px" };

  const title = maintenance ? "MAINTENANCE" : live ? "LIVE / PRODUCTION" : "TEST / OTE";
  const detail = maintenance
    ? String(status.message || "Domain ordering is temporarily unavailable. Registrar operations are paused until maintenance mode is disabled.")
    : live
      ? "Orders call DomainNameAPI production and debit the central KmerHosting balance."
      : "Orders call DomainNameAPI OTE, use its test funds and never debit the central KmerHosting balance.";

  return createElement(
    "div",
    { id: "khd-platform-status-banner", className: `khd-platform-status-banner ${maintenance ? "is-maintenance" : live ? "is-live" : "is-test"}`, style },
    `${title} — ${detail}`,
    maintenance ? createElement("small", { style: small }, `Support: ${status.supportEmail || "support@kmerhosting.com"}`) : null,
  );
}
