import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  ClickableTile,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Search as CarbonSearch,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Tile,
  Toggle,
} from "@carbon/react";
import {
  ApiClientError,
  api,
  downloadDomainDocument,
  formatDate,
  formatMoney,
  getSession,
  newIdempotencyKey,
  orderGuardApi,
  setSession,
  subscribeSession,
  walletApi,
  type Session,
  type User,
} from "./api";
import { FormEvent, ReactNode, useEffect, useState } from "react";

type Row = Record<string, any>;
type ProviderAttribute = {
  key: string;
  type?: string;
  options?: Array<{ value?: string } | string>;
  isRequired?: boolean;
  description?: string;
};
type TldPrice = {
  tld: string;
  popular: boolean;
  is_promo: boolean;
  registration_price_usd: number;
  renewal_price_usd: number;
  transfer_price_usd: number;
  restore_price_usd?: number | null;
  registration_periods?: number[];
  renewal_periods?: number[];
  transfer_periods?: number[];
  provider_attributes?: ProviderAttribute[];
  supports_privacy?: boolean;
};
type Contact = {
  id: string;
  label: string;
  first_name: string;
  last_name: string;
  company_name?: string | null;
  email: string;
  phone_country_code: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  registrar_verified?: boolean;
};
type Domain = {
  id: string;
  domain_name: string;
  registrar_environment: "production" | "ote";
  status: string;
  expires_at?: string | null;
  registered_at?: string | null;
  auto_renew: boolean;
  privacy_enabled: boolean;
  locked: boolean;
  nameservers: string[];
  epp_statuses?: string[];
  last_synced_at?: string | null;
};
type Order = {
  id: string;
  order_number: string;
  type: "registration" | "transfer" | "renewal" | "restore";
  domain_name: string;
  registrar_environment: "production" | "ote";
  status: string;
  price_usd: number;
  created_at: string;
  failure_message?: string | null;
  provider_quote_id?: string | null;
};
type SearchResult = {
  domainName: string;
  registrar: Row;
  price: TldPrice | null;
};
type DashboardPayload = {
  domains: Domain[];
  orders: Order[];
  notifications: Row[];
  invoices: Row[];
  balanceUsd: number;
};
type WalletSummary = {
  balanceUsd: number;
  transactions: Row[];
  orders: Order[];
  supportEmail: string;
  topupInstructions: string;
};

function useSession() {
  const [session, update] = useState<Session | null>(() => getSession());
  useEffect(() => subscribeSession(() => update(getSession())), []);
  return session;
}

function errorText(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Something went wrong.";
}

function providerInfo(registrar: Row): Row {
  return registrar.info || registrar.data?.info || registrar.data || registrar;
}

function isAvailable(registrar: Row): boolean {
  const info = providerInfo(registrar);
  const raw = info.status ?? registrar.status ?? registrar.available ?? registrar.isAvailable;
  return ["available", "true", "free", "1"].includes(String(raw || "").toLowerCase().replace(/[\s_-]+/g, ""));
}

function premiumDisplayPrice(result: SearchResult): number | null {
  if (!result.price) return null;
  const info = providerInfo(result.registrar);
  const premium = Boolean(info.isPremium ?? info.premium);
  const exactCost = Number(info.price || 0);
  if (premium && Number.isFinite(exactCost) && exactCost > 0) {
    return Math.round(Math.max(exactCost * 1.3, Number(result.price.registration_price_usd || 0)) * 100) / 100;
  }
  return Number(result.price.registration_price_usd || 0);
}

function Brand() {
  return <a href="/" className="brand carbon-brand" aria-label="KmerHosting Domains">
    <strong>KmerHosting</strong><span>Domains</span>
  </a>;
}

function PublicFooter() {
  return <footer className="footer"><div className="container footer-grid">
    <div><Brand /><p>Domain registration and management by KmerHosting LLC.</p></div>
    <div><strong>Platform</strong><a href="/transfer-domain">Transfer a domain</a><a href="/auth">Customer sign in</a><a href="mailto:support@kmerhosting.com">Technical support</a></div>
    <div><strong>Billing</strong><span>USD account balance</span><span>Manual credits by support</span><span>No external checkout</span></div>
  </div><div className="container footer-bottom">© {new Date().getFullYear()} KmerHosting LLC. All rights reserved.</div></footer>;
}

type CarbonTagType = "green" | "red" | "warm-gray" | "blue" | "gray";
function tagType(value: string): CarbonTagType {
  const normalized = value.toLowerCase().replaceAll("_", "-");
  if (["active", "completed", "paid", "verified", "live", "enabled"].includes(normalized)) return "green";
  if (["failed", "expired", "cancelled", "disabled", "dead"].includes(normalized)) return "red";
  if (["pending", "processing", "queued", "transfer-pending", "pending-payment", "payment-pending"].includes(normalized)) return "warm-gray";
  if (["test-ote", "ote", "test"].includes(normalized)) return "blue";
  return "gray";
}

function StatusBadge({ value }: { value: string }) {
  return <Tag type={tagType(value)}>{value.replaceAll("_", " ")}</Tag>;
}

function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return <InlineLoading description={label} />;
}

