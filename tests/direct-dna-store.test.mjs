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

test('storefront prices and order quotes are read from the live DNA catalog', async () => {
  const search = await read('supabase/functions/domain-search-fast/index.ts')
  const orders = await read('supabase/functions/domain-order-guard/index.ts')
  assert.match(search, /\/api\/v1\/products\/tlds/)
  assert.match(search, /DomainNameAPI live catalog/)
  assert.doesNotMatch(search, /from\("domain_tld_prices"\)/)
  assert.match(orders, /\/api\/v1\/products\/tlds/)
  assert.doesNotMatch(orders, /domain_tld_period_prices/)
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
  const main = await read('src/main.tsx')
  assert.doesNotMatch(router, /walletApi|WalletPage|walletRoute|Pay from balance/)
  assert.doesNotMatch(shell, /adminNavigation|href="\/admin"|\/dashboard\/wallet/)
  assert.doesNotMatch(main, /AdminPage|AdminEnvironmentsPage|AdminOperationsPage/)
})
