import { InlineNotification } from "@carbon/react";
import { createElement, useEffect, useState } from "react";

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

  const title = maintenance ? "MAINTENANCE" : live ? "LIVE / PRODUCTION" : "TEST / OTE";
  const detail = maintenance
    ? String(status.message || "Domain ordering is temporarily unavailable. Registrar operations are paused until maintenance mode is disabled.")
    : live
      ? "New domain orders are processed in live mode."
      : "New domain orders are currently using test mode. No live registration is created.";
  const subtitle = maintenance ? `${detail} Support: ${status.supportEmail || "support@kmerhosting.com"}` : detail;

  return createElement(InlineNotification, {
    id: "khd-platform-status-banner",
    className: `khd-platform-status-banner ${maintenance ? "is-maintenance" : live ? "is-live" : "is-test"}`,
    kind: maintenance ? "error" : "info",
    lowContrast: true,
    hideCloseButton: true,
    title,
    subtitle,
  });
}
