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
  ContentSwitcher,
  Grid,
  InlineLoading,
  InlineNotification,
  Modal,
  PasswordInput,
  RadioButton,
  RadioButtonGroup,
  Search as SearchInput,
  Select,
  SelectItem,
  SkeletonPlaceholder,
  SkeletonText,
  Switch,
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
  Toggle,
} from "@carbon/react";
import { Search as SearchIcon } from "@carbon/react/icons";
import {
  ApiClientError,
  api,
  customerToolsApi,
  domainSearchApi,
  downloadDomainDocument,
  formatDate,
  formatMoney,
  getSession,
  newIdempotencyKey,
  orderGuardApi,
  setSession,
  subscribeSession,
  type Session,
  type User,
} from "./api";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { SharedHostingCatalog } from "./shared-hosting-catalog";
import { TldCatalogPage } from "./tld-catalog-page";
import { featuredTlds } from "./tld-catalog";

type Row = Record<string, any>;

const COUNTRY_CODES = "AF AL DZ AO AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW".split(" ");
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
  min_years?: number;
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
  payableInCurrentEnvironment?: boolean;
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
  balanceSource: string;
  registrarEnvironment: "production" | "ote";
  testMode: boolean;
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
  const customerPrice = Number(providerInfo(result.registrar).customerPriceUsd);
  return Number.isFinite(customerPrice) && customerPrice > 0
    ? Math.round(customerPrice * 100) / 100
    : Number(result.price.registration_price_usd || 0);
}

function parseDomainInput(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .split(/[\s,;]+/)
      .map((domain) => domain.trim())
      .filter(Boolean),
  )).slice(0, 20);
}

