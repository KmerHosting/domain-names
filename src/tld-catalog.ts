export type CatalogTld = {
  tld: string;
  popular?: boolean;
  is_promo?: boolean;
  provider_available?: boolean;
  registration_price_usd: number;
  renewal_price_usd: number;
  transfer_price_usd: number;
  restore_price_usd?: number | null;
  supports_privacy?: boolean;
};

// Editorial ordering for public discovery. The provider catalogue remains the
// source of truth: an extension is shown only when it is returned by /prices.
export const FEATURED_TLD_ORDER = [
  ".com", ".net", ".org", ".co", ".io", ".ai", ".app", ".dev", ".xyz", ".online",
] as const;

const featuredTldSet = new Set<string>(FEATURED_TLD_ORDER);

export function supportedTlds(prices: CatalogTld[]): CatalogTld[] {
  return [...prices]
    .filter((price) => /^\.[a-z0-9-]{2,63}$/i.test(price.tld) && price.provider_available !== false)
    .sort((left, right) => left.tld.localeCompare(right.tld));
}

export function featuredTlds(prices: CatalogTld[]): CatalogTld[] {
  const supported = new Map(supportedTlds(prices).map((price) => [price.tld, price]));
  return FEATURED_TLD_ORDER.flatMap((tld) => {
    const price = supported.get(tld);
    return price ? [price] : [];
  });
}

export function isFeaturedTld(tld: string): boolean {
  return featuredTldSet.has(tld);
}
