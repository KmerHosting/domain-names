import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { adminApi, formatDate, formatMoney, getSession, newIdempotencyKey } from "./api";

type Row = Record<string, any>;
type Tab = "overview" | "users" | "orders" | "domains" | "payments" | "jobs" | "settings";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function Badge({ value }: { value?: string | null }) {
  const text = String(value || "unknown");
  return <span className={`status status-${text.toLowerCase().replaceAll("_", "-")}`}>{text.replaceAll("_", " ")}</span>;
}

function Loading() {
  return <div className="loading">Loading…</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state"><p>{text}</p></div>;
}

function Overview() {
  const query = useQuery({ queryKey: ["admin-summary"], queryFn: () => adminApi<Row>("/summary"), refetchInterval: 30000 });
  if (query.isPending) return <Loading />;
  if (query.isError) return <div className="alert alert-error">{errorText(query.error)}</div>;
  const counts = query.data?.counts || {};
  const revenue = query.data?.revenue || {};
  return <>
    <div className="stats-grid">
      <div><span>Users</span><strong>{counts.users || 0}</strong></div>
      <div><span>Domains</span><strong>{counts.domains || 0}</strong></div>
      <div><span>Orders</span><strong>{counts.orders || 0}</strong></div>
      <div><span>Jobs</span><strong>{counts.jobs || 0}</strong></div>
      <div><span>Wallet revenue</span><strong>{formatMoney(revenue.paidUsd || 0)}</strong></div>
    </div>
    {(query.data?.issues || []).length > 0 && <section className="card"><div className="card-heading"><div><h2>Operational issues</h2><p>Provider, automation and billing issues requiring attention.</p></div></div><div className="activity-list">{query.data.issues.map((item: Row) => <div className="activity-item" key={item.id || item.issue_key}><div className="activity-dot" /><div><strong>{item.title}</strong><p>{item.message}</p><small>{item.severity} · {formatDate(item.updated_at)}</small></div></div>)}</div></section>}
    <div className="dashboard-grid">
      <section className="card"><div className="card-heading"><div><h2>Recent orders</h2></div></div>{(query.data?.recentOrders || []).length ? <div className="activity-list">{query.data.recentOrders.map((item: Row) => <div className="activity-item" key={item.id}><div className="activity-dot" /><div><strong>{item.domain_name}</strong><p>{item.type} · {formatMoney(item.price_usd)}</p><Badge value={item.status} /></div></div>)}</div> : <Empty text="No orders." />}</section>
      <section className="card"><div className="card-heading"><div><h2>Recent jobs</h2></div></div>{(query.data?.recentJobs || []).length ? <div className="activity-list">{query.data.recentJobs.map((item: Row) => <div className="activity-item" key={item.id}><div className="activity-dot" /><div><strong>{item.type}</strong><p>{item.last_error || "No error"}</p><Badge value={item.status} /></div></div>)}</div> : <Empty text="No background jobs." />}</section>
    </div>
  </>;
}

