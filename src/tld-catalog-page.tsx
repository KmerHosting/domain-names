import { Button, Column, Grid, InlineLoading, InlineNotification, Pagination, Search, Tag, Tile } from "@carbon/react";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { domainSearchApi, formatMoney } from "./api";
import { isFeaturedTld, supportedTlds, type CatalogTld } from "./tld-catalog";
import { useDomainCopy } from "./domain-i18n";
import { useDomainWorkflowCopy } from "./domain-workflow-i18n";

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
  const copy = useDomainCopy();
  const workflow = useDomainWorkflowCopy();
  return <Tile className="carbon-tld-catalog__card">
    <div className="carbon-tld-catalog__card-heading">
      <h2>{price.tld}</h2>
      <div className="carbon-tld-catalog__tags">
        {isFeaturedTld(price.tld) ? <Tag type="blue">{copy.features}</Tag> : null}
        {price.is_promo ? <Tag type="green">{copy.pricing}</Tag> : null}
      </div>
    </div>
    <div className="carbon-tld-catalog__price">
      <span>{copy.domains}</span>
      <strong>{formatMoney(price.registration_price_usd)}</strong>
      <small>1 {workflow.years}</small>
    </div>
    <dl className="carbon-tld-catalog__details">
      <div><dt>{workflow.renewal}</dt><dd>{formatMoney(price.renewal_price_usd)}</dd></div>
      <div><dt>{copy.transfer}</dt><dd>{price.transfer_price_usd > 0 ? formatMoney(price.transfer_price_usd) : "—"}</dd></div>
      <div><dt>{copy.account}</dt><dd>{price.supports_privacy === false ? "—" : copy.open}</dd></div>
    </dl>
    <Button kind="secondary" href={`/register-domain?domain=${encodeURIComponent(`yourbrand${price.tld}`)}`}>{copy.search} {price.tld}</Button>
  </Tile>;
}

export function TldCatalogPage() {
  const copy = useDomainCopy();
  const workflow = useDomainWorkflowCopy();
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
          <h1>{copy.domains}</h1>
          <p>{workflow.tldCatalogDescription}</p>
        </Column>
      </Grid>
    </section>

    <section className="carbon-tld-catalog-page__content" aria-labelledby="supported-tlds-heading">
      <Grid fullWidth>
        <Column sm={4} md={8} lg={16}>
          <div className="carbon-tld-catalog__toolbar">
            <div>
              <h2 id="supported-tlds-heading">{copy.search}</h2>
              <p>{query.isSuccess ? `${catalog.length} ${copy.allTlds}` : `${copy.loading}…`}</p>
            </div>
            <Search id="supported-tld-search" labelText={copy.search} placeholder={workflow.searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </Column>
      </Grid>

      {query.isPending ? <div className="carbon-tld-catalog__status"><InlineLoading description={`${copy.loading}…`} /></div> : null}
      {query.isError ? <InlineNotification kind="error" lowContrast hideCloseButton title={`${copy.domains} unavailable`} subtitle={`${copy.loading}…`} /> : null}
      {query.isSuccess && filtered.length === 0 ? <InlineNotification kind="info" lowContrast hideCloseButton title={`${copy.search}: 0`} subtitle={`${copy.search} .com, .shop, .dev`} /> : null}
      {query.isSuccess && visible.length > 0 ? <>
        <Grid fullWidth className="carbon-tld-catalog__grid">
          {visible.map((price) => <Column sm={4} md={4} lg={4} key={price.tld}><TldCard price={price} /></Column>)}
        </Grid>
        <Pagination
          className="carbon-tld-catalog__pagination"
          backwardText={workflow.backSearch}
          forwardText={copy.search}
          itemsPerPageText={copy.allTlds}
          itemRangeText={(min, max, total) => `${min}–${max} ${copy.allTlds.toLowerCase()}`}
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
