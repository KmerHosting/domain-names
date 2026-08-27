import {
  Button,
  Column,
  ContentSwitcher,
  Grid,
  InlineLoading,
  InlineNotification,
  Switch,
  Tag,
  Tile,
} from "@carbon/react";
import { useEffect, useMemo, useState } from "react";

type HostingPlan = {
  code: string;
  panel: "cpanel" | "directadmin";
  name: string;
  description?: string;
  monthly_price_micros: number;
  storage_gb?: number;
  email_accounts?: number;
  databases?: number;
  ftp_accounts?: number;
  features?: string[];
  available?: boolean;
  active?: boolean;
  published?: boolean;
};

type HostingCatalogResponse = { plans: HostingPlan[]; syncedAt: string };

const categories = [
  { id: "standard", label: "Standard", title: "Standard Hosting", description: "Balanced hosting for sites, email, databases and everyday applications." },
  { id: "php", label: "PHP", title: "PHP Hosting", description: "PHP-oriented plans with runtime tooling and database capacity." },
  { id: "wordpress", label: "WordPress", title: "WordPress Hosting", description: "WordPress-ready plans with security, backups and PHP tooling." },
  { id: "nodejs", label: "Node.js", title: "NodeJS Hosting", description: "cPanel hosting for Node.js applications with SSH and Git." },
  { id: "python", label: "Python", title: "Python Hosting", description: "cPanel hosting for Python applications with SSH and Git." },
  { id: "laravel", label: "Laravel", title: "Laravel Hosting", description: "Laravel-focused PHP plans with SSH, cron jobs and database tooling." },
] as const;

type CategoryId = typeof categories[number]["id"];

function categoryForPlan(plan: HostingPlan): CategoryId {
  const code = String(plan.code || "").toLowerCase();
  if (code.startsWith("nodejs-")) return "nodejs";
  if (code.startsWith("python-")) return "python";
  if (code.startsWith("laravel-")) return "laravel";
  if (code.startsWith("wordpress-")) return "wordpress";
  if (code.startsWith("php-") || code.startsWith("cp-php-")) return "php";
  return "standard";
}

function planTier(plan: HostingPlan) {
  return ["starter", "growth", "pro", "business"].find((tier) => plan.code.toLowerCase().endsWith(`-${tier}`)) || "";
}

function price(plan: HostingPlan) {
  return `$${(Number(plan.monthly_price_micros || 0) / 1_000_000).toFixed(2)}`;
}

function panelLabel(panel: HostingPlan["panel"]) {
  return panel === "directadmin" ? "DirectAdmin" : "cPanel";
}

function catalogHref(plan: HostingPlan, category: CategoryId) {
  const params = new URLSearchParams({
    panel: plan.panel === "directadmin" ? "da" : "cpanel",
    category,
  });
  const tier = planTier(plan);
  if (tier) params.set("plan", tier);
  return `https://shared.kmerhosting.com/?${params.toString()}`;
}

function previewFeatures(plan: HostingPlan) {
  const included = [
    plan.storage_gb ? `${plan.storage_gb} GB NVMe SSD` : "",
    plan.email_accounts !== undefined ? `${plan.email_accounts} email accounts` : "",
    plan.databases !== undefined ? `${plan.databases} MySQL databases` : "",
    ...(plan.features || []),
  ].filter(Boolean);
  return Array.from(new Set(included)).slice(0, 7);
}

