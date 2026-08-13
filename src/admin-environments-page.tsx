import { useEffect, useState } from "react";

type EnvironmentName = "ote" | "production";
type EnvironmentRow = {
  environment: EnvironmentName;
  display_name: string;
  is_test: boolean;
  enabled: boolean;
  customer_checkout_enabled: boolean;
  domains: number;
  orders: number;
  open_jobs: number;
  dns_records: number;
};
type RegistrarAccount = {
  environment: EnvironmentName;
  label: string;
  source: "DomainNameAPI";
  sourceOfTruth: boolean;
  httpStatus?: number;
  usdBalance?: number | null;
  tryBalance?: number | null;
  tryBalanceCurrency?: string;
  endpoint?: string;
  error?: string;
};
type CustomerCreditRow = {
  user_id: string;
  email: string;
  role: string;
  status: string;
  ote_balance_usd: number | string;
  production_balance_usd: number | string;
  checkout_environment: EnvironmentName;
  checkout_balance_usd: number | string;
};
type Payload = {
  config: {
    customer_checkout_environment: EnvironmentName;
    registrar_environment: EnvironmentName;
    maintenance_mode: boolean;
    payment_mode: string;
    wallet_topup_mode: string;
  };
  environments: EnvironmentRow[];
  registrarAccounts: RegistrarAccount[];
  customerCredits: {
    source: string;
    sourceOfTruthForCustomerBilling: boolean;
    notDomainNameApiBalance: boolean;
    rows: CustomerCreditRow[];
  };
  semantics: {
    oteProviderBalance: string;
    liveProviderBalance: string;
    tryBalance: string;
    customerCredit: string;
  };
  generatedAt: string;
};

export function isAdminEnvironmentsPage(pathname = window.location.pathname) {
  return pathname === "/admin/environments";
}

const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));

function EnvBadge({ env }: { env: EnvironmentName }) {
  return <span className={env === "ote" ? "khd-env-tag khd-env-test" : "khd-env-tag khd-env-live"}>{env === "ote" ? "TEST / OTE" : "LIVE / PRODUCTION"}</span>;
}

export function AdminEnvironmentsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/environment-status", { credentials: "include", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
      setData(payload as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load environment status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return <main className="admin-main"><style>{`
    .env-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;margin:18px 0}.env-card{border:1px solid #e2e8f0;border-radius:16px;padding:20px;background:#fff}.env-card.test{background:#fffaf5;border-color:#fed7aa}.env-card.live{background:#f7fff9;border-color:#bbf7d0}.env-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.env-balance{font-size:30px;font-weight:800;margin:18px 0 4px}.env-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.env-meta div{padding:12px;border-radius:12px;background:rgba(255,255,255,.72);border:1px solid #e2e8f0}.env-meta span{display:block;font-size:12px;color:#64748b}.env-meta strong{display:block;margin-top:4px}.khd-env-tag{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:900}.khd-env-test{background:#ffedd5;color:#9a3412}.khd-env-live{background:#dcfce7;color:#166534}.checkout-note{padding:14px 16px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px}.credit-live{font-weight:800;color:#166534}.credit-test{font-weight:800;color:#9a3412}.source-label{display:inline-flex;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px;font-weight:800}.explain{color:#475569;line-height:1.55}.provider-field{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}`}</style>
    <div className="page-heading"><div><span className="kicker">Environment isolation</span><h1>DomainNameAPI TEST vs LIVE</h1><p>Registrar funds come only from DomainNameAPI. Customer credits are a separate KmerHosting billing ledger and are never treated as registrar funds.</p></div><div className="heading-actions"><a className="button button-secondary" href="/admin">Admin</a><button className="button button-primary" onClick={() => void load()} disabled={loading}>Refresh from DNA</button></div></div>
    {error && <div className="alert alert-error">{error}</div>}
    {loading && !data ? <div className="loading">Reading DomainNameAPI balances…</div> : data && <>
      <div className="checkout-note"><strong>Environment for new orders:</strong> <EnvBadge env={data.config.customer_checkout_environment} />. Existing domains, orders, DNS records and jobs keep their original immutable environment.</div>

      <div className="env-grid">{data.environments.map((env) => {
        const registrar = data.registrarAccounts.find((item) => item.environment === env.environment);
        return <section className={`env-card ${env.is_test ? "test" : "live"}`} key={env.environment}>
          <div className="env-top"><div><EnvBadge env={env.environment} /><h2>{env.display_name}</h2></div><span className="source-label">DomainNameAPI source</span></div>
          {registrar?.error ? <div className="alert alert-error">{registrar.error}</div> : <>
            <div className="env-balance">{money(registrar?.usdBalance)}</div>
            <small><strong>DNA reseller USD balance</strong> · field <span className="provider-field">usdBalance</span> · read directly from {env.environment === "ote" ? "OTE" : "production"} API</small>
            <p className="explain">DNA also returned <span className="provider-field">tryBalance</span> = {Number(registrar?.tryBalance || 0).toFixed(2)} TRY. This is the Turkish-lira balance, not a TEST balance.</p>
          </>}
          <div className="env-meta"><div><span>Domains</span><strong>{env.domains}</strong></div><div><span>Orders</span><strong>{env.orders}</strong></div><div><span>DNS records</span><strong>{env.dns_records}</strong></div><div><span>Open jobs</span><strong>{env.open_jobs}</strong></div></div>
        </section>;
      })}</div>

      <section className="card"><div className="card-heading"><div><h2>KmerHosting customer credits</h2><p>These are customer billing credits, not DomainNameAPI reseller balances. They exist because DNA exposes the reseller account balance, not a balance for each KmerHosting customer.</p></div><span className="source-label">KmerHosting ledger</span></div>
        <div className="alert alert-info"><strong>Important:</strong> a TEST customer credit cannot fund a LIVE order. A LIVE customer credit cannot fund an OTE order. Provider capacity is checked separately against the real DNA <span className="provider-field">usdBalance</span>.</div>
        <div className="table-wrap"><table><thead><tr><th>User</th><th>TEST customer credit</th><th>LIVE customer credit</th><th>Credit used by current checkout</th><th>Status</th></tr></thead><tbody>{data.customerCredits.rows.map((credit) => <tr key={credit.user_id}><td><strong>{credit.email}</strong><small>{credit.role}</small></td><td className="credit-test">{money(credit.ote_balance_usd)}</td><td className="credit-live">{money(credit.production_balance_usd)}</td><td>{money(credit.checkout_balance_usd)} <small>{credit.checkout_environment}</small></td><td>{credit.status}</td></tr>)}</tbody></table></div>
      </section>

      <section className="card"><h2>Balance rules</h2><div className="activity-list"><div className="activity-item"><div className="activity-dot" /><div><strong>OTE provider funds</strong><p>{data.semantics.oteProviderBalance}</p></div></div><div className="activity-item"><div className="activity-dot" /><div><strong>LIVE provider funds</strong><p>{data.semantics.liveProviderBalance}</p></div></div><div className="activity-item"><div className="activity-dot" /><div><strong>tryBalance</strong><p>{data.semantics.tryBalance}</p></div></div><div className="activity-item"><div className="activity-dot" /><div><strong>Customer credit</strong><p>{data.semantics.customerCredit}</p></div></div></div></section>
    </>}
  </main>;
}
