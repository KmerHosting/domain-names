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
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Network,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import {
  ApiClientError,
  api,
  clearSession,
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
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

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

function useEscapeToClose(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [locked]);
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

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className="brand" aria-label="KmerHosting Domains">
    <span className="brand-mark"><Globe2 size={21} /></span>
    {!compact && <span><strong>KmerHosting</strong><small>Domains</small></span>}
  </Link>;
}

function PublicHeader() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEscapeToClose(open, close);
  useBodyScrollLock(open);
  const homeAnchor = (section: string) => window.location.pathname === "/" ? "#" + section : "/#" + section;
  return <header className="public-header"><div className="container header-row">
    <Brand />
    <button type="button" className="icon-button mobile-only" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="public-navigation" aria-label={open ? "Close navigation" : "Open navigation"}>{open ? <X /> : <Menu />}</button>
    <nav id="public-navigation" aria-label="Public navigation" className={open ? "public-nav open" : "public-nav"}>
      <a href={homeAnchor("search")} onClick={close}>Search</a><a href={homeAnchor("pricing")} onClick={close}>Pricing</a><a href={homeAnchor("features")} onClick={close}>Features</a><Link to="/transfer-domain" onClick={close}>Transfer</Link>
      {session ? <Link to="/dashboard" className="button button-primary" onClick={close}>Dashboard</Link> : <><a href="https://dashboard.kmerhosting.com/login?service=domain" className="button button-ghost" onClick={close}>Sign in</a><a href="https://dashboard.kmerhosting.com/register" className="button button-primary" onClick={close}>Create account</a></>}
    </nav>
  </div>{open && <button type="button" className="nav-scrim public-nav-scrim" aria-label="Close navigation" onClick={close} />}</header>;
}

function PublicFooter() {
  return <footer className="footer"><div className="container footer-grid">
    <div><Brand /><p>Domain registration and management by KmerHosting LLC.</p></div>
    <div><strong>Platform</strong><Link to="/transfer-domain">Transfer a domain</Link><Link to="/auth" search={{ mode: undefined }}>Customer sign in</Link><a href="mailto:support@kmerhosting.com">Technical support</a></div>
    <div><strong>Billing</strong><span>USD account balance</span><span>Manual credits by support</span><span>No external checkout</span></div>
  </div><div className="container footer-bottom">© {new Date().getFullYear()} KmerHosting LLC. All rights reserved.</div></footer>;
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase().replaceAll("_", "-");
  return <span className={`status status-${normalized}`}>{value.replaceAll("_", " ")}</span>;
}