function HostingPlanCard({ plan, category }: { plan: HostingPlan; category: CategoryId }) {
  const features = previewFeatures(plan);
  const unavailable = plan.available === false || plan.active === false;
  const availabilityLabel = plan.available === false ? "Out of stock" : plan.active === false ? "Not active" : "Available";
  const href = catalogHref(plan, category);

  return <Tile className="carbon-hosting-plan-card">
    <div className="carbon-hosting-plan-card__top">
      <div className="carbon-hosting-plan-card__tags">
        <Tag type={plan.panel === "directadmin" ? "cyan" : "purple"}>{panelLabel(plan.panel)}</Tag>
        {planTier(plan) === "pro" ? <Tag type="blue">Most popular</Tag> : null}
        <Tag type={unavailable ? "red" : "green"}>{availabilityLabel}</Tag>
      </div>
      <h3>{plan.name}</h3>
      <p>{plan.description || "Shared hosting plan with published limits and platform features."}</p>
      <div className="carbon-hosting-plan-card__price"><strong>{price(plan)}</strong><span>/month</span></div>
    </div>
    <dl className="carbon-hosting-plan-card__limits">
      <div><dt>Storage</dt><dd>{plan.storage_gb ?? "—"} GB</dd></div>
      <div><dt>Email</dt><dd>{plan.email_accounts ?? "—"}</dd></div>
      <div><dt>Databases</dt><dd>{plan.databases ?? "—"}</dd></div>
    </dl>
    <ul className="carbon-hosting-plan-card__features" aria-label={`${plan.name} included features`}>
      {features.map((feature) => <li key={feature}>{feature}</li>)}
    </ul>
    <Button kind={unavailable ? "secondary" : "primary"} href={href} target="_blank" rel="noreferrer">
      {unavailable ? "Check availability" : "Choose this plan"}
    </Button>
  </Tile>;
}

export function SharedHostingCatalog() {
  const [category, setCategory] = useState<CategoryId>("standard");
  const [catalog, setCatalog] = useState<HostingCatalogResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/hosting-catalog", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as HostingCatalogResponse & { message?: string };
        if (!response.ok) throw new Error(payload.message || "Shared Hosting catalog is unavailable.");
        setCatalog(payload);
      })
      .catch((failure: unknown) => {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setError(failure instanceof Error ? failure.message : "Shared Hosting catalog is unavailable.");
      });
    return () => controller.abort();
  }, []);

  const activeCategory = categories.find((item) => item.id === category) || categories[0];
  const plans = useMemo(() => (catalog?.plans || [])
    .filter((plan) => plan.published !== false && categoryForPlan(plan) === category)
    .sort((a, b) => Number(a.monthly_price_micros) - Number(b.monthly_price_micros)), [catalog, category]);

  const categoryHref = `https://shared.kmerhosting.com/?${new URLSearchParams({ category }).toString()}`;

  return <section className="section section-soft carbon-hosting-catalog" id="hosting">
    <div className="container">
      <div className="section-heading carbon-hosting-catalog__heading">
        <div><span className="kicker">Shared Hosting</span><h2>Put your domain on the right hosting stack.</h2></div>
        <div><p>Live plans, prices and included features from KmerHosting Shared Hosting. Domain registration is separate from hosting.</p><Button kind="tertiary" href="https://shared.kmerhosting.com" target="_blank" rel="noreferrer">Open Shared Hosting</Button></div>
      </div>

      <div className="carbon-hosting-catalog__switcher" aria-label="Shared Hosting categories">
        <ContentSwitcher selectedIndex={categories.findIndex((item) => item.id === category)} onChange={({ name }) => setCategory(name as CategoryId)}>
          {categories.map((item) => <Switch key={item.id} name={item.id} text={item.label} />)}
        </ContentSwitcher>
      </div>

      <div className="carbon-hosting-catalog__category-heading">
        <div><h3>{activeCategory.title}</h3><p>{activeCategory.description}</p></div>
        <Tag type="green">Live catalog</Tag>
      </div>

      {error ? <InlineNotification lowContrast hideCloseButton kind="warning" title="Hosting catalog unavailable" subtitle={error} actions={<Button kind="ghost" size="sm" href={categoryHref} target="_blank" rel="noreferrer">View on Shared Hosting</Button>} /> : null}
      {!catalog && !error ? <InlineLoading description="Loading live hosting plans…" /> : null}
      {catalog && !plans.length ? <InlineNotification lowContrast hideCloseButton kind="info" title="No published plans in this category" subtitle="Open Shared Hosting to see the latest availability." actions={<Button kind="ghost" size="sm" href={categoryHref} target="_blank" rel="noreferrer">Open Shared Hosting</Button>} /> : null}
      {plans.length ? <Grid fullWidth className="carbon-hosting-plan-grid">
        {plans.map((plan) => <Column sm={4} md={4} lg={4} key={plan.code}><HostingPlanCard plan={plan} category={category} /></Column>)}
      </Grid> : null}
    </div>
  </section>;
}
