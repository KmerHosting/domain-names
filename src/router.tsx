import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Database,
  FileText,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import {
  ApiClientError,
  api,
  clearSession,
  formatDate,
  formatMoney,
  getSession,
  newIdempotencyKey,
  paymentApi,
  setSession,
  subscribeSession,
  type Session,
  type User,
} from "./api";
import { FormEvent, ReactNode, useEffect, useState } from "react";

type TldPrice = {
  tld: string;
  popular: boolean;
  is_promo: boolean;
  registration_price_usd: number;
  renewal_price_usd: number;
  transfer_price_usd: number;
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
};

type Domain = {
  id: string;
  domain_name: string;
  status: string;
  expires_at?: string | null;
  registered_at?: string | null;
  auto_renew: boolean;
  privacy_enabled: boolean;
  locked: boolean;
  nameservers: string[];
  last_synced_at?: string | null;
  domain_dns_records?: DnsRecord[];
};

type DnsRecord = {
  id: string;
  name: string;
  type: string;
  contents: string[];
  ttl: number;
  priority?: number | null;
  status: string;
};

type Order = {
  id: string;
  order_number: string;
  type: string;
  domain_name: string;
  status: string;
  price_usd: number;
  amount_xaf: number;
  created_at: string;
  failure_message?: string | null;
  domain_payments?: Array<{
    id: string;
    status: string;
    checkout_url?: string | null;
    created_at?: string | null;
    processed_at?: string | null;
  }>;
};

type PaymentCheckResult = {
  payment: {
    id: string;
    status: string;
    processed_at?: string | null;
  };
  order: {
    id: string;
    status: string;
  };
  providerStatus?: string | null;
  checkedAt: string;
  finalized: boolean;
  polling: {
    intervalSeconds: number;
    recommendedWindowSeconds: number;
    webhookRequired: boolean;
  };
};

function useSession() {
  const [session, update] = useState<Session | null>(() => getSession());
  useEffect(() => subscribeSession(() => update(getSession())), []);
  return session;
}

function errorText(error: unknown): string {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : "Something went wrong.";
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="KmerHosting Domains">
      <span className="brand-mark"><Globe2 size={21} /></span>
      {!compact && (
        <span>
          <strong>KmerHosting</strong>
          <small>Domains</small>
        </span>
      )}
    </Link>
  );
}

function PublicHeader() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <div className="container header-row">
        <Brand />
        <button className="icon-button mobile-only" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
          {open ? <X /> : <Menu />}
        </button>
        <nav className={open ? "public-nav open" : "public-nav"}>
          <a href="#search">Search</a>
          <a href="#pricing">Pricing</a>
          <a href="#features">Features</a>
          <Link to="/transfer-domain">Transfer</Link>
          {session ? (
            <Link to="/dashboard" className="button button-primary">Dashboard</Link>
          ) : (
            <>
              <Link to="/auth" search={{}} className="button button-ghost">Sign in</Link>
              <Link to="/auth" search={{ mode: "register" }} className="button button-primary">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Brand />
          <p>Domain registration and management by KmerHosting LLC.</p>
        </div>
        <div>
          <strong>Platform</strong>
          <Link to="/transfer-domain">Transfer a domain</Link>
          <Link to="/auth" search={{}}>Customer sign in</Link>
          <a href="mailto:support@kmerhosting.com">Technical support</a>
        </div>
        <div>
          <strong>Services</strong>
          <span>Domain search</span>
          <span>Domain transfers</span>
          <span>Secure payments</span>
        </div>
      </div>
      <div className="container footer-bottom">© {new Date().getFullYear()} KmerHosting LLC. All rights reserved.</div>
    </footer>
  );
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase().replaceAll("_", "-");
  return <span className={`status status-${normalized}`}>{value.replaceAll("_", " ")}</span>;
}