function ErrorNotice({ error, title = "Request failed" }: { error: unknown; title?: string }) {
  return <InlineNotification kind="error" lowContrast hideCloseButton title={title} subtitle={errorText(error)} />;
}

function InfoNotice({ title, subtitle, kind = "info" }: { title: string; subtitle: string; kind?: "info" | "success" | "warning" }) {
  return <InlineNotification kind={kind} lowContrast hideCloseButton title={title} subtitle={subtitle} />;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <Tile className="carbon-empty-state"><h3>{title}</h3><p>{text}</p>{action ? <div className="carbon-empty-state__action">{action}</div> : null}</Tile>;
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading carbon-page-heading"><div><span className="kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="heading-actions">{actions}</div> : null}</div>;
}

function MetricGrid({ metrics }: { metrics: Array<[string, ReactNode]> }) {
  return <Grid fullWidth className="carbon-metric-grid">{metrics.map(([label, value]) => <Column sm={2} md={4} lg={4} key={label}><Tile className="carbon-metric"><span>{label}</span><strong>{value}</strong></Tile></Column>)}</Grid>;
}

function HomePage() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => api<{ prices: TldPrice[] }>("/prices") });
  const search = useMutation({
    mutationFn: (domains: string[]) => api<{ results: SearchResult[] }>("/domains/check", { method: "POST", body: { domains } }),
    onMutate: () => setSearched(true),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const domains = query.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean).slice(0, 20);
    if (domains.length) search.mutate(domains);
  };

  return <><main>
    <section className="carbon-hero" id="search">
      <Grid fullWidth className="carbon-hero__grid">
        <Column sm={4} md={8} lg={10}>
          <span className="kicker">KmerHosting Domains</span>
          <h1>Search, buy and manage domains.</h1>
          <p className="carbon-lead">Live availability, provider-backed pricing and complete domain lifecycle management from one service.</p>
          <form className="carbon-search-form" onSubmit={submit}>
            <CarbonSearch id="domain-search" size="lg" labelText="Domain search" placeholder="yourbrand.com or multiple domains" value={query} onChange={(event) => setQuery(event.target.value)} />
            <Button type="submit" size="lg" disabled={search.isPending}>{search.isPending ? "Checking…" : "Search domains"}</Button>
          </form>
          <p className="search-hint">Bulk search up to 20 domains. Prices and balances are in USD.</p>
        </Column>
        <Column sm={4} md={8} lg={{ span: 5, offset: 1 }}>
          <Tile className="carbon-hero__summary">
            <span className="kicker">Service status</span>
            <h2>Provider-backed controls</h2>
            <p>Search, register, transfer, renew, restore, DNS and registrar security.</p>
            <div className="carbon-summary-list">
              <div><span>Billing</span><strong>USD wallet</strong></div>
              <div><span>Registrar</span><strong>Production</strong></div>
              <div><span>Account</span><strong>Central KmerHosting SSO</strong></div>
            </div>
            <StatusBadge value="live" />
          </Tile>
        </Column>
      </Grid>

      {searched ? <div className="container carbon-search-results">
        {search.isPending ? <LoadingBlock label="Checking live availability" /> : null}
        {search.isError ? <ErrorNotice error={search.error} title="Domain search failed" /> : null}
        {search.data?.results.map((result) => {
          const available = isAvailable(result.registrar);
          const info = providerInfo(result.registrar);
          const premium = Boolean(info.isPremium ?? info.premium);
          const price = premiumDisplayPrice(result);
          return <Tile className="carbon-result-row" key={result.domainName}>
            <div><strong>{result.domainName}</strong><p>{available ? premium ? "Available premium domain" : "Available to register" : "Not available"}</p></div>
            <div className="carbon-result-row__meta"><strong>{price !== null ? formatMoney(price) : "Unsupported TLD"}</strong>{premium ? <Tag type="purple">Premium</Tag> : null}<StatusBadge value={available ? "active" : "disabled"} /></div>
            {available && result.price ? <Button href={`/register-domain?domain=${encodeURIComponent(result.domainName)}`}>Continue</Button> : null}
          </Tile>;
        })}
      </div> : null}
    </section>

    <section className="section" id="pricing"><div className="container">
      <div className="section-heading"><div><span className="kicker">Provider-backed pricing</span><h2>Popular extensions</h2></div><p>Registration, renewal, transfer and restore prices are synchronized from the registrar.</p></div>
      {prices.isPending ? <LoadingBlock /> : prices.isError ? <ErrorNotice error={prices.error} title="Pricing unavailable" /> : <Grid fullWidth className="carbon-card-grid">{prices.data?.prices.slice(0, 8).map((price) => <Column sm={4} md={4} lg={4} key={price.tld}><Tile className="carbon-price-card">
        <div className="price-card-top"><strong className="tld">{price.tld}</strong>{price.is_promo ? <Tag type="green">Promo</Tag> : null}</div>
        <strong className="big-price">{formatMoney(price.registration_price_usd)}</strong><span className="price-term">one-year registration</span>
        <div className="price-lines"><span>Renewal <strong>{formatMoney(price.renewal_price_usd)}</strong></span><span>Transfer <strong>{price.transfer_price_usd > 0 ? formatMoney(price.transfer_price_usd) : "Unsupported"}</strong></span>{price.restore_price_usd ? <span>Restore <strong>{formatMoney(price.restore_price_usd)}</strong></span> : null}</div>
        <Button kind="secondary" href={`/register-domain?domain=${encodeURIComponent(`yourbrand${price.tld}`)}`}>Search {price.tld}</Button>
      </Tile></Column>)}</Grid>}
    </div></section>

    <section className="section section-soft" id="features"><div className="container">
      <div className="section-heading"><div><span className="kicker">Domain lifecycle</span><h2>Complete registrar management</h2></div><p>Domain operations stay focused on registration, transfer, DNS, contacts and security.</p></div>
      <Grid fullWidth className="carbon-card-grid">{[
        ["Registration and premium domains", "Availability, exact premium quote, supported periods and registry attributes."],
        ["Transfers, renewals and restores", "Eligibility checks and operation pricing before wallet payment."],
        ["DNS and nameservers", "A, AAAA, CNAME, MX, TXT, NS, SRV and CAA records with synchronization."],
        ["Lock and privacy", "Registrar-backed theft protection and WHOIS privacy controls."],
        ["WHOIS contacts", "Provider handles, verification and registry contact roles."],
        ["Lifecycle automation", "Reminders, balance-aware auto-renewal and provider synchronization."],
      ].map(([title, text]) => <Column sm={4} md={4} lg={4} key={title}><Tile className="carbon-feature-card"><h3>{title}</h3><p>{text}</p></Tile></Column>)}</Grid>
    </div></section>

    <section className="cta-section"><div className="container"><Tile className="carbon-cta"><div><span className="kicker">Start now</span><h2>Your next domain is one search away.</h2><p>Create one KmerHosting Account, add a WHOIS contact and pay from your shared USD balance.</p></div><Button href="https://dashboard.kmerhosting.com/register">Create account</Button></Tile></div></section>
  </main><PublicFooter /></>;
}

