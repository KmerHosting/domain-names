export type DnaJson = Record<string, any>;
export type DnaEnvironment = "ote" | "production";
export type DnaOperation = "registration" | "renewal" | "transfer" | "restore";

export type DnaCatalogPrice = {
  tld: string;
  popular: boolean;
  is_promo: boolean;
  provider_available: boolean;
  provider_product_name: string;
  provider_price_group: string;
  provider_attributes: DnaJson[];
  provider_lifecycle: DnaJson;
  registration_periods: number[];
  renewal_periods: number[];
  transfer_periods: number[];
  supports_privacy: boolean;
  registration_price_usd: number;
  renewal_price_usd: number;
  transfer_price_usd: number;
  restore_price_usd: number | null;
  operations: Record<DnaOperation, Array<{ period: number; providerCostUsd: number; customerPriceUsd: number }>>;
  registrar_environment: DnaEnvironment;
  source: "domainnameapi_live_catalog";
};

const clean = (value: unknown) => String(value ?? "").trim();
const list = (value: unknown): DnaJson[] => Array.isArray(value) ? value : [];
const money = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function tldName(value: unknown) {
  const name = clean(value).replace(/^\./, "").toLowerCase();
  return /^[a-z0-9-]{2,63}$/.test(name) ? `.${name}` : "";
}

function resellerGroup(item: DnaJson) {
  return list(item.prices).find((group) => clean(group.priceGroup).toLowerCase() === "reseller") || list(item.prices)[0] || {};
}

function operationRows(group: DnaJson, operation: string) {
  const source = group[operation];
  const rows = Array.isArray(source) ? source : source && typeof source === "object" ? [source] : [];
  const byPeriod = new Map<number, { period: number; providerCostUsd: number; customerPriceUsd: number }>();
  for (const row of rows) {
    const period = Math.round(Number(row.period || 1));
    const providerCostUsd = money(Number(row.price || 0));
    if (period < 1 || period > 10 || clean(row.currency || "USD").toUpperCase() !== "USD" || !(providerCostUsd > 0)) continue;
    byPeriod.set(period, { period, providerCostUsd, customerPriceUsd: money(providerCostUsd * 1.30) });
  }
  return [...byPeriod.values()].sort((a, b) => a.period - b.period);
}

function firstPrice(rows: Array<{ period: number; customerPriceUsd: number }>) {
  return (rows.find((row) => row.period === 1) || rows[0])?.customerPriceUsd || 0;
}

export function normalizeDnaCatalog(payload: DnaJson, environment: DnaEnvironment): DnaCatalogPrice[] {
  const items = list(payload.items || payload.data?.items || payload.results || payload.data?.results);
  const prices: DnaCatalogPrice[] = [];
  for (const item of items) {
    const tld = tldName(item.name || item.tld || item.productName);
    if (!tld) continue;
    const group = resellerGroup(item);
    const operations = {
      registration: operationRows(group, "register"),
      renewal: operationRows(group, "renew"),
      transfer: operationRows(group, "transfer"),
      restore: operationRows(group, "restore"),
    };
    if (!operations.registration.length && !operations.transfer.length) continue;
    prices.push({
      tld,
      popular: [".com", ".net", ".org", ".co", ".io", ".cm"].includes(tld),
      is_promo: false,
      provider_available: true,
      provider_product_name: clean(item.name) || tld.slice(1),
      provider_price_group: clean(group.priceGroup) || "Reseller",
      provider_attributes: list(item.attributes),
      provider_lifecycle: {
        failurePeriod: item.failurePeriod,
        paymentPeriod: item.paymentPeriod,
        renewalPeriod: item.renewalPeriod,
        addGracePeriod: item.addGracePeriod,
        registerPeriod: item.registerPeriod,
        transferPeriod: item.transferPeriod,
        deletionHoldPeriod: item.deletionHoldPeriod,
        finalizationPeriod: item.finalizationPeriod,
        autoRenewGracePeriod: item.autoRenewGracePeriod,
        deletionRestorablePeriod: item.deletionRestorablePeriod,
      },
      registration_periods: operations.registration.map((row) => row.period),
      renewal_periods: operations.renewal.map((row) => row.period),
      transfer_periods: operations.transfer.map((row) => row.period),
      supports_privacy: item.supportsPrivacy !== false,
      registration_price_usd: firstPrice(operations.registration),
      renewal_price_usd: firstPrice(operations.renewal),
      transfer_price_usd: firstPrice(operations.transfer),
      restore_price_usd: firstPrice(operations.restore) || null,
      operations,
      registrar_environment: environment,
      source: "domainnameapi_live_catalog",
    });
  }
  return prices.sort((a, b) => Number(b.popular) - Number(a.popular) || a.tld.localeCompare(b.tld));
}

export function exactDnaPrice(tld: DnaCatalogPrice, operation: DnaOperation, period: number) {
  return tld.operations[operation].find((row) => row.period === period) || null;
}
