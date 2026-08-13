import { useEffect, useState } from "react";

type EnvironmentRow = {
  environment: "ote" | "production";
  display_name: string;
  is_test: boolean;
  enabled: boolean;
  customer_checkout_enabled: boolean;
  domains: number;
  orders: number;
  open_jobs: number;
  dns_records: number;
  provider_balance_usd: number | string | null;
  provider_balance_checked_at: string | null;
};

type WalletRow = {
  user_id: string;
  email: string;
  role: string;
  status: string;
  ote_balance_usd: number | string;
  production_balance_usd: number | string;
  checkout_environment: string;
  checkout_balance_usd: number | string;
};

type Payload = {
  config: {
    customer_checkout_environment: "ote" | "production";
    registrar_environment: "ote" | "production";
    maintenance_mode: boolean;
    payment_mode: string;
    wallet_topup_mode: string;
  };
  environments: EnvironmentRow[];
  wallets: WalletRow[];
  generatedAt: string;
};

export function isAdminEnvironmentsPage(pathname = window.location.pathname) {
  return pathname === "/admin/environments";
}

const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "Never";

function EnvBadge({ env }: { env: "ote" | "production" }) {
  return <span className={env === "ote" ? "khd-env-tag khd-env-test" : "khd-env-tag khd-env-live"}>{env === "ote" ? "TEST / OTE" : "LIVE / PRODUCTION"}</span>;
}

export function AdminEnvironmentsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/environment-status", { credentials: "include", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
      setData(payload as Payload);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load environment status."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <main className="admin-main"><style>{`
    .env-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;margin:18px 0}.env-card{border:1px solid #e2e8f0;border-radius:16px;padding:20px;background:#fff}.env-card.test{background:#fffaf5;border-color:#fed7aa}.env-card.live{background:#f7fff9;border-color:#bbf7d0}.env-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.env-balance{font-size:30px;font-weight:800;margin:18px 0 4px}.env-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.env-meta div{padding:12px;border-radius:12px;background:rgba(255,255,255,.7);border:1px solid #e2e8f0}.env-meta span{display:block;font-size:12px;color:#64748b}.env-meta strong{display:block;margin-top:4px}.khd-env-tag{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:900}.khd-env-test{background:#ffedd5;color:#9a3412}.khd-env-live{background:#dcfce7;color:#166534}.checkout-note{padding:14px 16px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px}.wallet-live{font-weight:800;color:#166534}.wallet-test{font-weight:800;color:#9a3412}`}</style>
    <div className="page-heading"><div><span className="kicker">Registrar isolation</span><h1>TEST vs LIVE environments</h1><p>OTE and production are separate contexts. Domains, orders, DNS, jobs, provider balances and customer wallets must never cross environments.</p></div><div className="heading-actions"><a className="button button-secondary" href="/admin">Admin</a><button className="button button-primary" onClick={() => void load()} disabled={loading}>Refresh</button></div></div>
    {error && <div className="alert alert-error">{error}</div>}
    {loading && !data ? <div className="loading">Loading environment status…</div> : data && <>
      <div className="checkout-note"><strong>New customer orders:</strong> <EnvBadge env={data.config.customer_checkout_environment} />. Changing this setting must never convert existing records; their environment is immutable.</div>
      <div className="env-grid">{data.environments.map((env) => <section className={`env-card ${env.is_test ? "test" : "live"}`} key={env.environment}><div className="env-top"><div><EnvBadge env={env.environment} /><h2>{env.display_name}</h2></div>{env.customer_checkout_enabled && <span className="status status-active">New orders</span>}</div><div className="env-balance">{money(env.provider_balance_usd)}</div><small>DomainNameAPI USD balance · checked {date(env.provider_balance_checked_at)}</small><div className="env-meta"><div><span>Domains</span><strong>{env.domains}</strong></div><div><span>Orders</span><strong>{env.orders}</strong></div><div><span>DNS records</span><strong>{env.dns_records}</strong></div><div><span>Open jobs</span><strong>{env.open_jobs}</strong></div></div></section>)}</div>
      <section className="card"><div className="card-heading"><div><h2>Customer wallet separation</h2><p>TEST credits cannot be spent on LIVE orders, and LIVE credits cannot be spent on OTE orders.</p></div></div><div className="table-wrap"><table><thead><tr><th>User</th><th>TEST / OTE balance</th><th>LIVE balance</th><th>Checkout balance</th><th>Status</th></tr></thead><tbody>{data.wallets.map((wallet) => <tr key={wallet.user_id}><td><strong>{wallet.email}</strong><small>{wallet.role}</small></td><td className="wallet-test">{money(wallet.ote_balance_usd)}</td><td className="wallet-live">{money(wallet.production_balance_usd)}</td><td>{money(wallet.checkout_balance_usd)} <small>{wallet.checkout_environment}</small></td><td>{wallet.status}</td></tr>)}</tbody></table></div></section>
      <section className="card"><h2>Isolation rules now enforced</h2><p>Each domain, order, quote, DNS record, job, forwarding rule, glue host, payment, invoice and wallet transaction carries a registrar environment. The environment marker is immutable after creation. Child records inherit the environment from their order/domain instead of the current platform mode.</p></section>
    </>}
  </main>;
}