type AuthMode = "login" | "register" | "reset";
function AuthPage() {
  const search = useSearch({ from: "/auth" }) as { mode?: string };
  const initial: AuthMode = search.mode === "register" ? "register" : search.mode === "reset" ? "reset" : "login";
  const [ssoError, setSsoError] = useState("");
  const [ssoBusy, setSsoBusy] = useState(false);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get("kh_sso");
    if (!ticket) return;
    setSsoBusy(true);
    void api<{ session: Session; returnPath: string }>("/auth/kmerhosting/exchange", { method: "POST", body: { ticket } })
      .then((data) => { setSession(data.session); window.location.assign(data.returnPath || "/dashboard"); })
      .catch((ssoFailure) => { setSsoError(errorText(ssoFailure)); setSsoBusy(false); });
  }, []);

  const dashboardRegisterUrl = "https://dashboard.kmerhosting.com/register";
  const dashboardLoginUrl = "https://dashboard.kmerhosting.com/login?service=domain";
  if (initial === "register") {
    window.location.replace(dashboardRegisterUrl);
    return null;
  }

  return <main className="carbon-auth-page"><Grid fullWidth>
    <Column sm={4} md={4} lg={8} className="carbon-auth-page__intro"><span className="kicker">KmerHosting Account</span><h1>One account for every KmerHosting service.</h1><p>Domain access and USD credit are managed from your central KmerHosting Account.</p></Column>
    <Column sm={4} md={4} lg={8} className="carbon-auth-page__form"><Tile className="auth-card"><a href="/" className="back-link">← Back to domain search</a><h2>{ssoBusy ? "Signing you in…" : "Sign in with KmerHosting"}</h2><p>{ssoBusy ? "Your secure account delegation is being verified." : "Domain accounts are no longer created or managed separately."}</p>{ssoError ? <ErrorNotice error={new Error(ssoError)} title="Sign-in failed" /> : null}{ssoBusy ? <InlineLoading description="Verifying KmerHosting Account…" /> : <Button href={dashboardLoginUrl}>Continue with KmerHosting Account</Button>}<p className="auth-helper">New to KmerHosting? <a href={dashboardRegisterUrl}>Create your central account</a>.</p></Tile></Column>
  </Grid></main>;
}

function contactName(contact: Contact) {
  return contact.label || `${contact.first_name} ${contact.last_name}`;
}

function AttributeFields({ definitions, values, onChange }: { definitions: ProviderAttribute[]; values: Row; onChange: (next: Row) => void }) {
  if (!definitions.length) return null;
  return <Tile className="form-section carbon-form-section"><h3>Registry information</h3><p>This extension requires or accepts additional registry fields.</p><div className="carbon-form-grid">{definitions.map((definition) => {
    const options = (definition.options || []).map((option) => typeof option === "string" ? option : String(option.value || "")).filter(Boolean);
    const id = `registry-${definition.key.replace(/[^a-z0-9_-]/gi, "-")}`;
    if (options.length) return <Select id={id} key={definition.key} labelText={`${definition.description || definition.key}${definition.isRequired ? " *" : ""}`} value={String(values[definition.key] || "")} onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })}><SelectItem value="" text="Select" />{options.map((option) => <SelectItem key={option} value={option} text={option} />)}</Select>;
    if (definition.type === "Checkbox" || definition.type === "CheckboxWithContract") return <Checkbox id={id} key={definition.key} labelText={`${definition.description || definition.key}${definition.isRequired ? " *" : ""}`} checked={Boolean(values[definition.key])} onChange={(event) => onChange({ ...values, [definition.key]: event.target.checked })} />;
    return <TextInput id={id} key={definition.key} labelText={`${definition.description || definition.key}${definition.isRequired ? " *" : ""}`} value={String(values[definition.key] || "")} required={definition.isRequired} onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })} />;
  })}</div></Tile>;
}

