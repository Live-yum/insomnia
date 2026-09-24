import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOfflineBrowserUrlAllowed as allowed, parseOfflineOrigins as parse, OFFLINE_BUILD } from '../../packages/insomnia/src/common/offline-policy.ts';

test('offline build cannot be toggled by an environment variable', () => {
  process.env.INSOMNIA_OFFLINE = 'false';
  assert.equal(OFFLINE_BUILD, true);
});
test('no exceptions by default', () => assert.equal(parse(undefined).size, 0));
test('exact origin parsing and deduplication', () => {
  assert.deepEqual([...parse('["https://idp.corp:8443", "https://idp.corp:8443/"]')], ['https://idp.corp:8443']);
});
for (const input of ['null', '{}', '"https://idp.corp"', '[1]', '[null]', 'broken']) {
  test(`reject malformed origins configuration ${input}`, () => assert.throws(() => parse(input)));
}
for (const origin of [
  'https://*.corp', 'https://idp.corp/path', 'https://idp.corp?q=1', 'https://idp.corp#frag',
  'https://user:secret@idp.corp', 'file:///tmp/a', 'ftp://idp.corp', 'https://idp.corp.',
  ' https://idp.corp', 'https://idp.corp ', 'https://idp.\ncorp', 'https:\\idp.corp',
  'https:idp.corp', 'javascript:alert(1)', '*',
]) {
  test(`reject non-exact exception ${JSON.stringify(origin)}`, () => assert.throws(() => parse(JSON.stringify([origin]))));
}
for (const url of [
  'https://insomnia-app.local/', 'https://insomnia-app.local/assets/a.js',
  'file:///tmp/app/index.html', 'file:///C:/app/index.html',
  'data:text/plain,hello', 'blob:https://insomnia-app.local/123',
  'insomnia-templating-worker-database://local/query',
]) {
  test(`local asset allowed: ${url}`, () => assert.equal(allowed(url), true));
}
for (const url of [
  'https://api.insomnia.rest', 'https://updates.insomnia.rest', 'https://o1.ingest.sentry.io',
  'https://insomnia-app.local.evil.example/a', 'https://insomnia-app.local@evil.example/a',
  'https://evil.example@insomnia-app.local/a', 'http://insomnia-app.local/a',
  'https://insomnia-app.local:8443/a', 'https://insomnia-app.local./a',
  'http://localhost:3334', 'http://127.0.0.1:3334', 'http://10.0.0.1/api',
  'http://[::1]/', 'https://public.example', 'wss://public.example/socket',
  'file://public.example/share/a', 'file:////public.example/share/a', 'file:///%5c%5cpublic.example/a',
  'insomnia-event-source://events', 'javascript:alert(1)', 'not a URL', 'file:///%zz',
]) {
  test(`default-deny browser URL: ${url}`, () => assert.equal(allowed(url), false));
}
test('exceptions are scheme + host + port scoped, not domain suffixes', () => {
  const extra = parse('["https://idp.corp:8443", "wss://socket.corp"]');
  assert.equal(allowed('https://idp.corp:8443/login?next=%2f', extra), true);
  assert.equal(allowed('https://idp.corp/login', extra), false);
  assert.equal(allowed('http://idp.corp:8443/login', extra), false);
  assert.equal(allowed('https://idp.corp.evil.example:8443/login', extra), false);
  assert.equal(allowed('wss://socket.corp/stream', extra), true);
});
test('redirect destination needs separate authorization', () => {
  const extra = parse('["https://idp.corp"]');
  assert.equal(allowed('https://idp.corp/start', extra), true);
  assert.equal(allowed('https://outside.example/callback', extra), false);
});
