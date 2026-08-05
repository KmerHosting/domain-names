import { createElement, useEffect, useState } from "react";
import type { CSSProperties } from "react";

const STATUS_API_URL =
  import.meta.env.VITE_DOMAIN_PLATFORM_STATUS_API_URL ||
  "/api/domain/domain-platform-status";

type PlatformStatus = {
  checkoutEnabled?: boolean;
  message?: string;
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

const strongStyle: CSSProperties = { color: "#7c2d12" };
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
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setStatus(payload as PlatformStatus);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.checkoutEnabled) return null;

  return createElement(
    "div",
    { id: "khd-platform-status-banner", className: "khd-platform-status-banner", style: bannerStyle },
    createElement("strong", { style: strongStyle }, "Test mode. "),
    String(status.message || "Domain purchases are temporarily paused."),
    createElement("small", { style: smallStyle }, "Checkout is disabled until DomainNameAPI production and CamerPay live mode are enabled."),
  );
}