function PurchasePage({ type }: { type: "registration" | "transfer" }) {
  const session = useSession();
  const initialDomain = type === "registration" ? new URLSearchParams(window.location.search).get("domain") || "" : "";
  const [domainName, setDomainName] = useState(initialDomain);
  const [years, setYears] = useState(1);
  const [contactId, setContactId] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [customNameservers, setCustomNameservers] = useState(false);
  const [nameservers, setNameservers] = useState<string[]>(["", ""]);
  const [attributes, setAttributes] = useState<Row>({});
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Contact[] }>("/contacts"), enabled: Boolean(session) });
  const availability = useMutation({ mutationFn: (name: string) => api<{ results: SearchResult[] }>("/domains/check", { method: "POST", body: { domains: [name] } }) });
  const createOrder = useMutation({
    mutationFn: (body: Row) => orderGuardApi<{ order: Order; quote: Row; billing?: Row }>(type === "registration" ? "/registration" : "/transfer", { method: "POST", body, idempotencyKey: newIdempotencyKey(type) }),
    onSuccess: () => { window.location.href = "/dashboard/orders"; },
  });

  useEffect(() => {
    if (contacts.data?.contacts.length && !contactId) setContactId((contacts.data.contacts.find((item) => item.is_default) || contacts.data.contacts[0]).id);
  }, [contacts.data, contactId]);

  const result = availability.data?.results?.[0];
  const selectedPrice = result?.price;
  const periods = type === "registration"
    ? selectedPrice?.registration_periods?.length ? selectedPrice.registration_periods : [1]
    : selectedPrice?.transfer_periods?.length ? selectedPrice.transfer_periods : [1];

  useEffect(() => {
    if (!periods.includes(years)) setYears(periods[0] || 1);
  }, [selectedPrice?.tld]);

  const check = (event: FormEvent) => {
    event.preventDefault();
    availability.mutate(domainName.trim().toLowerCase());
  };
  const order = () => {
    const body: Row = { domainName: domainName.trim().toLowerCase(), years, contactId };
    if (type === "transfer") body.authCode = authCode;
    if (customNameservers) body.nameServers = nameservers.filter(Boolean);
    if (type === "registration") body.tldAttributes = attributes;
    createOrder.mutate(body);
  };

  if (!session) return <main className="section"><div className="container narrow"><EmptyState title="Sign in required" text="Sign in before creating a domain order." action={<Button href="/auth">Sign in</Button>} /></div></main>;

  return <main className="section"><div className="container"><PageHeading eyebrow={type === "registration" ? "Register domain" : "Transfer domain"} title={type === "registration" ? "Create a registration order" : "Transfer a domain to KmerHosting"} description="Creating the order does not charge your balance. You review and pay it separately from your USD account balance." />
    <Grid fullWidth className="carbon-purchase-grid"><Column sm={4} md={8} lg={10}><Tile className="carbon-order-form">
      <form className="carbon-form-stack" onSubmit={check}>
        <TextInput id="order-domain" labelText="Domain name" value={domainName} onChange={(event) => { setDomainName(event.target.value); availability.reset(); }} placeholder="example.com" required />
        <Button type="submit" kind="secondary" disabled={availability.isPending}>{availability.isPending ? "Checking…" : type === "registration" ? "Check availability and pricing" : "Load transfer pricing"}</Button>
      </form>
      {availability.isError ? <ErrorNotice error={availability.error} title="Unable to quote domain" /> : null}
      {result ? <InfoNotice kind={type === "registration" && !isAvailable(result.registrar) ? "warning" : "success"} title={type === "registration" ? isAvailable(result.registrar) ? `${result.domainName} is available` : `${result.domainName} is not available` : `Transfer pricing loaded for ${result.domainName}`} subtitle={premiumDisplayPrice(result) !== null ? `Current price: ${formatMoney(premiumDisplayPrice(result) || 0)}` : "Pricing unavailable for this extension."} /> : null}

      {(type === "transfer" || result && isAvailable(result.registrar) && selectedPrice) ? <div className="carbon-form-stack carbon-order-options">
        <Select id="order-contact" labelText="WHOIS contact" value={contactId} onChange={(event) => setContactId(event.target.value)}><SelectItem value="" text="Select a contact" />{(contacts.data?.contacts || []).map((contact) => <SelectItem key={contact.id} value={contact.id} text={`${contactName(contact)} · ${contact.email}`} />)}</Select>
        {!contacts.data?.contacts.length ? <InlineNotification kind="warning" lowContrast hideCloseButton title="WHOIS contact required" subtitle="Create a complete contact before placing the order." actions={<Button kind="ghost" size="sm" href="/dashboard/contacts">Open contacts</Button>} /> : null}
        <Select id="order-period" labelText="Period" value={String(years)} onChange={(event) => setYears(Number(event.target.value))}>{periods.map((period) => <SelectItem key={period} value={String(period)} text={`${period} year${period === 1 ? "" : "s"}`} />)}</Select>
        {type === "transfer" ? <TextInput id="order-auth-code" labelText="EPP/auth code" value={authCode} onChange={(event) => setAuthCode(event.target.value)} minLength={4} maxLength={35} required /> : null}
        <Toggle id="custom-nameservers" labelText="Nameservers" labelA="Default" labelB="Custom" toggled={customNameservers} onToggle={setCustomNameservers} />
        {customNameservers ? <div className="carbon-form-stack">{nameservers.map((value, index) => <div className="carbon-inline-field" key={index}><TextInput id={`nameserver-${index}`} labelText={`Nameserver ${index + 1}`} value={value} onChange={(event) => setNameservers(nameservers.map((item, position) => position === index ? event.target.value : item))} placeholder={`ns${index + 1}.example.com`} required /><Button type="button" kind="danger--ghost" size="sm" disabled={nameservers.length <= 2} onClick={() => setNameservers(nameservers.filter((_, position) => position !== index))}>Remove</Button></div>)}<Button type="button" kind="tertiary" size="sm" disabled={nameservers.length >= 13} onClick={() => setNameservers([...nameservers, ""])}>Add nameserver</Button></div> : null}
        <AttributeFields definitions={type === "registration" ? selectedPrice?.provider_attributes || [] : []} values={attributes} onChange={setAttributes} />
        <Button type="button" disabled={createOrder.isPending || !contactId} onClick={order}>{createOrder.isPending ? "Creating exact quote…" : "Create wallet order"}</Button>
        {createOrder.isError ? <ErrorNotice error={createOrder.error} title="Order creation failed" /> : null}
      </div> : null}
    </Tile></Column>
    <Column sm={4} md={8} lg={{ span: 5, offset: 1 }}><Tile className="carbon-order-summary"><span className="kicker">Order workflow</span><h2>Wallet-first billing</h2><p>The registrar quote is created first. Payment is a separate action from the account balance, so no external checkout is triggered from this form.</p></Tile></Column></Grid>
  </div></main>;
}