function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return <div className="loading"><LoaderCircle className="spin" size={20} /> {label}</div>;
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>;
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
  return <><PublicHeader /><main>
    <section className="hero" id="search"><div className="hero-orb orb-one" /><div className="hero-orb orb-two" /><div className="container hero-grid">
      <div className="hero-copy"><div className="eyebrow"><Sparkles size={15} /> From KmerHosting LLC</div><h1>Search, buy and manage domains.<br /><span>All from one place.</span></h1><p>Live availability, exact provider-backed pricing and complete domain management.</p><form className="domain-search" onSubmit={submit}><Search size={21} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="yourbrand.com or multiple domains" aria-label="Domain names" /><button className="button button-primary" disabled={search.isPending}>{search.isPending ? <LoaderCircle className="spin" size={18} /> : "Search domains"}</button></form><div className="search-hint">Bulk search up to 20 domains. Prices and balances are in USD.</div></div>
      <div className="hero-panel"><div className="panel-glow" /><div className="mini-window"><div className="window-top"><span /><span /><span /></div><div className="availability-row"><div className="availability-icon"><Check size={20} /></div><div><strong>Provider-backed controls</strong><span>Search, transfer, renew, DNS and security</span></div><StatusBadge value="live" /></div><div className="mini-metrics"><div><span>Billing</span><strong>USD wallet</strong></div><div><span>Top-up</span><strong>Manual support</strong></div><div><span>Registrar</span><strong>Production</strong></div></div></div></div>
    </div>
    {searched && <div className="container results-wrap">{search.isPending && <LoadingBlock label="Checking live availability" />}{search.isError && <div className="alert alert-error">{errorText(search.error)}</div>}{search.data?.results.map((result) => {
      const available = isAvailable(result.registrar);
      const info = providerInfo(result.registrar);
      const premium = Boolean(info.isPremium ?? info.premium);
      const price = premiumDisplayPrice(result);
      return <div className="search-result" key={result.domainName}><div className={available ? "result-check available" : "result-check unavailable"}>{available ? <Check /> : <X />}</div><div className="result-domain"><strong>{result.domainName}</strong><span>{available ? premium ? "Available premium domain" : "Available to register" : "Not available"}</span></div><div className="result-price">{price !== null ? formatMoney(price) : "Unsupported TLD"}{premium && <small className="dns-meta">exact premium quote</small>}</div>{available && result.price && <Link to="/register-domain" search={{ domain: result.domainName }} className="button button-primary">Continue</Link>}</div>;
    })}</div>}
    </section>
    <section className="trust-strip"><div className="container trust-grid"><div><ShieldCheck /><span><strong>Live registrar checks</strong>Availability and eligibility</span></div><div><WalletCards /><span><strong>USD account balance</strong>Manual credits by support</span></div><div><Mail /><span><strong>Account email</strong>Verification and reminders</span></div><div><Network /><span><strong>Domain controls</strong>DNS, contacts and transfers</span></div></div></section>
    <section className="section" id="pricing"><div className="container"><div className="section-heading"><div><span className="kicker">Provider-backed pricing</span><h2>Popular extensions</h2></div><p>Registration, renewal, transfer and restore prices are synchronized from DomainNameAPI.</p></div>{prices.isPending ? <LoadingBlock /> : prices.isError ? <div className="alert alert-error">{errorText(prices.error)}</div> : <div className="price-grid">{prices.data?.prices.slice(0, 8).map((price) => <article className="price-card" key={price.tld}><div className="price-card-top"><span className="tld">{price.tld}</span>{price.is_promo && <span className="promo">Promo</span>}</div><strong className="big-price">{formatMoney(price.registration_price_usd)}</strong><span className="price-term">one-year registration</span><div className="price-lines"><span>Renewal <strong>{formatMoney(price.renewal_price_usd)}</strong></span><span>Transfer <strong>{price.transfer_price_usd > 0 ? formatMoney(price.transfer_price_usd) : "Unsupported"}</strong></span>{price.restore_price_usd && <span>Restore <strong>{formatMoney(price.restore_price_usd)}</strong></span>}</div><Link to="/register-domain" search={{ domain: `yourbrand${price.tld}` }} className="button button-secondary">Search {price.tld}</Link></article>)}</div>}</div></section>
    <section className="section section-soft" id="features"><div className="container"><div className="section-heading centered"><span className="kicker">Domain-only platform</span><h2>Complete domain lifecycle management</h2><p>No SSL or sub-reseller products are mixed into the workflow.</p></div><div className="feature-grid">{[
      [<Globe2 />, "Registration and premium domains", "Availability, exact premium quote, supported periods and TLD attributes."],
      [<RefreshCw />, "Transfers, renewals and restores", "Eligibility checks and exact operation pricing before wallet payment."],
      [<Network />, "DNS and nameservers", "A, AAAA, CNAME, MX, TXT, NS, SRV and CAA records with apply and synchronization."],
      [<ShieldCheck />, "Lock and privacy", "Registrar-backed theft protection and WHOIS privacy controls."],
      [<UserRound />, "WHOIS contacts", "Provider handles, verification and four registry contact roles."],
      [<Bell />, "Lifecycle automation", "Reminders, balance-aware auto-renewal and provider synchronization."],
    ].map(([icon, title, text]) => <article className="feature-card" key={String(title)}><div className="feature-icon">{icon}</div><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
    <section className="cta-section"><div className="container cta-card"><div><span className="kicker light">Start now</span><h2>Your next domain is one search away.</h2><p>Create one KmerHosting Account, add a WHOIS contact and pay from your shared USD balance.</p></div><a href="https://dashboard.kmerhosting.com/register" className="button button-light">Create account <ArrowRight size={18} /></a></div></section>
  </main><PublicFooter /></>;
}

type AuthMode = "login" | "register" | "reset";
function AuthPage() {
  const search = useSearch({ from: "/auth" }) as { mode?: string };
  const initial: AuthMode = search.mode === "register" ? "register" : search.mode === "reset" ? "reset" : "login";
  const [mode, setMode] = useState<AuthMode>(initial);
  const [step, setStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [ssoError, setSsoError] = useState("");
  const [ssoBusy, setSsoBusy] = useState(false);
  const passwordLogin = useMutation({
    mutationFn: (body: Row) => api<{ user: User; session: Session }>("/auth/login", { method: "POST", body }),
    onSuccess: (data) => { setSession(data.session); window.location.href = "/dashboard"; },
  });
  const requestOtp = useMutation({
    mutationFn: (body: Row) => api(mode === "register" ? "/auth/register/request" : "/auth/password-reset/request", { method: "POST", body }),
    onSuccess: () => setStep("otp"),
  });
  const verifyOtp = useMutation({
    mutationFn: (body: Row) => api<{ user: User; session: Session }>(mode === "register" ? "/auth/register/verify" : "/auth/password-reset/verify", { method: "POST", body }),
    onSuccess: (data) => { setSession(data.session); window.location.href = "/dashboard"; },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const submittedEmail = String(body.email || email).trim().toLowerCase();
    setEmail(submittedEmail);
    if (mode === "login") passwordLogin.mutate({ email: submittedEmail, password: body.password });
    else if (step === "form") requestOtp.mutate({ ...body, email: submittedEmail });
    else verifyOtp.mutate({ ...body, email: submittedEmail });
  };
  const busy = passwordLogin.isPending || requestOtp.isPending || verifyOtp.isPending;
  const error = passwordLogin.error || requestOtp.error || verifyOtp.error;

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
  if (ssoBusy || mode === "login") return <div className="auth-shell"><div className="auth-brand-pane"><Brand /><div className="auth-brand-copy"><span className="eyebrow dark"><ShieldCheck size={15} /> KmerHosting Account</span><h1>One account for every KmerHosting service.</h1><p>Domain access and USD credit are managed from your central KmerHosting Account.</p></div></div><div className="auth-form-pane"><div className="auth-card"><Link to="/" className="back-link">← Back to domain search</Link><h2>{ssoBusy ? "Signing you in…" : "Sign in with KmerHosting"}</h2><p>{ssoBusy ? "Your secure account delegation is being verified." : "Use your central KmerHosting Account. Domain accounts are no longer created or managed separately."}</p>{ssoError && <div className="alert alert-error">{ssoError}</div>}{!ssoBusy && <button className="button button-primary button-wide" onClick={() => window.location.assign(dashboardLoginUrl)}>Continue with KmerHosting Account</button>}<p className="auth-helper">New to KmerHosting? <a href={dashboardRegisterUrl}>Create your central account</a>.</p></div></div></div>;
  return <div className="auth-shell"><div className="auth-brand-pane"><Brand /></div><div className="auth-form-pane"><div className="auth-card"><Link to="/" className="back-link">← Back to domain search</Link><h2>Use your KmerHosting Account</h2><p>Password recovery is managed centrally to protect every KmerHosting service.</p><button className="button button-primary button-wide" onClick={() => window.location.assign(dashboardLoginUrl)}>Open KmerHosting Account</button></div></div></div>;
}

function contactName(contact: Contact) {
  return contact.label || `${contact.first_name} ${contact.last_name}`;
}

function AttributeFields({ definitions, values, onChange }: { definitions: ProviderAttribute[]; values: Row; onChange: (next: Row) => void }) {
  if (!definitions.length) return null;
  return <section className="form-section"><h3>Registry information</h3><p>This extension requires or accepts additional registry fields.</p>{definitions.map((definition) => {
    const options = (definition.options || []).map((option) => typeof option === "string" ? option : String(option.value || "")).filter(Boolean);
    return <label key={definition.key}>{definition.description || definition.key}{definition.isRequired ? " *" : ""}{options.length ? <select value={String(values[definition.key] || "")} required={definition.isRequired} onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })}><option value="">Select</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : definition.type === "Checkbox" || definition.type === "CheckboxWithContract" ? <input type="checkbox" checked={Boolean(values[definition.key])} onChange={(event) => onChange({ ...values, [definition.key]: event.target.checked })} /> : <input value={String(values[definition.key] || "")} required={definition.isRequired} onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })} />}</label>;
  })}</section>;
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
  if (!session) return <><PublicHeader /><main className="section"><div className="container narrow"><EmptyState icon={<KeyRound />} title="Sign in required" text="Sign in before creating a domain order." action={<Link to="/auth" search={{ mode: undefined }} className="button button-primary">Sign in</Link>} /></div></main><PublicFooter /></>;
  return <><PublicHeader /><main className="section"><div className="container purchase-layout"><div><span className="kicker">{type === "registration" ? "Register domain" : "Transfer domain"}</span><h1>{type === "registration" ? "Create a registration order" : "Transfer a domain to KmerHosting"}</h1><p>Creating the order does not charge your balance. You review and pay it separately from your USD account balance.</p></div>
    <section className="card"><form className="form-stack" onSubmit={check}><label>Domain name<input value={domainName} onChange={(event) => { setDomainName(event.target.value); availability.reset(); }} placeholder="example.com" required /></label><button className="button button-secondary" disabled={availability.isPending}>{availability.isPending ? "Checking…" : type === "registration" ? "Check availability and pricing" : "Load transfer pricing"}</button></form>{availability.isError && <div className="alert alert-error">{errorText(availability.error)}</div>}{result && <div className={isAvailable(result.registrar) || type === "transfer" ? "alert alert-success" : "alert alert-error"}>{type === "registration" ? isAvailable(result.registrar) ? `${result.domainName} is available.` : `${result.domainName} is not available.` : `Transfer pricing loaded for ${result.domainName}.`} {premiumDisplayPrice(result) !== null && <strong>{formatMoney(premiumDisplayPrice(result) || 0)}</strong>}</div>}
      {(type === "transfer" || result && isAvailable(result.registrar) && selectedPrice) && <div className="form-stack"><label>WHOIS contact<select value={contactId} onChange={(event) => setContactId(event.target.value)} required><option value="">Select a contact</option>{(contacts.data?.contacts || []).map((contact) => <option key={contact.id} value={contact.id}>{contactName(contact)} · {contact.email}</option>)}</select></label>{!contacts.data?.contacts.length && <div className="alert alert-warning">Create a complete WHOIS contact first. <Link to="/dashboard/contacts">Open contacts</Link>.</div>}<label>Period<select value={years} onChange={(event) => setYears(Number(event.target.value))}>{periods.map((period) => <option key={period} value={period}>{period} year{period === 1 ? "" : "s"}</option>)}</select></label>{type === "transfer" && <label>EPP/auth code<input value={authCode} onChange={(event) => setAuthCode(event.target.value)} minLength={4} maxLength={35} required /></label>}<label className="checkbox"><input type="checkbox" checked={customNameservers} onChange={(event) => setCustomNameservers(event.target.checked)} /><span>Use custom nameservers</span></label>{customNameservers && <div className="form-stack">{nameservers.map((value, index) => <div className="dns-add-row" key={index}><input value={value} onChange={(event) => setNameservers(nameservers.map((item, position) => position === index ? event.target.value : item))} placeholder={`ns${index + 1}.example.com`} required /><button type="button" className="button button-secondary" disabled={nameservers.length <= 2} onClick={() => setNameservers(nameservers.filter((_, position) => position !== index))}>Remove</button></div>)}<button type="button" className="button button-secondary" disabled={nameservers.length >= 13} onClick={() => setNameservers([...nameservers, ""])}>Add nameserver</button></div>}<AttributeFields definitions={type === "registration" ? selectedPrice?.provider_attributes || [] : []} values={attributes} onChange={setAttributes} /><button type="button" className="button button-primary" disabled={createOrder.isPending || !contactId} onClick={order}>{createOrder.isPending ? "Creating exact quote…" : "Create wallet order"}</button>{createOrder.isError && <div className="alert alert-error">{errorText(createOrder.error)}</div>}</div>}
    </section>
  </div></main><PublicFooter /></>;
}

