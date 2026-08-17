import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Domain registration UI delegates account creation to the central portal', async () => {
  const router = await read('src/router.tsx')
  assert.match(router, /dashboardRegisterUrl = "https:\/\/dashboard\.kmerhosting\.com\/register"/)
  assert.match(router, /if \(initial === "register"\) \{\s*window\.location\.replace\(dashboardRegisterUrl\)/s)
  assert.match(router, /href="https:\/\/dashboard\.kmerhosting\.com\/register"/)
})

test('Domain backend blocks all local registration endpoints before any legacy auth implementation', async () => {
  const backend = await read('supabase/functions/domain-api/index.ts')
  const guard = backend.indexOf('["/auth/register/request", "/auth/register/verify"')
  assert.ok(guard >= 0, 'central registration guard must exist')
  assert.match(backend, /central_account_only/)
  assert.match(backend, /https:\/\/dashboard\.kmerhosting\.com/)
})

test('Domain product identities can only be created for a central KmerHosting account', async () => {
  const migration = await read('supabase/migrations/20260817053947_domain_central_identity_uuid_cutover.sql')
  assert.match(migration, /domain_users_central_account_fkey/)
  assert.match(migration, /domain_enforce_central_account_identity/)
  assert.match(migration, /central_account_required/)
})
