import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CreditCard,
  Database,
  FileText,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { FormEvent, ReactNode, useMemo, useState } from "react";
import { adminApi, api, clearSession, formatDate, formatMoney, getSession, type User } from "./api";

type AdminSummary = {
  counts: Record<string, number>;
  revenue: { paidUsd: number; paidXaf: number };
  orderStatus: Record<string, number>;
  jobStatus: Record<string, number>;
  issues: Array<{ issue: string; count: number | string }>;
  recentOrders: Array<Record<string, any>>;
  recentJobs: Array<Record<string, any>>;
};

type AdminTab = "overview" | "users" | "orders" | "domains" | "payments" | "tlds" | "jobs" | "settings";

function adminError(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Request failed.");
}

function StatusBadge({ value }: { value?: string | null }) {
  const text = String(value || "unknown").replaceAll("_", " ");
  const cls = String(value || "unknown").toLowerCase().replaceAll("_", "-");
  return <span className={`status status-${cls}`}>{text}</span>;
}

function moneyOrDash(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? formatMoney(n) : "—";
}

function AdminMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: string }) {
  return <div className="admin-metric"><div className="admin-metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

function AdminTable({ children }: { children: ReactNode }) {
  return <div className="admin-table-wrap"><table>{children}</table></div>;
}

function AdminPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="card admin-card"><div className="card-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>{children}</section>;
}

function useAdminGuard() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<{ user: User }>("/me"), enabled: Boolean(getSession()) });
}

function OverviewTab({ summary }: { summary?: AdminSummary }) {
  if (!summary) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading admin summary</div>;
  const issueCount = summary.issues.reduce((total, item) => total + Number(item.count || 0), 0);
  return <>
    <div className="admin-metrics-grid">
      <AdminMetric icon={<UserRound />} label="Users" value={summary.counts.users || 0} />
      <AdminMetric icon={<Globe2 />} label="Domains" value={summary.counts.domains || 0} />
      <AdminMetric icon={<CreditCard />} label="Paid revenue" value={formatMoney(summary.revenue.paidUsd || 0)} hint={formatMoney(summary.revenue.paidXaf || 0, "XAF")} />
      <AdminMetric icon={<AlertTriangle />} label="Open issues" value={issueCount} hint="jobs, DNS and delayed orders" />
    </div>
    <div className="dashboard-grid">
      <AdminPanel title="Operational issues" description="Quick health view from the database.">
        <div className="admin-issue-list">{summary.issues.map((item) => <div key={item.issue}><span>{item.issue.replaceAll("_", " ")}</span><strong>{item.count}</strong></div>)}</div>
      </AdminPanel>
      <AdminPanel title="Recent registrar jobs" description="Latest background jobs.">
        {summary.recentJobs.length ? <AdminTable><thead><tr><th>Type</th><th>Status</th><th>Updated</th><th>Error</th></tr></thead><tbody>{summary.recentJobs.slice(0, 8).map((job) => <tr key={job.id}><td>{job.type}</td><td><StatusBadge value={job.status} /></td><td>{formatDate(job.updated_at)}</td><td className="admin-small-cell">{job.last_error || "—"}</td></tr>)}</tbody></AdminTable> : <p className="admin-empty">No recent jobs.</p>}
      </AdminPanel>
    </div>
  </>;
}