function DashboardLayout() {
  const session = useSession();
  if (!session) {
    window.location.href = "/auth";
    return null;
  }
  return <Outlet />;
}

function DashboardOverview() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardPayload>("/dashboard") });
  if (query.isPending) return <div className="dashboard-content"><LoadingBlock /></div>;
  if (query.isError) return <div className="dashboard-content"><ErrorNotice error={query.error} /></div>;
  const data = query.data!;
  return <div className="dashboard-content"><PageHeading eyebrow="Account overview" title="Dashboard" description="Domains, orders, wallet and lifecycle activity." actions={<Button href="/register-domain">Register domain</Button>} />
    <MetricGrid metrics={[["Domains", data.domains.length], ["Open orders", data.orders.filter((item) => !["completed", "cancelled", "refunded"].includes(item.status)).length], ["USD balance", formatMoney(data.balanceUsd)], ["Unread notifications", data.notifications.filter((item) => !item.read_at).length]]} />
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Recent domains</h2></div><a href="/dashboard/domains">View all</a></div>{data.domains.length ? <div className="carbon-activity-list">{data.domains.slice(0, 5).map((domain) => <ClickableTile href={`/dashboard/domains/${domain.id}`} key={domain.id}><strong>{domain.domain_name}</strong><span>Expires {formatDate(domain.expires_at)}</span><StatusBadge value={domain.status} /></ClickableTile>)}</div> : <EmptyState title="No domains" text="Register or transfer your first domain." />}</Tile></Column>
    <Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Recent orders</h2></div><a href="/dashboard/orders">View all</a></div>{data.orders.length ? <div className="carbon-activity-list">{data.orders.slice(0, 5).map((order) => <Tile className="carbon-activity-row" key={order.id}><strong>{order.domain_name}</strong><span>{order.type} · {formatMoney(order.price_usd)}</span><StatusBadge value={order.status} /></Tile>)}</div> : <EmptyState title="No orders" text="Your domain orders will appear here." />}</Tile></Column></Grid>
  </div>;
}

function DomainsPage() {
  const query = useQuery({ queryKey: ["domains"], queryFn: () => api<{ domains: Domain[] }>("/domains") });
  return <div className="dashboard-content"><PageHeading eyebrow="Portfolio" title="Domains" description="Live and test-environment domains are clearly separated." actions={<><Button kind="secondary" href="/transfer-domain">Transfer domain</Button><Button href="/register-domain">Register domain</Button></>} />
    {query.isPending ? <LoadingBlock /> : query.isError ? <ErrorNotice error={query.error} /> : query.data?.domains.length ? <div className="carbon-domain-list">{query.data.domains.map((domain) => <Tile className="carbon-domain-row" key={domain.id}><div><strong>{domain.domain_name}</strong><span>Expires {formatDate(domain.expires_at)}</span></div><div className="heading-actions"><StatusBadge value={domain.registrar_environment === "ote" ? "test_ote" : "live"} /><StatusBadge value={domain.status} /><Button kind="ghost" href={`/dashboard/domains/${domain.id}`}>Open</Button></div></Tile>)}</div> : <EmptyState title="No domains" text="Register or transfer a domain to begin." />}
  </div>;
}

