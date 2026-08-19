import { useQuery } from "@tanstack/react-query";
import {
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
  Tile,
} from "@carbon/react";
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
  const text = String(value || "unknown");
  const normalized = text.toLowerCase();
  const type = normalized.includes("live") || normalized.includes("ok") || normalized.includes("active") ? "green" : normalized.includes("test") || normalized.includes("ote") ? "blue" : normalized.includes("fail") || normalized.includes("error") ? "red" : "gray";
  return <Tag type={type}>{text.replaceAll("_", " ")}</Tag>;
}

function AdminShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="admin-main carbon-native-page"><div className="page-heading carbon-page-heading"><div><span className="kicker">KmerHosting Domains</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</main>;
}

function Loading() { return <InlineLoading description="Loading…" />; }
function ErrorNotice({ error }: { error: unknown }) { return <InlineNotification kind="error" lowContrast hideCloseButton title="Request failed" subtitle={errorText(error)} />; }

function BalanceCard({ item, active }: { item?: ProviderBalance; active: boolean }) {
  if (!item) return <Tile className="carbon-metric"><span>Unavailable</span><strong>—</strong></Tile>;
  return <Tile className="carbon-metric"><span>{item.label} {active ? "· CURRENT" : ""}</span><strong>{item.balance === null ? "Unavailable" : formatMoney(item.balance)}</strong><small>DomainNameAPI V{item.dnaVersion} · field: {item.rawBalanceKey}{item.error ? ` · ${item.error}` : ""}</small></Tile>;
}

function ProviderPage() {
  const balance = useQuery({ queryKey: ["admin-provider-separated-balances"], queryFn: providerBalances, refetchInterval: 60_000 });
  const tx = useQuery({ queryKey: ["admin-provider-transactions-real"], queryFn: () => adminApi<Row>("/provider/transactions?limit=20"), refetchInterval: 120_000 });
  const test = balance.data?.balances.find((item) => item.environment === "ote");
  const live = balance.data?.balances.find((item) => item.environment === "production");
  const txRows = Array.isArray(tx.data?.provider?.items) ? tx.data.provider.items : Array.isArray(tx.data?.provider) ? tx.data.provider : Array.isArray(tx.data?.items) ? tx.data.items : [];
  return <AdminShell title="Provider environments" subtitle="DomainNameAPI TEST/OTE and LIVE/production are displayed as separate accounts and balances.">
    <Tile className="carbon-admin-section"><div className="card-heading"><div><h2>Environment separation</h2><p>Balances are fetched independently from OTE and production. USD is read from the real DomainNameAPI field <code>usdBalance</code>.</p></div><Badge value={balance.data?.currentEnvironment === "production" ? "LIVE" : "TEST / OTE"} /></div>{balance.isPending ? <Loading /> : balance.isError ? <ErrorNotice error={balance.error} /> : <><Grid fullWidth className="carbon-metric-grid"><Column sm={4} md={4} lg={4}><BalanceCard item={test} active={balance.data.currentEnvironment === "ote"} /></Column><Column sm={4} md={4} lg={4}><BalanceCard item={live} active={balance.data.currentEnvironment === "production"} /></Column><Column sm={2} md={4} lg={4}><Tile className="carbon-metric"><span>Payment sandbox</span><strong>{balance.data.paymentSandbox ? "ON" : "OFF"}</strong><small>Independent from registrar environment.</small></Tile></Column><Column sm={2} md={4} lg={4}><Tile className="carbon-metric"><span>Maintenance</span><strong>{balance.data.maintenanceMode ? "ON" : "OFF"}</strong><small>Low balance threshold: {formatMoney(balance.data.lowBalanceThresholdUsd)}</small></Tile></Column></Grid><InlineNotification kind="warning" lowContrast hideCloseButton title="Environment isolation" subtitle="TEST/OTE balance and LIVE balance are unrelated. A test balance can never authorize a production order." /></>}</Tile>
    <Tile className="carbon-admin-section carbon-table-section"><div className="card-heading"><div><h2>LIVE provider transactions</h2><p>Transaction history remains explicitly production-only.</p></div><Badge value="LIVE" /></div>{tx.isPending ? <Loading /> : tx.isError ? <ErrorNotice error={tx.error} /> : <Table size="lg"><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Description</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Status</TableHeader></TableRow></TableHead><TableBody>{txRows.map((row: Row, index: number) => <TableRow key={row.id || index}><TableCell>{formatDate(row.createdAt || row.date || row.transactionDate)}</TableCell><TableCell>{row.description || row.type || row.transactionType || "transaction"}</TableCell><TableCell>{row.amount ?? row.usdAmount ?? row.price ?? "—"}</TableCell><TableCell><Badge value={row.status || "returned"} /></TableCell></TableRow>)}</TableBody></Table>}</Tile>
  </AdminShell>;
}