function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return <div className="loading"><LoaderCircle className="spin" size={20} /> {label}</div>;
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function HomePage() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const prices = useQuery({
    queryKey: ["prices"],
    queryFn: () => api<{ prices: TldPrice[] }>("/prices"),
  });
  const search = useMutation({
    mutationFn: (domains: string[]) => api<{ results: Array<{ domainName: string; registrar: Record<string, unknown>; price: TldPrice | null }> }>("/domains/check", {
      method: "POST",
      body: { domains },
    }),
    onMutate: () => setSearched(true),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const domains = query.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean).slice(0, 20);
    if (domains.length) search.mutate(domains);
  };

  return (
    <>
      <PublicHeader />
      <main>
        <section className="hero" id="search">
          <div className="hero-orb orb-one" />
          <div className="hero-orb orb-two" />
          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="eyebrow"><Sparkles size={15} /> From KmerHosting LLC</div>
              <h1>Search, buy and manage domains.<br /><span>All from one place.</span></h1>
              <p>Register, transfer, renew and manage DNS from your KmerHosting account.</p>
              <form className="domain-search" onSubmit={submit}>
                <Search size={21} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="yourbrand.com or multiple domains" aria-label="Domain names" />
                <button className="button button-primary" disabled={search.isPending}>
                  {search.isPending ? <LoaderCircle className="spin" size={18} /> : "Search domains"}
                </button>
              </form>
              <div className="search-hint">Bulk search up to 20 domains. Prices are shown in USD.</div>
            </div>
            <div className="hero-panel">
              <div className="panel-glow" />
              <div className="mini-window">
                <div className="window-top"><span /><span /><span /></div>
                <div className="availability-row">
                  <div className="availability-icon"><Check size={20} /></div>
                  <div><strong>kmerhosting.com</strong><span>Registered & protected</span></div>
                  <StatusBadge value="active" />
                </div>
                <div className="mini-metrics">
                  <div><span>Auto-renew</span><strong>Enabled</strong></div>
                  <div><span>Registrar lock</span><strong>Enabled</strong></div>
                  <div><span>DNS</span><strong>Managed</strong></div>
                </div>
                <div className="automation-line"><Zap size={17} /><span>Renewal reminders help you avoid missed expirations.</span></div>
              </div>
            </div>
          </div>
          {searched && (
            <div className="container results-wrap">
              {search.isPending && <LoadingBlock label="Checking registrar availability" />}
              {search.isError && <div className="alert alert-error">{errorText(search.error)}</div>}
              {search.data?.results.map((result) => {
                const raw = result.registrar as Record<string, any>;
                const availableValue = raw.available ?? raw.isAvailable ?? raw.data?.available ?? raw.data?.isAvailable ?? raw.status;
                const available = ["true", "available", "free", "1"].includes(String(availableValue).toLowerCase());
                return (
                  <div className="search-result" key={result.domainName}>
                    <div className={available ? "result-check available" : "result-check unavailable"}>{available ? <Check /> : <X />}</div>
                    <div className="result-domain"><strong>{result.domainName}</strong><span>{available ? "Available to register" : "Not available"}</span></div>
                    <div className="result-price">{result.price ? formatMoney(result.price.registration_price_usd) : "Unsupported TLD"}</div>
                    {available && result.price && <Link to="/register-domain" search={{ domain: result.domainName }} className="button button-primary">Register</Link>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="trust-strip">
          <div className="container trust-grid">
            <div><ShieldCheck /><span><strong>Domain management</strong>Safe availability checks</span></div>
            <div><CreditCard /><span><strong>CamerPay checkout</strong>Mobile money and cards</span></div>
            <div><Mail /><span><strong>Account email</strong>Verification and reminders</span></div>
            <div><Database /><span><strong>Reliable backend</strong>Secure platform services</span></div>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="container">
            <div className="section-heading">
              <div><span className="kicker">Transparent pricing</span><h2>Popular extensions</h2></div>
              <p>Registration, renewal and transfer pricing is displayed before checkout.</p>
            </div>
            {prices.isPending ? <LoadingBlock /> : prices.isError ? <div className="alert alert-error">{errorText(prices.error)}</div> : (
              <div className="price-grid">
                {prices.data?.prices.slice(0, 8).map((price) => (
                  <article className="price-card" key={price.tld}>
                    <div className="price-card-top">
                      <span className="tld">{price.tld}</span>
                      {price.is_promo && <span className="promo">Promo</span>}
                    </div>
                    <strong className="big-price">{formatMoney(price.registration_price_usd)}</strong>
                    <span className="price-term">first registration year</span>
                    <div className="price-lines">
                      <span>Renewal <strong>{formatMoney(price.renewal_price_usd)}</strong></span>
                      <span>Transfer <strong>{formatMoney(price.transfer_price_usd)}</strong></span>
                    </div>
                    <Link to="/register-domain" search={{ domain: `yourbrand${price.tld}` }} className="button button-secondary">Search {price.tld}</Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="section section-soft" id="features">
          <div className="container">
            <div className="section-heading centered">
              <span className="kicker">Built for domain management</span>
              <h2>After payment, we handle the registrar steps</h2>
              <p>Your domain order is processed and updated in your dashboard.</p>
            </div>
            <div className="feature-grid">
              {[
                [<Globe2 />, "Registration & transfer", "Register new domains or transfer existing names with encrypted EPP codes."],
                [<RefreshCw />, "Renewal lifecycle", "Automated renewal orders, expiry notices and repeated synchronization."],
                [<Network />, "DNS management", "Create and update A, AAAA, CNAME, MX, TXT, NS, SRV and CAA records."],
                [<ShieldCheck />, "Safer domain changes", "Payment checks, transfer locks and status updates reduce mistakes."],
                [<KeyRound />, "Secure customer accounts", "Email verification and protected sessions keep your account secure."],
                [<Bell />, "Actionable notifications", "Payment, provisioning, transfer and expiry events appear in one place."],
              ].map(([icon, title, text]) => (
                <article className="feature-card" key={String(title)}>
                  <div className="feature-icon">{icon}</div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="container cta-card">
            <div><span className="kicker light">Start now</span><h2>Your next domain is one search away.</h2><p>Create an account, verify your email and complete checkout securely.</p></div>
            <Link to="/auth" search={{ mode: "register" }} className="button button-light">Create account <ArrowRight size={18} /></Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}

function AuthPage() {
  const search = useSearch({ from: "/auth" }) as { mode?: string };
  const [mode, setMode] = useState(search.mode === "register" ? "register" : "login");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const request = useMutation({
    mutationFn: (data: Record<string, unknown>) => api<{ success: boolean }>(mode === "register" ? "/auth/register/request" : "/auth/login", {
      method: "POST",
      body: data,
    }),
    onSuccess: (data: any) => {
      if (mode === "register") setStep("otp");
      else {
        setSession(data.session);
        navigate({ to: "/dashboard" });
      }
    },
  });
  const otp = useMutation({
    mutationFn: (code: string) => api<{ user: User; session: Session }>(mode === "register" ? "/auth/register/verify" : "/auth/login/verify", {
      method: "POST",
      body: { email, code },
    }),
    onSuccess: (data) => {
      setSession(data.session);
      navigate({ to: "/dashboard" });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setEmail(String(data.email || ""));
    request.mutate(data);
  };

  return (
    <div className="auth-shell">
      <div className="auth-brand-pane">
        <Brand />
        <div>
          <span className="eyebrow dark"><ShieldCheck size={15} /> Secure customer portal</span>
          <h1>Control your domains from one dashboard.</h1>
          <p>OTP verification, protected transfer codes and secure domain management.</p>
        </div>
        <div className="auth-points">
          <span><Check /> Secure account verification</span>
          <span><Check /> Session protection included</span>
          <span><Check /> Payment and registrar keys are never exposed</span>
        </div>
      </div>
      <div className="auth-form-pane">
        <div className="auth-card">
          <Link to="/" className="back-link">← Back to domain search</Link>
          <div className="auth-tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setStep("form"); }}>Sign in</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setStep("form"); }}>Create account</button>
          </div>
          {step === "form" ? (
            <>
              <h2>{mode === "login" ? "Welcome back" : "Create your domain account"}</h2>
              <p>{mode === "login" ? "Sign in with your verified email and password." : "We will send a six-digit OTP to verify your email."}</p>
              <form className="form-stack" onSubmit={submit}>
                {mode === "register" && (
                  <>
                    <label>Full name<input name="fullName" required minLength={2} autoComplete="name" /></label>
                    <div className="form-row">
                      <label>Phone<input name="phone" required placeholder="2376…" autoComplete="tel" /></label>
                      <label>Country<input name="countryCode" required maxLength={2} placeholder="CM" /></label>
                    </div>
                  </>
                )}
                <label>Email address<input name="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                <label>Password<input name="password" type="password" required minLength={10} autoComplete={mode === "register" ? "new-password" : "current-password"} /></label>
                {request.isError && <div className="alert alert-error">{errorText(request.error)}</div>}
                <button className="button button-primary button-wide" disabled={request.isPending}>
                  {request.isPending && <LoaderCircle className="spin" size={18} />}
                  {mode === "login" ? "Sign in" : "Send verification code"}
                </button>
              </form>
              {mode === "login" && (
                <button className="text-button" onClick={() => api("/auth/login/request", { method: "POST", body: { email } }).then(() => setStep("otp")).catch(() => undefined)}>
                  Sign in with an OTP instead
                </button>
              )}
            </>
          ) : (
            <>
              <div className="otp-icon"><Mail /></div>
              <h2>Check your email</h2>
              <p>Enter the six-digit code sent to <strong>{email}</strong>.</p>
              <form className="form-stack" onSubmit={(event) => {
                event.preventDefault();
                otp.mutate(String(new FormData(event.currentTarget).get("code") || ""));
              }}>
                <label>Verification code<input name="code" className="otp-input" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus /></label>
                {otp.isError && <div className="alert alert-error">{errorText(otp.error)}</div>}
                <button className="button button-primary button-wide" disabled={otp.isPending}>
                  {otp.isPending && <LoaderCircle className="spin" size={18} />} Verify and continue
                </button>
                <button type="button" className="button button-ghost button-wide" onClick={() => setStep("form")}>Use another email</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const dashboardLinks = [
  ["/dashboard", "Overview", LayoutDashboard],
  ["/dashboard/domains", "Domains", Globe2],
  ["/dashboard/orders", "Orders & payments", CreditCard],
  ["/dashboard/contacts", "Contacts", UserRound],
  ["/dashboard/profile", "Profile", Settings2],
] as const;

function DashboardLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(false);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User }>("/me"),
    enabled: Boolean(session),
  });

  useEffect(() => {
    if (!session) navigate({ to: "/auth", search: {} });
  }, [session, navigate]);

  if (!session) return <LoadingBlock label="Redirecting to sign in" />;

  return (
    <div className="dashboard-shell">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <div className="sidebar-top"><Brand /><button className="icon-button mobile-only" onClick={() => setMobile(false)}><X /></button></div>
        <nav className="sidebar-nav">
          {dashboardLinks.map(([to, label, Icon]) => (
            <Link key={to} to={to} activeOptions={{ exact: to === "/dashboard" }} onClick={() => setMobile(false)}>
              <Icon size={19} /> {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-mini">
            <div className="avatar">{me.data?.user.fullName?.slice(0, 1).toUpperCase() || "K"}</div>
            <span><strong>{me.data?.user.fullName || "Customer"}</strong><small>{me.data?.user.email || ""}</small></span>
          </div>
          <button className="sidebar-logout" onClick={async () => {
            await api("/auth/logout", { method: "POST" }).catch(() => undefined);
            clearSession();
            navigate({ to: "/" });
          }}><LogOut size={18} /> Sign out</button>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <button className="icon-button mobile-only" onClick={() => setMobile(true)}><Menu /></button>
          <div className="dashboard-header-actions">
            <Link to="/" className="header-action"><Search size={18} /> Search domains</Link>
            <Link to="/dashboard" className="notification-button"><Bell size={19} /></Link>
          </div>
        </header>
        <div className="dashboard-content"><Outlet /></div>
      </div>
    </div>
  );
}

function DashboardOverview() {
  const data = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<{ domains: Domain[]; orders: Order[]; notifications: any[]; invoices: any[] }>("/dashboard"),
  });
  if (data.isPending) return <LoadingBlock label="Loading dashboard" />;
  if (data.isError) return <div className="alert alert-error">{errorText(data.error)}</div>;
  const domains = data.data.domains;
  const expiring = domains.filter((d) => d.expires_at && new Date(d.expires_at).getTime() < Date.now() + 30 * 86_400_000).length;
  return (
    <>
      <div className="page-heading"><div><span className="kicker">Customer portal</span><h1>Overview</h1><p>Your domains, orders and recent account activity.</p></div><Link to="/register-domain" search={{}} className="button button-primary"><Plus size={18} /> Register domain</Link></div>
      <div className="metric-grid">
        <div className="metric-card"><div className="metric-icon blue"><Globe2 /></div><span>Managed domains</span><strong>{domains.length}</strong><small>{domains.filter((d) => d.status === "active").length} active</small></div>
        <div className="metric-card"><div className="metric-icon green"><RefreshCw /></div><span>Auto-renew enabled</span><strong>{domains.filter((d) => d.auto_renew).length}</strong><small>Renewals can be paid from your account</small></div>
        <div className="metric-card"><div className="metric-icon orange"><Clock3 /></div><span>Expiring in 30 days</span><strong>{expiring}</strong><small>Email reminders are enabled</small></div>
        <div className="metric-card"><div className="metric-icon purple"><FileText /></div><span>Recent orders</span><strong>{data.data.orders.length}</strong><small>{data.data.orders.filter((o) => o.status === "completed").length} completed</small></div>
      </div>
      <div className="dashboard-grid">
        <section className="card">
          <div className="card-heading"><div><h2>Your domains</h2><p>Registration, transfer and renewal status.</p></div><Link to="/dashboard/domains">View all <ChevronRight size={17} /></Link></div>
          {domains.length ? <div className="table-wrap"><table><thead><tr><th>Domain</th><th>Status</th><th>Expires</th><th>Auto-renew</th></tr></thead><tbody>{domains.slice(0, 6).map((d) => <tr key={d.id}><td><Link to="/dashboard/domains/$domainId" params={{ domainId: d.id }} className="domain-cell"><Globe2 size={17} />{d.domain_name}</Link></td><td><StatusBadge value={d.status} /></td><td>{formatDate(d.expires_at)}</td><td>{d.auto_renew ? <span className="yes"><Check size={15} /> On</span> : "Off"}</td></tr>)}</tbody></table></div> : <EmptyState icon={<Globe2 />} title="No domains yet" text="Search for a new domain or transfer one you already own." action={<Link to="/register-domain" search={{}} className="button button-primary">Register a domain</Link>} />}
        </section>
        <section className="card activity-card">
          <div className="card-heading"><div><h2>Recent activity</h2><p>Recent account notifications.</p></div></div>
          {data.data.notifications.length ? <div className="activity-list">{data.data.notifications.slice(0, 7).map((n) => <div className="activity-item" key={n.id}><div className="activity-dot" /><div><strong>{n.title}</strong><p>{n.message}</p><small>{formatDate(n.created_at)}</small></div></div>)}</div> : <EmptyState icon={<Bell />} title="No activity" text="Account events will appear here." />}
        </section>
      </div>
    </>
  );
}

function DomainsPage() {
  const data = useQuery({ queryKey: ["domains"], queryFn: () => api<{ domains: Domain[] }>("/domains") });
  return (
    <>
      <div className="page-heading"><div><span className="kicker">Portfolio</span><h1>Domains</h1><p>Manage registrations, nameservers, DNS and renewal settings.</p></div><div className="heading-actions"><Link to="/transfer-domain" className="button button-secondary">Transfer</Link><Link to="/register-domain" search={{}} className="button button-primary"><Plus size={18} /> Register</Link></div></div>
      <section className="card">
        {data.isPending ? <LoadingBlock /> : data.isError ? <div className="alert alert-error">{errorText(data.error)}</div> : data.data.domains.length ? (
          <div className="domain-card-list">{data.data.domains.map((d) => <Link to="/dashboard/domains/$domainId" params={{ domainId: d.id }} className="domain-list-card" key={d.id}><div className="domain-logo"><Globe2 /></div><div className="domain-list-main"><strong>{d.domain_name}</strong><span>Expires {formatDate(d.expires_at)}</span></div><StatusBadge value={d.status} /><div className="domain-flags"><span className={d.auto_renew ? "flag enabled" : "flag"}><RefreshCw size={14} /> Auto-renew</span><span className={d.locked ? "flag enabled" : "flag"}><LockKeyhole size={14} /> Locked</span></div><ChevronRight /></Link>)}</div>
        ) : <EmptyState icon={<Globe2 />} title="Build your domain portfolio" text="Register a new name or transfer an existing domain." action={<Link to="/register-domain" search={{}} className="button button-primary">Find a domain</Link>} />}
      </section>
    </>
  );
}

function DomainDetailPage() {
  const { domainId } = useParams({ from: "/dashboard/domains/$domainId" });
  const client = useQueryClient();
  const data = useQuery({ queryKey: ["domain", domainId], queryFn: () => api<{ domain: Domain }>(`/domains/${domainId}`) });
  const autoRenew = useMutation({
    mutationFn: (enabled: boolean) => api(`/domains/${domainId}/auto-renew`, { method: "PUT", body: { enabled } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["domain", domainId] }),
  });
  const nameservers = useMutation({
    mutationFn: (values: string[]) => api(`/domains/${domainId}/nameservers`, { method: "PUT", body: { nameServers: values } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["domain", domainId] }),
  });
  const addDns = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/domains/${domainId}/dns`, { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["domain", domainId] }),
  });
  const deleteDns = useMutation({
    mutationFn: (id: string) => api(`/domains/${domainId}/dns/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["domain", domainId] }),
  });

  if (data.isPending) return <LoadingBlock label="Loading domain" />;
  if (data.isError) return <div className="alert alert-error">{errorText(data.error)}</div>;
  const d = data.data.domain;
  return (
    <>
      <div className="page-heading">
        <div><Link to="/dashboard/domains" className="back-link">← Domains</Link><div className="title-with-status"><h1>{d.domain_name}</h1><StatusBadge value={d.status} /></div><p>Registered {formatDate(d.registered_at)} · Expires {formatDate(d.expires_at)}</p></div>
        <Link to="/register-domain" search={{ domain: "" }} className="button button-secondary">Register another</Link>
      </div>
      <div className="detail-grid">
        <section className="card">
          <div className="card-heading"><div><h2>Protection & renewal</h2><p>Keep the domain active without missing an expiry date.</p></div></div>
          <div className="setting-row"><div className="setting-icon"><RefreshCw /></div><div><strong>Automatic renewal</strong><p>The system creates a renewal payment request before expiration.</p></div><button className={d.auto_renew ? "toggle on" : "toggle"} onClick={() => autoRenew.mutate(!d.auto_renew)}><span /></button></div>
          <div className="setting-row"><div className="setting-icon"><LockKeyhole /></div><div><strong>Registrar lock</strong><p>Prevents unauthorized transfer attempts.</p></div><StatusBadge value={d.locked ? "active" : "disabled"} /></div>
          <div className="setting-row"><div className="setting-icon"><ShieldCheck /></div><div><strong>WHOIS privacy</strong><p>Registrant details are protected where the TLD supports it.</p></div><StatusBadge value={d.privacy_enabled ? "active" : "disabled"} /></div>
        </section>
        <section className="card">
          <div className="card-heading"><div><h2>Nameservers</h2><p>Nameserver changes are submitted to the registrar. Some changes may take time to appear.</p></div></div>
          <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            nameservers.mutate([String(form.get("ns1") || ""), String(form.get("ns2") || "")]);
          }}>
            <label>Primary nameserver<input name="ns1" defaultValue={d.nameservers?.[0] || ""} required /></label>
            <label>Secondary nameserver<input name="ns2" defaultValue={d.nameservers?.[1] || ""} required /></label>
            {nameservers.isError && <div className="alert alert-error">{errorText(nameservers.error)}</div>}
            <button className="button button-secondary" disabled={nameservers.isPending}>{nameservers.isPending && <LoaderCircle className="spin" size={17} />} Save nameservers</button>
          </form>
        </section>
      </div>
      <section className="card">
        <div className="card-heading"><div><h2>DNS records</h2><p>Add and manage DNS records for this domain.</p></div></div>
        <form className="dns-add-row" onSubmit={(event) => {
          event.preventDefault();
          const f = Object.fromEntries(new FormData(event.currentTarget));
          addDns.mutate({ name: f.name, type: f.type, content: f.content, ttl: Number(f.ttl) });
          event.currentTarget.reset();
        }}>
          <input name="name" placeholder="@ or host" required />
          <select name="type" defaultValue="A">{["A","AAAA","CNAME","MX","TXT","NS","SRV","CAA"].map((t) => <option key={t}>{t}</option>)}</select>
          <input name="content" placeholder="Record value" required />
          <input name="ttl" type="number" defaultValue="3600" min="1" max="86400" required />
          <button className="button button-primary"><Plus size={17} /> Add</button>
        </form>
        {addDns.isError && <div className="alert alert-error">{errorText(addDns.error)}</div>}
        {d.domain_dns_records?.length ? (
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>TTL</th><th>Status</th><th /></tr></thead><tbody>{d.domain_dns_records.map((r) => <tr key={r.id}><td>{r.name}</td><td><span className="record-type">{r.type}</span></td><td className="mono">{r.contents.join(", ")}</td><td>{r.ttl}</td><td><StatusBadge value={r.status} /></td><td><button className="icon-button danger" onClick={() => deleteDns.mutate(r.id)}><Trash2 size={17} /></button></td></tr>)}</tbody></table></div>
        ) : <EmptyState icon={<Network />} title="No DNS records" text="Create the first zone record for this domain." />}
      </section>
    </>
  );
}

function OrdersPage() {
  const client = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);
  const [checkingOrderId, setCheckingOrderId] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ orders: Order[] }>("/orders"),
    refetchInterval: 20_000,
  });
  const checkout = useMutation({
    mutationFn: ({ id, phone, paymentMethod }: { id: string; phone: string; paymentMethod: string }) =>
      api<{ payment: { checkout_url: string } }>(`/orders/${id}/checkout`, {
        method: "POST",
        body: { phone, paymentMethod },
      }),
    onSuccess: (result, variables) => {
      localStorage.setItem("kmerhosting-domain-pending-order", variables.id);
      window.location.assign(result.payment.checkout_url);
    },
  });
  const checkStatus = useMutation({
    mutationFn: (orderId: string) =>
      paymentApi<PaymentCheckResult>("/check", { method: "POST", body: { orderId } }),
    onMutate: (orderId) => setCheckingOrderId(orderId),
    onSuccess: (result, orderId) => {
      if (result.payment.status === "paid" &&
          localStorage.getItem("kmerhosting-domain-pending-order") === orderId) {
        localStorage.removeItem("kmerhosting-domain-pending-order");
      }
      client.invalidateQueries({ queryKey: ["orders"] });
      client.invalidateQueries({ queryKey: ["dashboard"] });
      client.invalidateQueries({ queryKey: ["domains"] });
    },
    onSettled: () => setCheckingOrderId(null),
  });

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="kicker">Billing</span>
          <h1>Orders & payments</h1>
          <p>Track orders, payments and invoices.</p>
        </div>
      </div>

      {checkStatus.isError && <div className="alert alert-error">{errorText(checkStatus.error)}</div>}
      {checkStatus.isSuccess && (
        <div className={checkStatus.data.payment.status === "paid" ? "alert alert-success" : "alert alert-warning"}>
          {checkStatus.data.payment.status === "paid"
            ? "Payment confirmed. We are now processing your domain order."
            : `CamerPay currently reports ${checkStatus.data.providerStatus || checkStatus.data.payment.status}. You can check again.`}
        </div>
      )}

      <section className="card">
        {data.isPending ? <LoadingBlock /> : data.isError ? (
          <div className="alert alert-error">{errorText(data.error)}</div>
        ) : data.data.orders.length ? (
          <div className="order-list">
            {data.data.orders.map((o) => {
              const latestPayment = [...(o.domain_payments || [])].sort(
                (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
              )[0];
              const paymentPending = ["pending", "processing"].includes(latestPayment?.status || "");
              const canPay = ["pending_payment", "payment_pending"].includes(o.status) &&
                latestPayment?.status !== "paid";
              const canCheck = o.status === "payment_pending" && Boolean(latestPayment) &&
                latestPayment?.status !== "paid";

              return (
                <div className="order-card" key={o.id}>
                  <div className="order-icon">
                    {o.type === "renewal" ? <RefreshCw /> : o.type === "transfer" ? <ArrowRight /> : <Globe2 />}
                  </div>
                  <div className="order-main">
                    <strong>{o.domain_name}</strong>
                    <span>{o.order_number} · {o.type}</span>
                    <small>{formatDate(o.created_at)}</small>
                  </div>
                  <div className="order-amount">
                    <strong>{formatMoney(o.price_usd)}</strong>
                    <span>{formatMoney(o.amount_xaf, "XAF")}</span>
                  </div>
                  <StatusBadge value={o.status} />
                  <div className="order-actions">
                    {canCheck && (
                      <button
                        className="button button-secondary"
                        disabled={checkingOrderId === o.id}
                        onClick={() => checkStatus.mutate(o.id)}
                      >
                        {checkingOrderId === o.id
                          ? <LoaderCircle className="spin" size={16} />
                          : <RefreshCw size={16} />}
                        {paymentPending ? "Check payment status" : "Check again"}
                      </button>
                    )}
                    {canPay && (
                      <button className="button button-primary" onClick={() => setPaying(o.id)}>
                        Pay now
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<CreditCard />}
            title="No orders"
            text="Your registration, transfer and renewal orders will appear here."
          />
        )}
      </section>

      {paying && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-heading">
              <h2>Complete payment</h2>
              <button className="icon-button" onClick={() => setPaying(null)}><X /></button>
            </div>
            <p>CamerPay will open a secure checkout page. We will update the order when the payment is confirmed.</p>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                checkout.mutate({
                  id: paying,
                  phone: String(form.get("phone") || ""),
                  paymentMethod: String(form.get("paymentMethod") || "orange_money"),
                });
              }}
            >
              <label>Payment phone<input name="phone" required placeholder="2376…" /></label>
              <label>
                Payment method
                <select name="paymentMethod">
                  <option value="orange_money">Orange Money</option>
                  <option value="mtn_momo">MTN MoMo</option>
                  <option value="stripe">Card</option>
                  <option value="paypal">PayPal</option>
                </select>
              </label>
              {checkout.isError && <div className="alert alert-error">{errorText(checkout.error)}</div>}
              <button className="button button-primary button-wide" disabled={checkout.isPending}>
                {checkout.isPending && <LoaderCircle className="spin" size={17} />}
                Continue to CamerPay
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function ContactsPage() {
  const client = useQueryClient();
  const data = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Contact[] }>("/contacts") });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/contacts", { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["contacts"] }),
  });
  return (
    <>
      <div className="page-heading"><div><span className="kicker">Registrant data</span><h1>Contacts</h1><p>Reusable contact information for registration and transfers.</p></div></div>
      <div className="contacts-grid">
        <section className="card">
          <div className="card-heading"><div><h2>Saved contacts</h2><p>Complete registrant details are required to register or transfer a domain.</p></div></div>
          {data.isPending ? <LoadingBlock /> : data.data?.contacts.length ? <div className="contact-list">{data.data.contacts.map((c) => <div className="contact-card" key={c.id}><div className="avatar">{c.first_name[0]}{c.last_name[0]}</div><div><strong>{c.first_name} {c.last_name}</strong><span>{c.label}{c.is_default ? " · Default" : ""}</span><small>{c.email}<br />{c.city}, {c.country}</small></div>{c.is_default && <BadgeCheck className="verified-icon" />}</div>)}</div> : <EmptyState icon={<UserRound />} title="No contacts" text="Add a complete registrant contact before ordering a domain." />}
        </section>
        <section className="card">
          <div className="card-heading"><div><h2>Add contact</h2><p>Use accurate legal contact details.</p></div></div>
          <form className="form-stack compact" onSubmit={(event) => {
            event.preventDefault();
            const raw = Object.fromEntries(new FormData(event.currentTarget));
            create.mutate({ ...raw, isDefault: raw.isDefault === "on" });
            if (!create.isError) event.currentTarget.reset();
          }}>
            <div className="form-row"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label></div>
            <label>Company<input name="companyName" /></label>
            <label>Email<input name="email" type="email" required /></label>
            <div className="form-row"><label>Calling code<input name="phoneCountryCode" placeholder="237" required /></label><label>Phone<input name="phone" required /></label></div>
            <label>Street address<input name="address" required /></label>
            <div className="form-row"><label>City<input name="city" required /></label><label>State / region<input name="state" required /></label></div>
            <div className="form-row"><label>Postal code<input name="postalCode" required /></label><label>Country code<input name="country" maxLength={2} placeholder="CM" required /></label></div>
            <label className="checkbox"><input type="checkbox" name="isDefault" /> Use as default registrant</label>
            {create.isError && <div className="alert alert-error">{errorText(create.error)}</div>}
            <button className="button button-primary" disabled={create.isPending}>{create.isPending && <LoaderCircle className="spin" size={17} />} Save contact</button>
          </form>
        </section>
      </div>
    </>
  );
}

function ProfilePage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: User }>("/me") });
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ user: User }>("/me", { method: "PATCH", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
  return (
    <>
      <div className="page-heading"><div><span className="kicker">Account</span><h1>Profile</h1><p>Update customer and payment contact information.</p></div></div>
      <section className="card profile-card">
        {me.isPending ? <LoadingBlock /> : me.isError ? <div className="alert alert-error">{errorText(me.error)}</div> : (
          <form className="form-stack" onSubmit={(event) => {event.preventDefault();update.mutate(Object.fromEntries(new FormData(event.currentTarget)));}}>
            <div className="profile-header"><div className="avatar large">{me.data.user.fullName[0]}</div><div><h2>{me.data.user.fullName}</h2><span>{me.data.user.email}</span></div><StatusBadge value="verified" /></div>
            <label>Full name<input name="fullName" defaultValue={me.data.user.fullName} required /></label>
            <label>Email<input value={me.data.user.email} disabled /><small>Email changes require a separate OTP verification flow.</small></label>
            <div className="form-row"><label>Phone<input name="phone" defaultValue={me.data.user.phone || ""} /></label><label>Country<input name="countryCode" maxLength={2} defaultValue={me.data.user.countryCode || ""} /></label></div>
            {update.isSuccess && <div className="alert alert-success">Profile updated.</div>}
            {update.isError && <div className="alert alert-error">{errorText(update.error)}</div>}
            <button className="button button-primary" disabled={update.isPending}>Save changes</button>
          </form>
        )}
      </section>
    </>
  );
}

function PurchasePage({ type }: { type: "registration" | "transfer" }) {
  const search = useSearch({ strict: false }) as { domain?: string };
  const navigate = useNavigate();
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Contact[] }>("/contacts"), enabled: Boolean(getSession()) });
  const order = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ order: Order }>(`/orders/${type}`, { method: "POST", body, idempotencyKey: newIdempotencyKey(type) }),
    onSuccess: () => navigate({ to: "/dashboard/orders" }),
  });
  const session = useSession();
  return (
    <>
      <PublicHeader />
      <main className="purchase-main">
        <div className="container narrow">
          <div className="purchase-heading"><span className="kicker">{type === "registration" ? "New registration" : "Domain transfer"}</span><h1>{type === "registration" ? "Register a domain" : "Transfer your domain"}</h1><p>{type === "registration" ? "Create the order, then complete secure CamerPay checkout." : "Enter the current registrar EPP/auth code. It is encrypted before storage."}</p></div>
          {!session ? <div className="card sign-in-gate"><KeyRound /><h2>Sign in first</h2><p>A verified account is required for domain ownership and billing.</p><Link to="/auth" search={{}} className="button button-primary">Sign in or create account</Link></div> : (
            <section className="card">
              <form className="form-stack" onSubmit={(event) => {
                event.preventDefault();
                const raw = Object.fromEntries(new FormData(event.currentTarget));
                order.mutate({ ...raw, years: Number(raw.years), nameServers: [raw.ns1, raw.ns2] });
              }}>
                <label>Domain name<input name="domainName" defaultValue={search.domain || ""} placeholder="yourbrand.com" required /></label>
                {type === "transfer" && <label>EPP / authorization code<input name="authCode" type="password" required minLength={4} /></label>}
                <div className="form-row"><label>Registration period<select name="years" defaultValue="1">{[1,2,3,4,5,6,7,8,9,10].map((n) => <option value={n} key={n}>{n} year{n > 1 ? "s" : ""}</option>)}</select></label><label>Registrant contact<select name="contactId" required defaultValue="">{<option value="" disabled>Select a contact</option>}{contacts.data?.contacts.map((c) => <option value={c.id} key={c.id}>{c.first_name} {c.last_name} — {c.label}</option>)}</select></label></div>
                <div className="form-row"><label>Primary nameserver<input name="ns1" defaultValue="tr.apiname.com" required /></label><label>Secondary nameserver<input name="ns2" defaultValue="eu.apiname.com" required /></label></div>
                {!contacts.isPending && !contacts.data?.contacts.length && <div className="alert alert-warning">Create a registrant contact in the dashboard before ordering.</div>}
                {order.isError && <div className="alert alert-error">{errorText(order.error)}</div>}
                <button className="button button-primary button-wide" disabled={order.isPending || !contacts.data?.contacts.length}>{order.isPending && <LoaderCircle className="spin" size={18} />} Create {type} order</button>
              </form>
            </section>
          )}
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

function PaymentReturnPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [pollStartedAt] = useState(() => Date.now());
  const returnSearch = new URLSearchParams(window.location.search);
  const orderFromUrl = returnSearch.get("order");
  const invoiceFromUrl = returnSearch.get("invoice");
  const orderId = orderFromUrl || localStorage.getItem("kmerhosting-domain-pending-order");
  const paymentReference = orderId ? { orderId } : invoiceFromUrl ? { invoice: invoiceFromUrl } : null;
  const session = getSession();
  const terminalStatuses = ["paid", "failed", "cancelled", "refunded"];

  const status = useQuery({
    queryKey: ["payment-return", orderId, invoiceFromUrl],
    queryFn: () => {
      if (!paymentReference) throw new Error("The payment order reference is missing.");
      return paymentApi<PaymentCheckResult>("/check", { method: "POST", body: paymentReference });
    },
    enabled: Boolean(paymentReference && session),
    retry: false,
    refetchInterval: (query) => {
      const paymentStatus = query.state.data?.payment.status;
      if (paymentStatus && terminalStatuses.includes(paymentStatus)) return false;
      if (Date.now() - pollStartedAt >= 300_000) return false;
      return 5_000;
    },
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (status.data?.payment.status === "paid") {
      localStorage.removeItem("kmerhosting-domain-pending-order");
      client.invalidateQueries({ queryKey: ["orders"] });
      client.invalidateQueries({ queryKey: ["dashboard"] });
      client.invalidateQueries({ queryKey: ["domains"] });
      const timer = setTimeout(() => navigate({ to: "/dashboard/orders" }), 2500);
      return () => clearTimeout(timer);
    }
  }, [status.data, navigate, client]);

  const paymentStatus = status.data?.payment.status;
  const pollingStopped = Date.now() - pollStartedAt >= 300_000 &&
    !terminalStatuses.includes(paymentStatus || "");
  const lastChecked = status.data?.checkedAt
    ? new Date(status.data.checkedAt).toLocaleTimeString("en-US")
    : null;

  return (
    <div className="return-page">
      <Brand />
      <div className="return-card">
        {!paymentReference ? (
          <>
            <X className="return-error" />
            <h1>Payment reference missing</h1>
            <p>Open your orders and use the payment status button on the relevant order.</p>
            <Link to="/dashboard/orders" className="button button-primary">Open orders</Link>
          </>
        ) : !session ? (
          <>
            <KeyRound className="return-error" />
            <h1>Sign in to verify payment</h1>
            <p>Payment status is protected and can only be checked from the account that created the order.</p>
            <Link to="/auth" search={{}} className="button button-primary">Sign in</Link>
          </>
        ) : status.isPending ? (
          <>
            <LoaderCircle className="spin return-loader" />
            <h1>Confirming payment</h1>
            <p>We are checking your payment status. This usually takes a few seconds.</p>
          </>
        ) : status.isError ? (
          <>
            <X className="return-error" />
            <h1>Unable to confirm yet</h1>
            <p>{errorText(status.error)}</p>
            <div className="return-actions">
              <button
                className="button button-secondary"
                onClick={() => status.refetch()}
                disabled={status.isFetching}
              >
                {status.isFetching ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                Check payment status
              </button>
              <Link to="/dashboard/orders" className="button button-primary">Open orders</Link>
            </div>
          </>
        ) : paymentStatus === "paid" ? (
          <>
            <BadgeCheck className="return-success" />
            <h1>Payment confirmed</h1>
            <p>Payment confirmed. We are now processing your domain order.</p>
          </>
        ) : ["failed", "cancelled", "refunded"].includes(paymentStatus || "") ? (
          <>
            <X className="return-error" />
            <h1>Payment {paymentStatus}</h1>
            <p>CamerPay returned a final payment status. Open the order to start another checkout when applicable.</p>
            <Link to="/dashboard/orders" className="button button-primary">Open orders</Link>
          </>
        ) : (
          <>
            <Clock3 className="return-waiting" />
            <h1>Payment pending</h1>
            <p>
              {pollingStopped
                ? "We could not confirm the payment after 5 minutes. Use the button below to check again."
                : "We are checking CamerPay for confirmation. This can take a few minutes."}
            </p>
            {lastChecked && <small className="last-checked">Last checked at {lastChecked}</small>}
            <div className="return-actions">
              <button
                className="button button-secondary"
                onClick={() => status.refetch()}
                disabled={status.isFetching}
              >
                {status.isFetching ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                Check payment status
              </button>
              <Link to="/dashboard/orders" className="button button-primary">Open orders</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
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
const transferRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transfer-domain",
  component: () => <PurchasePage type="transfer" />,
});
const returnRoute = createRoute({ getParentRoute: () => rootRoute, path: "/payment/return", component: PaymentReturnPage });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: DashboardLayout });
const dashboardIndexRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/", component: DashboardOverview });
const domainsRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/domains", component: DomainsPage });
const domainDetailRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/domains/$domainId", component: DomainDetailPage });
const ordersRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/orders", component: OrdersPage });
const contactsRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/contacts", component: ContactsPage });
const profileRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/profile", component: ProfilePage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  registerRoute,
  transferRoute,
  returnRoute,
  dashboardRoute.addChildren([dashboardIndexRoute, domainsRoute, domainDetailRoute, ordersRoute, contactsRoute, profileRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