function DomainDetailPage() {
  const { domainId } = useParams({ from: "/dashboard/domains/$domainId" });
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["domain", domainId], queryFn: () => api<{ domain: Domain }>(`/domains/${domainId}`) });
  const autoRenew = useMutation({ mutationFn: (enabled: boolean) => api(`/domains/${domainId}/auto-renew`, { method: "PUT", body: { enabled } }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain", domainId] }) });
  if (query.isPending) return <div className="dashboard-content"><LoadingBlock /></div>;
  if (query.isError || !query.data?.domain) return <div className="dashboard-content"><ErrorNotice error={query.error} /></div>;
  const domain = query.data.domain;
  return <div className="dashboard-content"><PageHeading eyebrow="Domain" title={domain.domain_name} description={`Last provider sync ${formatDate(domain.last_synced_at)}.`} actions={<><Button href={`/dashboard/domains/${domain.id}/manage`}>Manage domain</Button><Button kind="secondary" href={`/dashboard/domains/${domain.id}/dns`}>DNS settings</Button></>} />
    <div className="heading-actions carbon-heading-tags"><StatusBadge value={domain.registrar_environment === "ote" ? "test_ote" : "live"} /><StatusBadge value={domain.status} /></div>
    {domain.registrar_environment === "ote" ? <InfoNotice kind="warning" title="Test domain" subtitle="Orders, wallet debits and domain changes stay inside the OTE test environment." /> : null}
    <MetricGrid metrics={[["Registered", formatDate(domain.registered_at)], ["Expires", formatDate(domain.expires_at)], ["Lock", domain.locked ? "Enabled" : "Disabled"], ["Privacy", domain.privacy_enabled ? "Enabled" : "Disabled"]]} />
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><h2>Automatic renewal</h2><p>Uses the USD account balance only after exact provider pricing and balance checks.</p><Toggle id="domain-auto-renew" labelText="Automatic renewal" labelA="Disabled" labelB="Enabled" toggled={domain.auto_renew} disabled={autoRenew.isPending} onToggle={(enabled) => autoRenew.mutate(enabled)} />{autoRenew.isError ? <ErrorNotice error={autoRenew.error} /> : null}</Tile></Column>
    <Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Nameservers</h2></div><a href={`/dashboard/domains/${domain.id}/dns`}>Edit</a></div><div className="carbon-activity-list">{(domain.nameservers || []).map((nameserver) => <Tile className="carbon-activity-row" key={nameserver}><strong>{nameserver}</strong></Tile>)}</div></Tile></Column></Grid>
    {domain.epp_statuses?.length ? <Tile className="carbon-dashboard-panel"><h2>EPP statuses</h2><div className="heading-actions">{domain.epp_statuses.map((status) => <StatusBadge key={status} value={status} />)}</div></Tile> : null}
  </div>;
}

function OrdersPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["orders"], queryFn: () => api<{ orders: Order[] }>("/orders"), refetchInterval: 20000 });
  const wallet = useQuery({ queryKey: ["wallet-summary"], queryFn: () => walletApi<WalletSummary>("/summary") });
  const pay = useMutation({ mutationFn: (orderId: string) => walletApi("/pay-order", { method: "POST", body: { orderId }, idempotencyKey: newIdempotencyKey("wallet-pay") }), onSuccess: () => { client.invalidateQueries({ queryKey: ["orders"] }); client.invalidateQueries({ queryKey: ["wallet-summary"] }); } });
  return <div className="dashboard-content"><PageHeading eyebrow="Orders" title="Domain orders" description="Pay pending orders from your USD account balance." actions={<Button kind="secondary" href="/dashboard/wallet">Balance {formatMoney(wallet.data?.balanceUsd || 0)}</Button>} />
    {query.isError || pay.isError ? <ErrorNotice error={query.error || pay.error} /> : null}
    {query.isPending ? <LoadingBlock /> : query.data?.orders.length ? <div className="carbon-order-list">{query.data.orders.map((order) => <Tile className="carbon-order-row" key={order.id}><div><strong>{order.domain_name}</strong><span>{order.order_number} · {order.type} · {formatDate(order.created_at)}</span>{order.failure_message ? <small>{order.failure_message}</small> : null}</div><div className="heading-actions"><strong>{formatMoney(order.price_usd)}</strong><StatusBadge value={order.status} />{["pending_payment", "payment_pending"].includes(order.status) ? <Button disabled={pay.isPending || Number(wallet.data?.balanceUsd || 0) < Number(order.price_usd)} onClick={() => window.confirm(`Pay ${formatMoney(order.price_usd)} from your account balance?`) && pay.mutate(order.id)}>Pay from balance</Button> : null}</div></Tile>)}</div> : <EmptyState title="No orders" text="Registration, transfer, renewal and restore orders appear here." />}
  </div>;
}

