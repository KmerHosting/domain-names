import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, ReactNode, useState } from "react";
import {
  adminApi,
  adminMonitorApi,
  api,
  customerToolsApi,
  formatDate,
  formatMoney,
  getSession,
  newIdempotencyKey,
} from "./api";

type Row = Record<string, any>;
type Route =
  | { kind: "notifications" }
  | { kind: "domainManage"; domainId: string }
  | { kind: "admin"; page: "provider" | "cron" | "logs" | "tlds" }
  | null;

function route(pathname = window.location.pathname): Route {
  if (pathname === "/dashboard/notifications") return { kind: "notifications" };
  const manage = pathname.match(/^\/dashboard\/domains\/([^/]+)\/manage$/);
  if (manage) return { kind: "domainManage", domainId: manage[1] };
  if (pathname === "/admin/provider") return { kind: "admin", page: "provider" };
  if (pathname === "/admin/cron") return { kind: "admin", page: "cron" };
  if (pathname === "/admin/logs") return { kind: "admin", page: "logs" };
  if (pathname === "/admin/tlds") return { kind: "admin", page: "tlds" };
  return null;
}

export function isNativePage(pathname = window.location.pathname): boolean {
  return Boolean(route(pathname));
}

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

function Shell({ title, subtitle, back, children }: { title: string; subtitle: string; back: string; children: ReactNode }) {
  return <main className="dashboard-main native-page-main"><header className="dashboard-header"><a className="header-action" href={back}>← Back</a></header><div className="dashboard-content"><div className="page-heading"><div><span className="kicker">KmerHosting Domains</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</div></main>;
}

function AdminShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const links = [["/admin", "Main"], ["/admin/provider", "Provider"], ["/admin/tlds", "TLDs"], ["/admin/logs", "Logs"], ["/admin/cron", "Crons"]];
  return <main className="admin-main"><div className="admin-topbar"><nav className="admin-nav-inline">{links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav></div><div className="page-heading"><div><span className="kicker">Domain administration</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</main>;
}

function NotificationsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => customerToolsApi<{ notifications: Row[]; unread: number }>("/notifications"), refetchInterval: 30000 });
  const readOne = useMutation({ mutationFn: (id: string) => customerToolsApi(`/notifications/${id}/read`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }) });
  const readAll = useMutation({ mutationFn: () => customerToolsApi("/notifications/read-all", { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }) });
  return <Shell title="Notifications" subtitle="Domain, transfer, renewal and account activity." back="/dashboard"><section className="card"><div className="card-heading"><div><h2>Inbox</h2><p>{query.data?.unread || 0} unread.</p></div><button className="button button-secondary" onClick={() => readAll.mutate()} disabled={readAll.isPending}>Read all</button></div>{query.isPending ? <Loading /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <div className="activity-list">{(query.data?.notifications || []).map((item) => <div className="activity-item" key={item.id}><div className={item.read_at ? "activity-dot muted" : "activity-dot"} /><div><strong>{item.title}</strong><p>{item.message}</p><small>{formatDate(item.created_at)} · {item.type || "account"}</small>{!item.read_at && <div><button className="button button-secondary" onClick={() => readOne.mutate(item.id)}>Mark as read</button></div>}</div></div>)}</div>}</section></Shell>;
}

function ProviderAction({ title, description, action, busy }: { title: string; description: string; action: () => void; busy: boolean }) {
  return <div className="native-action-card"><strong>{title}</strong><p>{description}</p><button className="button button-secondary" onClick={action} disabled={busy}>{busy ? "Working…" : title}</button></div>;
}

