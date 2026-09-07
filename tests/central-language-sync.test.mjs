import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../src/domain-shell.tsx', import.meta.url), 'utf8');
const core = readFileSync(new URL('../supabase/functions/domain-api/core.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../supabase/functions/domain-api/index.ts', import.meta.url), 'utf8');

test('domain language selection persists centrally and is restored through SSO/session payloads', () => {
  assert.match(shell, /api\("\/me\/language"/);
  assert.match(shell, /kmerhosting:language-change/);
  assert.match(shell, /preferredLanguage/);
  assert.match(core, /preferredLanguage\?: string \| null/);
  assert.match(api, /centralPreferredLanguageForProductUser/);
  assert.match(api, /preferredLanguage: clean\(centralUser\.preferred_language\)/);
});