function UsersTab() {
  const query = useQuery({ queryKey: ["admin", "users"], queryFn: () => adminApi<{ users: Array<Record<string, any>> }>("/users") });
  const client = useQueryClient();
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => adminApi(`/users/${id}`, { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "users"] }) });
  if (query.isPending) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading users</div>;
  if (query.isError) return <div className="alert alert-error">{adminError(query.error)}</div>;
  return <AdminPanel title="Users" description="Suspend accounts, restore accounts and adjust wallet balance when needed.">
    <AdminTable><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Balance</th><th>Last login</th><th>Actions</th></tr></thead><tbody>{query.data.users.map((user) => <tr key={user.id}><td><strong>{user.full_name}</strong><small>{user.email}</small></td><td>{user.role}</td><td><StatusBadge value={user.status} /></td><td>{formatMoney(user.balance_usd || 0)}</td><td>{formatDate(user.last_login_at)}</td><td><div className="admin-actions"><button disabled={user.role === "admin" && user.status === "active"} title={user.role === "admin" ? "The active admin account cannot suspend itself." : undefined} onClick={() => update.mutate({ id: user.id, body: { status: user.status === "active" ? "suspended" : "active" } })}>{user.status === "active" ? "Suspend" : "Activate"}</button><button onClick={() => { const v = prompt("New USD balance", String(user.balance_usd || 0)); if (v !== null) update.mutate({ id: user.id, body: { balanceUsd: Number(v) } }); }}>Set balance</button></div></td></tr>)}</tbody></AdminTable>
    {update.isError && <div className="alert alert-error">{adminError(update.error)}</div>}
  </AdminPanel>;
}

function OrdersTab() {
  const query = useQuery({ queryKey: ["admin", "orders"], queryFn: () => adminApi<{ orders: Array<Record<string, any>> }>("/orders") });
  const client = useQueryClient();
  const retry = useMutation({ mutationFn: (id: string) => adminApi(`/orders/${id}/retry`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "orders"] }) });
  const cancel = useMutation({ mutationFn: (id: string) => adminApi(`/orders/${id}/cancel`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "orders"] }) });
  if (query.isPending) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading orders</div>;
  if (query.isError) return <div className="alert alert-error">{adminError(query.error)}</div>;
  return <AdminPanel title="Orders" description="Retry failed provisioning and cancel unpaid orders.">
    <AdminTable><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th><th>Payment</th><th>Actions</th></tr></thead><tbody>{query.data.orders.map((order) => { const payment = [...(order.domain_payments || [])].sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime())[0]; return <tr key={order.id}><td><strong>{order.domain_name}</strong><small>{order.order_number} · {order.type} · {formatDate(order.created_at)}</small>{order.failure_message && <small className="admin-error-text">{order.failure_message}</small>}</td><td>{order.domain_users?.email || "—"}</td><td>{formatMoney(order.price_usd)}<small>{formatMoney(order.amount_xaf, "XAF")}</small></td><td><StatusBadge value={order.status} /></td><td><StatusBadge value={payment?.status || "none"} /></td><td><div className="admin-actions"><button onClick={() => retry.mutate(order.id)} disabled={!['paid','processing','failed'].includes(order.status)}><RotateCcw size={14} /> Retry</button><button onClick={() => cancel.mutate(order.id)} disabled={['paid','processing','completed'].includes(order.status)}><XCircle size={14} /> Cancel</button></div></td></tr>; })}</tbody></AdminTable>
    {(retry.isError || cancel.isError) && <div className="alert alert-error">{adminError(retry.error || cancel.error)}</div>}
  </AdminPanel>;
}

function DomainsTab() {
  const query = useQuery({ queryKey: ["admin", "domains"], queryFn: () => adminApi<{ domains: Array<Record<string, any>> }>("/domains") });
  const client = useQueryClient();
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => adminApi(`/domains/${id}`, { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "domains"] }) });
  if (query.isPending) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading domains</div>;
  if (query.isError) return <div className="alert alert-error">{adminError(query.error)}</div>;
  return <AdminPanel title="Domains" description="Manage local domain state, auto-renew and protection flags.">
    <AdminTable><thead><tr><th>Domain</th><th>Owner</th><th>Status</th><th>Expires</th><th>Flags</th><th>Actions</th></tr></thead><tbody>{query.data.domains.map((domain) => <tr key={domain.id}><td><strong>{domain.domain_name}</strong><small>{domain.tld}</small></td><td>{domain.domain_users?.email || "—"}</td><td><StatusBadge value={domain.status} /></td><td>{formatDate(domain.expires_at)}</td><td><small>Renew: {domain.auto_renew ? "on" : "off"}</small><small>Lock: {domain.locked ? "on" : "off"}</small><small>Privacy: {domain.privacy_enabled ? "on" : "off"}</small></td><td><div className="admin-actions"><button onClick={() => update.mutate({ id: domain.id, body: { autoRenew: !domain.auto_renew } })}>Auto-renew</button><button onClick={() => update.mutate({ id: domain.id, body: { locked: !domain.locked } })}>Lock</button><button onClick={() => update.mutate({ id: domain.id, body: { privacyEnabled: !domain.privacy_enabled } })}>Privacy</button></div></td></tr>)}</tbody></AdminTable>
  </AdminPanel>;
}

