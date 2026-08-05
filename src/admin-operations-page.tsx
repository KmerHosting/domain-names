import { useQuery } from "@tanstack/react-query";
import { adminApi, formatDate, formatMoney, operationsMonitorApi } from "./api";

type Row = Record<string, any>;

export function isAdminOperationsPage(pathname = window.location.pathname): boolean {
  return pathname === "/admin/operations" || pathname === "/admin/provider";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function valueAt(source: any, paths: string[]): unknown {
  for (const path of paths) {
    let current = source;
    for (const key of path.split(".")) current = current?.[key];
    if (current !== undefined && current !== null && String(current).trim() !== "") return current;
  }
  return undefined;
}

function realUsdBalance(source: any): number | null {
  const value = valueAt(source, ["usdBalance", "provider.usdBalance", "data.usdBalance", "provider.data.usdBalance"]);
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function realTryBalance(source: any): number | null {
  const value = valueAt(source, ["tryBalance", "provider.tryBalance", "data.tryBalance", "provider.data.tryBalance"]);
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function Badge({ value }: { value?: string | null }) {
  const v = String(value || "unknown");
  return <span className={`status status-${v.toLowerCase().replaceAll("_", "-")}`}>{v.replaceAll("_", " ")}</span>;
}

function AdminShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const links = [["/admin", "Main"], ["/admin/provider", "Provider"], ["/admin/operations", "Operations"], ["/admin/tlds", "TLDs"], ["/admin/logs", "Logs"], ["/admin/cron", "Crons"]];
  return <main className="admin-main">
    <div className="admin-topbar"><nav className="admin-nav-inline">{links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav></div>
    <div className="page-heading"><div><span className="kicker">KmerHosting Domains</span><h1>{title}</h1><p>{subtitle}</p></div></div>
    {children}
  </main>;
}

function Loading() { return <div className="loading">Loading…</div>; }

function ProviderPage() {
  const account = useQuery({ queryKey: ["admin-provider-real-balance"], queryFn: () => adminApi<Row>("/provider/account"), refetchInterval: 60_000 });
  const tx = useQuery({ queryKey: ["admin-provider-transactions-real"], queryFn: () => adminApi<Row>("/provider/transactions?limit=20"), refetchInterval: 120_000 });
  const usd = realUsdBalance(account.data);
  const tryBalance = realTryBalance(account.data);
  const txRows = Array.isArray(tx.data?.provider?.items) ? tx.data.provider.items : Array.isArray(tx.data?.provider) ? tx.data.provider : Array.isArray(tx.data?.items) ? tx.data.items : [];
  return <AdminShell title="Provider account" subtitle="DomainNameAPI production account using real response field names.">
    <div className="dashboard-grid">
      <section className="card"><div className="card-heading"><div><h2>Real balances</h2><p>No aliases are used here. The UI reads DomainNameAPI field names directly.</p></div></div>
        {account.isPending ? <Loading /> : account.isError ? <div className="alert alert-error">{errorText(account.error)}</div> : <div className="stats-grid">
          <div className="stat-card"><span>usdBalance</span><strong>{usd === null ? "not returned" : formatMoney(usd)}</strong></div>
          <div className="stat-card"><span>tryBalance</span><strong>{tryBalance === null ? "not returned" : String(tryBalance)}</strong></div>
        </div>}
      </section>
      <section className="card"><div className="card-heading"><div><h2>Provider transactions</h2><p>Recent provider-side account history when returned by the API.</p></div></div>
        {tx.isPending ? <Loading /> : tx.isError ? <div className="alert alert-error">{errorText(tx.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>{txRows.map((r: Row, i: number) => <tr key={r.id || i}><td>{formatDate(r.createdAt || r.date || r.transactionDate)}</td><td>{r.description || r.type || r.transactionType || "transaction"}</td><td>{r.amount ?? r.usdAmount ?? r.price ?? "—"}</td><td><Badge value={r.status || "returned"} /></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  </AdminShell>;
}

function OperationsPage() {
  const q = useQuery({ queryKey: ["admin-operations-summary"], queryFn: () => operationsMonitorApi<Row>("/summary"), refetchInterval: 30_000 });
  const data = q.data;
  return <AdminShell title="Operations" subtitle="Read-only operational cockpit for jobs, payments, DNS, crons and readiness.">
    {q.isPending ? <Loading /> : q.isError ? <div className="alert alert-error">{errorText(q.error)}</div> : <div className="dashboard-grid">
      <section className="card full-width"><div className="card-heading"><div><h2>Readiness</h2><p>Excludes Supabase Advisor security and production-domain absence checks by request.</p></div><Badge value={data?.config?.registrar_environment} /></div>
        <div className="stats-grid">{(data?.readiness || []).map((r: Row) => <div className="stat-card" key={r.key}><span>{r.key}</span><strong>{r.ok ? "OK" : `Attention${r.count !== undefined ? `: ${r.count}` : ""}`}</strong><small>{r.message}</small></div>)}</div>
      </section>
      <section className="card"><h2>Counts</h2><pre className="khd-admin-tools-output">{JSON.stringify(data?.counts || {}, null, 2)}</pre></section>
      <section className="card"><h2>Operational issues</h2><div className="table-wrap"><table><thead><tr><th>Issue</th><th>Count</th></tr></thead><tbody>{(data?.operationalIssues || []).map((r: Row) => <tr key={r.issue}><td>{r.issue}</td><td>{r.count}</td></tr>)}</tbody></table></div></section>
      <section className="card full-width"><div className="card-heading"><div><h2>Dead jobs</h2><p>Historical dead jobs that should be reviewed, archived or retried manually.</p></div><Badge value={String(data?.deadJobs?.length || 0)} /></div><div className="table-wrap"><table><thead><tr><th>Type</th><th>Attempts</th><th>Updated</th><th>Error</th></tr></thead><tbody>{(data?.deadJobs || []).map((r: Row) => <tr key={r.id}><td>{r.type}</td><td>{r.attempts}/{r.max_attempts}</td><td>{formatDate(r.updated_at)}</td><td>{r.last_error || "—"}</td></tr>)}</tbody></table></div></section>
      <section className="card full-width"><h2>Paid refunded orders</h2><div className="table-wrap"><table><thead><tr><th>Order</th><th>Domain</th><th>Type</th><th>Price</th><th>Failure</th></tr></thead><tbody>{(data?.paidRefunded || []).map((r: Row) => <tr key={r.id}><td>{r.order_number}</td><td>{r.domain_name}</td><td>{r.type}</td><td>{formatMoney(r.price_usd)}</td><td>{r.failure_message || "—"}</td></tr>)}</tbody></table></div></section>
      <section className="card full-width"><h2>DNS failed or stale</h2><div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Last operation</th><th>Error</th></tr></thead><tbody>{(data?.staleDns || []).map((r: Row) => <tr key={r.id}><td>{r.name}</td><td>{r.type}</td><td><Badge value={r.status} /></td><td>{r.last_operation || "—"}</td><td>{r.last_error || "—"}</td></tr>)}</tbody></table></div></section>
    </div>}
  </AdminShell>;
}

export function AdminOperationsPage() {
  return window.location.pathname === "/admin/provider" ? <ProviderPage /> : <OperationsPage />;
}