function DashboardLayout() {
  const session = useSession();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: User }>("/me"), enabled: Boolean(session) });
  const logout = useMutation({ mutationFn: () => api("/auth/logout", { method: "POST" }), onSettled: () => { clearSession(); window.location.href = "/"; } });
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEscapeToClose(open, close);
  useBodyScrollLock(open);
  if (!session) { window.location.href = "/auth"; return null; }
  return <div className="dashboard-shell"><aside className={open ? "dashboard-sidebar open" : "dashboard-sidebar"}><div className="sidebar-brand"><Brand /></div><nav id="dashboard-navigation" aria-label="Dashboard navigation" className="sidebar-nav"><Link to="/dashboard" activeOptions={{ exact: true }} onClick={close}><LayoutDashboard size={18} />Overview</Link><Link to="/dashboard/domains" onClick={close}><Globe2 size={18} />Domains</Link><Link to="/dashboard/orders" onClick={close}><FileText size={18} />Orders</Link><Link to="/dashboard/wallet" onClick={close}><WalletCards size={18} />Wallet</Link><Link to="/dashboard/contacts" onClick={close}><UserRound size={18} />Contacts</Link><Link to="/dashboard/invoices" onClick={close}><FileText size={18} />Invoices</Link><Link to="/dashboard/profile" onClick={close}><Settings2 size={18} />Profile</Link><a href="/dashboard/notifications" onClick={close}><Bell size={18} />Notifications</a>{me.data?.user.role === "admin" && <a href="/admin" onClick={close}><ShieldCheck size={18} />Administration</a>}</nav><button type="button" className="sidebar-logout" onClick={() => logout.mutate()}><LogOut size={18} />Sign out</button></aside>{open && <button type="button" className="nav-scrim dashboard-nav-scrim" aria-label="Close dashboard navigation" onClick={close} />}<main className="dashboard-main"><header className="dashboard-header"><button type="button" className="icon-button mobile-only" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="dashboard-navigation" aria-label={open ? "Close dashboard navigation" : "Open dashboard navigation"}>{open ? <X /> : <Menu />}</button><div /><div className="header-account"><span>{me.data?.user.fullName || "Customer"}</span><small>{me.data?.user.email}</small></div></header><Outlet /></main></div>;
}

