import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatDate, formatMoney, getSession, subscribeSession, walletApi } from "./api";

type WalletOrder = {
  id: string;
  order_number: string;
  type: string;
  domain_name: string;
  status: string;
  price_usd: number | string;
  created_at: string;
  domain_payments?: Array<{ provider?: string; status: string }>;
};

type WalletSummary = {
  balanceUsd: number;
  transactions: Array<Record<string, any>>;
  orders: WalletOrder[];
  supportEmail: string;
  topupMode: "manual_support" | string;
  topupInstructions?: string;
};

const OPEN_WALLET_EVENT = "khd-open-wallet";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unexpected error.");
}

function supportMailto(email: string, balance: number): string {
  const subject = encodeURIComponent("Manual domain account balance credit");
  const body = encodeURIComponent(
    `Hello KmerHosting Support,\n\nI would like to credit my domain account balance.\n\nAccount balance currently shown: ${formatMoney(balance)}\nRequested amount: $\nPayment/reference details: \n\nThank you.`,
  );
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

function WalletWidget() {
  const [hasSession, setHasSession] = useState(Boolean(getSession()));
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  useEffect(() => subscribeSession(() => setHasSession(Boolean(getSession()))), []);
  useEffect(() => {
    const listener = () => setOpen(true);
    window.addEventListener(OPEN_WALLET_EVENT, listener);
    return () => window.removeEventListener(OPEN_WALLET_EVENT, listener);
  }, []);

  async function loadSummary() {
    if (!getSession()) return;
    setLoading(true);
    setError("");
    try {
      setSummary(await walletApi<WalletSummary>("/summary"));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (hasSession) void loadSummary();
  }, [hasSession]);

  useEffect(() => {
    if (!open || !hasSession) return;
    void loadSummary();
    const timer = window.setInterval(() => void loadSummary(), 30_000);
    return () => window.clearInterval(timer);
  }, [open, hasSession]);

  async function payWithBalance(orderId: string) {
    setBusyOrderId(orderId);
    setError("");
    setMessage("");
    try {
      await walletApi("/pay-order", { method: "POST", body: { orderId } });
      setMessage("Order paid from your account balance. Provisioning has been queued.");
      await loadSummary();
      window.setTimeout(() => window.location.assign("/dashboard/orders"), 900);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyOrderId(null);
    }
  }

  const supportEmail = summary?.supportEmail || "support@kmerhosting.com";
  const payableOrders = (summary?.orders || []).filter((order) =>
    ["pending_payment", "payment_pending"].includes(order.status) &&
    !order.domain_payments?.some((payment) => payment.status === "paid"),
  );

  if (!hasSession) return null;

  return <>
    <button className="khd-wallet-launcher" onClick={() => setOpen(true)}>
      <span>Balance</span><strong>{formatMoney(summary?.balanceUsd || 0)}</strong>
    </button>
    {open && <div className="khd-wallet-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <aside className="khd-wallet-panel" aria-label="Account balance">
        <div className="khd-wallet-header">
          <div><small>Account balance</small><h2>{formatMoney(summary?.balanceUsd || 0)}</h2></div>
          <button onClick={() => setOpen(false)} aria-label="Close balance panel">×</button>
        </div>
        {loading && <div className="khd-wallet-note">Loading balance…</div>}
        {error && <div className="khd-wallet-error">{error}</div>}
        {message && <div className="khd-wallet-success">{message}</div>}

        <section className="khd-wallet-section">
          <h3>Credit your balance</h3>
          <p className="khd-wallet-copy">Online top-ups are disabled. Account credits are added manually by KmerHosting Support after verification.</p>
          <a className="khd-wallet-support" href={supportMailto(supportEmail, summary?.balanceUsd || 0)}>Contact {supportEmail}</a>
        </section>

        <section className="khd-wallet-section">
          <h3>Pay orders with balance</h3>
          {payableOrders.length ? payableOrders.map((order) => {
            const enough = Number(summary?.balanceUsd || 0) >= Number(order.price_usd || 0);
            return <div className="khd-wallet-order" key={order.id}>
              <div><strong>{order.domain_name}</strong><small>{order.order_number} · {order.type} · {formatDate(order.created_at)}</small></div>
              <div>
                <span>{formatMoney(order.price_usd)}</span>
                <button disabled={!enough || busyOrderId === order.id} onClick={() => payWithBalance(order.id)}>
                  {busyOrderId === order.id ? "Paying…" : enough ? "Pay with balance" : "Insufficient balance"}
                </button>
              </div>
              {!enough && <a className="khd-wallet-small-link" href={supportMailto(supportEmail, summary?.balanceUsd || 0)}>Request a manual credit</a>}
            </div>;
          }) : <p className="khd-wallet-empty">No pending order can be paid from your balance.</p>}
        </section>

        <section className="khd-wallet-section">
          <h3>Recent transactions</h3>
          {summary?.transactions?.length ? summary.transactions.slice(0, 8).map((transaction) =>
            <div className="khd-wallet-tx" key={transaction.id}>
              <span>{String(transaction.transaction_type || "transaction").replaceAll("_", " ")}</span>
              <strong>{formatMoney(transaction.amount_usd)}</strong>
            </div>,
          ) : <p className="khd-wallet-empty">No balance transaction yet.</p>}
        </section>
      </aside>
    </div>}
  </>;
}

function installLegacyCheckoutBlock() {
  if ((window as any).__khdLegacyCheckoutBlockInstalled) return;
  (window as any).__khdLegacyCheckoutBlockInstalled = true;

  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const button = target?.closest?.("button") as HTMLButtonElement | null;
    if (!button) return;
    const text = String(button.textContent || "").trim().toLowerCase();
    if (text === "pay now" || text.includes("check payment status") || text === "continue to checkout") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.dispatchEvent(new Event(OPEN_WALLET_EVENT));
    }
  }, true);

  const cleanLegacyUi = () => {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button"))) {
      const text = String(button.textContent || "").trim().toLowerCase();
      if (text === "pay now") button.textContent = "Pay with balance";
      if (text.includes("check payment status")) button.style.display = "none";
    }
    for (const modal of Array.from(document.querySelectorAll<HTMLElement>(".modal-backdrop,.modal"))) {
      const text = String(modal.textContent || "").toLowerCase();
      if (text.includes("payment phone") || text.includes("orange money") || text.includes("continue to checkout")) modal.remove();
    }
  };

  cleanLegacyUi();
  new MutationObserver(cleanLegacyUi).observe(document.documentElement, { childList: true, subtree: true });

  if (window.location.pathname === "/payment/return") {
    window.location.replace("/dashboard/orders");
  }
}

