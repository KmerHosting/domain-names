import { createElement, useEffect, useState } from "react";
import type { CSSProperties } from "react";

const STATUS_API_URL =
  import.meta.env.VITE_DOMAIN_PLATFORM_STATUS_API_URL ||
  "/api/domain/domain-platform-status";

type PlatformStatus = {
  checkoutEnabled?: boolean;
  maintenanceMode?: boolean;
  message?: string;
  supportEmail?: string;
};

const bannerStyle: CSSProperties = {
  position: "relative",
  zIndex: 2,
  background: "#fff7ed",
  color: "#9a3412",
  borderBottom: "1px solid #fed7aa",
  padding: "10px 16px",
  fontWeight: 800,
  textAlign: "center",
  fontSize: "14px",
  lineHeight: 1.4,
};

const smallStyle: CSSProperties = {
  display: "block",
  fontWeight: 700,
  color: "#9a3412",
  opacity: 0.88,
  marginTop: "2px",
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
      .then((payload) => {
        if (!cancelled) setStatus(payload);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.maintenanceMode || status.checkoutEnabled) return null;
  const supportEmail = status.supportEmail || "support@kmerhosting.com";

  return createElement(
    "div",
    { id: "khd-platform-status-banner", className: "khd-platform-status-banner", style: bannerStyle },
    String(status.message || "Domain ordering is temporarily unavailable during maintenance."),
    createElement("small", { style: smallStyle }, `Support: ${supportEmail}`),
  );
}
