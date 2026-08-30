import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('all DNA catalog operations apply the fixed 30 percent resale markup', async () => {
  const catalog = await read('supabase/functions/_shared/dna-catalog.ts')
  assert.match(catalog, /customerPriceUsd:\s*money\(providerCostUsd \* 1\.30\)/)
  for (const operation of ['registration', 'renewal', 'transfer', 'restore']) {
    assert.match(catalog, new RegExp(`${operation}: operationRows`))
  }
})

test('storefront uses synchronized prices while checkout refreshes the live DNA quote', async () => {
  const search = await read('supabase/functions/domain-search-fast/index.ts')
  const orders = await read('supabase/functions/domain-order-guard/index.ts')
  const jobs = await read('supabase/functions/domain-jobs-v2/index.ts')
  const dnaClient = await read('supabase/functions/_shared/dna-client.ts')
  assert.match(search, /from\("domain_tld_prices"\)/)
  assert.match(search, /Current domain catalog/)
  assert.match(search, /\/api\/v1\/domains\/bulk-search/)
  assert.doesNotMatch(search, /\/api\/v1\/products\/tlds/)
  assert.doesNotMatch(search, /\/api\/v1\/domains\/search/)
  assert.match(search, /domain_registrar_proxy_env/)
  assert.doesNotMatch(search, /registration_cost_usd|renewal_cost_usd|transfer_cost_usd|provider_catalog_payload/)
  assert.match(orders, /\/api\/v1\/products\/tlds/)
  assert.match(orders, /\/api\/v1\/domains\/bulk-search/)
  assert.doesNotMatch(orders, /\/api\/v1\/domains\/search/)
  assert.doesNotMatch(orders, /domain_tld_period_prices/)
  assert.match(orders, /domain_registrar_proxy_env/)
  assert.match(jobs, /isHidden: false/)
  assert.doesNotMatch(jobs, /discloseFlag/)
  assert.match(jobs, /domain_registrar_proxy_env/)
  assert.match(dnaClient, /https:\/\/api\.domainresellerapi\.com/)
  assert.match(dnaClient, /https:\/\/ote\.domainresellerapi\.com/)
})

test('OTE skips central charging while LIVE uses the central credit ledger', async () => {
  const migration = await read('supabase/migrations/20260824070000_direct_dna_store.sql')
  assert.match(migration, /if not v_test then[\s\S]*dashboard_apply_product_credit/)
  assert.match(migration, /case when v_test then 0 else v_order\.price_usd end/)
  assert.match(migration, /'domain',p_user_id::text,-round\(v_order\.price_usd\*1000000\)/)
  assert.match(migration, /domain_refund_order_direct/)
})

test('customer UI exposes neither a domain wallet nor an administration route', async () => {
  const router = await read('src/router.tsx')
  const shell = await read('src/domain-shell.tsx')
  const footer = await read('src/site-footer.tsx')
  const main = await read('src/main.tsx')
  assert.doesNotMatch(router, /walletApi|WalletPage|walletRoute|Pay from balance/)
  assert.doesNotMatch(shell, /adminNavigation|href="\/admin"|\/dashboard\/wallet/)
  assert.doesNotMatch(footer, /dashboard\/wallet|label: "Wallet"/)
  assert.doesNotMatch(main, /AdminPage|AdminEnvironmentsPage|AdminOperationsPage/)
})

test('domain homepage reads shared hosting prices from the live catalog endpoint', async () => {
  const catalog = await read('src/shared-hosting-catalog.tsx')
  const proxy = await read('api/hosting-catalog.ts')
  assert.match(catalog, /fetch\("\/api\/hosting-catalog"/)
  assert.match(catalog, /monthly_price_micros/)
  assert.match(catalog, /Number\(plan\.monthly_price_micros\s*\|\|\s*0\)\s*\/\s*1_000_000/)
  assert.match(proxy, /hosting-api-gateway\/catalog/)
  assert.doesNotMatch(catalog, /\$2\.99|\$3\.99|\$4\.99|\$6\.99|\$10\.99|\$15\.99/)
})

test('domain hero is centered without the redundant product label', async () => {
  const router = await read('src/router.tsx')
  const styles = await read('src/carbon-product-alignment.scss')
  assert.match(styles, /\.carbon-domain-overview__content\s*\{[\s\S]*text-align:\s*center;/)
  assert.doesNotMatch(router, /carbon-domain-overview__content">\s*<span className="kicker">KmerHosting Domains<\/span>/)
})

test('bulk search aligns submit control with the textarea', async () => {
  const styles = await read('src/carbon-product-alignment.scss')
  assert.match(styles, /\.carbon-domain-search-form--bulk\s+\.carbon-domain-search-form__actions\s*\{[\s\S]*margin-block-end:\s*spacing\.\$spacing-05\s*\+\s*spacing\.\$spacing-02;/)
})

test('OTE orders expose a guarded DNA retry action', async () => {
  const backend = await read('supabase/functions/domain-api/index.ts')
  const router = await read('src/router.tsx')
  assert.match(backend, /async function retryOrder\(/)
  assert.match(backend, /await domainInfo\(order\.domain_name\)/)
  assert.match(backend, /status: "pending", run_after: now/)
  assert.match(backend, /\.eq\("status", "failed"\)/)
  assert.match(backend, /retry_ote_only/)
  assert.match(router, /Retry operation/)
  assert.match(router, /api\(`\/orders\/\$\{orderId\}\/retry`, \{ method: "POST" \}\)/)
})


test('public boundaries hide provider costs, markup metadata, and raw provider payloads', async () => {
  const search = await read('supabase/functions/domain-search-fast/index.ts')
  const api = await read('supabase/functions/domain-api/index.ts')
  const customerTools = await read('supabase/functions/domain-customer-tools/index.ts')
  const orderGuard = await read('supabase/functions/domain-order-guard/index.ts')
  assert.match(search, /function publicCatalogPrice/)
  assert.match(search, /customerPriceUsd/)
  assert.doesNotMatch(search, /markupPercent/)
  assert.doesNotMatch(api, /markupPercent/)
  assert.doesNotMatch(customerTools, /providerCostUsd|markupPercent/)
  assert.match(orderGuard, /function publicOrder/)
  assert.doesNotMatch(orderGuard, /return json\(req, \{[\s\S]{0,500}providerCostUsd/)
})

test('route loading is skeleton-only and forms expose Carbon validation controls', async () => {
  const experience = await read('src/carbon-experience.tsx')
  const router = await read('src/router.tsx')
  const styles = await read('src/carbon-product-alignment.scss')
  assert.doesNotMatch(experience, /withOverlay|<Loading\b/)
  assert.match(experience, /SkeletonText/)
  assert.match(router, /invalidText=/)
  assert.match(router, /RadioButtonGroup/)
  assert.match(router, /PasswordInput/)
  assert.match(router, /carbon-form-grid--two/)
  assert.doesNotMatch(styles, /cds--search-input[\s\S]{0,120}min-block-size:\s*4rem/)
})