function validDomainInput(value: string): boolean {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.$/, "");
  return domain.length >= 3 && domain.length <= 253 && domain.includes(".") && domain.split(".").every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function validNameserver(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  return host.length >= 3 && host.length <= 253 && host.includes(".") && host.split(".").every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function validContactEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function supportedPrice(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function DomainPriceBreakdown({ result, dueToday }: { result: SearchResult; dueToday: "registration" | "transfer" | null }) {
  const purchasePrice = premiumDisplayPrice(result);
  const registrationPeriod = result.price?.min_years || result.price?.registration_periods?.[0] || 1;
  const transferPrice = supportedPrice(result.price?.transfer_price_usd);
  const renewalPrice = supportedPrice(result.price?.renewal_price_usd);
  const dueTodayPrice = dueToday === "registration" ? purchasePrice : dueToday === "transfer" ? transferPrice : null;
  const display = (amount: number | null) => amount === null ? "Unavailable" : formatMoney(amount);

  return <div className="carbon-domain-price-breakdown" aria-label={`Pricing for ${result.domainName}`}>
    <div><span>Purchase price · {registrationPeriod} {registrationPeriod === 1 ? "year" : "years"}</span><strong>{display(purchasePrice)}</strong></div>
    <div><span>Transfer price</span><strong>{display(transferPrice)}</strong></div>
    <div><span>Renewal price</span><strong>{display(renewalPrice)}</strong></div>
    <div className="carbon-domain-price-breakdown__due"><span>Due today{dueToday === "transfer" ? " · transfer" : dueToday === "registration" ? " · purchase" : ""}</span><strong>{dueToday ? display(dueTodayPrice) : "No purchase available"}</strong></div>
  </div>;
}

function Brand() {
  return <a href="/" className="brand carbon-brand" aria-label="KmerHosting Domains">
    <strong>KmerHosting</strong><span>Domains</span>
  </a>;
}

type CarbonTagType = "green" | "red" | "warm-gray" | "blue" | "gray";
function tagType(value: string): CarbonTagType {
  const normalized = value.toLowerCase().replaceAll("_", "-");
  if (["active", "available", "completed", "paid", "verified", "enabled"].includes(normalized)) return "green";
  if (["failed", "expired", "cancelled", "disabled", "dead"].includes(normalized)) return "red";
  if (["pending", "processing", "queued", "transfer-pending", "pending-payment", "payment-pending"].includes(normalized)) return "warm-gray";
  if (["test-ote", "ote", "test"].includes(normalized)) return "blue";
  return "gray";
}

function StatusBadge({ value }: { value: string }) {
  return <Tag type={tagType(value)}>{value.replaceAll("_", " ")}</Tag>;
}

function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return <Tile className="carbon-loading-block" aria-label={label} aria-busy="true">
    <SkeletonText heading width="38%" />
    <SkeletonText paragraph lineCount={3} width="78%" />
  </Tile>;
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
  return <Grid fullWidth className="carbon-metric-grid">{metrics.map(([label, value]) => <Column sm={4} md={4} lg={4} key={label}><Tile className="carbon-metric"><span>{label}</span><strong>{value}</strong></Tile></Column>)}</Grid>;
}

function HomePage() {
  const [query, setQuery] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [searched, setSearched] = useState(false);
  const parsedDomains = parseDomainInput(query);
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => domainSearchApi<{ prices: TldPrice[] }>("/prices") });
  const search = useMutation({
    mutationFn: (domains: string[]) => domainSearchApi<{ results: SearchResult[] }>("", { method: "POST", body: { domains } }),
    onMutate: () => setSearched(true),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsedDomains.length) search.mutate(parsedDomains);
  };

  return <><main>
    <section className="carbon-hero carbon-domain-overview" id="search">
      <Grid fullWidth className="carbon-domain-overview__grid">
        <Column sm={4} md={8} lg={{ span: 12, offset: 2 }} className="carbon-domain-overview__content">
          <h1>Find the domain that fits your next idea.</h1>
          <p className="carbon-lead">Check availability and compare current registration, renewal and transfer prices.</p>
          <div className="carbon-domain-search-mode">
            <ContentSwitcher
              selectedIndex={bulkMode ? 1 : 0}
              onChange={(selection) => setBulkMode(selection.name === "bulk")}
              size="lg"
              aria-label="Domain search mode"
            >
              <Switch name="single" text="Single domain" />
              <Switch name="bulk" text="Bulk search" />
            </ContentSwitcher>
          </div>
          <form className={`carbon-domain-search-form${bulkMode ? " carbon-domain-search-form--bulk" : ""}`} onSubmit={submit}>
            <div className="carbon-domain-search-form__field">
              {bulkMode ? (
                <TextArea
                  id="domain-search"
                  labelText="Domains to check"
                  helperText="Up to 20 domains. One per line or comma-separated."
                  placeholder={"yourbrand.com\nmyproduct.io\nteam.dev"}
                  rows={3}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              ) : (
                <SearchInput
                  id="domain-search"
                  labelText="Search for a domain"
                  size="lg"
                  placeholder="Search a domain, for example yourbrand.com"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
            </div>
            <div className="carbon-domain-search-form__actions">
              <Button type="submit" size="lg" renderIcon={SearchIcon} disabled={search.isPending || !parsedDomains.length}>
                {search.isPending ? "Checking…" : parsedDomains.length > 1 ? `Search ${parsedDomains.length} domains` : "Search domain"}
              </Button>
            </div>
          </form>
          <div className="carbon-domain-search-form__meta" aria-live="polite">
            <span>{parsedDomains.length ? `${parsedDomains.length} unique domain${parsedDomains.length === 1 ? "" : "s"} ready to check.` : "Live availability and USD pricing."}</span>
            <span>{bulkMode ? "Bulk search checks up to 20 domains at once." : "Need more than one? Use bulk search."}</span>
          </div>
        </Column>
      </Grid>

      {searched ? <div className="container carbon-search-results">
        {search.isPending ? <div className="carbon-search-skeletons" aria-label="Checking live availability" aria-busy="true">{parsedDomains.slice(0, 4).map((domain) => <Tile className="carbon-search-skeleton" key={domain}><SkeletonText heading width="56%" /><SkeletonText paragraph lineCount={2} width="88%" /><SkeletonPlaceholder /></Tile>)}</div> : null}
        {search.isError ? <ErrorNotice error={search.error} title="Domain search failed" /> : null}
        {search.data?.results.map((result) => {
          const available = isAvailable(result.registrar);
          const info = providerInfo(result.registrar);
          const premium = Boolean(info.isPremium ?? info.premium);
          return <Tile className="carbon-result-row" key={result.domainName}>
            <div><strong>{result.domainName}</strong><p>{available ? premium ? "Available premium domain" : "Available to register" : "Not available"}</p></div>
            <DomainPriceBreakdown result={result} dueToday={available && result.price ? "registration" : (result.price?.transfer_price_usd || 0) > 0 ? "transfer" : null} />
            <div className="carbon-result-row__meta">{premium ? <Tag type="purple">Premium</Tag> : null}<StatusBadge value={available ? "available" : "unavailable"} />{available && result.price ? <Button href={`/register-domain?domain=${encodeURIComponent(result.domainName)}`}>Purchase</Button> : (result.price?.transfer_price_usd || 0) > 0 ? <Button kind="secondary" href={`/transfer-domain?domain=${encodeURIComponent(result.domainName)}`}>Transfer</Button> : null}</div>
          </Tile>;
        })}
      </div> : null}
    </section>

    <section className="section" id="pricing"><div className="container">
      <div className="section-heading"><div><span className="kicker">Domain pricing</span><h2>Popular extensions</h2></div><p>See current registration, renewal and transfer prices for popular extensions. Restoration is not currently available.</p></div>
      {prices.isPending ? <LoadingBlock /> : prices.isError ? <ErrorNotice error={prices.error} title="Pricing unavailable" /> : <Grid fullWidth className="carbon-card-grid">{featuredTlds(prices.data?.prices || []).map((price) => {
        const registrationPeriod = price.min_years || price.registration_periods?.[0] || 1;
        return <Column sm={4} md={4} lg={4} key={price.tld}><Tile className="carbon-price-card">
        <div className="price-card-top"><strong className="tld">{price.tld}</strong>{price.is_promo ? <Tag type="green">Promo</Tag> : null}</div>
        <strong className="big-price">{formatMoney(price.registration_price_usd)}</strong><span className="price-term">{registrationPeriod}-year registration</span>
        <div className="price-lines"><span>Renewal <strong>{formatMoney(price.renewal_price_usd)}</strong></span><span>Transfer <strong>{price.transfer_price_usd > 0 ? formatMoney(price.transfer_price_usd) : "Unsupported"}</strong></span></div>
        <Button kind="secondary" href={`/register-domain?domain=${encodeURIComponent(`yourbrand${price.tld}`)}`}>Search {price.tld}</Button>
      </Tile></Column>})}</Grid>}
    </div></section>

    <SharedHostingCatalog />

    <section className="section section-soft" id="features"><div className="container">
      <div className="section-heading"><div><span className="kicker">Domain services</span><h2>Manage your domain</h2></div><p>Search, register, transfer and manage your domain in one place.</p></div>
      <Grid fullWidth className="carbon-card-grid">{[
        ["Search and registration", "Check availability and register supported extensions."],
        ["Transfers and renewals", "See eligibility and current pricing before you confirm."],
        ["DNS and nameservers", "Manage records and nameservers from one place."],
        ["Lock and privacy", "Protect your domain where the extension supports it."],
        ["WHOIS contacts", "Keep registrant information ready for registration."],
        ["Lifecycle automation", "Keep renewal enabled to help avoid service interruption."],
      ].map(([title, text]) => <Column sm={4} md={4} lg={4} key={title}><Tile className="carbon-feature-card"><h3>{title}</h3><p>{text}</p></Tile></Column>)}</Grid>
    </div></section>

    <section className="cta-section"><div className="container"><Tile className="carbon-cta"><div><span className="kicker">Get started</span><h2>Find your next domain.</h2><p>Create or use your KmerHosting account, add a contact and review the price before ordering.</p></div><Button href="https://dashboard.kmerhosting.com/register">Create account</Button></Tile></div></section>
  </main></>;
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
    <Column sm={4} md={4} lg={8} className="carbon-auth-page__intro"><span className="kicker">KmerHosting Account</span><h1>Manage your domain from your KmerHosting account.</h1><p>Use the same account for domains, billing and other KmerHosting services.</p></Column>
    <Column sm={4} md={4} lg={8} className="carbon-auth-page__form"><Tile className="auth-card"><a href="/" className="back-link">Back to domain search</a><h2>{ssoBusy ? "Verifying your account…" : "Sign in to continue"}</h2><p>{ssoBusy ? "Your account is being verified." : "You will continue through the secure KmerHosting account sign-in."}</p>{ssoError ? <ErrorNotice error={new Error(ssoError)} title="Sign-in failed" /> : null}{ssoBusy ? <InlineLoading description="Verifying KmerHosting Account…" /> : <Button href={dashboardLoginUrl}>Continue with KmerHosting Account</Button>}<p className="auth-helper">New to KmerHosting? <a href={dashboardRegisterUrl}>Create your central account</a>.</p></Tile></Column>
  </Grid></main>;
}

function contactName(contact: Contact) {
  return contact.label || `${contact.first_name} ${contact.last_name}`;
}

function AttributeFields({ definitions, values, onChange, showErrors }: { definitions: ProviderAttribute[]; values: Row; onChange: (next: Row) => void; showErrors: boolean }) {
  if (!definitions.length) return null;
  return <Tile className="form-section carbon-form-section"><h3>Registry information</h3><p>This extension needs a few additional details.</p><div className="carbon-form-grid">{definitions.map((definition) => {
    const options = (definition.options || []).map((option) => typeof option === "string" ? option : String(option.value || "")).filter(Boolean);
    const id = `registry-${definition.key.replace(/[^a-z0-9_-]/gi, "-")}`;
    const rawValue = values[definition.key];
    const missing = Boolean(definition.isRequired && (typeof rawValue === "boolean" ? !rawValue : !String(rawValue || "").trim()));
    const label = definition.description || definition.key;
    if (options.length) return <Select id={id} key={definition.key} labelText={label} value={String(rawValue || "")} required={definition.isRequired} invalid={showErrors && missing} invalidText="Select an option." onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })}><SelectItem value="" text="Select an option" />{options.map((option) => <SelectItem key={option} value={option} text={option} />)}</Select>;
    if (definition.type === "Checkbox" || definition.type === "CheckboxWithContract") return <Checkbox id={id} key={definition.key} labelText={label} checked={Boolean(rawValue)} invalid={showErrors && missing} invalidText="This field is required." onChange={(event) => onChange({ ...values, [definition.key]: event.target.checked })} />;
    return <TextInput id={id} key={definition.key} labelText={label} value={String(rawValue || "")} required={definition.isRequired} invalid={showErrors && missing} invalidText="Enter a value." onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })} />;
  })}</div></Tile>;
}