function DashboardOverview() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardPayload>("/dashboard") });
  if (query.isPending) return <div className="dashboard-content"><LoadingBlock /></div>;
  if (query.isError) return <div className="dashboard-content"><div className="alert alert-error">{errorText(query.error)}</div></div>;
  const data = query.data!;
  return <div className="dashboard-content"><div className="page-heading"><div><span className="kicker">Account overview</span><h1>Dashboard</h1><p>Domains, orders, wallet and lifecycle activity.</p></div><Link to="/register-domain" search={{ domain: undefined }} className="button button-primary">Register domain</Link></div><div className="stats-grid"><div><span>Domains</span><strong>{data.domains.length}</strong></div><div><span>Open orders</span><strong>{data.orders.filter((item) => !["completed", "cancelled", "refunded"].includes(item.status)).length}</strong></div><div><span>USD balance</span><strong>{formatMoney(data.balanceUsd)}</strong></div><div><span>Unread notifications</span><strong>{data.notifications.filter((item) => !item.read_at).length}</strong></div></div><div className="dashboard-grid"><section className="card"><div className="card-heading"><div><h2>Recent domains</h2></div><Link to="/dashboard/domains">View all</Link></div>{data.domains.length ? <div className="activity-list">{data.domains.slice(0, 5).map((domain) => <Link to="/dashboard/domains/$domainId" params={{ domainId: domain.id }} className="activity-item" key={domain.id}><div className="activity-dot" /><div><strong>{domain.domain_name}</strong><p>Expires {formatDate(domain.expires_at)}</p><StatusBadge value={domain.status} /></div></Link>)}</div> : <EmptyState icon={<Globe2 />} title="No domains" text="Register or transfer your first domain." />}</section><section className="card"><div className="card-heading"><div><h2>Recent orders</h2></div><Link to="/dashboard/orders">View all</Link></div>{data.orders.length ? <div className="activity-list">{data.orders.slice(0, 5).map((order) => <div className="activity-item" key={order.id}><div className="activity-dot" /><div><strong>{order.domain_name}</strong><p>{order.type} · {formatMoney(order.price_usd)}</p><StatusBadge value={order.status} /></div></div>)}</div> : <EmptyState icon={<FileText />} title="No orders" text="Your domain orders will appear here." />}</section></div></div>;
}