function Forwarding({ domainId }: { domainId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["forwarding", domainId], queryFn: () => customerToolsApi<{ forwarding: Row | null; provider?: Row | null }>(`/domains/${domainId}/forwarding`) });
  const save = useMutation({ mutationFn: (body: Row) => customerToolsApi(`/domains/${domainId}/forwarding`, { method: "PUT", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["forwarding", domainId] }) });
  const remove = useMutation({ mutationFn: () => customerToolsApi(`/domains/${domainId}/forwarding`, { method: "DELETE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["forwarding", domainId] }) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    save.mutate({ redirectAddress: values.redirectAddress, forwardType: values.forwardType });
  };
  const current = query.data?.forwarding;
  return <section className="card"><div className="card-heading"><div><h2>Web forwarding</h2><p>Create or remove the registrar forwarding rule.</p></div></div>{query.isPending ? <Loading /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <><p>{current ? <>Active: <strong>{current.redirect_address || current.redirect_url}</strong> <Badge value={current.status} /></> : "No active forwarding rule."}</p><form className="form-stack" onSubmit={submit}><label>Redirect URL<input name="redirectAddress" type="url" required defaultValue={current?.redirect_address || current?.redirect_url || ""} /></label><label>Forward type<select name="forwardType" defaultValue={current?.forward_type || "Permanent"}><option>Permanent</option><option>Temporary</option></select></label><div className="heading-actions"><button className="button button-primary" disabled={save.isPending}>Save forwarding</button>{current && <button type="button" className="button button-secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</button>}</div></form>{(save.isError || remove.isError) && <div className="alert alert-error">{errorText(save.error || remove.error)}</div>}</>}</section>;
}

function GlueHosts({ domainId, domainName }: { domainId: string; domainName: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["glue-hosts", domainId], queryFn: () => customerToolsApi<{ glueHosts: Row[] }>(`/domains/${domainId}/glue-hosts`) });
  const add = useMutation({ mutationFn: (body: Row) => customerToolsApi(`/domains/${domainId}/glue-hosts`, { method: "POST", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["glue-hosts", domainId] }) });
  const edit = useMutation({ mutationFn: ({ id, ips, name }: { id: string; ips: string[]; name: string }) => customerToolsApi(`/domains/${domainId}/glue-hosts/${id}`, { method: "PUT", body: { newHostName: name, ipAddresses: ips } }), onSuccess: () => client.invalidateQueries({ queryKey: ["glue-hosts", domainId] }) });
  const remove = useMutation({ mutationFn: (id: string) => customerToolsApi(`/domains/${domainId}/glue-hosts/${id}`, { method: "DELETE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["glue-hosts", domainId] }) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    add.mutate({ hostName: values.hostName, ipAddresses: String(values.ipAddresses || "").split(/[\s,]+/).filter(Boolean) });
    event.currentTarget.reset();
  };
  return <section className="card"><div className="card-heading"><div><h2>Child nameservers / glue hosts</h2><p>Use a full child hostname under {domainName} and one or more IPv4/IPv6 addresses.</p></div></div><form className="dns-add-row" onSubmit={submit}><input name="hostName" placeholder={`ns1.${domainName}`} required /><input name="ipAddresses" placeholder="192.0.2.10, 2001:db8::10" required /><button className="button button-primary" disabled={add.isPending}>Add</button></form>{query.isPending ? <Loading /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Host</th><th>IP addresses</th><th>Status</th><th>Actions</th></tr></thead><tbody>{(query.data?.glueHosts || []).map((host) => <tr key={host.id}><td>{host.host_name}</td><td>{(host.ip_addresses || []).join(", ")}</td><td><Badge value={host.status} /></td><td><button onClick={() => { const ips = prompt("New IP addresses", (host.ip_addresses || []).join(", ")); if (ips !== null) edit.mutate({ id: host.id, name: host.host_name, ips: ips.split(/[\s,]+/).filter(Boolean) }); }}>Edit</button><button onClick={() => window.confirm(`Delete ${host.host_name}?`) && remove.mutate(host.id)}>Delete</button></td></tr>)}</tbody></table></div>}{(add.isError || edit.isError || remove.isError) && <div className="alert alert-error">{errorText(add.error || edit.error || remove.error)}</div>}</section>;
}

function DomainContacts({ domainId }: { domainId: string }) {
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Row[] }>("/contacts") });
  const save = useMutation({ mutationFn: (body: Row) => customerToolsApi(`/domains/${domainId}/contacts`, { method: "PUT", body }) });
  const [selected, setSelected] = useState("");
  const rows = contacts.data?.contacts || [];
  return <section className="card"><div className="card-heading"><div><h2>WHOIS contacts</h2><p>Assign one contact to all four registry roles, or manage contacts from the Contacts page.</p></div><a className="button button-secondary" href="/dashboard/contacts">Manage contacts</a></div>{contacts.isPending ? <Loading /> : contacts.isError ? <div className="alert alert-error">{errorText(contacts.error)}</div> : <div className="form-row"><label>Contact<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select a contact</option>{rows.map((contact) => <option key={contact.id} value={contact.id}>{contact.label || `${contact.first_name} ${contact.last_name}`} · {contact.email}</option>)}</select></label><button className="button button-primary" disabled={!selected || save.isPending} onClick={() => save.mutate({ contactId: selected })}>Apply to all roles</button></div>}{save.isSuccess && <div className="alert alert-success">Registry contacts updated.</div>}{save.isError && <div className="alert alert-error">{errorText(save.error)}</div>}</section>;
}

function DomainManagePage({ domainId }: { domainId: string }) {
  const client = useQueryClient();
  const domainQuery = useQuery({ queryKey: ["domain-manage", domainId], queryFn: () => api<{ domain: Row }>(`/domains/${domainId}`) });
  const domain = domainQuery.data?.domain;
  const [transferCode, setTransferCode] = useState("");
  const [quote, setQuote] = useState<Row | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const sync = useMutation({ mutationFn: () => customerToolsApi(`/domains/${domainId}/sync`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain-manage", domainId] }) });
  const lock = useMutation({ mutationFn: (enabled: boolean) => customerToolsApi(`/domains/${domainId}/lock`, { method: "PUT", body: { enabled } }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain-manage", domainId] }) });
  const privacy = useMutation({ mutationFn: (enabled: boolean) => customerToolsApi(`/domains/${domainId}/privacy`, { method: "PUT", body: { enabled } }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain-manage", domainId] }) });
  const epp = useMutation({ mutationFn: () => customerToolsApi<{ transferCode: string }>(`/domains/${domainId}/transfer-code`, { method: "POST", body: { confirm: true } }), onSuccess: (data) => setTransferCode(data.transferCode) });
  const transferAction = useMutation({ mutationFn: (action: string) => customerToolsApi(`/domains/${domainId}/transfer/${action}`, { method: "POST", body: { confirm: true } }), onSuccess: () => sync.mutate() });
  const getQuote = useMutation({ mutationFn: (operation: "renewal" | "restore") => customerToolsApi<{ quote: Row }>(`/domains/${domainId}/quote?operation=${operation}&years=1`), onSuccess: (data) => setQuote(data.quote) });
  const createOrder = useMutation({ mutationFn: (operation: "renewal" | "restore") => customerToolsApi<{ order: Row }>(`/domains/${domainId}/orders/${operation}`, { method: "POST", body: { years: 1 }, idempotencyKey: newIdempotencyKey(operation) }), onSuccess: (data) => { setOrderMessage(`Order ${data.order?.order_number || "created"} is ready. Pay it from your USD account balance.`); setQuote(null); } });

  if (domainQuery.isPending) return <Shell title="Domain management" subtitle="Loading domain data." back="/dashboard/domains"><Loading /></Shell>;
  if (domainQuery.isError || !domain) return <Shell title="Domain management" subtitle="Unable to load this domain." back="/dashboard/domains"><div className="alert alert-error">{errorText(domainQuery.error)}</div></Shell>;
  const test = domain.registrar_environment === "ote";
  const busy = sync.isPending || lock.isPending || privacy.isPending;

  return <Shell title={domain.domain_name} subtitle="Registrar-backed domain controls, lifecycle operations and DNS." back={`/dashboard/domains/${domainId}`}>
    {test && <div className="alert alert-warning"><strong>TEST / OTE domain.</strong> Domain actions and wallet debits stay in the test environment. Production purchases and the production provider balance remain untouched.</div>}
    <section className="card"><div className="card-heading"><div><h2>Registrar state</h2><p>Last synchronized {formatDate(domain.last_synced_at)}.</p></div><div className="heading-actions"><Badge value={domain.status} /><span className={test ? "status status-pending" : "status status-active"}>{test ? "TEST / OTE" : "LIVE"}</span></div></div><div className="stats-grid"><div><span>Expires</span><strong>{formatDate(domain.expires_at)}</strong></div><div><span>Lock</span><strong>{domain.locked ? "Enabled" : "Disabled"}</strong></div><div><span>Privacy</span><strong>{domain.privacy_enabled ? "Enabled" : "Disabled"}</strong></div><div><span>Auto-renew</span><strong>{domain.auto_renew ? "Enabled" : "Disabled"}</strong></div></div><div className="heading-actions"><button className="button button-secondary" disabled={busy} onClick={() => sync.mutate()}>Sync provider state</button><a className="button button-secondary" href={`/dashboard/domains/${domainId}/dns`}>DNS and nameservers</a></div>{sync.isError && <div className="alert alert-error">{errorText(sync.error)}</div>}</section>

    <section className="card"><div className="card-heading"><div><h2>Security and transfer code</h2><p>These actions are sent to the registrar and then synchronized locally.</p></div></div><div className="native-action-grid"><ProviderAction title={domain.locked ? "Unlock domain" : "Lock domain"} description="Change the EPP/theft-protection lock." busy={lock.isPending} action={() => lock.mutate(!domain.locked)} /><ProviderAction title={domain.privacy_enabled ? "Disable privacy" : "Enable privacy"} description="Change WHOIS privacy where the TLD supports it." busy={privacy.isPending} action={() => privacy.mutate(!domain.privacy_enabled)} /><ProviderAction title="Reveal transfer code" description="Displays the EPP/auth code. Keep it private." busy={epp.isPending} action={() => window.confirm("Reveal the transfer code?") && epp.mutate()} /></div>{transferCode && <div className="alert alert-warning"><strong>Transfer code:</strong> <code>{transferCode}</code></div>}{(lock.isError || privacy.isError || epp.isError) && <div className="alert alert-error">{errorText(lock.error || privacy.error || epp.error)}</div>}</section>

    {!test && <section className="card"><div className="card-heading"><div><h2>Renew or restore</h2><p>Pricing is checked against the exact DomainNameAPI period price before an order is created.</p></div></div><div className="native-action-grid"><ProviderAction title="Check renewal quote" description="One-year renewal eligibility and USD price." busy={getQuote.isPending} action={() => getQuote.mutate("renewal")} /><ProviderAction title="Check restore quote" description="Restore eligibility and exact restore price." busy={getQuote.isPending} action={() => getQuote.mutate("restore")} /></div>{quote && <div className="native-quote-result"><strong>{String(quote.operation).toUpperCase()}</strong><span>{formatMoney(quote.customerPriceUsd, quote.currency || "USD")}</span><small>Provider cost {formatMoney(quote.providerCostUsd, quote.currency || "USD")} · {quote.periodYears} year(s)</small><button className="button button-primary" disabled={createOrder.isPending} onClick={() => createOrder.mutate(quote.operation)}>Create wallet order</button></div>}{orderMessage && <div className="alert alert-success">{orderMessage} <a href="/dashboard/orders">Open orders</a>.</div>}{(getQuote.isError || createOrder.isError) && <div className="alert alert-error">{errorText(getQuote.error || createOrder.error)}</div>}</section>}

    {domain.status === "transfer_pending" && <section className="card"><div className="card-heading"><div><h2>Transfer status</h2><p>Query or act on a pending incoming/outgoing transfer.</p></div></div><div className="heading-actions">{["query", "approve", "reject", "cancel"].map((action) => <button key={action} className="button button-secondary" disabled={transferAction.isPending} onClick={() => window.confirm(`${action} transfer for ${domain.domain_name}?`) && transferAction.mutate(action)}>{action}</button>)}</div>{transferAction.isError && <div className="alert alert-error">{errorText(transferAction.error)}</div>}</section>}

    <DomainContacts domainId={domainId} />
    <Forwarding domainId={domainId} />
    <GlueHosts domainId={domainId} domainName={domain.domain_name} />
  </Shell>;
}

function AdminProviderPage() {
  const account = useQuery({ queryKey: ["provider-account"], queryFn: () => adminApi<{ environment: string; provider: Row }>("/provider/account") });
  const transactions = useQuery({ queryKey: ["provider-transactions"], queryFn: () => adminApi<{ provider: Row }>("/provider/transactions?limit=30") });
  const reconcile = useQuery({ queryKey: ["provider-reconcile"], queryFn: () => adminApi<{ reconciliation: Row }>("/provider/reconcile") });
  const provider = account.data?.provider || {};
  const transactionRows = Array.isArray(transactions.data?.provider?.items) ? transactions.data!.provider.items : [];
  return <AdminShell title="DomainNameAPI account" subtitle="Read-only provider balance, transaction history and local/provider reconciliation.">
    <div className="dashboard-grid"><section className="card"><h2>Provider balance</h2>{account.isPending ? <Loading /> : account.isError ? <div className="alert alert-error">{errorText(account.error)}</div> : <div className="stats-grid"><div><span>USD balance</span><strong>{formatMoney(provider.usdBalance || 0)}</strong></div><div><span>TRY balance</span><strong>{provider.tryBalance ?? "—"}</strong></div><div><span>Environment</span><strong>{account.data?.environment}</strong></div></div>}</section><section className="card"><h2>Reconciliation</h2>{reconcile.isPending ? <Loading /> : reconcile.isError ? <div className="alert alert-error">{errorText(reconcile.error)}</div> : <pre className="khd-admin-tools-output">{JSON.stringify(reconcile.data?.reconciliation, null, 2)}</pre>}</section></div>
    <section className="card"><div className="card-heading"><div><h2>Provider transactions</h2><p>Read-only DomainNameAPI account activity.</p></div></div>{transactions.isPending ? <Loading /> : transactions.isError ? <div className="alert alert-error">{errorText(transactions.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Currency</th><th>Status</th></tr></thead><tbody>{transactionRows.map((item: Row, index: number) => <tr key={item.id || index}><td>{formatDate(item.createdAt || item.transactionDate || item.date)}</td><td>{item.description || item.type || "transaction"}</td><td>{item.amount ?? item.price ?? "—"}</td><td>{item.currency || "USD"}</td><td><Badge value={item.status || "completed"} /></td></tr>)}</tbody></table></div>}</section>
  </AdminShell>;
}

function AdminCronPage() {
  const query = useQuery({ queryKey: ["admin-cron"], queryFn: () => adminMonitorApi<{ cron: Row[] }>("/cron"), refetchInterval: 30000 });
  return <AdminShell title="Automation status" subtitle="Background domain jobs, schedules and latest execution state."><section className="card">{query.isPending ? <Loading /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Job</th><th>Schedule</th><th>Active</th><th>Status</th><th>Last run</th><th>Duration</th><th>Error</th></tr></thead><tbody>{(query.data?.cron || []).map((item) => <tr key={item.jobname}><td>{item.jobname}</td><td>{item.schedule}</td><td>{item.active ? "yes" : "no"}</td><td><Badge value={item.last_status || "never"} /></td><td>{formatDate(item.last_started_at)}</td><td>{item.last_duration_ms ? `${item.last_duration_ms} ms` : "—"}</td><td>{item.last_error_message || "—"}</td></tr>)}</tbody></table></div>}</section></AdminShell>;
}

function AdminLogsPage() {
  const query = useQuery({ queryKey: ["provider-logs"], queryFn: () => adminApi<{ logs: Row[] }>("/provider/logs") });
  return <AdminShell title="Provider logs" subtitle="DomainNameAPI catalog and synchronization history."><section className="card">{query.isPending ? <Loading /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Date</th><th>Details</th></tr></thead><tbody>{(query.data?.logs || []).map((item) => <tr key={item.id}><td>{item.sync_type || "provider"}</td><td><Badge value={item.status} /></td><td>{formatDate(item.created_at)}</td><td><pre className="khd-admin-tools-output">{JSON.stringify(item.payload || item.error_message || {}, null, 2)}</pre></td></tr>)}</tbody></table></div>}</section></AdminShell>;
}

function AdminTldsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["provider-tlds"], queryFn: () => adminApi<{ tlds: Row[] }>("/tlds") });
  const sync = useMutation({ mutationFn: () => adminApi("/tlds/sync", { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["provider-tlds"] }) });
  const toggle = useMutation({ mutationFn: ({ tld, enabled, popular }: { tld: string; enabled?: boolean; popular?: boolean }) => adminApi(`/tlds/${encodeURIComponent(tld)}`, { method: "PATCH", body: { enabled, popular } }), onSuccess: () => client.invalidateQueries({ queryKey: ["provider-tlds"] }) });
  return <AdminShell title="DomainNameAPI TLD catalog" subtitle="Exact provider costs, customer prices, periods, restore fees and required registry attributes."><section className="card"><div className="card-heading"><div><h2>Catalog</h2><p>{query.data?.tlds?.length || 0} provider TLDs.</p></div><button className="button button-primary" disabled={sync.isPending} onClick={() => sync.mutate()}>Sync production catalog</button></div>{sync.isError && <div className="alert alert-error">{errorText(sync.error)}</div>}{query.isPending ? <Loading /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <div className="table-wrap"><table><thead><tr><th>TLD</th><th>Sale</th><th>Registration</th><th>Renewal</th><th>Transfer</th><th>Restore</th><th>Periods</th><th>Attributes</th><th>Actions</th></tr></thead><tbody>{(query.data?.tlds || []).map((item) => <tr key={item.tld}><td><strong>{item.tld}</strong><small className="dns-meta">{item.provider_product_name}</small></td><td><Badge value={item.enabled ? "enabled" : "disabled"} /></td><td>{formatMoney(item.registration_price_usd || 0)}<small className="dns-meta">cost {formatMoney(item.registration_cost_usd || 0)}</small></td><td>{formatMoney(item.renewal_price_usd || 0)}<small className="dns-meta">cost {formatMoney(item.renewal_cost_usd || 0)}</small></td><td>{formatMoney(item.transfer_price_usd || 0)}<small className="dns-meta">cost {formatMoney(item.transfer_cost_usd || 0)}</small></td><td>{item.restore_price_usd ? formatMoney(item.restore_price_usd) : "unsupported"}<small className="dns-meta">cost {item.restore_cost_usd ? formatMoney(item.restore_cost_usd) : "—"}</small></td><td>R: {(item.registration_periods || []).join(", ")}<br />N: {(item.renewal_periods || []).join(", ")}</td><td>{(item.provider_attributes || []).filter((x: Row) => x.isRequired).map((x: Row) => x.key).join(", ") || "none"}</td><td><button onClick={() => toggle.mutate({ tld: item.tld, enabled: !item.enabled })}>{item.enabled ? "Disable" : "Enable"}</button><button onClick={() => toggle.mutate({ tld: item.tld, popular: !item.popular })}>{item.popular ? "Unfeature" : "Feature"}</button></td></tr>)}</tbody></table></div>}</section></AdminShell>;
}

export function NativePageRouter() {
  const current = route();
  if (!getSession()) {
    window.location.href = "/login";
    return null;
  }
  if (!current) return null;
  if (current.kind === "notifications") return <NotificationsPage />;
  if (current.kind === "domainManage") return <DomainManagePage domainId={current.domainId} />;
  if (current.page === "provider") return <AdminProviderPage />;
  if (current.page === "cron") return <AdminCronPage />;
  if (current.page === "logs") return <AdminLogsPage />;
  return <AdminTldsPage />;
}