function PurchasePage({ type }: { type: "registration" | "transfer" }) {
  const session = useSession();
  const initialDomain = new URLSearchParams(window.location.search).get("domain") || "";
  const [domainName, setDomainName] = useState(initialDomain);
  const [years, setYears] = useState(1);
  const [contactId, setContactId] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [customNameservers, setCustomNameservers] = useState(false);
  const [nameservers, setNameservers] = useState<string[]>(["", ""]);
  const [attributes, setAttributes] = useState<Row>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [orderKey, setOrderKey] = useState(() => newIdempotencyKey(type));
  const [checkAttempted, setCheckAttempted] = useState(false);
  const [orderAttempted, setOrderAttempted] = useState(false);
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Contact[] }>("/contacts"), enabled: Boolean(session) });
  const availability = useMutation({
    mutationFn: (name: string) => domainSearchApi<{ results: SearchResult[] }>("", { method: "POST", body: { domains: [name] } }),
    onSuccess: () => setOrderKey(newIdempotencyKey(type)),
  });
  const createOrder = useMutation({
    mutationFn: (body: Row) => orderGuardApi<{ order: Order; quote: Row; billing?: Row }>(type === "registration" ? "/registration" : "/transfer", { method: "POST", body, idempotencyKey: orderKey }),
    onSuccess: () => { window.location.href = "/dashboard/orders"; },
    onError: () => setConfirmOpen(false),
  });

  useEffect(() => {
    if (contacts.data?.contacts.length && !contactId) setContactId((contacts.data.contacts.find((item) => item.is_default) || contacts.data.contacts[0]).id);
  }, [contacts.data, contactId]);

  const result = availability.data?.results?.[0];
  const selectedPrice = result?.price;
  // The public catalog exposes the exact displayed price for its default
  // period. Other periods stay unavailable until they can be quoted before a
  // charge rather than guessed client-side.
  const periods = type === "registration"
    ? [selectedPrice?.min_years || selectedPrice?.registration_periods?.[0] || 1]
    : [selectedPrice?.transfer_periods?.[0] || 1];

  useEffect(() => {
    if (!periods.includes(years)) setYears(periods[0] || 1);
  }, [selectedPrice?.tld]);

  const attributeDefinitions = type === "registration" ? selectedPrice?.provider_attributes || [] : [];
  const nameserversValid = !customNameservers || (
    nameservers.length >= 2 &&
    nameservers.length <= 13 &&
    nameservers.every(validNameserver)
  );
  const requiredAttributesMissing = attributeDefinitions.some((definition) => {
    const rawValue = attributes[definition.key];
    return Boolean(definition.isRequired && (typeof rawValue === "boolean" ? !rawValue : !String(rawValue || "").trim()));
  });

  const check = (event: FormEvent) => {
    event.preventDefault();
    setCheckAttempted(true);
    const normalized = domainName.trim().toLowerCase();
    if (!validDomainInput(normalized)) {
      availability.reset();
      return;
    }
    availability.mutate(normalized);
  };
  const reviewOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOrderAttempted(true);
    if (!contactId || !nameserversValid || requiredAttributesMissing || (type === "transfer" && (authCode.length < 4 || authCode.length > 35))) return;
    setConfirmOpen(true);
  };
  const order = () => {
    const body: Row = { domainName: domainName.trim().toLowerCase(), years, contactId, expectedPriceUsd: dueNow };
    if (type === "transfer") body.authCode = authCode;
    if (customNameservers) body.nameServers = nameservers.filter(Boolean);
    if (type === "registration") body.tldAttributes = attributes;
    createOrder.mutate(body);
  };

  const transferSupported = type === "transfer" && Boolean(selectedPrice && supportedPrice(selectedPrice.transfer_price_usd));
  const orderOptionsVisible = Boolean(result && selectedPrice && (type === "registration" ? isAvailable(result.registrar) : transferSupported));
  const dueNow = result && selectedPrice
    ? type === "registration"
      ? Number(premiumDisplayPrice(result) || 0)
      : Number(selectedPrice.transfer_price_usd || 0)
    : 0;

  if (!session) return <main className="section"><div className="container narrow"><EmptyState title="Sign in required" text="Sign in before creating a domain order." action={<Button href="/auth">Sign in</Button>} /></div></main>;

  return <main className="section"><div className="container"><PageHeading eyebrow={type === "registration" ? "Register domain" : "Transfer domain"} title={type === "registration" ? "Register your domain" : "Transfer your domain"} description="Review the current price before you place the order. Your account is charged only after confirmation." />
    <Grid fullWidth className="carbon-purchase-grid"><Column sm={4} md={8} lg={16}><Tile className="carbon-order-form">
      <form className="carbon-form-stack" onSubmit={check} noValidate>
        <TextInput id="order-domain" labelText="Domain name" value={domainName} onChange={(event) => { setDomainName(event.target.value); availability.reset(); setCheckAttempted(false); }} placeholder="example.com" required invalid={checkAttempted && !validDomainInput(domainName)} invalidText="Enter a valid domain, for example example.com." />
        <Button type="submit" kind="secondary" disabled={availability.isPending}>{availability.isPending ? "Checking…" : type === "registration" ? "Check availability and pricing" : "Load transfer pricing"}</Button>
      </form>
      {availability.isError ? <ErrorNotice error={availability.error} title="Unable to quote domain" /> : null}
      {result ? <><InfoNotice kind={type === "registration" ? isAvailable(result.registrar) ? "success" : "warning" : transferSupported ? "success" : "warning"} title={type === "registration" ? isAvailable(result.registrar) ? `${result.domainName} is available` : `${result.domainName} is not available` : transferSupported ? `Transfer pricing loaded for ${result.domainName}` : `Transfer is not supported for ${result.domainName}`} subtitle="Review purchase, transfer and renewal pricing before continuing." /><DomainPriceBreakdown result={result} dueToday={type === "registration" && !isAvailable(result.registrar) ? null : transferSupported || type === "registration" ? type : null} /></> : null}

      {orderOptionsVisible ? <form className="carbon-form-stack carbon-order-options" onSubmit={reviewOrder} noValidate>
        <Select id="order-contact" labelText="WHOIS contact" value={contactId} required invalid={orderAttempted && !contactId} invalidText="Select a WHOIS contact before continuing." onChange={(event) => setContactId(event.target.value)}><SelectItem value="" text="Select a contact" />{(contacts.data?.contacts || []).map((contact) => <SelectItem key={contact.id} value={contact.id} text={`${contactName(contact)} · ${contact.email}`} />)}</Select>
        {!contacts.data?.contacts.length ? <InlineNotification kind="warning" lowContrast hideCloseButton title="WHOIS contact required" subtitle="Create a complete contact before placing the order." actions={<Button kind="ghost" size="sm" href="/dashboard/contacts">Open contacts</Button>} /> : null}
        <Select id="order-period" labelText="Period" value={String(years)} onChange={(event) => setYears(Number(event.target.value))}>{periods.map((period) => <SelectItem key={period} value={String(period)} text={`${period} year${period === 1 ? "" : "s"}`} />)}</Select>
        {type === "transfer" ? <PasswordInput id="order-auth-code" labelText="Transfer authorization code" hidePasswordLabel="Hide code" showPasswordLabel="Show code" value={authCode} onChange={(event) => setAuthCode(event.target.value)} minLength={4} maxLength={35} required invalid={orderAttempted && (authCode.length < 4 || authCode.length > 35)} invalidText="Enter the authorization code supplied by your current registrar." /> : null}
        <RadioButtonGroup legendText="Nameservers" name="nameserver-mode" valueSelected={customNameservers ? "custom" : "default"} onChange={(value) => setCustomNameservers(value === "custom")}>
          <RadioButton id="nameservers-default" labelText="Use KmerHosting nameservers" value="default" />
          <RadioButton id="nameservers-custom" labelText="Use custom nameservers" value="custom" />
        </RadioButtonGroup>
        {customNameservers ? <div className="carbon-form-stack">{nameservers.map((value, index) => <div className="carbon-inline-field" key={index}><TextInput id={`nameserver-${index}`} labelText={`Nameserver ${index + 1}`} value={value} onChange={(event) => setNameservers(nameservers.map((item, position) => position === index ? event.target.value : item))} placeholder={`ns${index + 1}.example.com`} required invalid={orderAttempted && (!validNameserver(value) || nameservers.length < 2)} invalidText="Enter a valid nameserver, for example ns1.example.com." /><Button type="button" kind="danger--ghost" size="sm" disabled={nameservers.length <= 2} onClick={() => setNameservers(nameservers.filter((_, position) => position !== index))}>Remove</Button></div>)}<Button type="button" kind="tertiary" size="sm" disabled={nameservers.length >= 13} onClick={() => setNameservers([...nameservers, ""])}>Add nameserver</Button></div> : null}
        <AttributeFields definitions={attributeDefinitions} values={attributes} onChange={setAttributes} showErrors={orderAttempted} />
        <Button type="submit" disabled={createOrder.isPending}>{type === "registration" ? "Review registration" : "Review transfer"}</Button>
        {createOrder.isError ? <ErrorNotice error={createOrder.error} title="Order creation failed" /> : null}
      </form> : null}
    </Tile></Column></Grid>
    <Modal
      open={confirmOpen}
      modalHeading={type === "registration" ? "Confirm domain registration" : "Confirm domain transfer"}
      primaryButtonText={createOrder.isPending ? "Submitting to provider…" : `${type === "registration" ? "Register" : "Start transfer"} · ${formatMoney(dueNow)}`}
      secondaryButtonText="Go back"
      primaryButtonDisabled={createOrder.isPending}
      onRequestClose={() => { if (!createOrder.isPending) setConfirmOpen(false); }}
      onRequestSubmit={order}
    >
      <p><strong>{domainName.trim().toLowerCase()}</strong> · {years} year{years === 1 ? "" : "s"}</p>
      <p>This submits a real domain operation. After confirmation, {formatMoney(dueNow)} is charged from your KmerHosting balance only after the price and available balance are checked.</p>
    </Modal>
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
  return <div className="dashboard-content"><PageHeading eyebrow="Account overview" title="Dashboard" description="Your domains and orders in one place." actions={<Button href="/register-domain">Register domain</Button>} />
    <MetricGrid metrics={[["Domains", data.domains.length], ["Open orders", data.orders.filter((item) => !["completed", "cancelled", "refunded"].includes(item.status)).length], [data.balanceSource, formatMoney(data.balanceUsd)], ["Unread notifications", data.notifications.filter((item) => !item.read_at).length]]} />
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Recent domains</h2></div><a href="/dashboard/domains">View all</a></div>{data.domains.length ? <div className="carbon-activity-list">{data.domains.slice(0, 5).map((domain) => <ClickableTile href={`/dashboard/domains/${domain.id}`} key={domain.id}><div className="carbon-activity-copy"><strong>{domain.domain_name}</strong><span>Expires {formatDate(domain.expires_at)}</span></div><StatusBadge value={domain.status} /></ClickableTile>)}</div> : <EmptyState title="No domains" text="Register or transfer your first domain." />}</Tile></Column>
    <Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Recent orders</h2></div><a href="/dashboard/orders">View all</a></div>{data.orders.length ? <div className="carbon-activity-list">{data.orders.slice(0, 5).map((order) => <Tile className="carbon-activity-row" key={order.id}><div className="carbon-activity-copy"><strong>{order.domain_name}</strong><span>{order.type} · {formatMoney(order.price_usd)}</span></div><StatusBadge value={order.status} /></Tile>)}</div> : <EmptyState title="No orders" text="Your domain orders will appear here." />}</Tile></Column></Grid>
  </div>;
}

