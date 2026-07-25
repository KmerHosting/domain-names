import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, formatDate, formatMoney, getSession, subscribeSession, walletApi } from "./api";

type WalletOrder = {
  id: string;
  order_number: string;
  type: string;
  domain_name: string;
  status: string;
  price_usd: number | string;
  amount_xaf: number | string;
  created_at: string;
  domain_payments?: Array<{ id: string; status: string; checkout_url?: string | null; created_at?: string | null }>;
};

type WalletSummary = {
  balanceUsd: number;
  topups: Array<Record<string, any>>;
  transactions: Array<Record<string, any>>;
  orders: WalletOrder[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unexpected error.");
}

function normalizeAvailabilityResult(result: any) {
  const registrar = result?.registrar || {};
  const status = String(
    registrar.info?.status ??
    registrar.data?.info?.status ??
    registrar.data?.status ??
    registrar.status ??
    registrar.available ??
    registrar.isAvailable ??
    "",
  ).toLowerCase().replace(/[\s_-]+/g, "");

  const available = registrar.success !== false && ["available", "true", "free", "1"].includes(status);
  const unavailable = ["notavailable", "unavailable", "registered", "taken", "false", "0"].includes(status);

  if (available || unavailable) {
    result.registrar = {
      ...registrar,
      available,
      isAvailable: available,
      status: available ? "available" : "unavailable",
    };
  }
  return result;
}

function installFetchNormalizer() {
  if ((window as any).__khdFetchNormalizerInstalled) return;
  (window as any).__khdFetchNormalizerInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("/domain-api/domains/check")) return response;

    try {
      const payload = await response.clone().json();
      if (Array.isArray(payload?.results)) {
        payload.results = payload.results.map(normalizeAvailabilityResult);
        const headers = new Headers(response.headers);
        headers.set("Content-Type", "application/json; charset=utf-8");
        return new Response(JSON.stringify(payload), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    } catch {
      return response;
    }
    return response;
  };
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

function WalletWidget() {
  const [hasSession, setHasSession] = useState(Boolean(getSession()));
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [topupAmount, setTopupAmount] = useState("25");
  const [topupPhone, setTopupPhone] = useState("");
  const [topupMethod, setTopupMethod] = useState("orange_money");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [checkingTopup, setCheckingTopup] = useState(false);

  const walletTopupId = useMemo(() => new URLSearchParams(window.location.search).get("walletTopup"), []);

  useEffect(() => subscribeSession(() => setHasSession(Boolean(getSession()))), []);

  async function loadSummary() {
    if (!getSession()) return;
    setLoading(true);
    setError("");
    try {
      const data = await walletApi<WalletSummary>("/summary");
      setSummary(data);
    } catch (err) {
      setError(errorMessage(err));
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

  useEffect(() => {
    if (!walletTopupId || !hasSession) return;
    setOpen(true);
    setCheckingTopup(true);
    walletApi<{ topup: Record<string, any>; result?: Record<string, any> }>("/topups/check", {
      method: "POST",
      body: { topupId: walletTopupId },
    })
      .then((result) => {
        const status = result.topup?.status;
        setMessage(status === "credited" ? "Balance recharged successfully." : `Top-up status: ${status || "pending"}.`);
        return loadSummary();
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setCheckingTopup(false));
  }, [walletTopupId, hasSession]);

  async function submitTopup(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const result = await walletApi<{ checkoutUrl: string }>("/topups", {
        method: "POST",
        body: { amountUsd: Number(topupAmount), phone: topupPhone, paymentMethod: topupMethod },
      });
      window.location.assign(result.checkoutUrl);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  async function payWithBalance(orderId: string) {
    setBusyOrderId(orderId);
    setError("");
    setMessage("");
    try {
      await walletApi("/pay-order", { method: "POST", body: { orderId } });
      setMessage("Order paid from balance. Registrar processing is queued.");
      await loadSummary();
      window.setTimeout(() => window.location.assign("/dashboard/orders"), 900);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyOrderId(null);
    }
  }

  const payableOrders = (summary?.orders || []).filter((order) =>
    ["pending_payment", "payment_pending"].includes(order.status) &&
    !order.domain_payments?.some((payment) => payment.status === "paid"),
  );

  if (!hasSession) return null;

  return (
    <>
      <button className="khd-wallet-launcher" onClick={() => setOpen(true)}>
        <span>Balance</span>
        <strong>{formatMoney(summary?.balanceUsd || 0)}</strong>
      </button>
      {open && (
        <div className="khd-wallet-backdrop">
          <aside className="khd-wallet-panel" aria-label="Rechargeable balance">
            <div className="khd-wallet-header">
              <div>
                <small>Rechargeable balance</small>
                <h2>{formatMoney(summary?.balanceUsd || 0)}</h2>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close wallet">×</button>
            </div>

            {loading && <div className="khd-wallet-note">Loading wallet…</div>}
            {checkingTopup && <div className="khd-wallet-note">Checking top-up status…</div>}
            {error && <div className="khd-wallet-error">{error}</div>}
            {message && <div className="khd-wallet-success">{message}</div>}

            <section className="khd-wallet-section">
              <h3>Recharge balance</h3>
              <form onSubmit={submitTopup} className="khd-wallet-form">
                <label>Amount in USD<input type="number" min="5" max="5000" step="1" value={topupAmount} onChange={(event) => setTopupAmount(event.target.value)} /></label>
                <label>Payment phone<input value={topupPhone} onChange={(event) => setTopupPhone(event.target.value)} placeholder="2376…" /></label>
                <label>Method<select value={topupMethod} onChange={(event) => setTopupMethod(event.target.value)}><option value="orange_money">Orange Money</option><option value="mtn_momo">MTN MoMo</option><option value="stripe">Card</option><option value="paypal">PayPal</option></select></label>
                <button disabled={loading}>Recharge with CamerPay</button>
              </form>
            </section>

            <section className="khd-wallet-section">
              <h3>Pay orders with balance</h3>
              {payableOrders.length ? payableOrders.map((order) => {
                const enough = Number(summary?.balanceUsd || 0) >= Number(order.price_usd || 0);
                return (
                  <div className="khd-wallet-order" key={order.id}>
                    <div><strong>{order.domain_name}</strong><small>{order.order_number} · {order.type} · {formatDate(order.created_at)}</small></div>
                    <div><span>{formatMoney(order.price_usd)}</span><button disabled={!enough || busyOrderId === order.id} onClick={() => payWithBalance(order.id)}>{busyOrderId === order.id ? "Paying…" : enough ? "Pay with balance" : "Insufficient"}</button></div>
                  </div>
                );
              }) : <p className="khd-wallet-empty">No pending order can be paid from balance.</p>}
            </section>

            <section className="khd-wallet-section">
              <h3>Recent transactions</h3>
              {summary?.transactions?.length ? summary.transactions.slice(0, 5).map((tx) => (
                <div className="khd-wallet-tx" key={tx.id}><span>{String(tx.transaction_type).replaceAll("_", " ")}</span><strong>{formatMoney(tx.amount_usd)}</strong></div>
              )) : <p className="khd-wallet-empty">No wallet transaction yet.</p>}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function mountWallet() {
  if ((window as any).__khdWalletMounted) return;
  (window as any).__khdWalletMounted = true;
  const node = document.createElement("div");
  node.id = "khd-wallet-root";
  document.body.appendChild(node);
  createRoot(node).render(<WalletWidget />);
}

function injectWalletStyles() {
  if (document.getElementById("khd-wallet-styles")) return;
  const style = document.createElement("style");
  style.id = "khd-wallet-styles";
  style.textContent = `
    .khd-wallet-launcher{position:fixed;right:18px;bottom:18px;z-index:60;border:0;border-radius:999px;background:#155eef;color:white;box-shadow:0 16px 38px rgba(21,94,239,.28);padding:11px 16px;display:flex;gap:10px;align-items:center;cursor:pointer;font-weight:700}.khd-wallet-launcher span{opacity:.85;font-size:12px}.khd-wallet-backdrop{position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.42);display:flex;justify-content:flex-end}.khd-wallet-panel{width:min(430px,100vw);height:100%;overflow:auto;background:#fff;color:#172033;padding:22px;box-shadow:-20px 0 50px rgba(15,23,42,.22)}.khd-wallet-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e5eaf2;padding-bottom:16px;margin-bottom:18px}.khd-wallet-header small{color:#64748b;text-transform:uppercase;font-size:11px;font-weight:700}.khd-wallet-header h2{font-size:34px;margin:4px 0}.khd-wallet-header button{border:0;background:#f1f5f9;border-radius:10px;width:36px;height:36px;font-size:24px;cursor:pointer}.khd-wallet-section{border:1px solid #e5eaf2;border-radius:16px;padding:16px;margin:14px 0}.khd-wallet-section h3{margin:0 0 12px}.khd-wallet-form{display:grid;gap:10px}.khd-wallet-form label{display:grid;gap:6px;font-size:13px;color:#475467}.khd-wallet-form input,.khd-wallet-form select{border:1px solid #d8e0eb;border-radius:10px;padding:10px 12px;font:inherit;color:#172033;background:#fff}.khd-wallet-form button,.khd-wallet-order button{border:0;border-radius:10px;background:#155eef;color:#fff;padding:10px 12px;font-weight:700;cursor:pointer}.khd-wallet-form button:disabled,.khd-wallet-order button:disabled{opacity:.55;cursor:not-allowed}.khd-wallet-order{display:grid;gap:8px;border-top:1px solid #eef2f7;padding:12px 0}.khd-wallet-order:first-of-type{border-top:0}.khd-wallet-order strong{display:block}.khd-wallet-order small{display:block;color:#64748b}.khd-wallet-order>div:last-child{display:flex;justify-content:space-between;align-items:center;gap:10px}.khd-wallet-tx{display:flex;justify-content:space-between;border-top:1px solid #eef2f7;padding:9px 0;text-transform:capitalize}.khd-wallet-note,.khd-wallet-success,.khd-wallet-error{border-radius:12px;padding:10px 12px;margin:10px 0;font-size:14px}.khd-wallet-note{background:#eff6ff;color:#1d4ed8}.khd-wallet-success{background:#ecfdf3;color:#027a48}.khd-wallet-error{background:#fff1f0;color:#b42318}.khd-wallet-empty{color:#64748b;margin:0;font-size:14px}@media(max-width:640px){.khd-wallet-launcher{right:12px;bottom:12px}.khd-wallet-panel{width:100vw}}`;
  document.head.appendChild(style);
}

installFetchNormalizer();
installHashNavigationFix();
injectWalletStyles();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountWallet, { once: true });
} else {
  mountWallet();
}