function DomainsPage() {
  const query = useQuery({ queryKey: ["domains"], queryFn: () => api<{ domains: Domain[] }>("/domains") });
  return <div className="dashboard-content"><div className="page-heading"><div><span className="kicker">Portfolio</span><h1>Domains</h1><p>Live and test-environment domains are clearly separated.</p></div><div className="heading-actions"><Link to="/transfer-domain" className="button button-secondary">Transfer domain</Link><Link to="/register-domain" search={{ domain: undefined }} className="button button-primary">Register domain</Link></div></div>{query.isPending ? <LoadingBlock /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : query.data?.domains.length ? <div className="domain-list">{query.data.domains.map((domain) => <article className="domain-card" key={domain.id}><div><strong>{domain.domain_name}</strong><span>Expires {formatDate(domain.expires_at)}</span></div><div className="heading-actions"><StatusBadge value={domain.registrar_environment === "ote" ? "test_ote" : "live"} /><StatusBadge value={domain.status} /><Link to="/dashboard/domains/$domainId" params={{ domainId: domain.id }} className="button button-secondary">Open <ChevronRight size={16} /></Link></div></article>)}</div> : <EmptyState icon={<Globe2 />} title="No domains" text="Register or transfer a domain to begin." />}</div>;
}

function DomainDetailPage() {
  const { domainId } = useParams({ from: "/dashboard/domains/$domainId" });
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["domain", domainId], queryFn: () => api<{ domain: Domain }>(`/domains/${domainId}`) });
  const autoRenew = useMutation({ mutationFn: (enabled: boolean) => api(`/domains/${domainId}/auto-renew`, { method: "PUT", body: { enabled } }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain", domainId] }) });
  if (query.isPending) return <div className="dashboard-content"><LoadingBlock /></div>;
  if (query.isError || !query.data?.domain) return <div className="dashboard-content"><div className="alert alert-error">{errorText(query.error)}</div></div>;
  const domain = query.data.domain;
  return <div className="dashboard-content"><div className="page-heading"><div><Link to="/dashboard/domains" className="back-link">← Domains</Link><div className="title-with-status"><h1>{domain.domain_name}</h1><StatusBadge value={domain.registrar_environment === "ote" ? "test_ote" : "live"} /><StatusBadge value={domain.status} /></div><p>Last provider sync {formatDate(domain.last_synced_at)}.</p></div><div className="heading-actions"><a href={`/dashboard/domains/${domain.id}/manage`} className="button button-primary">Manage domain</a><a href={`/dashboard/domains/${domain.id}/dns`} className="button button-secondary">DNS settings</a></div></div>{domain.registrar_environment === "ote" && <div className="alert alert-warning"><strong>Test domain.</strong> Orders, wallet debits and domain changes stay inside the OTE test environment.</div>}<div className="stats-grid"><div><span>Registered</span><strong>{formatDate(domain.registered_at)}</strong></div><div><span>Expires</span><strong>{formatDate(domain.expires_at)}</strong></div><div><span>Lock</span><strong>{domain.locked ? "Enabled" : "Disabled"}</strong></div><div><span>Privacy</span><strong>{domain.privacy_enabled ? "Enabled" : "Disabled"}</strong></div></div><section className="card"><div className="card-heading"><div><h2>Automatic renewal</h2><p>Uses the USD account balance only after exact provider pricing and balance checks.</p></div><button className="button button-secondary" disabled={autoRenew.isPending} onClick={() => autoRenew.mutate(!domain.auto_renew)}>{domain.auto_renew ? "Disable" : "Enable"}</button></div><StatusBadge value={domain.auto_renew ? "enabled" : "disabled"} />{autoRenew.isError && <div className="alert alert-error">{errorText(autoRenew.error)}</div>}</section><section className="card"><div className="card-heading"><div><h2>Nameservers</h2></div><a href={`/dashboard/domains/${domain.id}/dns`}>Edit</a></div><div className="activity-list">{(domain.nameservers || []).map((nameserver) => <div className="activity-item" key={nameserver}><Network size={18} /><strong>{nameserver}</strong></div>)}</div></section>{domain.epp_statuses?.length ? <section className="card"><div className="card-heading"><div><h2>EPP statuses</h2></div></div><div className="heading-actions">{domain.epp_statuses.map((status) => <StatusBadge key={status} value={status} />)}</div></section> : null}</div>;
}

function OrdersPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["orders"], queryFn: () => api<{ orders: Order[] }>("/orders"), refetchInterval: 20000 });
  const wallet = useQuery({ queryKey: ["wallet-summary"], queryFn: () => walletApi<WalletSummary>("/summary") });
  const pay = useMutation({ mutationFn: (orderId: string) => walletApi("/pay-order", { method: "POST", body: { orderId }, idempotencyKey: newIdempotencyKey("wallet-pay") }), onSuccess: () => { client.invalidateQueries({ queryKey: ["orders"] }); client.invalidateQueries({ queryKey: ["wallet-summary"] }); } });
  return <div className="dashboard-content"><div className="page-heading"><div><span className="kicker">Orders</span><h1>Domain orders</h1><p>Pay pending orders from your USD account balance.</p></div><Link to="/dashboard/wallet" className="button button-secondary">Balance {formatMoney(wallet.data?.balanceUsd || 0)}</Link></div>{(query.isError || pay.isError) && <div className="alert alert-error">{errorText(query.error || pay.error)}</div>}{query.isPending ? <LoadingBlock /> : query.data?.orders.length ? <div className="order-list">{query.data.orders.map((order) => <article className="order-card" key={order.id}><div><strong>{order.domain_name}</strong><span>{order.order_number} · {order.type} · {formatDate(order.created_at)}</span>{order.failure_message && <small className="dns-meta">{order.failure_message}</small>}</div><div className="heading-actions"><strong>{formatMoney(order.price_usd)}</strong><StatusBadge value={order.status} />{["pending_payment", "payment_pending"].includes(order.status) && <button className="button button-primary" disabled={pay.isPending || Number(wallet.data?.balanceUsd || 0) < Number(order.price_usd)} onClick={() => window.confirm(`Pay ${formatMoney(order.price_usd)} from your account balance?`) && pay.mutate(order.id)}>Pay from balance</button>}</div></article>)}</div> : <EmptyState icon={<FileText />} title="No orders" text="Registration, transfer, renewal and restore orders appear here." />}</div>;
}