function Users() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-users"], queryFn: () => adminApi<{ users: Row[] }>("/users") });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => adminApi(`/users/${id}`, { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-users"] }) });
  const credit = useMutation({ mutationFn: ({ id, amountUsd, reason }: { id: string; amountUsd: number; reason: string }) => adminApi(`/users/${id}/wallet-credit`, { method: "POST", body: { amountUsd, reason }, idempotencyKey: newIdempotencyKey("manual-credit") }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-users"] }) });
  const addCredit = (user: Row) => {
    const amount = prompt(`USD amount to credit to ${user.email}`);
    if (amount === null) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return alert("Enter a positive USD amount.");
    const reason = prompt("Reason for this manual credit", "Manual support credit") || "Manual support credit";
    credit.mutate({ id: user.id, amountUsd: value, reason });
  };
  return <section className="card"><div className="card-heading"><div><h2>Users and USD balances</h2><p>Balances can only be increased through an audited manual credit. Direct replacement is blocked.</p></div></div>{(query.isError || update.isError || credit.isError) && <div className="alert alert-error">{errorText(query.error || update.error || credit.error)}</div>}{query.isPending ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Balance</th><th>Last login</th><th>Actions</th></tr></thead><tbody>{(query.data?.users || []).map((user) => <tr key={user.id}><td><strong>{user.full_name}</strong><small className="dns-meta">{user.email}</small></td><td><Badge value={user.role} /></td><td><Badge value={user.status} /></td><td>{formatMoney(user.balance_usd)}</td><td>{formatDate(user.last_login_at)}</td><td><div className="heading-actions"><button onClick={() => addCredit(user)}>Add credit</button><button onClick={() => update.mutate({ id: user.id, body: { status: user.status === "active" ? "suspended" : "active" } })}>{user.status === "active" ? "Suspend" : "Activate"}</button><button onClick={() => update.mutate({ id: user.id, body: { role: user.role === "admin" ? "customer" : "admin" } })}>{user.role === "admin" ? "Make customer" : "Make admin"}</button></div></td></tr>)}</tbody></table></div>}</section>;
}

function Orders() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-orders"], queryFn: () => adminApi<{ orders: Row[] }>("/orders"), refetchInterval: 20000 });
  const action = useMutation({ mutationFn: ({ id, action, body }: { id: string; action: string; body?: Row }) => adminApi(`/orders/${id}/${action}`, { method: "POST", body: body || {} }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-orders"] }) });
  return <section className="card"><div className="card-heading"><div><h2>Domain orders</h2><p>Only provider-quoted wallet orders can be retried. Paid failures can be explicitly refunded to the wallet.</p></div></div>{(query.isError || action.isError) && <div className="alert alert-error">{errorText(query.error || action.error)}</div>}{query.isPending ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Domain</th><th>Type</th><th>Environment</th><th>Price</th><th>Status</th><th>Provider quote</th><th>Actions</th></tr></thead><tbody>{(query.data?.orders || []).map((order) => <tr key={order.id}><td>{order.order_number}<small className="dns-meta">{formatDate(order.created_at)}</small></td><td>{order.domain_users?.email || "—"}</td><td><strong>{order.domain_name}</strong></td><td>{order.type}</td><td><Badge value={order.registrar_environment} /></td><td>{formatMoney(order.price_usd)}</td><td><Badge value={order.status} />{order.failure_message && <small className="dns-meta">{order.failure_message}</small>}</td><td>{order.provider_quote_id ? "yes" : "no"}</td><td><div className="heading-actions">{["failed", "processing", "paid"].includes(order.status) && order.provider_quote_id && <button onClick={() => action.mutate({ id: order.id, action: "retry" })}>Retry</button>}{["pending_payment", "payment_pending"].includes(order.status) && <button onClick={() => window.confirm("Cancel this unpaid order?") && action.mutate({ id: order.id, action: "cancel", body: { reason: "Cancelled by administrator" } })}>Cancel</button>}{["paid", "processing", "failed"].includes(order.status) && <button onClick={() => window.confirm("Refund this paid order to the customer wallet?") && action.mutate({ id: order.id, action: "refund", body: { reason: "Refunded by administrator" } })}>Refund</button>}</div></td></tr>)}</tbody></table></div>}</section>;
}

function Domains() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-domains"], queryFn: () => adminApi<{ domains: Row[] }>("/domains"), refetchInterval: 30000 });
  const sync = useMutation({ mutationFn: (id: string) => adminApi(`/domains/${id}/sync`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-domains"] }) });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => adminApi(`/domains/${id}`, { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-domains"] }) });
  return <section className="card"><div className="card-heading"><div><h2>Managed domains</h2><p>Lock, privacy and nameserver changes are provider-backed. There is no destructive local “delete domain” action.</p></div><a className="button button-secondary" href="/admin/provider">Reconcile provider</a></div>{(query.isError || sync.isError || update.isError) && <div className="alert alert-error">{errorText(query.error || sync.error || update.error)}</div>}{query.isPending ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Domain</th><th>Owner</th><th>Environment</th><th>Status</th><th>Expires</th><th>Lock</th><th>Privacy</th><th>Nameservers</th><th>Actions</th></tr></thead><tbody>{(query.data?.domains || []).map((domain) => <tr key={domain.id}><td><strong>{domain.domain_name}</strong><small className="dns-meta">{domain.registrar_domain_id || "no provider id"}</small></td><td>{domain.domain_users?.email || "—"}</td><td><Badge value={domain.registrar_environment} /></td><td><Badge value={domain.status} /></td><td>{formatDate(domain.expires_at)}</td><td>{domain.locked ? "on" : "off"}</td><td>{domain.privacy_enabled ? "on" : "off"}</td><td>{(domain.nameservers || []).join(", ")}</td><td><div className="heading-actions"><button onClick={() => sync.mutate(domain.id)}>Sync</button><button onClick={() => update.mutate({ id: domain.id, body: { locked: !domain.locked } })}>{domain.locked ? "Unlock" : "Lock"}</button><button onClick={() => update.mutate({ id: domain.id, body: { privacyEnabled: !domain.privacy_enabled } })}>{domain.privacy_enabled ? "Disable privacy" : "Enable privacy"}</button></div></td></tr>)}</tbody></table></div>}</section>;
}

function Payments() {
  const query = useQuery({ queryKey: ["admin-payments"], queryFn: () => adminApi<{ payments: Row[] }>("/payments") });
  return <section className="card"><div className="card-heading"><div><h2>Wallet payment history</h2><p>New external payments are blocked. Historical provider rows may remain for accounting evidence.</p></div></div>{query.isPending ? <Loading /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Order</th><th>Provider</th><th>Method</th><th>USD amount</th><th>Status</th></tr></thead><tbody>{(query.data?.payments || []).map((payment) => <tr key={payment.id}><td>{formatDate(payment.created_at)}</td><td>{payment.domain_orders?.order_number || "—"}<small className="dns-meta">{payment.domain_orders?.domain_name}</small></td><td>{payment.provider}</td><td>{payment.payment_method || "—"}</td><td>{formatMoney(payment.amount_usd || 0)}</td><td><Badge value={payment.status} /></td></tr>)}</tbody></table></div>}</section>;
}

function Jobs() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-jobs"], queryFn: () => adminApi<{ jobs: Row[] }>("/jobs"), refetchInterval: 15000 });
  const retry = useMutation({ mutationFn: (id: string) => adminApi(`/jobs/${id}/retry`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-jobs"] }) });
  return <section className="card"><div className="card-heading"><div><h2>Automation jobs</h2><p>Provider writes execute only after a valid wallet payment and production quote.</p></div><a className="button button-secondary" href="/admin/cron">Cron status</a></div>{(query.isError || retry.isError) && <div className="alert alert-error">{errorText(query.error || retry.error)}</div>}{query.isPending ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Job</th><th>Order</th><th>Status</th><th>Attempts</th><th>Run after</th><th>Error</th><th>Action</th></tr></thead><tbody>{(query.data?.jobs || []).map((job) => <tr key={job.id}><td>{job.type}</td><td>{job.domain_orders?.order_number || job.domain_orders?.domain_name || "—"}</td><td><Badge value={job.status} /></td><td>{job.attempts}/{job.max_attempts}</td><td>{formatDate(job.run_after)}</td><td>{job.last_error || "—"}</td><td>{["failed", "dead"].includes(job.status) && <button onClick={() => retry.mutate(job.id)}>Retry</button>}</td></tr>)}</tbody></table></div>}</section>;
}

function Settings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: () => adminApi<{ settings: Row }>("/settings") });
  const save = useMutation({ mutationFn: (body: Row) => adminApi("/settings", { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-settings"] }) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    save.mutate({ supportEmail: data.supportEmail, maintenanceMode: data.maintenanceMode === "on", providerLowBalanceThresholdUsd: Number(data.providerLowBalanceThresholdUsd), defaultNameservers: String(data.defaultNameservers || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean) });
  };
  if (query.isPending) return <Loading />;
  if (query.isError) return <div className="alert alert-error">{errorText(query.error)}</div>;
  const settings = query.data?.settings || {};
  return <section className="card"><div className="card-heading"><div><h2>Platform settings</h2><p>Registrar environment is intentionally locked to production. OTE tests use explicit test-only calls.</p></div></div><form className="form-stack" onSubmit={submit}><label>Support email<input name="supportEmail" type="email" defaultValue={settings.support_email} required /></label><label>Provider low-balance threshold (USD)<input name="providerLowBalanceThresholdUsd" type="number" min="0" step="0.01" defaultValue={settings.provider_low_balance_threshold_usd || 0} /></label><label>Default nameservers<textarea name="defaultNameservers" defaultValue={(settings.default_nameservers || []).join("\n")} required /></label><label><input name="maintenanceMode" type="checkbox" defaultChecked={Boolean(settings.maintenance_mode)} /> Maintenance mode</label><div className="stats-grid"><div><span>Registrar</span><strong>{settings.registrar_environment}</strong></div><div><span>Payments</span><strong>{settings.payment_mode}</strong></div><div><span>Top-up</span><strong>{settings.wallet_topup_mode}</strong></div></div><button className="button button-primary" disabled={save.isPending}>Save settings</button>{save.isSuccess && <div className="alert alert-success">Settings saved.</div>}{save.isError && <div className="alert alert-error">{errorText(save.error)}</div>}</form></section>;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  if (!getSession()) {
    window.location.href = "/login";
    return null;
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "orders", label: "Orders" },
    { id: "domains", label: "Domains" },
    { id: "payments", label: "Wallet" },
    { id: "jobs", label: "Jobs" },
    { id: "settings", label: "Settings" },
  ];
  return <main className="admin-main"><div className="admin-topbar"><a href="/dashboard">← Customer dashboard</a><nav className="admin-nav-inline"><a href="/admin/provider">Provider</a><a href="/admin/tlds">TLDs</a><a href="/admin/logs">Logs</a><a href="/admin/cron">Crons</a></nav></div><div className="page-heading"><div><span className="kicker">KmerHosting Domains</span><h1>Administration</h1><p>Wallet-only billing and production DomainNameAPI operations.</p></div></div><div className="admin-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>{tab === "overview" && <Overview />}{tab === "users" && <Users />}{tab === "orders" && <Orders />}{tab === "domains" && <Domains />}{tab === "payments" && <Payments />}{tab === "jobs" && <Jobs />}{tab === "settings" && <Settings />}</main>;
}