function PaymentsTab() {
  const query = useQuery({ queryKey: ["admin", "payments"], queryFn: () => adminApi<{ payments: Array<Record<string, any>> }>("/payments") });
  const invoices = useQuery({ queryKey: ["admin", "invoices"], queryFn: () => adminApi<{ invoices: Array<Record<string, any>> }>("/invoices") });
  if (query.isPending || invoices.isPending) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading billing</div>;
  if (query.isError || invoices.isError) return <div className="alert alert-error">{adminError(query.error || invoices.error)}</div>;
  return <div className="dashboard-grid"><AdminPanel title="Payments" description="Latest direct payments."><AdminTable><thead><tr><th>Payment</th><th>Order</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{query.data.payments.map((payment) => <tr key={payment.id}><td>{payment.merchant_invoice_id || payment.provider_reference || payment.id}</td><td>{payment.domain_orders?.domain_name || "—"}</td><td>{formatMoney(payment.amount_xaf, "XAF")}</td><td><StatusBadge value={payment.status} /></td><td>{formatDate(payment.created_at)}</td></tr>)}</tbody></AdminTable></AdminPanel><AdminPanel title="Invoices" description="Server-generated billing documents."><AdminTable><thead><tr><th>Invoice</th><th>Order</th><th>Amount</th><th>Status</th></tr></thead><tbody>{invoices.data.invoices.map((invoice) => <tr key={invoice.id}><td>{invoice.invoice_number}</td><td>{invoice.domain_orders?.domain_name || "—"}</td><td>{formatMoney(invoice.amount_usd)}<small>{formatMoney(invoice.amount_xaf, "XAF")}</small></td><td><StatusBadge value={invoice.status} /></td></tr>)}</tbody></AdminTable></AdminPanel></div>;
}

function TldsTab() {
  const query = useQuery({ queryKey: ["admin", "tlds"], queryFn: () => adminApi<{ tlds: Array<Record<string, any>> }>("/tlds") });
  const client = useQueryClient();
  const update = useMutation({ mutationFn: ({ tld, body }: { tld: string; body: Record<string, unknown> }) => adminApi(`/tlds/${encodeURIComponent(tld)}`, { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "tlds"] }) });
  if (query.isPending) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading provider TLD catalog</div>;
  if (query.isError) return <div className="alert alert-error">{adminError(query.error)}</div>;
  const rows = (query.data.tlds || []).filter((tld) => Boolean(tld.provider_available));
  return <AdminPanel title="Provider TLD catalog" description="TLDs imported from DomainNameAPI. Customer prices are provider cost +30%."><AdminTable><thead><tr><th>TLD</th><th>Provider cost</th><th>Customer price</th><th>Sync</th><th>Sale status</th><th>Actions</th></tr></thead><tbody>{rows.map((tld) => {
    const canEnable = Number(tld.registration_price_usd || 0) > 0;
    return <tr key={tld.tld}><td><strong>{tld.tld}</strong><small>Provider product: {tld.provider_product_name || tld.tld.replace(".", "")}</small></td><td><small>Register: {moneyOrDash(tld.registration_cost_usd)}</small><small>Renew: {moneyOrDash(tld.renewal_cost_usd)}</small><small>Transfer: {moneyOrDash(tld.transfer_cost_usd)}</small></td><td><small>Register: {moneyOrDash(tld.registration_price_usd)}</small><small>Renew: {moneyOrDash(tld.renewal_price_usd)}</small><small>Transfer: {moneyOrDash(tld.transfer_price_usd)}</small></td><td><StatusBadge value={tld.registration_sync_status || "pending"} /> <small>{formatDate(tld.provider_catalog_seen_at || tld.last_synced_at)}</small></td><td><StatusBadge value={tld.enabled ? "enabled" : "disabled"} /> {tld.popular && <StatusBadge value="popular" />}</td><td><div className="admin-actions"><button disabled={!canEnable && !tld.enabled} title={!canEnable ? "Missing provider registration price." : undefined} onClick={() => update.mutate({ tld: tld.tld, body: { enabled: !tld.enabled } })}>{tld.enabled ? "Disable" : "Enable"}</button><button onClick={() => { const v = prompt(`Customer registration price for ${tld.tld}`, String(tld.registration_price_usd || 0)); if (v !== null) update.mutate({ tld: tld.tld, body: { registrationPriceUsd: Number(v) } }); }}>Set price</button></div></td></tr>;
  })}</tbody></AdminTable>{!rows.length && <p className="admin-empty">No provider TLD catalog imported yet. Use “Import provider TLD catalog”.</p>}</AdminPanel>;
}

