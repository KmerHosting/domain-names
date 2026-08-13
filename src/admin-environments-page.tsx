import { useEffect, useState } from "react";

type Env = "ote" | "production";
type Provider = { environment: Env; usdBalance?: number | null; tryBalance?: number | null; error?: string };
type Environment = { environment: Env; display_name: string; is_test: boolean; enabled: boolean; customer_checkout_enabled: boolean; domains: number; orders: number; open_jobs: number; dns_records: number };
type Credit = { user_id: string; email: string; role: string; status: string; ote_balance_usd: number | string; production_balance_usd: number | string; checkout_environment: Env; checkout_balance_usd: number | string };
type Payload = {
  config: { customer_checkout_environment: Env; registrar_environment: Env; maintenance_mode: boolean; payment_mode: string; wallet_topup_mode: string };
  environments: Environment[];
  registrarAccounts: Provider[];
  customerCredits: { rows: Credit[]; notDomainNameApiBalance: boolean };
  semantics: { oteProviderBalance: string; liveProviderBalance: string; tryBalance: string; customerCredit: string };
};

export function isAdminEnvironmentsPage(pathname = window.location.pathname) { return pathname === "/admin/environments"; }
const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
const label = (env: Env) => env === "ote" ? "TEST / OTE" : "LIVE / PRODUCTION";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "include", ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
  return payload;
}

export function AdminEnvironmentsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => { setError(""); try { setData(await request("/api/environment-status")); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load environments."); } };
  useEffect(() => { void load(); }, []);

  const switchTo = async (environment: Env) => {
    if (!data || data.config.customer_checkout_environment === environment) return;
    const text = environment === "production"
      ? "Use LIVE / PRODUCTION for NEW orders? Future paid orders can use real DomainNameAPI funds. Existing TEST records remain TEST."
      : "Use TEST / OTE for NEW orders? Existing LIVE records remain LIVE.";
    if (!confirm(text)) return;
    setBusy(true); setError("");
    try {
      await request("/api/environment-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment, confirm: environment }) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Environment switch failed."); }
    finally { setBusy(false); }
  };

  const addCredit = async (user: Credit, environment: Env) => {
    const raw = prompt(`KmerHosting customer credit in USD for ${user.email} — ${label(environment)}`);
    if (raw === null) return;
    const amountUsd = Number(raw);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) { setError("Enter a positive USD amount."); return; }
    if (!confirm(`Add ${money(amountUsd)} of KmerHosting customer credit to ${label(environment)}? This does NOT modify the DomainNameAPI reseller balance.`)) return;
    const reason = prompt("Reason", "Manual support credit") || "Manual support credit";
    setBusy(true); setError("");
    try {
      await request("/api/environment-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `credit-${environment}-${Date.now()}` },
        body: JSON.stringify({ userId: user.user_id, environment, amountUsd, reason }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Customer credit failed."); }
    finally { setBusy(false); }
  };

  return <main className="admin-main"><style>{`
    .env-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin:18px 0}.env-card{border:1px solid #e2e8f0;border-radius:16px;padding:20px}.env-card.test{background:#fffaf5;border-color:#fed7aa}.env-card.live{background:#f7fff9;border-color:#bbf7d0}.env-tag{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:900}.env-tag.test{background:#ffedd5;color:#9a3412}.env-tag.live{background:#dcfce7;color:#166534}.dna-balance{font-size:30px;font-weight:800;margin:16px 0 4px}.env-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.env-meta>div{padding:10px;border:1px solid #e2e8f0;border-radius:10px;background:#fff}.env-meta span{display:block;font-size:12px;color:#64748b}.env-actions{margin-top:14px}.note{padding:14px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px}.test-credit{font-weight:800;color:#9a3412}.live-credit{font-weight:800;color:#166534}`}</style>
    <div className="page-heading"><div><span className="kicker">Registrar isolation</span><h1>TEST / OTE and LIVE / Production</h1><p>DomainNameAPI reseller funds and KmerHosting customer credits are separate concepts.</p></div><div className="heading-actions"><a className="button button-secondary" href="/admin">Admin</a><button className="button button-primary" disabled={busy} onClick={() => void load()}>Refresh DNA</button></div></div>
    {error && <div className="alert alert-error">{error}</div>}
    {!data ? <div className="loading">Loading…</div> : <>
      <div className="note"><strong>New orders:</strong> {label(data.config.customer_checkout_environment)}. Existing orders, domains, DNS records and jobs keep their immutable original environment.</div>
      <div className="env-grid">{data.environments.map((environment) => {
        const provider = data.registrarAccounts.find((item) => item.environment === environment.environment);
        const current = data.config.customer_checkout_environment === environment.environment;
        return <section key={environment.environment} className={`env-card ${environment.is_test ? "test" : "live"}`}>
          <span className={`env-tag ${environment.is_test ? "test" : "live"}`}>{label(environment.environment)}</span>
          <h2>{environment.display_name}</h2>
          {provider?.error ? <div className="alert alert-error">{provider.error}</div> : <><div className="dna-balance">{money(provider?.usdBalance)}</div><strong>DomainNameAPI reseller USD balance</strong><p><code>usdBalance</code> from the {environment.environment === "ote" ? "OTE" : "production"} API host.</p><small><code>tryBalance</code>: {Number(provider?.tryBalance || 0).toFixed(2)} TRY/TL — currency balance, not TEST balance.</small></>}
          <div className="env-meta"><div><span>Domains</span><strong>{environment.domains}</strong></div><div><span>Orders</span><strong>{environment.orders}</strong></div><div><span>DNS records</span><strong>{environment.dns_records}</strong></div><div><span>Open jobs</span><strong>{environment.open_jobs}</strong></div></div>
          <div className="env-actions">{current ? <span className="status status-active">Current environment for new orders</span> : <button className="button button-secondary" disabled={busy || !environment.enabled} onClick={() => void switchTo(environment.environment)}>Use for new orders</button>}</div>
        </section>;
      })}</div>
      <section className="card"><div className="card-heading"><div><h2>KmerHosting customer credits</h2><p>These credits pay customer orders. They are not DomainNameAPI reseller funds.</p></div></div><div className="alert alert-info">TEST credit pays only OTE orders. LIVE credit pays only production orders. Every order is also independently checked against the real DomainNameAPI <code>usdBalance</code>.</div><div className="table-wrap"><table><thead><tr><th>User</th><th>TEST credit</th><th>LIVE credit</th><th>Actions</th></tr></thead><tbody>{data.customerCredits.rows.map((user) => <tr key={user.user_id}><td><strong>{user.email}</strong><small>{user.role} · {user.status}</small></td><td className="test-credit">{money(user.ote_balance_usd)}</td><td className="live-credit">{money(user.production_balance_usd)}</td><td><div className="heading-actions"><button disabled={busy} onClick={() => void addCredit(user, "ote")}>Add TEST credit</button><button disabled={busy} onClick={() => void addCredit(user, "production")}>Add LIVE credit</button></div></td></tr>)}</tbody></table></div></section>
      <section className="card"><h2>Source-of-truth rules</h2><p><strong>OTE registrar funds:</strong> {data.semantics.oteProviderBalance}</p><p><strong>LIVE registrar funds:</strong> {data.semantics.liveProviderBalance}</p><p><strong>tryBalance:</strong> {data.semantics.tryBalance}</p><p><strong>Customer credit:</strong> {data.semantics.customerCredit}</p></section>
    </>}
  </main>;
}
