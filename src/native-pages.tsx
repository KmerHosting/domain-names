import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, adminMonitorApi, customerToolsApi, formatDate, getSession } from "./api";
import { ReactNode } from "react";

type Row = Record<string, any>;
type Route = { kind: "notifications" } | { kind: "admin"; page: "provider" | "cron" | "logs" | "tlds" } | null;

function route(pathname = window.location.pathname): Route {
  if (pathname === "/dashboard/notifications") return { kind: "notifications" };
  if (pathname === "/admin/provider") return { kind: "admin", page: "provider" };
  if (pathname === "/admin/cron") return { kind: "admin", page: "cron" };
  if (pathname === "/admin/logs") return { kind: "admin", page: "logs" };
  if (pathname === "/admin/tlds") return { kind: "admin", page: "tlds" };
  return null;
}

export function isNativePage(pathname = window.location.pathname): boolean { return Boolean(route(pathname)); }

function errorText(error: unknown) { return error instanceof Error ? error.message : "Request failed."; }
function Badge({ value }: { value?: string | null }) { const v = String(value || "unknown"); return <span className={`status status-${v.toLowerCase().replaceAll("_", "-")}`}>{v.replaceAll("_", " ")}</span>; }
function Loading() { return <div className="loading">Loading…</div>; }
function Shell({ title, subtitle, back, children }: { title: string; subtitle: string; back: string; children: ReactNode }) { return <main className="dashboard-main native-page-main"><header className="dashboard-header"><a className="header-action" href={back}>← Back</a></header><div className="dashboard-content"><div className="page-heading"><div><span className="kicker">KmerHosting Domains</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</div></main>; }
function AdminShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { const links = [["/admin","Main"],["/admin/provider","Provider"],["/admin/tlds","TLDs"],["/admin/logs","Logs"],["/admin/cron","Crons"]]; return <main className="admin-main"><div className="admin-topbar"><nav className="admin-nav-inline">{links.map(([href,label]) => <a key={href} href={href}>{label}</a>)}</nav></div><div className="page-heading"><div><span className="kicker">Provider admin</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</main>; }

function NotificationsPage() {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["native-notifications"], queryFn: () => customerToolsApi<{ notifications: Row[]; unread: number }>("/notifications"), refetchInterval: 30000 });
  const readOne = useMutation({ mutationFn: (id: string) => customerToolsApi(`/notifications/${id}/read`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["native-notifications"] }) });
  const readAll = useMutation({ mutationFn: () => customerToolsApi("/notifications/read-all", { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["native-notifications"] }) });
  return <Shell title="Notifications" subtitle="Domain, billing, transfer and account activity." back="/dashboard"><section className="card"><div className="card-heading"><div><h2>Inbox</h2><p>{q.data?.unread || 0} unread.</p></div><button className="button button-secondary" onClick={() => readAll.mutate()}>Read all</button></div>{q.isPending ? <Loading/> : q.isError ? <div className="alert alert-error">{errorText(q.error)}</div> : <div className="activity-list">{(q.data?.notifications || []).map((n) => <div className="activity-item" key={n.id}><div className={n.read_at ? "activity-dot muted" : "activity-dot"}/><div><strong>{n.title}</strong><p>{n.message}</p><small>{formatDate(n.created_at)} · {n.type || "account"}</small>{!n.read_at && <div><button className="button button-secondary" onClick={() => readOne.mutate(n.id)}>Mark as read</button></div>}</div></div>)}</div>}</section></Shell>;
}

