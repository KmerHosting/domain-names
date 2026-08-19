import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextArea,
  TextInput,
  Tile,
} from "@carbon/react";
import { FormEvent, ReactNode, useState } from "react";
import { adminApi, api, formatDate, formatMoney, getSession, newIdempotencyKey } from "./api";

type Row = Record<string, any>;
type Tab = "overview" | "users" | "orders" | "domains" | "payments" | "jobs" | "settings";
type EnvName = "ote" | "production";
type EnvironmentStatus = {
  config?: { customer_checkout_environment?: EnvName; registrar_environment?: EnvName };
  customerCredits?: {
    rows?: Array<{
      user_id: string;
      ote_balance_usd: number | string;
      production_balance_usd: number | string;
    }>;
  };
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function tagType(value?: string | null): "green" | "red" | "warm-gray" | "blue" | "purple" | "gray" {
  const text = String(value || "unknown").toLowerCase().replaceAll("_", "-");
  if (["active", "completed", "paid", "verified", "live", "enabled", "admin"].some((item) => text.includes(item))) return "green";
  if (["failed", "error", "expired", "disabled", "cancelled", "dead", "suspended"].some((item) => text.includes(item))) return "red";
  if (["pending", "processing", "queued", "never"].some((item) => text.includes(item))) return "warm-gray";
  if (["ote", "test"].some((item) => text.includes(item))) return "blue";
  if (text === "customer") return "purple";
  return "gray";
}

function Badge({ value }: { value?: string | null }) {
  const text = String(value || "unknown");
  return <Tag type={tagType(text)}>{text.replaceAll("_", " ")}</Tag>;
}

function Loading({ description = "Loading…" }: { description?: string }) {
  return <InlineLoading description={description} />;
}

function ErrorNotice({ error, title = "Request failed" }: { error: unknown; title?: string }) {
  return <InlineNotification kind="error" lowContrast hideCloseButton title={title} subtitle={errorText(error)} />;
}

function Empty({ text }: { text: string }) {
  return <Tile className="carbon-empty-state"><p>{text}</p></Tile>;
}

function MetricGrid({ metrics }: { metrics: Array<[string, ReactNode]> }) {
  return <Grid fullWidth className="carbon-metric-grid">{metrics.map(([label, value]) => <Column sm={2} md={4} lg={4} key={label}><Tile className="carbon-metric"><span>{label}</span><strong>{value}</strong></Tile></Column>)}</Grid>;
}

function AdminSection({ title, description, actions, children, table = false }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; table?: boolean }) {
  return <Tile className={`carbon-admin-section${table ? " carbon-table-section" : ""}`}><div className="card-heading"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{actions ? <div className="heading-actions">{actions}</div> : null}</div>{children}</Tile>;
}

async function environmentStatus(): Promise<EnvironmentStatus> {
  const response = await fetch("/api/environment-status", { credentials: "include", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Environment status failed (${response.status}).`);
  return payload as EnvironmentStatus;
}

async function addEnvironmentCredit(input: { userId: string; environment: EnvName; amountUsd: number; reason: string }) {
  const response = await fetch("/api/environment-credit", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": newIdempotencyKey(`customer-credit-${input.environment}`),
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Customer credit failed (${response.status}).`);
  return payload;
}

function Overview() {
  const query = useQuery({ queryKey: ["admin-summary"], queryFn: () => adminApi<Row>("/summary"), refetchInterval: 30000 });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} />;
  const counts = query.data?.counts || {};
  const revenue = query.data?.revenue || {};
  return <div className="carbon-admin-stack">
    <MetricGrid metrics={[["Users", counts.users || 0], ["Domains", counts.domains || 0], ["Orders", counts.orders || 0], ["Jobs", counts.jobs || 0], ["Customer-credit revenue", formatMoney(revenue.paidUsd || 0)]]} />
    {(query.data?.issues || []).length > 0 ? <AdminSection title="Operational issues" description="Provider, automation and billing issues requiring attention."><div className="carbon-activity-list">{query.data.issues.map((item: Row) => <Tile className="carbon-admin-activity" key={item.id || item.issue_key}><div><strong>{item.title}</strong><p>{item.message}</p><small>{item.severity} · {formatDate(item.updated_at)}</small></div><Badge value={item.severity} /></Tile>)}</div></AdminSection> : null}
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><AdminSection title="Recent orders">{(query.data?.recentOrders || []).length ? <div className="carbon-activity-list">{query.data.recentOrders.map((item: Row) => <Tile className="carbon-admin-activity" key={item.id}><div><strong>{item.domain_name}</strong><p>{item.type} · {formatMoney(item.price_usd)}</p></div><div className="heading-actions"><Badge value={item.registrar_environment} /><Badge value={item.status} /></div></Tile>)}</div> : <Empty text="No orders." />}</AdminSection></Column><Column sm={4} md={4} lg={8}><AdminSection title="Recent jobs">{(query.data?.recentJobs || []).length ? <div className="carbon-activity-list">{query.data.recentJobs.map((item: Row) => <Tile className="carbon-admin-activity" key={item.id}><div><strong>{item.type}</strong><p>{item.last_error || "No error"}</p></div><div className="heading-actions"><Badge value={item.registrar_environment} /><Badge value={item.status} /></div></Tile>)}</div> : <Empty text="No background jobs." />}</AdminSection></Column></Grid>
  </div>;
}