function installHashNavigationFix() {
  if ((window as any).__khdHashFixInstalled) return;
  (window as any).__khdHashFixInstalled = true;
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const link = target?.closest?.('a[href="#search"],a[href="#pricing"],a[href="#features"]') as HTMLAnchorElement | null;
    if (!link) return;
    const hash = link.getAttribute("href") || "#search";
    if (window.location.pathname !== "/") {
      event.preventDefault();
      window.location.assign(`${window.location.origin}/${hash}`);
    }
  }, true);
}

function injectStyles() {
  if (document.getElementById("khd-wallet-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-wallet-styles";
  style.textContent = `.khd-wallet-launcher{position:fixed;right:90px;top:96px;z-index:60;border:1px solid #d8e0eb;border-radius:12px;background:#fff;color:#155eef;box-shadow:0 8px 24px rgba(15,23,42,.08);padding:8px 11px;display:flex;gap:8px;align-items:center;cursor:pointer;font-weight:800}.khd-wallet-launcher span{opacity:.75;font-size:12px}.khd-wallet-backdrop{position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.42);display:flex;justify-content:flex-end}.khd-wallet-panel{width:min(430px,100vw);height:100%;overflow:auto;background:#fff;color:#172033;padding:22px;box-shadow:-20px 0 50px rgba(15,23,42,.22)}.khd-wallet-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e5eaf2;padding-bottom:16px;margin-bottom:18px}.khd-wallet-header small{color:#64748b;text-transform:uppercase;font-size:11px;font-weight:700}.khd-wallet-header h2{font-size:34px;margin:4px 0}.khd-wallet-header button{border:0;background:#f1f5f9;border-radius:10px;width:36px;height:36px;font-size:24px;cursor:pointer}.khd-wallet-section{border:1px solid #e5eaf2;border-radius:16px;padding:16px;margin:14px 0}.khd-wallet-section h3{margin:0 0 12px}.khd-wallet-copy{color:#475467;line-height:1.55;font-size:14px}.khd-wallet-support,.khd-wallet-order button{display:inline-flex;justify-content:center;border:0;border-radius:10px;background:#155eef;color:#fff;padding:10px 12px;font-weight:700;text-decoration:none;cursor:pointer}.khd-wallet-order button:disabled{opacity:.55;cursor:not-allowed}.khd-wallet-order{display:grid;gap:8px;border-top:1px solid #eef2f7;padding:12px 0}.khd-wallet-order:first-of-type{border-top:0}.khd-wallet-order strong{display:block}.khd-wallet-order small{display:block;color:#64748b}.khd-wallet-order>div:last-of-type{display:flex;justify-content:space-between;align-items:center;gap:10px}.khd-wallet-small-link{font-size:12px;color:#155eef}.khd-wallet-tx{display:flex;justify-content:space-between;border-top:1px solid #eef2f7;padding:9px 0;text-transform:capitalize}.khd-wallet-note,.khd-wallet-success,.khd-wallet-error{border-radius:12px;padding:10px 12px;margin:10px 0;font-size:14px}.khd-wallet-note{background:#eff6ff;color:#1d4ed8}.khd-wallet-success{background:#ecfdf3;color:#027a48}.khd-wallet-error{background:#fff1f0;color:#b42318}.khd-wallet-empty{color:#64748b;margin:0;font-size:14px}@media(max-width:900px){.khd-wallet-launcher{right:76px;top:90px;padding:7px 9px}.khd-wallet-launcher span{display:none}}@media(max-width:640px){.khd-wallet-launcher{right:66px;top:86px}.khd-wallet-panel{width:100vw}}`;
  document.head.appendChild(style);
}

function mountWallet() {
  if ((window as any).__khdWalletMounted) return;
  (window as any).__khdWalletMounted = true;
  const node = document.createElement("div");
  node.id = "khd-wallet-root";
  document.body.appendChild(node);
  createRoot(node).render(<WalletWidget />);
}

installLegacyCheckoutBlock();
installHashNavigationFix();
injectStyles();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountWallet, { once: true });
else mountWallet();
