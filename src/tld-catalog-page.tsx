import { Button, Column, Grid, InlineLoading, InlineNotification, Pagination, Search, Tag, Tile } from "@carbon/react";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { domainSearchApi, formatMoney } from "./api";
import { isFeaturedTld, supportedTlds, type CatalogTld } from "./tld-catalog";

type TldCatalogResponse = {
  prices: CatalogTld[];
  registrarEnvironment?: "ote" | "production";
  generatedAt?: string;
};

const DEFAULT_PAGE_SIZE = 24;
const PAGE_SIZES = [12, 24, 48];

function tldSearchValue(price: CatalogTld) {
  return price.tld.slice(1).toLowerCase();
}

function TldCard({ price }: { price: CatalogTld }) {
  return <Tile className="carbon-tld-catalog__card">
    <div className="carbon-tld-catalog__card-heading">
      <h2>{price.tld}</h2>
      <div className="carbon-tld-catalog__tags">
        {isFeaturedTld(price.tld) ? <Tag type="blue">Popular</Tag> : null}
        {price.is_promo ? <Tag type="green">Promo</Tag> : null}
      </div>
    </div>
    <div className="carbon-tld-catalog__price">
      <span>Registration</span>
      <strong>{formatMoney(price.registration_price_usd)}</strong>
      <small>for one year</small>
    </div>
    <dl className="carbon-tld-catalog__details">
      <div><dt>Renewal</dt><dd>{formatMoney(price.renewal_price_usd)}</dd></div>
      <div><dt>Transfer</dt><dd>{price.transfer_price_usd > 0 ? formatMoney(price.transfer_price_usd) : "Not available"}</dd></div>
      <div><dt>Privacy</dt><dd>{price.supports_privacy === false ? "Not available" : "Available"}</dd></div>
    </dl>
    <Button kind="secondary" href={`/register-domain?domain=${encodeURIComponent(`yourbrand${price.tld}`)}`}>Search {price.tld}</Button>
  </Tile>;
}

export function TldCatalogPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const query = useQuery({
    queryKey: ["supported-tlds"],
    queryFn: () => domainSearchApi<TldCatalogResponse>("/prices"),
  });
  const catalog = useMemo(() => supportedTlds(query.data?.prices || []), [query.data?.prices]);
  const filtered = useMemo(() => {
    if (!deferredSearch) return catalog;
    return catalog.filter((price) => tldSearchValue(price).includes(deferredSearch));
  }, [catalog, deferredSearch]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  useEffect(() => setPage(1), [deferredSearch, pageSize]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return <main className="carbon-tld-catalog-page">
    <section className="carbon-tld-catalog-page__hero">
      <Grid fullWidth>
        <Column sm={4} md={8} lg={12}>
          <h1>Domain extensions</h1>
          <p>Browse the domain extensions currently available through KmerHosting. Prices and availability are updated regularly.</p>
        </Column>
      </Grid>
    </section>

    <section className="carbon-tld-catalog-page__content" aria-labelledby="supported-tlds-heading">
      <Grid fullWidth>
        <Column sm={4} md={8} lg={16}>
          <div className="carbon-tld-catalog__toolbar">
            <div>
              <h2 id="supported-tlds-heading">Find a domain extension</h2>
              <p>{query.isSuccess ? `${catalog.length} extensions available` : "Loading available extensions…"}</p>
            </div>
            <Search id="supported-tld-search" labelText="Search extensions" placeholder="Search .com, .shop, .dev" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </Column>
      </Grid>

      {query.isPending ? <div className="carbon-tld-catalog__status"><InlineLoading description="Loading supported extensions…" /></div> : null}
      {query.isError ? <InlineNotification kind="error" lowContrast hideCloseButton title="Extensions unavailable" subtitle="We couldn't load the extension list. Try again shortly." /> : null}
      {query.isSuccess && filtered.length === 0 ? <InlineNotification kind="info" lowContrast hideCloseButton title="No extension found" subtitle="Try another extension name, such as com, store or dev." /> : null}
      {query.isSuccess && visible.length > 0 ? <>
        <Grid fullWidth className="carbon-tld-catalog__grid">
          {visible.map((price) => <Column sm={4} md={4} lg={4} key={price.tld}><TldCard price={price} /></Column>)}
        </Grid>
        <Pagination
          className="carbon-tld-catalog__pagination"
          backwardText="Previous page"
          forwardText="Next page"
          itemsPerPageText="Extensions per page"
          itemRangeText={(min, max, total) => `${min}–${max} of ${total} supported extensions`}
          page={page}
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          totalItems={filtered.length}
          onChange={({ page: nextPage, pageSize: nextPageSize }) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }}
        />
      </> : null}
    </section>
  </main>;
}