function Users() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-users"], queryFn: () => adminApi<{ users: Row[] }>("/users") });
  const meQuery = useQuery({ queryKey: ["admin-me"], queryFn: () => api<{ user: Row }>("/me") });
  const envQuery = useQuery({ queryKey: ["admin-environment-status"], queryFn: environmentStatus, refetchInterval: 30000 });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => adminApi(`/users/${id}`, { method: "PATCH", body }), onSuccess: () => { client.invalidateQueries({ queryKey: ["admin-users"] }); client.invalidateQueries({ queryKey: ["admin-me"] }); } });
  const credit = useMutation({ mutationFn: addEnvironmentCredit, onSuccess: () => { client.invalidateQueries({ queryKey: ["admin-users"] }); client.invalidateQueries({ queryKey: ["admin-environment-status"] }); } });
  const credits = new Map((envQuery.data?.customerCredits?.rows || []).map((row) => [row.user_id, row]));
  const users = query.data?.users || [];
  const adminCount = users.filter((user) => user.role === "admin").length;
  const activeAdminCount = users.filter((user) => user.role === "admin" && user.status === "active").length;
  const currentAdminId = meQuery.data?.user?.id;
  const addCredit = (user: Row, environment: EnvName) => {
    const label = environment === "ote" ? "TEST / OTE" : "LIVE / PRODUCTION";
    const amount = prompt(`KmerHosting customer credit for ${user.email}\nEnvironment: ${label}\nUSD amount:`);
    if (amount === null) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return alert("Enter a positive USD amount.");
    const reason = prompt(`Reason for this ${label} customer credit`, "Manual support credit") || "Manual support credit";
    if (!window.confirm(`Credit ${formatMoney(value)} to ${user.email} in ${label}?\n\nThis changes KmerHosting customer credit only. It does NOT change the DomainNameAPI reseller balance.`)) return;
    credit.mutate({ userId: user.id, environment, amountUsd: value, reason });
  };
  const pending = query.isPending || envQuery.isPending || meQuery.isPending;
  const error = query.error || envQuery.error || meQuery.error || update.error || credit.error;

  return <AdminSection title="Users and customer credits" description="KmerHosting customer credits are separate from the DomainNameAPI reseller account. DNA reseller balances are read only from the DNA API." actions={<Button kind="secondary" size="sm" href="/admin/environments">DNA balances</Button>} table>
    {error ? <ErrorNotice error={error} /> : null}
    <InlineNotification kind="info" lowContrast hideCloseButton title="Administrator safety" subtitle="An administrator cannot suspend or demote their own account. The last administrator and last active administrator are protected by both backend and interface." />
    <InlineNotification kind="info" lowContrast hideCloseButton title="Balance semantics" subtitle="TEST/LIVE values below are KmerHosting customer billing credits, not DomainNameAPI usdBalance." />
    {pending ? <Loading /> : <Table size="lg"><TableHead><TableRow><TableHeader>User</TableHeader><TableHeader>Role</TableHeader><TableHeader>Status</TableHeader><TableHeader>TEST customer credit</TableHeader><TableHeader>LIVE customer credit</TableHeader><TableHeader>Last login</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{users.map((user) => {
      const row = credits.get(user.id);
      const self = user.id === currentAdminId;
      const lastAdmin = user.role === "admin" && adminCount <= 1;
      const lastActiveAdmin = user.role === "admin" && user.status === "active" && activeAdminCount <= 1;
      const cannotSuspend = user.status === "active" && (self || lastActiveAdmin);
      const cannotDemote = user.role === "admin" && (self || lastAdmin || lastActiveAdmin);
      const suspendTitle = self ? "You cannot suspend your own administrator account." : lastActiveAdmin ? "The last active administrator cannot be suspended." : undefined;
      const demoteTitle = self ? "You cannot convert your own administrator account to a customer." : lastAdmin ? "The last administrator cannot be converted to a customer." : lastActiveAdmin ? "The last active administrator cannot be converted to a customer." : undefined;
      return <TableRow key={user.id}><TableCell><strong>{user.full_name}</strong><small className="dns-meta">{user.email}{self ? " · current admin" : ""}</small></TableCell><TableCell><Badge value={user.role} /></TableCell><TableCell><Badge value={user.status} /></TableCell><TableCell>{formatMoney(Number(row?.ote_balance_usd || 0))}</TableCell><TableCell>{formatMoney(Number(row?.production_balance_usd || 0))}</TableCell><TableCell>{formatDate(user.last_login_at)}</TableCell><TableCell><div className="heading-actions"><Button kind="ghost" size="sm" onClick={() => addCredit(user, "ote")}>Credit TEST</Button><Button kind="ghost" size="sm" onClick={() => addCredit(user, "production")}>Credit LIVE</Button><Button kind="ghost" size="sm" disabled={cannotSuspend || update.isPending} title={suspendTitle} onClick={() => update.mutate({ id: user.id, body: { status: user.status === "active" ? "suspended" : "active" } })}>{user.status === "active" ? "Suspend" : "Activate"}</Button><Button kind="ghost" size="sm" disabled={cannotDemote || update.isPending} title={demoteTitle} onClick={() => update.mutate({ id: user.id, body: { role: user.role === "admin" ? "customer" : "admin" } })}>{user.role === "admin" ? "Make customer" : "Make admin"}</Button></div></TableCell></TableRow>;
    })}</TableBody></Table>}
  </AdminSection>;
}