function WalletPage() {
  const query = useQuery({ queryKey: ["wallet-summary"], queryFn: () => walletApi<WalletSummary>("/summary"), refetchInterval: 30000 });
  return <div className="dashboard-content"><div className="page-heading"><div><span className="kicker">Billing</span><h1>USD account balance</h1><p>Online top-ups are disabled. Credits are added manually by support.</p></div></div>{query.isPending ? <LoadingBlock /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <><div className="stats-grid"><div><span>Available balance</span><strong>{formatMoney(query.data?.balanceUsd || 0)}</strong></div><div><span>Top-up method</span><strong>Manual support credit</strong></div></div><div className="alert alert-info">{query.data?.topupInstructions} <a href={`mailto:${query.data?.supportEmail}`}>{query.data?.supportEmail}</a></div><section className="card"><div className="card-heading"><div><h2>Wallet transactions</h2></div></div>{query.data?.transactions.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Amount</th><th>Balance after</th></tr></thead><tbody>{query.data.transactions.map((item) => <tr key={item.id}><td>{formatDate(item.created_at)}</td><td>{item.transaction_type}</td><td>{item.reference || "—"}</td><td>{formatMoney(item.amount_usd)}</td><td>{formatMoney(item.balance_after_usd)}</td></tr>)}</tbody></table></div> : <EmptyState icon={<WalletCards />} title="No wallet transactions" text="Manual credits and order debits will appear here." />}</section></>}</div>;
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
  return <div className="dashboard-content"><div className="page-heading"><div><span className="kicker">WHOIS contacts</span><h1>Contacts</h1><p>Complete contact data is required for registration and transfer.</p></div></div>{(query.isError || save.isError || remove.isError) && <div className="alert alert-error">{errorText(query.error || save.error || remove.error)}</div>}<div className="dashboard-grid"><section className="card"><div className="card-heading"><div><h2>{editing ? "Edit contact" : "Create contact"}</h2></div></div><form className="form-stack" onSubmit={submit} key={editing?.id || "new"}><label>Label<input name="label" defaultValue={editing?.label || "Default"} required /></label><div className="form-row"><label>First name<input name="firstName" defaultValue={editing?.first_name || ""} required /></label><label>Last name<input name="lastName" defaultValue={editing?.last_name || ""} required /></label></div><label>Company<input name="companyName" defaultValue={editing?.company_name || ""} /></label><label>Email<input name="email" type="email" defaultValue={editing?.email || ""} required /></label><div className="form-row contact-phone-row"><label>Dialing code<input name="phoneCountryCode" inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} placeholder="237" defaultValue={editing?.phone_country_code || "237"} required /><small>Digits only, without the + sign.</small></label><label>Phone number<input name="phone" type="tel" inputMode="tel" placeholder="670000000" defaultValue={editing?.phone || ""} required /><small>Local number only.</small></label></div><label>Address<input name="address" defaultValue={editing?.address || ""} required /></label><div className="form-row"><label>City<input name="city" defaultValue={editing?.city || ""} required /></label><label>State/region<input name="state" defaultValue={editing?.state || ""} required /></label></div><div className="form-row"><label>Postal code<input name="postalCode" defaultValue={editing?.postal_code || ""} required /></label><label>Country code<input name="country" maxLength={2} defaultValue={editing?.country || "CM"} required /></label></div><label className="checkbox"><input name="isDefault" type="checkbox" defaultChecked={editing?.is_default ?? true} /><span>Default contact</span></label><div className="heading-actions"><button className="button button-primary" disabled={save.isPending}>{editing ? "Save contact" : "Create contact"}</button>{editing && <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button>}</div></form></section><section className="card"><div className="card-heading"><div><h2>Saved contacts</h2></div></div>{query.isPending ? <LoadingBlock /> : query.data?.contacts.length ? <div className="activity-list">{query.data.contacts.map((contact) => <div className="activity-item" key={contact.id}><UserRound size={18} /><div><strong>{contactName(contact)}</strong><p>{contact.email} · {contact.country}</p><small>{contact.registrar_verified ? "Provider verified" : "Not yet provider verified"}</small><div className="heading-actions"><button onClick={() => setEditing(contact)}>Edit</button><button onClick={() => window.confirm("Delete this unused contact?") && remove.mutate(contact.id)}>Delete</button></div></div></div>)}</div> : <EmptyState icon={<UserRound />} title="No contacts" text="Create a WHOIS contact before ordering a domain." />}</section></div></div>;
}