function AdminProviderPage() {
  const account = useQuery({ queryKey: ["native-provider-account"], queryFn: () => adminApi<Row>("/provider/account") });
  const tx = useQuery({ queryKey: ["native-provider-transactions"], queryFn: () => adminApi<Row>("/provider/transactions?limit=20") });
  const provider = account.data?.provider || account.data || {};
  const txRows = Array.isArray(tx.data?.provider?.items) ? tx.data.provider.items : Array.isArray(tx.data?.provider) ? tx.data.provider : [];
  return <AdminShell title="Provider account" subtitle="Provider balance and latest transactions."><div className="dashboard-grid"><section className="card"><h2>Account</h2>{account.isPending ? <Loading/> : account.isError ? <div className="alert alert-error">{errorText(account.error)}</div> : <pre className="khd-admin-tools-output">Balance: {provider.balance ?? provider.availableBalance ?? provider.data?.balance ?? "not returned"}</pre>}</section><section className="card"><h2>Transactions</h2>{tx.isPending ? <Loading/> : tx.isError ? <div className="alert alert-error">{errorText(tx.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>{txRows.map((r: Row, i: number) => <tr key={r.id || i}><td>{formatDate(r.createdAt || r.date || r.transactionDate)}</td><td>{r.description || r.type || "transaction"}</td><td>{r.amount || r.price || "—"}</td><td><Badge value={r.status || "ok"}/></td></tr>)}</tbody></table></div>}</section></div></AdminShell>;
}

function AdminCronPage() { const q = useQuery({ queryKey: ["native-cron"], queryFn: () => adminMonitorApi<{ cron: Row[] }>("/cron"), refetchInterval: 30000 }); return <AdminShell title="Cron status" subtitle="Background jobs and last run state."><section className="card">{q.isPending ? <Loading/> : q.isError ? <div className="alert alert-error">{errorText(q.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Job</th><th>Schedule</th><th>Active</th><th>Status</th><th>Last run</th><th>Duration</th><th>Error</th></tr></thead><tbody>{(q.data?.cron || []).map((r) => <tr key={r.jobname}><td>{r.jobname}</td><td>{r.schedule}</td><td>{r.active ? "yes" : "no"}</td><td><Badge value={r.last_status || "never"}/></td><td>{formatDate(r.last_started_at)}</td><td>{r.last_duration_ms ? `${r.last_duration_ms} ms` : "—"}</td><td>{r.last_error_message || "—"}</td></tr>)}</tbody></table></div>}</section></AdminShell>; }
function AdminLogsPage() { const q = useQuery({ queryKey: ["native-provider-logs"], queryFn: () => adminApi<{ logs: Row[] }>("/provider/logs?limit=100") }); return <AdminShell title="Provider logs" subtitle="Provider sync and operation history."><section className="card">{q.isPending ? <Loading/> : q.isError ? <div className="alert alert-error">{errorText(q.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Date</th><th>Error</th></tr></thead><tbody>{(q.data?.logs || []).map((r) => <tr key={r.id}><td>{r.sync_type || "provider"}</td><td><Badge value={r.status}/></td><td>{formatDate(r.created_at)}</td><td>{r.error_message || "—"}</td></tr>)}</tbody></table></div>}</section></AdminShell>; }
function AdminTldsPage() { const q = useQuery({ queryKey: ["native-tlds"], queryFn: () => adminApi<{ tlds: Row[] }>("/tlds") }); return <AdminShell title="Provider TLD catalog" subtitle="Only TLDs returned by DomainNameAPI."><section className="card">{q.isPending ? <Loading/> : q.isError ? <div className="alert alert-error">{errorText(q.error)}</div> : <div className="table-wrap"><table><thead><tr><th>TLD</th><th>Provider</th><th>Sale</th><th>Prices</th></tr></thead><tbody>{(q.data?.tlds || []).filter((t) => t.provider_available).map((t) => <tr key={t.tld}><td>{t.tld}</td><td>{t.provider_product_name || "—"}</td><td><Badge value={t.enabled ? "enabled" : "disabled"}/></td><td>Register {t.registration_price_usd || 0} · Renew {t.renewal_price_usd || 0} · Transfer {t.transfer_price_usd || 0}</td></tr>)}</tbody></table></div>}</section></AdminShell>; }

export function NativePageRouter() {
  const r = route();
  if (!r) return null;
  if (!getSession()) return <Shell title="Sign in required" subtitle="Open your account before using this page." back="/auth"><section className="card"><a className="button button-primary" href="/auth">Sign in</a></section></Shell>;
  if (r.kind === "notifications") return <NotificationsPage/>;
  if (r.page === "provider") return <AdminProviderPage/>;
  if (r.page === "cron") return <AdminCronPage/>;
  if (r.page === "logs") return <AdminLogsPage/>;
  return <AdminTldsPage/>;
}