function ReadinessCard({ item }: { item: Row }) {
  return <Tile className="carbon-metric"><span>{item.key}</span><strong>{item.ok ? "OK" : `Attention${item.count !== undefined ? `: ${item.count}` : ""}`}</strong><small>{item.message}</small></Tile>;
}

function OperationsPage() {
  const query = useQuery({ queryKey: ["admin-operations-summary"], queryFn: () => operationsMonitorApi<Row>("/summary"), refetchInterval: 30_000 });
  const data = query.data;
  return <AdminShell title="Operations" subtitle="Read-only operational cockpit for jobs, payments, DNS, crons and readiness.">
    {query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : <div className="carbon-admin-stack">
      <Tile className="carbon-admin-section"><div className="card-heading"><div><h2>Readiness</h2><p>Operational state by current registrar environment.</p></div><Badge value={data?.config?.registrar_environment} /></div><Grid fullWidth className="carbon-metric-grid">{(data?.readiness || []).map((item: Row) => <Column sm={2} md={4} lg={4} key={item.key}><ReadinessCard item={item} /></Column>)}</Grid></Tile>
      <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><Tile className="carbon-admin-section"><h2>Counts</h2><pre className="khd-admin-tools-output">{JSON.stringify(data?.counts || {}, null, 2)}</pre></Tile></Column><Column sm={4} md={4} lg={8}><Tile className="carbon-admin-section carbon-table-section"><h2>Operational issues</h2><Table size="lg"><TableHead><TableRow><TableHeader>Issue</TableHeader><TableHeader>Count</TableHeader></TableRow></TableHead><TableBody>{(data?.operationalIssues || []).map((row: Row) => <TableRow key={row.issue}><TableCell>{row.issue}</TableCell><TableCell>{row.count}</TableCell></TableRow>)}</TableBody></Table></Tile></Column></Grid>
      <Tile className="carbon-admin-section carbon-table-section"><div className="card-heading"><div><h2>Dead jobs</h2><p>Historical dead jobs that should be reviewed, archived or retried manually.</p></div><Badge value={String(data?.deadJobs?.length || 0)} /></div><Table size="lg"><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Attempts</TableHeader><TableHeader>Updated</TableHeader><TableHeader>Error</TableHeader></TableRow></TableHead><TableBody>{(data?.deadJobs || []).map((row: Row) => <TableRow key={row.id}><TableCell>{row.type}</TableCell><TableCell>{row.attempts}/{row.max_attempts}</TableCell><TableCell>{formatDate(row.updated_at)}</TableCell><TableCell>{row.last_error || "—"}</TableCell></TableRow>)}</TableBody></Table></Tile>
      <Tile className="carbon-admin-section carbon-table-section"><h2>Paid refunded orders</h2><Table size="lg"><TableHead><TableRow><TableHeader>Order</TableHeader><TableHeader>Domain</TableHeader><TableHeader>Type</TableHeader><TableHeader>Price</TableHeader><TableHeader>Failure</TableHeader></TableRow></TableHead><TableBody>{(data?.paidRefunded || []).map((row: Row) => <TableRow key={row.id}><TableCell>{row.order_number}</TableCell><TableCell>{row.domain_name}</TableCell><TableCell>{row.type}</TableCell><TableCell>{formatMoney(row.price_usd)}</TableCell><TableCell>{row.failure_message || "—"}</TableCell></TableRow>)}</TableBody></Table></Tile>
      <Tile className="carbon-admin-section carbon-table-section"><h2>DNS failed or stale</h2><Table size="lg"><TableHead><TableRow><TableHeader>Name</TableHeader><TableHeader>Type</TableHeader><TableHeader>Status</TableHeader><TableHeader>Last operation</TableHeader><TableHeader>Error</TableHeader></TableRow></TableHead><TableBody>{(data?.staleDns || []).map((row: Row) => <TableRow key={row.id}><TableCell>{row.name}</TableCell><TableCell>{row.type}</TableCell><TableCell><Badge value={row.status} /></TableCell><TableCell>{row.last_operation || "—"}</TableCell><TableCell>{row.last_error || "—"}</TableCell></TableRow>)}</TableBody></Table></Tile>
    </div>}
  </AdminShell>;
}

export function AdminOperationsPage() {
  return window.location.pathname === "/admin/provider" ? <ProviderPage /> : <OperationsPage />;
}
