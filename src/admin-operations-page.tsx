import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { adminApi, formatDate, formatMoney, operationsMonitorApi } from "./api";

type Row = Record<string, any>;
type ProviderBalance = {
  environment: "ote" | "production";
  label: string;
  currency: string;
  rawBalanceKey: "usdBalance";
  balance: number | null;
  balanceText: string | null;
  httpStatus?: number;
  dnaVersion: string;
  error?: string;
};
type ProviderBalanceSnapshot = {
  ok: boolean;
  dnaVersion: string;
  credentialModel: string;
  currentEnvironment: "ote" | "production";
  paymentSandbox: boolean;
  maintenanceMode: boolean;
  lowBalanceThresholdUsd: number;
  balances: ProviderBalance[];
  generatedAt: string;
};

export function isAdminOperationsPage(pathname = window.location.pathname): boolean {
  return pathname === "/admin/operations" || pathname === "/admin/provider";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

async function providerBalances(): Promise<ProviderBalanceSnapshot> {
  const response = await fetch("/api/domain-provider-balances", { credentials: "include", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.message || `Provider balance request failed (${response.status}).`));
  return payload as ProviderBalanceSnapshot;
}

function Badge({ value }: { value?: string | null }) {
  const v = String(value || "unknown");
  return <span className={`status status-${v.toLowerCase().replaceAll("_", "-").replaceAll(" / ", "-")}`}>{v.replaceAll("_", " ")}</span>;
}

function AdminShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const links = [["/admin", "Main"], ["/admin/provider", "Provider"], ["/admin/operations", "Operations"], ["/admin/tlds", "TLDs"], ["/admin/logs", "Logs"], ["/admin/cron", "Crons"]];
  return <main className="admin-main">
    <div className="admin-topbar"><nav className="admin-nav-inline">{links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav></div>
    <div className="page-heading"><div><span className="kicker">KmerHosting Domains</span><h1>{title}</h1><p>{subtitle}</p></div></div>
    {children}
  </main>;
}

function Loading() { return <div className="loading">Loading…</div>; }

function BalanceCard({ item, active }: { item?: ProviderBalance; active: boolean }) {
  if (!item) return <div className="stat-card"><span>Unavailable</span><strong>—</strong></div>;
  return <div className="stat-card">
    <span>{item.label} {active ? "· CURRENT" : ""}</span>
    <strong>{item.balance === null ? "Unavailable" : formatMoney(item.balance)}</strong>
    <small>DomainNameAPI V{item.dnaVersion} · field: {item.rawBalanceKey}{item.error ? ` · ${item.error}` : ""}</small>
  </div>;
}

function ProviderPage() {
  const balance = useQuery({ queryKey: ["admin-provider-separated-balances"], queryFn: providerBalances, refetchInterval: 60_000 });
  const tx = useQuery({ queryKey: ["admin-provider-transactions-real"], queryFn: () => adminApi<Row>("/provider/transactions?limit=20"), refetchInterval: 120_000 });
  const test = balance.data?.balances.find((item) => item.environment === "ote");
  const live = balance.data?.balances.find((item) => item.environment === "production");
  const txRows = Array.isArray(tx.data?.provider?.items) ? tx.data.provider.items : Array.isArray(tx.data?.provider) ? tx.data.provider : Array.isArray(tx.data?.items) ? tx.data.items : [];
  return <AdminShell title="Provider environments" subtitle="DomainNameAPI TEST/OTE and LIVE/production are displayed as separate accounts and balances.">
    <div className="dashboard-grid">
      <section className="card full-width">
        <div className="card-heading"><div><h2>Environment separation</h2><p>Balances are fetched independently from OTE and production. No alias is used: USD is read from the real DomainNameAPI field <code>usdBalance</code>.</p></div><Badge value={balance.data?.currentEnvironment === "production" ? "LIVE" : "TEST / OTE"} /></div>
        {balance.isPending ? <Loading /> : balance.isError ? <div className="alert alert-error">{errorText(balance.error)}</div> : <>
          <div className="stats-grid">
            <BalanceCard item={test} active={balance.data.currentEnvironment === "ote"} />
            <BalanceCard item={live} active={balance.data.currentEnvironment === "production"} />
            <div className="stat-card"><span>Payment sandbox</span><strong>{balance.data.paymentSandbox ? "ON" : "OFF"}</strong><small>Independent from registrar environment.</small></div>
            <div className="stat-card"><span>Maintenance</span><strong>{balance.data.maintenanceMode ? "ON" : "OFF"}</strong><small>Low balance threshold: {formatMoney(balance.data.lowBalanceThresholdUsd)}</small></div>
          </div>
          <div className="alert alert-warning"><strong>Important:</strong> TEST/OTE balance and LIVE balance are unrelated. A test balance can never be used to authorize a production order.</div>
        </>}
      </section>
      <section className="card full-width"><div className="card-heading"><div><h2>LIVE provider transactions</h2><p>Transaction history remains explicitly production-only.</p></div><Badge value="LIVE" /></div>
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
      <section className="card full-width"><div className="card-heading"><div><h2>Readiness</h2><p>Operational state by current registrar environment.</p></div><Badge value={data?.config?.registrar_environment} /></div>
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