function DomainsPage() {
  const query = useQuery({ queryKey: ["domains"], queryFn: () => api<{ domains: Domain[] }>("/domains") });
  return <div className="dashboard-content"><PageHeading eyebrow="Portfolio" title="Domains" description="Live and test-environment domains are clearly separated." actions={<><Button kind="secondary" href="/transfer-domain">Transfer domain</Button><Button href="/register-domain">Register domain</Button></>} />
    {query.isPending ? <LoadingBlock /> : query.isError ? <ErrorNotice error={query.error} /> : query.data?.domains.length ? <div className="carbon-domain-list">{query.data.domains.map((domain) => <Tile className="carbon-domain-row" key={domain.id}><div><strong>{domain.domain_name}</strong><span>Expires {formatDate(domain.expires_at)}</span></div><div className="heading-actions">{domain.registrar_environment === "ote" ? <StatusBadge value="test_ote" /> : null}<StatusBadge value={domain.status} /><Button kind="ghost" href={`/dashboard/domains/${domain.id}`}>Open</Button></div></Tile>)}</div> : <EmptyState title="No domains" text="Register or transfer a domain to begin." />}
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
  return <div className="dashboard-content"><PageHeading eyebrow="Domain" title={domain.domain_name} description={`Last synchronized ${formatDate(domain.last_synced_at)}.`} actions={<><Button href={`/dashboard/domains/${domain.id}/manage`}>Manage domain</Button><Button kind="secondary" href={`/dashboard/domains/${domain.id}/dns`}>DNS settings</Button></>} />
    <div className="heading-actions carbon-heading-tags">{domain.registrar_environment === "ote" ? <StatusBadge value="test_ote" /> : null}<StatusBadge value={domain.status} /></div>
    {domain.registrar_environment === "ote" ? <InfoNotice kind="warning" title="Test domain" subtitle="Changes in this test environment never debit your KmerHosting balance." /> : null}
    <MetricGrid metrics={[["Registered", formatDate(domain.registered_at)], ["Expires", formatDate(domain.expires_at)], ["Lock", domain.locked ? "Enabled" : "Disabled"], ["Privacy", domain.privacy_enabled ? "Enabled" : "Disabled"]]} />
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><h2>Automatic renewal</h2><p>Uses your USD balance after the renewal price and available balance are checked.</p><Toggle id="domain-auto-renew" labelText="Automatic renewal" labelA="Disabled" labelB="Enabled" toggled={domain.auto_renew} disabled={autoRenew.isPending} onToggle={(enabled) => autoRenew.mutate(enabled)} />{autoRenew.isError ? <ErrorNotice error={autoRenew.error} /> : null}</Tile></Column>
    <Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Nameservers</h2></div><a href={`/dashboard/domains/${domain.id}/dns`}>Edit</a></div><div className="carbon-activity-list">{(domain.nameservers || []).map((nameserver) => <Tile className="carbon-activity-row" key={nameserver}><strong>{nameserver}</strong></Tile>)}</div></Tile></Column></Grid>
    {domain.epp_statuses?.length ? <Tile className="carbon-dashboard-panel"><h2>EPP statuses</h2><div className="heading-actions">{domain.epp_statuses.map((status) => <StatusBadge key={status} value={status} />)}</div></Tile> : null}
  </div>;
}

function OrdersPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["orders"], queryFn: () => api<{ orders: Order[] }>("/orders"), refetchInterval: 20000 });
  const retry = useMutation({
    mutationFn: (orderId: string) => api(`/orders/${orderId}/retry`, { method: "POST" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["orders"] });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  return <div className="dashboard-content"><PageHeading eyebrow="Orders" title="Domain orders" description="Track each order by its real lifecycle status. Only completed registrations create an active domain." />
    {query.isError || retry.isError ? <ErrorNotice error={query.error || retry.error} /> : null}
    {retry.isSuccess ? <InfoNotice kind="success" title="Retry queued" subtitle="The order was re-queued after the registrar confirmed that the domain is not registered." /> : null}
    {query.isPending ? <LoadingBlock /> : query.data?.orders.length ? <div className="carbon-order-list">{query.data.orders.map((order) => {
      const canRetry = order.registrar_environment === "ote" && ["processing", "failed"].includes(order.status);
      return <Tile className="carbon-order-row" key={order.id}><div><strong>{order.domain_name}</strong><span>{order.order_number} · {order.type} · {formatDate(order.created_at)}</span><small>{order.registrar_environment === "ote" ? "Test order · no account charge" : "Charged to the central KmerHosting balance"}</small>{order.failure_message ? <small>{order.failure_message}</small> : null}</div><div className="heading-actions"><strong>{formatMoney(order.price_usd)}</strong>{order.registrar_environment === "ote" ? <StatusBadge value="test_ote" /> : null}<StatusBadge value={order.status} />{canRetry ? <Button kind="ghost" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(order.id)}>{retry.isPending ? "Retrying…" : "Retry operation"}</Button> : null}</div></Tile>;
    })}</div> : <EmptyState title="No orders" text="Registration, transfer, renewal and restore orders appear here." />}
  </div>;
}

function ContactsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Contact[] }>("/contacts") });
  const [editing, setEditing] = useState<Contact | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Contact | null>(null);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const invalid = (name: string) => invalidFields.includes(name);
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Row }) => api(id ? `/contacts/${id}` : "/contacts", { method: id ? "PUT" : "POST", body }),
    onSuccess: () => {
      setInvalidFields([]);
      void client.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/contacts/${id}`, { method: "DELETE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["contacts"] }) });
  const verify = useMutation({ mutationFn: (id: string) => customerToolsApi<{ readyForRegistration: boolean; message: string }>(`/contacts/${id}/verification`, { method: "POST" }) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const required = ["label", "firstName", "lastName", "email", "phoneCountryCode", "phone", "address", "city", "state", "postalCode", "country"];
    const errors = required.filter((key) => !String(body[key] || "").trim());
    if (body.email && !validContactEmail(String(body.email))) errors.push("email");
    if (body.phoneCountryCode && !/^\d{1,3}$/.test(String(body.phoneCountryCode))) errors.push("phoneCountryCode");
    if (body.country && !/^[A-Za-z]{2}$/.test(String(body.country))) errors.push("country");
    const uniqueErrors = [...new Set(errors)];
    setInvalidFields(uniqueErrors);
    if (uniqueErrors.length) return;
    save.mutate({ id: editing?.id, body: { ...body, isDefault: body.isDefault === "on" } });
    if (!editing) event.currentTarget.reset();
  };

  return <div className="dashboard-content"><PageHeading eyebrow="WHOIS contacts" title="Contacts" description="Complete contact data is required for registration and transfer." />
    {query.isError || save.isError || remove.isError || verify.isError ? <ErrorNotice error={query.error || save.error || remove.error || verify.error} /> : null}
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={8} lg={7}><Tile className="carbon-contact-form"><h2>{editing ? "Edit contact" : "Create contact"}</h2><p>Use the registrant's real contact details. Required fields are checked before you continue.</p><form className="carbon-form-stack" onSubmit={submit} noValidate key={editing?.id || "new"}>
      <TextInput id="contact-label" name="label" labelText="Label" helperText="A name you will recognize in your account." autoComplete="off" defaultValue={editing?.label || "Default"} invalid={invalid("label")} invalidText="Enter a label." required />
      <div className="carbon-form-grid carbon-form-grid--two">
        <TextInput id="contact-first-name" name="firstName" labelText="First name" autoComplete="given-name" defaultValue={editing?.first_name || ""} invalid={invalid("firstName")} invalidText="Enter a first name." required />
        <TextInput id="contact-last-name" name="lastName" labelText="Last name" autoComplete="family-name" defaultValue={editing?.last_name || ""} invalid={invalid("lastName")} invalidText="Enter a last name." required />
      </div>
      <TextInput id="contact-company" name="companyName" labelText="Company" autoComplete="organization" defaultValue={editing?.company_name || ""} />
      <TextInput id="contact-email" name="email" type="email" labelText="Email" autoComplete="email" defaultValue={editing?.email || ""} invalid={invalid("email")} invalidText="Enter a valid email address." required />
      <div className="carbon-form-grid carbon-form-grid--two">
        <TextInput id="contact-dial-code" name="phoneCountryCode" labelText="Country calling code" helperText="Digits only, without the + sign." inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} autoComplete="tel-country-code" placeholder="237" defaultValue={editing?.phone_country_code || "237"} invalid={invalid("phoneCountryCode")} invalidText="Enter one to three digits." required />
        <TextInput id="contact-phone" name="phone" type="tel" labelText="Phone number" helperText="Local number only." autoComplete="tel" placeholder="670000000" defaultValue={editing?.phone || ""} invalid={invalid("phone")} invalidText="Enter a phone number." required />
      </div>
      <TextInput id="contact-address" name="address" labelText="Address" autoComplete="street-address" defaultValue={editing?.address || ""} invalid={invalid("address")} invalidText="Enter an address." required />
      <div className="carbon-form-grid carbon-form-grid--two">
        <TextInput id="contact-city" name="city" labelText="City" autoComplete="address-level2" defaultValue={editing?.city || ""} invalid={invalid("city")} invalidText="Enter a city." required />
        <TextInput id="contact-state" name="state" labelText="State or region" autoComplete="address-level1" defaultValue={editing?.state || ""} invalid={invalid("state")} invalidText="Enter a state or region." required />
      </div>
      <div className="carbon-form-grid carbon-form-grid--two">
        <TextInput id="contact-postal" name="postalCode" labelText="Postal code" autoComplete="postal-code" defaultValue={editing?.postal_code || ""} invalid={invalid("postalCode")} invalidText="Enter a postal code." required />
        <Select id="contact-country" name="country" labelText="Country" helperText="Select the registrant's two-letter country code." defaultValue={String(editing?.country || "CM").toUpperCase()} invalid={invalid("country")} invalidText="Select a two-letter country code." required>
          <SelectItem value="" text="Select a country" />
          {COUNTRY_CODES.map((code) => <SelectItem key={code} value={code} text={code} />)}
        </Select>
      </div>
      <Checkbox id="contact-default" name="isDefault" labelText="Use as the default contact" defaultChecked={editing?.is_default ?? true} />
      <div className="heading-actions"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save contact" : "Create contact"}</Button>{editing ? <Button type="button" kind="secondary" onClick={() => { setEditing(null); setInvalidFields([]); }}>Cancel</Button> : null}</div>
    </form></Tile></Column>
    <Column sm={4} md={8} lg={9}><Tile className="carbon-dashboard-panel"><h2>Saved contacts</h2>{verify.isSuccess ? <InfoNotice kind="success" title="Contact is complete" subtitle={verify.data.message} /> : null}{query.isPending ? <LoadingBlock /> : query.data?.contacts.length ? <div className="carbon-activity-list">{query.data.contacts.map((contact) => <Tile className="carbon-contact-row" key={contact.id}><div><strong>{contactName(contact)}</strong><span>{contact.email} · {contact.country}</span><small>{contact.registrar_verified ? "Ready to use" : "This contact will be checked when you place an order"}</small></div><div className="heading-actions">{!contact.registrar_verified ? <Button kind="tertiary" size="sm" disabled={verify.isPending} onClick={() => verify.mutate(contact.id)}>Check readiness</Button> : null}<Button kind="ghost" size="sm" onClick={() => { setEditing(contact); setInvalidFields([]); }}>Edit</Button><Button kind="danger--ghost" size="sm" onClick={() => setRemoveTarget(contact)}>Delete</Button></div></Tile>)}</div> : <EmptyState title="No contacts" text="Create a WHOIS contact before ordering a domain." />}</Tile></Column></Grid>
    <Modal
      open={Boolean(removeTarget)}
      danger
      modalHeading="Delete contact"
      primaryButtonText={remove.isPending ? "Deleting…" : "Delete"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={remove.isPending}
      onRequestClose={() => setRemoveTarget(null)}
      onRequestSubmit={() => {
        if (!removeTarget) return;
        remove.mutate(removeTarget.id, { onSettled: () => setRemoveTarget(null) });
      }}
    >
      <p>This contact will be removed from your saved contacts. Only unused contacts can be deleted.</p>
    </Modal>
  </div>;
}

function InvoicesPage() {
  const query = useQuery({ queryKey: ["invoices"], queryFn: () => api<{ invoices: Row[] }>("/invoices") });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  return <div className="dashboard-content"><PageHeading eyebrow="Documents" title="Invoices" description="Invoices for orders charged to your KmerHosting balance." />
    {downloadError ? <InlineNotification kind="error" lowContrast hideCloseButton title="Download failed" subtitle={downloadError} /> : null}
    {query.isPending ? <LoadingBlock /> : query.isError ? <ErrorNotice error={query.error} /> : query.data?.invoices.length ? <Tile className="carbon-table-section"><Table size="lg"><TableHead><TableRow><TableHeader>Invoice</TableHeader><TableHeader>Domain</TableHeader><TableHeader>Type</TableHeader><TableHeader>Date</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Status</TableHeader><TableHeader>Document</TableHeader></TableRow></TableHead><TableBody>{query.data.invoices.map((invoice) => <TableRow key={invoice.id}><TableCell>{invoice.invoice_number}</TableCell><TableCell>{invoice.domain_orders?.domain_name || "—"}</TableCell><TableCell>{invoice.domain_orders?.type || "—"}</TableCell><TableCell>{formatDate(invoice.issued_at)}</TableCell><TableCell>{formatMoney(invoice.amount_usd)}</TableCell><TableCell><StatusBadge value={invoice.status} /></TableCell><TableCell><Button kind="ghost" size="sm" onClick={() => { setDownloadError(null); void downloadDomainDocument(`/invoices/${invoice.id}`, `${invoice.invoice_number}.pdf`).catch((error) => setDownloadError(errorText(error))); }}>Download PDF</Button></TableCell></TableRow>)}</TableBody></Table></Tile> : <EmptyState title="No invoices" text="Invoices appear after an order is charged to your KmerHosting balance." />}
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
const tldCatalogRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tlds", component: TldCatalogPage });
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
const contactsRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/contacts", component: ContactsPage });
const invoicesRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/invoices", component: InvoicesPage });
const profileRoute = createRoute({ getParentRoute: () => dashboardRoute, path: "/profile", component: ProfilePage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  tldCatalogRoute,
  authRoute,
  registerRoute,
  transferRoute,
  returnRoute,
  dashboardRoute.addChildren([dashboardIndexRoute, domainsRoute, domainDetailRoute, ordersRoute, contactsRoute, invoicesRoute, profileRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