function InvoicesPage() {
  const query = useQuery({ queryKey: ["invoices"], queryFn: () => api<{ invoices: Row[] }>("/invoices") });
  return <div className="dashboard-content"><div className="page-heading"><div><span className="kicker">Documents</span><h1>Invoices</h1><p>Wallet-paid domain order invoices.</p></div></div>{query.isPending ? <LoadingBlock /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : query.data?.invoices.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Domain</th><th>Type</th><th>Date</th><th>Amount</th><th>Status</th><th>Document</th></tr></thead><tbody>{query.data.invoices.map((invoice) => <tr key={invoice.id}><td>{invoice.invoice_number}</td><td>{invoice.domain_orders?.domain_name || "—"}</td><td>{invoice.domain_orders?.type || "—"}</td><td>{formatDate(invoice.issued_at)}</td><td>{formatMoney(invoice.amount_usd)}</td><td><StatusBadge value={invoice.status} /></td><td><button onClick={() => downloadDomainDocument(`/invoices/${invoice.id}`, `${invoice.invoice_number}.pdf`).catch((error) => alert(errorText(error)))}>Download PDF</button></td></tr>)}</tbody></table></div> : <EmptyState icon={<FileText />} title="No invoices" text="Invoices are generated after wallet payment." />}</div>;
}

