import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const proxy = readFileSync(new URL('../api/domain-proxy.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');

test('central KmerHosting SSO exchange becomes an HttpOnly domain session', () => {
  assert.match(proxy, /AUTH_SUCCESS_PATHS[\s\S]*\/auth\/kmerhosting\/exchange/);
  assert.match(proxy, /Set-Cookie/);
  assert.match(proxy, /HttpOnly/);
  assert.match(proxy, /SameSite=Lax/);
  assert.match(api, /mode:\s*["']httpOnlyCookie["']/);
});