function Orders() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-orders"], queryFn: () => adminApi<{ orders: Row[] }>("/orders"), refetchInterval: 20000 });
  const action = useMutation({ mutationFn: ({ id, action, body }: { id: string; action: string; body?: Row }) => adminApi(`/orders/${id}/${action}`, { method: "POST", body: body || {} }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-orders"] }) });
  return <AdminSection title="Domain orders" description="Orders use KmerHosting customer credit for billing, while provider capacity is checked directly against DNA usdBalance for the order environment." table>{query.isError || action.isError ? <ErrorNotice error={query.error || action.error} /> : null}{query.isPending ? <Loading /> : <Table size="lg"><TableHead><TableRow><TableHeader>Order</TableHeader><TableHeader>Customer</TableHeader><TableHeader>Domain</TableHeader><TableHeader>Type</TableHeader><TableHeader>Environment</TableHeader><TableHeader>Price</TableHeader><TableHeader>Status</TableHeader><TableHeader>Provider quote</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{(query.data?.orders || []).map((order) => <TableRow key={order.id}><TableCell>{order.order_number}<small className="dns-meta">{formatDate(order.created_at)}</small></TableCell><TableCell>{order.domain_users?.email || "—"}</TableCell><TableCell><strong>{order.domain_name}</strong></TableCell><TableCell>{order.type}</TableCell><TableCell><Badge value={order.registrar_environment} /></TableCell><TableCell>{formatMoney(order.price_usd)}</TableCell><TableCell><Badge value={order.status} />{order.failure_message ? <small className="dns-meta">{order.failure_message}</small> : null}</TableCell><TableCell>{order.provider_quote_id ? "yes" : "no"}</TableCell><TableCell><div className="heading-actions">{["failed", "processing", "paid"].includes(order.status) && order.provider_quote_id ? <Button kind="ghost" size="sm" onClick={() => action.mutate({ id: order.id, action: "retry" })}>Retry</Button> : null}{["pending_payment", "payment_pending"].includes(order.status) ? <Button kind="danger--ghost" size="sm" onClick={() => window.confirm("Cancel this unpaid order?") && action.mutate({ id: order.id, action: "cancel", body: { reason: "Cancelled by administrator" } })}>Cancel</Button> : null}{["paid", "processing", "failed"].includes(order.status) ? <Button kind="danger--ghost" size="sm" onClick={() => window.confirm("Refund this paid order to the customer credit in the same environment?") && action.mutate({ id: order.id, action: "refund", body: { reason: "Refunded by administrator" } })}>Refund</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table>}</AdminSection>;
}

function Domains() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-domains"], queryFn: () => adminApi<{ domains: Row[] }>("/domains"), refetchInterval: 30000 });
  const sync = useMutation({ mutationFn: (id: string) => adminApi(`/domains/${id}/sync`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-domains"] }) });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => adminApi(`/domains/${id}`, { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-domains"] }) });
  return <AdminSection title="Managed domains" description="Every provider operation uses the immutable environment stored on the domain." actions={<Button kind="secondary" size="sm" href="/admin/provider">Reconcile provider</Button>} table>{query.isError || sync.isError || update.isError ? <ErrorNotice error={query.error || sync.error || update.error} /> : null}{query.isPending ? <Loading /> : <Table size="lg"><TableHead><TableRow><TableHeader>Domain</TableHeader><TableHeader>Owner</TableHeader><TableHeader>Environment</TableHeader><TableHeader>Status</TableHeader><TableHeader>Expires</TableHeader><TableHeader>Lock</TableHeader><TableHeader>Privacy</TableHeader><TableHeader>Nameservers</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{(query.data?.domains || []).map((domain) => <TableRow key={domain.id}><TableCell><strong>{domain.domain_name}</strong><small className="dns-meta">{domain.registrar_domain_id || "no provider id"}</small></TableCell><TableCell>{domain.domain_users?.email || "—"}</TableCell><TableCell><Badge value={domain.registrar_environment} /></TableCell><TableCell><Badge value={domain.status} /></TableCell><TableCell>{formatDate(domain.expires_at)}</TableCell><TableCell>{domain.locked ? "on" : "off"}</TableCell><TableCell>{domain.privacy_enabled ? "on" : "off"}</TableCell><TableCell>{(domain.nameservers || []).join(", ")}</TableCell><TableCell><div className="heading-actions"><Button kind="ghost" size="sm" onClick={() => sync.mutate(domain.id)}>Sync</Button><Button kind="ghost" size="sm" onClick={() => update.mutate({ id: domain.id, body: { locked: !domain.locked } })}>{domain.locked ? "Unlock" : "Lock"}</Button><Button kind="ghost" size="sm" onClick={() => update.mutate({ id: domain.id, body: { privacyEnabled: !domain.privacy_enabled } })}>{domain.privacy_enabled ? "Disable privacy" : "Enable privacy"}</Button></div></TableCell></TableRow>)}</TableBody></Table>}</AdminSection>;
}

function Payments() {
  const query = useQuery({ queryKey: ["admin-payments"], queryFn: () => adminApi<{ payments: Row[] }>("/payments") });
  return <AdminSection title="Customer-credit payment history" description="These rows describe KmerHosting customer billing. They do not represent deposits into the DomainNameAPI reseller account." table>{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : <Table size="lg"><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Order</TableHeader><TableHeader>Environment</TableHeader><TableHeader>Provider</TableHeader><TableHeader>Method</TableHeader><TableHeader>USD amount</TableHeader><TableHeader>Status</TableHeader></TableRow></TableHead><TableBody>{(query.data?.payments || []).map((payment) => <TableRow key={payment.id}><TableCell>{formatDate(payment.created_at)}</TableCell><TableCell>{payment.domain_orders?.order_number || "—"}<small className="dns-meta">{payment.domain_orders?.domain_name}</small></TableCell><TableCell><Badge value={payment.registrar_environment || payment.domain_orders?.registrar_environment} /></TableCell><TableCell>{payment.provider}</TableCell><TableCell>{payment.payment_method || "—"}</TableCell><TableCell>{formatMoney(payment.amount_usd || 0)}</TableCell><TableCell><Badge value={payment.status} /></TableCell></TableRow>)}</TableBody></Table>}</AdminSection>;
}

function Jobs() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-jobs"], queryFn: () => adminApi<{ jobs: Row[] }>("/jobs"), refetchInterval: 15000 });
  const retry = useMutation({ mutationFn: (id: string) => adminApi(`/jobs/${id}/retry`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-jobs"] }) });
  return <AdminSection title="Automation jobs" description="Each job keeps the environment inherited from its order/domain. OTE jobs cannot be retried against LIVE and LIVE jobs cannot be retried against OTE." actions={<Button kind="secondary" size="sm" href="/admin/cron">Cron status</Button>} table>{query.isError || retry.isError ? <ErrorNotice error={query.error || retry.error} /> : null}{query.isPending ? <Loading /> : <Table size="lg"><TableHead><TableRow><TableHeader>Job</TableHeader><TableHeader>Environment</TableHeader><TableHeader>Order</TableHeader><TableHeader>Status</TableHeader><TableHeader>Attempts</TableHeader><TableHeader>Run after</TableHeader><TableHeader>Error</TableHeader><TableHeader>Action</TableHeader></TableRow></TableHead><TableBody>{(query.data?.jobs || []).map((job) => <TableRow key={job.id}><TableCell>{job.type}</TableCell><TableCell><Badge value={job.registrar_environment} /></TableCell><TableCell>{job.domain_orders?.order_number || job.domain_orders?.domain_name || "—"}</TableCell><TableCell><Badge value={job.status} /></TableCell><TableCell>{job.attempts}/{job.max_attempts}</TableCell><TableCell>{formatDate(job.run_after)}</TableCell><TableCell>{job.last_error || "—"}</TableCell><TableCell>{["failed", "dead"].includes(job.status) ? <Button kind="ghost" size="sm" onClick={() => retry.mutate(job.id)}>Retry</Button> : null}</TableCell></TableRow>)}</TableBody></Table>}</AdminSection>;
}

function Settings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: () => adminApi<{ settings: Row }>("/settings") });
  const envQuery = useQuery({ queryKey: ["admin-settings-environment"], queryFn: environmentStatus, refetchInterval: 30000 });
  const save = useMutation({ mutationFn: (body: Row) => adminApi("/settings", { method: "PATCH", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["admin-settings"] }) });
  const switchEnvironment = useMutation({
    mutationFn: async (environment: EnvName) => {
      const response = await fetch("/api/environment-switch", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ environment, confirm: environment }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || `Environment switch failed (${response.status}).`);
      return payload;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-settings"] });
      client.invalidateQueries({ queryKey: ["admin-settings-environment"] });
      client.invalidateQueries({ queryKey: ["admin-environment-status"] });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    save.mutate({ supportEmail: data.supportEmail, maintenanceMode: data.maintenanceMode === "on", providerLowBalanceThresholdUsd: Number(data.providerLowBalanceThresholdUsd), defaultNameservers: String(data.defaultNameservers || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean) });
  };
  if (query.isPending || envQuery.isPending) return <Loading />;
  if (query.isError || envQuery.isError) return <ErrorNotice error={query.error || envQuery.error} />;
  const settings = query.data?.settings || {};
  const checkoutEnvironment = envQuery.data?.config?.customer_checkout_environment || settings.customer_checkout_environment || settings.registrar_environment || "production";
  const switchTo = (environment: EnvName) => {
    if (environment === checkoutEnvironment || switchEnvironment.isPending) return;
    const message = environment === "ote"
      ? "Switch the full NEW-ORDER platform to TEST / OTE?\n\nAvailability search, bulk search, quotes, new registrations, transfers, renewals/restores and provider balance checks for NEW operations will use DomainNameAPI OTE. Existing LIVE domains, orders, DNS records and jobs remain LIVE. Maintenance mode is not changed."
      : "Switch the full NEW-ORDER platform to LIVE / PRODUCTION?\n\nAvailability search, bulk search, quotes and NEW paid registrar operations will use DomainNameAPI production and can spend REAL provider funds. Existing TEST records remain TEST. Maintenance mode is not changed.";
    if (window.confirm(message)) switchEnvironment.mutate(environment);
  };

  return <AdminSection title="Platform settings" description="New operations use one explicit platform environment. Existing domains, orders, DNS records and jobs keep their immutable original environment." actions={<Button kind="secondary" size="sm" href="/admin/environments">Environment details & balances</Button>}>
    <form className="carbon-form-stack" onSubmit={submit}>
      <TextInput id="admin-support-email" name="supportEmail" type="email" labelText="Support email" defaultValue={settings.support_email} required />
      <TextInput id="admin-low-balance" name="providerLowBalanceThresholdUsd" type="number" labelText="Provider low-balance threshold (USD)" min={0} step="0.01" defaultValue={settings.provider_low_balance_threshold_usd || 0} />
      <TextArea id="admin-default-nameservers" name="defaultNameservers" labelText="Default nameservers" defaultValue={(settings.default_nameservers || []).join("\n")} required />
      <Checkbox id="admin-maintenance" name="maintenanceMode" labelText="Maintenance mode" defaultChecked={Boolean(settings.maintenance_mode)} />

      <Tile className="carbon-admin-settings-tile"><div className="card-heading"><div><h3>Full platform environment</h3><p>This switch changes the registrar environment used for all NEW availability searches, bulk searches, quotes and orders. It does not convert existing records and does not change maintenance mode.</p></div></div><div className="heading-actions"><Button type="button" kind={checkoutEnvironment === "ote" ? "primary" : "secondary"} disabled={checkoutEnvironment === "ote" || switchEnvironment.isPending} onClick={() => switchTo("ote")}>{checkoutEnvironment === "ote" ? "TEST / OTE — CURRENT" : "Switch full platform to TEST / OTE"}</Button><Button type="button" kind={checkoutEnvironment === "production" ? "primary" : "secondary"} disabled={checkoutEnvironment === "production" || switchEnvironment.isPending} onClick={() => switchTo("production")}>{checkoutEnvironment === "production" ? "LIVE / PRODUCTION — CURRENT" : "Switch full platform to LIVE / PRODUCTION"}</Button></div>{switchEnvironment.isSuccess ? <InlineNotification kind="success" lowContrast hideCloseButton title="Platform environment switched" subtitle="New operations now use the selected registrar environment." /> : null}{switchEnvironment.isError ? <ErrorNotice error={switchEnvironment.error} /> : null}</Tile>

      <MetricGrid metrics={[["New-operation environment", checkoutEnvironment === "ote" ? "TEST / OTE" : "LIVE / PRODUCTION"], ["Provider balance source", "DomainNameAPI usdBalance"], ["Customer billing", "KmerHosting customer credit"]]} />
      <InlineNotification kind="info" lowContrast hideCloseButton title="TRY balance" subtitle="tryBalance is the DNA TRY/TL currency balance. It is never used to represent TEST mode." />
      <Button type="submit" disabled={save.isPending}>Save settings</Button>
      {save.isSuccess ? <InlineNotification kind="success" lowContrast hideCloseButton title="Settings saved" subtitle="The domain platform settings were updated." /> : null}
      {save.isError ? <ErrorNotice error={save.error} /> : null}
    </form>
  </AdminSection>;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  if (!getSession()) {
    window.location.href = "/auth";
    return null;
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "orders", label: "Orders" },
    { id: "domains", label: "Domains" },
    { id: "payments", label: "Billing" },
    { id: "jobs", label: "Jobs" },
    { id: "settings", label: "Settings" },
  ];
  return <main className="admin-main carbon-admin-page"><div className="page-heading carbon-page-heading"><div><span className="kicker">KmerHosting Domains</span><h1>Administration</h1><p>Environment-scoped registrar operations with DomainNameAPI as the source of truth for registrar funds. Customer billing credit is tracked separately.</p></div></div><div className="carbon-admin-tabs" role="tablist" aria-label="Administration sections">{tabs.map((item) => <Button key={item.id} kind={tab === item.id ? "secondary" : "ghost"} size="sm" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}</div><div className="carbon-admin-stack" role="tabpanel">{tab === "overview" ? <Overview /> : null}{tab === "users" ? <Users /> : null}{tab === "orders" ? <Orders /> : null}{tab === "domains" ? <Domains /> : null}{tab === "payments" ? <Payments /> : null}{tab === "jobs" ? <Jobs /> : null}{tab === "settings" ? <Settings /> : null}</div></main>;
}