function JobsTab() {
  const query = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => adminApi<{ jobs: Array<Record<string, any>> }>("/jobs") });
  const client = useQueryClient();
  const retry = useMutation({ mutationFn: (id: string) => adminApi(`/jobs/${id}/retry`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "jobs"] }) });
  const kill = useMutation({ mutationFn: (id: string) => adminApi(`/jobs/${id}/dead`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "jobs"] }) });
  if (query.isPending) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading jobs</div>;
  if (query.isError) return <div className="alert alert-error">{adminError(query.error)}</div>;
  return <AdminPanel title="Registrar jobs" description="Retry stuck jobs or mark impossible jobs as dead."><AdminTable><thead><tr><th>Job</th><th>Status</th><th>Attempts</th><th>Run after</th><th>Error</th><th>Actions</th></tr></thead><tbody>{query.data.jobs.map((job) => <tr key={job.id}><td><strong>{job.type}</strong><small>{job.id}</small></td><td><StatusBadge value={job.status} /></td><td>{job.attempts}/{job.max_attempts}</td><td>{formatDate(job.run_after)}</td><td className="admin-small-cell">{job.last_error || "—"}</td><td><div className="admin-actions"><button onClick={() => retry.mutate(job.id)}>Retry</button><button onClick={() => kill.mutate(job.id)}>Mark dead</button></div></td></tr>)}</tbody></AdminTable></AdminPanel>;
}

function SettingsTab() {
  const query = useQuery({ queryKey: ["admin", "config"], queryFn: () => adminApi<{ config: Record<string, any> }>("/config") });
  const client = useQueryClient();
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => adminApi("/config", { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "config"] }) });
  if (query.isPending) return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading settings</div>;
  if (query.isError) return <div className="alert alert-error">{adminError(query.error)}</div>;
  const cfg = query.data.config;
  return <AdminPanel title="Settings" description="Safe platform settings. Secrets stay in Supabase Vault."><form className="admin-settings-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const raw = Object.fromEntries(new FormData(event.currentTarget)); update.mutate({ registrarEnvironment: raw.registrarEnvironment, paymentSandbox: raw.paymentSandbox === "on", maintenanceMode: raw.maintenanceMode === "on", usdToXafRate: Number(raw.usdToXafRate), supportEmail: raw.supportEmail, defaultNameservers: String(raw.defaultNameservers || "").split(/[\s,]+/).filter(Boolean) }); }}><label>Registrar environment<select name="registrarEnvironment" defaultValue={cfg.registrar_environment}><option value="ote">OT&E / test</option><option value="production">Production</option></select></label><label>USD to XAF rate<input name="usdToXafRate" type="number" defaultValue={cfg.usd_to_xaf_rate} /></label><label>Support email<input name="supportEmail" type="email" defaultValue={cfg.support_email} /></label><label>Default nameservers<input name="defaultNameservers" defaultValue={(cfg.default_nameservers || []).join(", ")} /></label><label className="checkbox"><input type="checkbox" name="paymentSandbox" defaultChecked={Boolean(cfg.payment_sandbox)} /> CamerPay sandbox mode</label><label className="checkbox"><input type="checkbox" name="maintenanceMode" defaultChecked={Boolean(cfg.maintenance_mode)} /> Maintenance mode</label>{update.isError && <div className="alert alert-error">{adminError(update.error)}</div>}{update.isSuccess && <div className="alert alert-success">Settings saved.</div>}<button className="button button-primary" disabled={update.isPending}>{update.isPending && <LoaderCircle className="spin" size={16} />} Save settings</button></form></AdminPanel>;
}