function ProfilePage() {
  const query = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: User }>("/me") });
  return <div className="dashboard-content"><div className="page-heading"><div><span className="kicker">Account</span><h1>Profile</h1><p>Your KmerHosting Account is the single source of truth for identity and contact details.</p></div></div><section className="card">{query.isPending ? <LoadingBlock /> : query.isError ? <div className="alert alert-error">{errorText(query.error)}</div> : <div className="form-stack"><label>Email<input value={query.data?.user.email || ""} disabled /></label><label>Full name<input value={query.data?.user.fullName || ""} disabled /></label><label>Phone<input value={query.data?.user.phone || ""} disabled /></label><label>Country code<input value={query.data?.user.countryCode || ""} disabled /></label><div className="alert alert-info">Edit these details in your central KmerHosting account.</div><a className="button button-primary" href="https://dashboard.kmerhosting.com/?view=account">Open KmerHosting Account settings</a></div>}</section></div>;
}

function PaymentReturnPage() {
  return <div className="return-page"><Brand /><div className="return-card"><WalletCards className="return-success" /><h1>External checkout removed</h1><p>Domain orders are paid from your USD account balance. Contact support@kmerhosting.com for a manual credit.</p><Link to="/dashboard/orders" className="button button-primary">Open orders</Link></div></div>;
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