function WalletPage() {
  const query = useQuery({ queryKey: ["wallet-summary"], queryFn: () => walletApi<WalletSummary>("/summary"), refetchInterval: 30000 });
  return <div className="dashboard-content"><PageHeading eyebrow="Billing" title="USD account balance" description="Online top-ups are disabled. Credits are added manually by support." />
    {query.isPending ? <LoadingBlock /> : query.isError ? <ErrorNotice error={query.error} /> : <>
      <MetricGrid metrics={[["Available balance", formatMoney(query.data?.balanceUsd || 0)], ["Top-up method", "Manual support credit"]]} />
      <InlineNotification kind="info" lowContrast hideCloseButton title="Top-up instructions" subtitle={query.data?.topupInstructions || "Contact support to add credit."} actions={<Button kind="ghost" size="sm" href={`mailto:${query.data?.supportEmail}`}>Contact support</Button>} />
      <Tile className="carbon-table-section"><h2>Wallet transactions</h2>{query.data?.transactions.length ? <Table size="lg"><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Type</TableHeader><TableHeader>Reference</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Balance after</TableHeader></TableRow></TableHead><TableBody>{query.data.transactions.map((item) => <TableRow key={item.id}><TableCell>{formatDate(item.created_at)}</TableCell><TableCell>{item.transaction_type}</TableCell><TableCell>{item.reference || "—"}</TableCell><TableCell>{formatMoney(item.amount_usd)}</TableCell><TableCell>{formatMoney(item.balance_after_usd)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState title="No wallet transactions" text="Manual credits and order debits will appear here." />}</Tile>
    </>}
  </div>;
}

function ContactsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Contact[] }>("/contacts") });
  const save = useMutation({ mutationFn: ({ id, body }: { id?: string; body: Row }) => api(id ? `/contacts/${id}` : "/contacts", { method: id ? "PUT" : "POST", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["contacts"] }) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/contacts/${id}`, { method: "DELETE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["contacts"] }) });
  const [editing, setEditing] = useState<Contact | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    save.mutate({ id: editing?.id, body: { ...body, isDefault: body.isDefault === "on" } });
    if (!editing) event.currentTarget.reset();
  };

  return <div className="dashboard-content"><PageHeading eyebrow="WHOIS contacts" title="Contacts" description="Complete contact data is required for registration and transfer." />
    {query.isError || save.isError || remove.isError ? <ErrorNotice error={query.error || save.error || remove.error} /> : null}
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><Tile className="carbon-contact-form"><h2>{editing ? "Edit contact" : "Create contact"}</h2><form className="carbon-form-stack" onSubmit={submit} key={editing?.id || "new"}>
      <TextInput id="contact-label" name="label" labelText="Label" defaultValue={editing?.label || "Default"} required />
      <Grid condensed><Column sm={4} md={2} lg={4}><TextInput id="contact-first-name" name="firstName" labelText="First name" defaultValue={editing?.first_name || ""} required /></Column><Column sm={4} md={2} lg={4}><TextInput id="contact-last-name" name="lastName" labelText="Last name" defaultValue={editing?.last_name || ""} required /></Column></Grid>
      <TextInput id="contact-company" name="companyName" labelText="Company" defaultValue={editing?.company_name || ""} />
      <TextInput id="contact-email" name="email" type="email" labelText="Email" defaultValue={editing?.email || ""} required />
      <Grid condensed><Column sm={4} md={2} lg={4}><TextInput id="contact-dial-code" name="phoneCountryCode" labelText="Dialing code" helperText="Digits only, without the + sign." inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} placeholder="237" defaultValue={editing?.phone_country_code || "237"} required /></Column><Column sm={4} md={2} lg={4}><TextInput id="contact-phone" name="phone" type="tel" labelText="Phone number" helperText="Local number only." placeholder="670000000" defaultValue={editing?.phone || ""} required /></Column></Grid>
      <TextInput id="contact-address" name="address" labelText="Address" defaultValue={editing?.address || ""} required />
      <Grid condensed><Column sm={4} md={2} lg={4}><TextInput id="contact-city" name="city" labelText="City" defaultValue={editing?.city || ""} required /></Column><Column sm={4} md={2} lg={4}><TextInput id="contact-state" name="state" labelText="State/region" defaultValue={editing?.state || ""} required /></Column></Grid>
      <Grid condensed><Column sm={4} md={2} lg={4}><TextInput id="contact-postal" name="postalCode" labelText="Postal code" defaultValue={editing?.postal_code || ""} required /></Column><Column sm={4} md={2} lg={4}><TextInput id="contact-country" name="country" labelText="Country code" maxLength={2} defaultValue={editing?.country || "CM"} required /></Column></Grid>
      <Checkbox id="contact-default" name="isDefault" labelText="Default contact" defaultChecked={editing?.is_default ?? true} />
      <div className="heading-actions"><Button type="submit" disabled={save.isPending}>{editing ? "Save contact" : "Create contact"}</Button>{editing ? <Button type="button" kind="secondary" onClick={() => setEditing(null)}>Cancel</Button> : null}</div>
    </form></Tile></Column>
    <Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><h2>Saved contacts</h2>{query.isPending ? <LoadingBlock /> : query.data?.contacts.length ? <div className="carbon-activity-list">{query.data.contacts.map((contact) => <Tile className="carbon-contact-row" key={contact.id}><div><strong>{contactName(contact)}</strong><span>{contact.email} · {contact.country}</span><small>{contact.registrar_verified ? "Provider verified" : "Not yet provider verified"}</small></div><div className="heading-actions"><Button kind="ghost" size="sm" onClick={() => setEditing(contact)}>Edit</Button><Button kind="danger--ghost" size="sm" onClick={() => window.confirm("Delete this unused contact?") && remove.mutate(contact.id)}>Delete</Button></div></Tile>)}</div> : <EmptyState title="No contacts" text="Create a WHOIS contact before ordering a domain." />}</Tile></Column></Grid>
  </div>;
}

function InvoicesPage() {
  const query = useQuery({ queryKey: ["invoices"], queryFn: () => api<{ invoices: Row[] }>("/invoices") });
  return <div className="dashboard-content"><PageHeading eyebrow="Documents" title="Invoices" description="Wallet-paid domain order invoices." />
    {query.isPending ? <LoadingBlock /> : query.isError ? <ErrorNotice error={query.error} /> : query.data?.invoices.length ? <Tile className="carbon-table-section"><Table size="lg"><TableHead><TableRow><TableHeader>Invoice</TableHeader><TableHeader>Domain</TableHeader><TableHeader>Type</TableHeader><TableHeader>Date</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Status</TableHeader><TableHeader>Document</TableHeader></TableRow></TableHead><TableBody>{query.data.invoices.map((invoice) => <TableRow key={invoice.id}><TableCell>{invoice.invoice_number}</TableCell><TableCell>{invoice.domain_orders?.domain_name || "—"}</TableCell><TableCell>{invoice.domain_orders?.type || "—"}</TableCell><TableCell>{formatDate(invoice.issued_at)}</TableCell><TableCell>{formatMoney(invoice.amount_usd)}</TableCell><TableCell><StatusBadge value={invoice.status} /></TableCell><TableCell><Button kind="ghost" size="sm" onClick={() => downloadDomainDocument(`/invoices/${invoice.id}`, `${invoice.invoice_number}.pdf`).catch((error) => alert(errorText(error)))}>Download PDF</Button></TableCell></TableRow>)}</TableBody></Table></Tile> : <EmptyState title="No invoices" text="Invoices are generated after wallet payment." />}
  </div>;
}

function ProfilePage() {
  const query = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: User }>("/me") });
  return <div className="dashboard-content"><PageHeading eyebrow="Account" title="Profile" description="Your KmerHosting Account is the single source of truth for identity and contact details." />
    <Tile className="carbon-profile-card">{query.isPending ? <LoadingBlock /> : query.isError ? <ErrorNotice error={query.error} /> : <div className="carbon-form-stack"><TextInput id="profile-email" labelText="Email" value={query.data?.user.email || ""} disabled /><TextInput id="profile-name" labelText="Full name" value={query.data?.user.fullName || ""} disabled /><TextInput id="profile-phone" labelText="Phone" value={query.data?.user.phone || ""} disabled /><TextInput id="profile-country" labelText="Country code" value={query.data?.user.countryCode || ""} disabled /><InfoNotice title="Central account" subtitle="Edit these details in your central KmerHosting account." /><Button href="https://dashboard.kmerhosting.com/?view=account">Open KmerHosting Account settings</Button></div>}</Tile>
  </div>;
}

function PaymentReturnPage() {
  return <main className="return-page"><Tile className="return-card"><Brand /><h1>External checkout removed</h1><p>Domain orders are paid from your USD account balance. Contact support@kmerhosting.com for a manual credit.</p><Button href="/dashboard/orders">Open orders</Button></Tile></main>;
}

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  validateSearch: (search: Record<string, unknown>) => ({ mode: typeof search.mode === "string" ? search.mode : undefined }),
  component: AuthPage,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register-domain",
  validateSearch: (search: Record<string, unknown>) => ({ domain: typeof search.domain === "string" ? search.domain : undefined }),
  component: () => <PurchasePage type="registration" />,
});
const transferRoute = createRoute({ getParentRoute: () => rootRoute, path: "/transfer-domain", component: () => <PurchasePage type="transfer" /> });
const returnRoute = createRoute({ getParentRoute: () => rootRoute, path: "/payment/return", component: PaymentReturnPage });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: DashboardLayout });
const dashboardIndexRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/", component: DashboardOverview });
const domainsRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/domains", component: DomainsPage });
const domainDetailRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/domains/$domainId", component: DomainDetailPage });
const ordersRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/orders", component: OrdersPage });
const walletRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/wallet", component: WalletPage });
const contactsRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/contacts", component: ContactsPage });
const invoicesRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/invoices", component: InvoicesPage });
const profileRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/profile", component: ProfilePage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  registerRoute,
  transferRoute,
  returnRoute,
  dashboardRoute.addChildren([dashboardIndexRoute, domainsRoute, domainDetailRoute, ordersRoute, walletRoute, contactsRoute, invoicesRoute, profileRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