function AdminContent({ tab, summary }: { tab: AdminTab; summary?: AdminSummary }) {
  if (tab === "overview") return <OverviewTab summary={summary} />;
  if (tab === "users") return <UsersTab />;
  if (tab === "orders") return <OrdersTab />;
  if (tab === "domains") return <DomainsTab />;
  if (tab === "payments") return <PaymentsTab />;
  if (tab === "tlds") return <TldsTab />;
  if (tab === "jobs") return <JobsTab />;
  return <SettingsTab />;
}

export default function AdminPage() {
  const me = useAdminGuard();
  const [tab, setTab] = useState<AdminTab>("overview");
  const summary = useQuery({ queryKey: ["admin", "summary"], queryFn: () => adminApi<AdminSummary>("/summary"), enabled: me.data?.user.role === "admin", refetchInterval: 30_000 });
  const tabs = useMemo(() => [
    ["overview", "Overview", ShieldCheck], ["users", "Users", UserRound], ["orders", "Orders", CreditCard], ["domains", "Domains", Globe2], ["payments", "Payments", FileText], ["tlds", "Provider TLDs", Database], ["jobs", "Jobs", RefreshCw], ["settings", "Settings", Settings2],
  ] as const, []);

  if (!getSession()) return <div className="return-page"><div className="return-card"><LockKeyhole /><h1>Admin access</h1><p>Sign in with the administrator account.</p><a href="/auth" className="button button-primary">Sign in</a></div></div>;
  if (me.isPending) return <div className="return-page"><div className="return-card"><LoaderCircle className="spin" /><h1>Checking admin access</h1></div></div>;
  if (me.isError || me.data?.user.role !== "admin") return <div className="return-page"><div className="return-card"><XCircle className="return-error" /><h1>Access denied</h1><p>This page is reserved for the single platform administrator.</p><a href="/dashboard" className="button button-primary">Open dashboard</a></div></div>;

  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><ShieldCheck /><div><strong>KmerHosting Admin</strong><small>{me.data.user.email}</small></div></div>
      <nav>{tabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={18} /> {label}</button>)}</nav>
      <div className="admin-sidebar-bottom"><a href="/dashboard" className="button button-secondary"><ArrowLeft size={16} /> Customer dashboard</a><button className="button button-ghost" onClick={() => { clearSession(); window.location.assign("/"); }}>Sign out</button></div>
    </aside>
    <main className="admin-main">
      <div className="page-heading"><div><span className="kicker">Single admin account</span><h1>Platform administration</h1><p>Manage users, orders, payments, domains, jobs, provider pricing and platform settings.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => summary.refetch()}><RefreshCw size={16} /> Refresh</button><a href="/" className="button button-primary"><Search size={16} /> Search site</a></div></div>
      {summary.isError && <div className="alert alert-error">{adminError(summary.error)}</div>}
      <AdminContent tab={tab} summary={summary.data} />
    </main>
  </div>;
}
