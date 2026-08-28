import {
  Button,
  InlineLoading,
  InlineNotification,
  Modal,
  TextArea,
  TextInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from "@carbon/react";
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
  const [switchTarget, setSwitchTarget] = useState<{ environment: Env; text: string } | null>(null);
  const [creditTarget, setCreditTarget] = useState<{ user: Credit; environment: Env } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("Manual support credit");
  const load = async () => {
    setError("");
    try { setData(await request("/api/environment-status")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load environments."); }
  };
  useEffect(() => { void load(); }, []);

  const switchTo = (environment: Env) => {
    if (!data || data.config.customer_checkout_environment === environment || busy) return;
    const text = environment === "production"
      ? "Use LIVE / PRODUCTION for NEW orders? Future paid orders can use real DomainNameAPI funds. Existing TEST records remain TEST."
      : "Use TEST / OTE for NEW orders? Existing LIVE records remain LIVE.";
    setSwitchTarget({ environment, text });
  };
  const confirmSwitch = async () => {
    if (!switchTarget) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/environment-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: switchTarget.environment, confirm: switchTarget.environment }),
      });
      setSwitchTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Environment switch failed.");
    } finally {
      setBusy(false);
    }
  };;

  const addCredit = (user: Credit, environment: Env) => {
    setCreditTarget({ user, environment });
    setCreditAmount("");
    setCreditReason("Manual support credit");
  };
  const confirmCredit = async () => {
    if (!creditTarget) return;
    const amountUsd = Number(creditAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setError("Enter a positive USD amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request("/api/environment-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `credit-${creditTarget.environment}-${Date.now()}` },
        body: JSON.stringify({ userId: creditTarget.user.user_id, environment: creditTarget.environment, amountUsd, reason: creditReason.trim() || "Manual support credit" }),
      });
      setCreditTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Customer credit failed.");
    } finally {
      setBusy(false);
    }
  };;

  return <main className="admin-main environment-admin-page">
    <div className="page-heading">
      <div>
        <span className="kicker">Registrar isolation</span>
        <h1>TEST / OTE and LIVE / Production</h1>
        <p>DomainNameAPI reseller funds and KmerHosting customer credits are separate concepts.</p>
      </div>
      <div className="heading-actions">
        <Button kind="secondary" href="/admin">Administration</Button>
        <Button disabled={busy} onClick={() => void load()}>Refresh provider data</Button>
      </div>
    </div>

    {error ? <InlineNotification kind="error" lowContrast hideCloseButton title="Environment operation failed" subtitle={error} /> : null}

    {!data ? <InlineLoading description="Loading registrar environments…" /> : <>
      <InlineNotification
        kind="info"
        lowContrast
        hideCloseButton
        title={`New orders use ${label(data.config.customer_checkout_environment)}`}
        subtitle="Existing orders, domains, DNS records and jobs keep their immutable original environment."
      />

      <div className="env-grid">{data.environments.map((environment) => {
        const provider = data.registrarAccounts.find((item) => item.environment === environment.environment);
        const current = data.config.customer_checkout_environment === environment.environment;
        return <Tile key={environment.environment} className="env-card">
          <Tag>{label(environment.environment)}</Tag>
          <h2>{environment.display_name}</h2>
          {provider?.error ? (
            <InlineNotification kind="error" lowContrast hideCloseButton title="Provider balance unavailable" subtitle={provider.error} />
          ) : <>
            <div className="dna-balance">{money(provider?.usdBalance)}</div>
            <strong>DomainNameAPI reseller USD balance</strong>
            <p><code>usdBalance</code> from the {environment.environment === "ote" ? "OTE" : "production"} API host.</p>
            <small><code>tryBalance</code>: {Number(provider?.tryBalance || 0).toFixed(2)} TRY/TL — currency balance, not TEST balance.</small>
          </>}
          <div className="env-meta">
            <div><span>Domains</span><strong>{environment.domains}</strong></div>
            <div><span>Orders</span><strong>{environment.orders}</strong></div>
            <div><span>DNS records</span><strong>{environment.dns_records}</strong></div>
            <div><span>Open jobs</span><strong>{environment.open_jobs}</strong></div>
          </div>
          <div className="env-actions">
            {current ? <Tag type="green">Current for new orders</Tag> : (
              <Button kind="secondary" size="sm" disabled={busy || !environment.enabled} onClick={() => void switchTo(environment.environment)}>
                Use for new orders
              </Button>
            )}
          </div>
        </Tile>;
      })}</div>

      <Tile className="carbon-admin-section carbon-table-section">
        <div className="card-heading"><div><h2>KmerHosting customer credits</h2><p>These credits pay customer orders. They are not DomainNameAPI reseller funds.</p></div></div>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title="Credits are environment-specific"
          subtitle="TEST credit pays only OTE orders. LIVE credit pays only production orders. Every order is independently checked against the real DomainNameAPI usdBalance."
        />
        <Table size="lg"><TableHead><TableRow><TableHeader>User</TableHeader><TableHeader>TEST credit</TableHeader><TableHeader>LIVE credit</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{data.customerCredits.rows.map((user) => <TableRow key={user.user_id}>
          <TableCell><strong>{user.email}</strong><small>{user.role} · {user.status}</small></TableCell>
          <TableCell className="test-credit">{money(user.ote_balance_usd)}</TableCell>
          <TableCell className="live-credit">{money(user.production_balance_usd)}</TableCell>
          <TableCell><div className="heading-actions">
            <Button kind="ghost" size="sm" disabled={busy} onClick={() => addCredit(user, "ote")}>Add TEST credit</Button>
            <Button kind="ghost" size="sm" disabled={busy} onClick={() => addCredit(user, "production")}>Add LIVE credit</Button>
          </div></TableCell>
        </TableRow>)}</TableBody></Table>
      </Tile>

      <Tile className="carbon-admin-section">
        <h2>Source-of-truth rules</h2>
        <p><strong>OTE registrar funds:</strong> {data.semantics.oteProviderBalance}</p>
        <p><strong>LIVE registrar funds:</strong> {data.semantics.liveProviderBalance}</p>
        <p><strong>tryBalance:</strong> {data.semantics.tryBalance}</p>
        <p><strong>Customer credit:</strong> {data.semantics.customerCredit}</p>
      </Tile>
    </>}

    <Modal
      open={Boolean(switchTarget)}
      modalHeading={switchTarget?.environment === "production" ? "Switch to LIVE / PRODUCTION" : "Switch to TEST / OTE"}
      primaryButtonText={busy ? "Switching…" : "Confirm switch"}
      secondaryButtonText="Keep current environment"
      primaryButtonDisabled={busy}
      onRequestClose={() => { if (!busy) setSwitchTarget(null); }}
      onRequestSubmit={() => { void confirmSwitch(); }}
    >
      <p className="khd-modal-copy">{switchTarget?.text}</p>
    </Modal>
    <Modal
      open={Boolean(creditTarget)}
      modalHeading="Add customer credit"
      primaryButtonText={busy ? "Adding…" : "Add credit"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={busy || !creditAmount}
      onRequestClose={() => { if (!busy) setCreditTarget(null); }}
      onRequestSubmit={() => { void confirmCredit(); }}
    >
      <p className="khd-modal-copy">Add credit for <strong>{creditTarget?.user.email}</strong> in {creditTarget?.environment === "ote" ? "TEST / OTE" : "LIVE / PRODUCTION"}.</p>
      <TextInput id="environment-credit-amount" type="number" labelText="Amount (USD)" min={0.01} step="0.01" value={creditAmount} onChange={(event) => { setCreditAmount(event.target.value); setError(""); }} />
      <TextArea id="environment-credit-reason" labelText="Reason" value={creditReason} onChange={(event) => setCreditReason(event.target.value)} />
      <p className="khd-modal-copy">This changes KmerHosting customer credit only; it does not change the DomainNameAPI reseller balance.</p>
    </Modal>
  </main>;
}