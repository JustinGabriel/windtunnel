import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { loadCorpus } from '../src/engine/corpus.js';
import { createApp } from '../src/server/app.js';
import { decodeShare, encodeShare } from '../src/server/share.js';
import { createWaitlist } from '../src/server/store.js';

const corpus = loadCorpus();
const dataDir = mkdtempSync(join(tmpdir(), 'windtunnel-'));
let server;
let base;

before(async () => {
  server = createApp({ corpus, dataDir, rateLimit: 1000 }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const form = (fields) => ({
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('every page renders', async () => {
  for (const path of ['/', '/compare', '/trends', '/method', '/agents', '/pricing']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.match(body, /<title>.*Windtunnel/);
    assert.doesNotMatch(body, /undefined|NaN|\[object Object\]/, path);
  }
});

test('security headers are set', async () => {
  const res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('submitting a pitch saves a shareable report', async () => {
  const res = await fetch(base + '/test', form({ name: 'Relay', tagline: 'Turn website visitors into booked sales calls' }));
  assert.equal(res.status, 303);
  const location = res.headers.get('location');
  assert.match(location, /^\/r\/[\w-]+$/);
  assert.deepEqual(decodeShare('r', location.slice(3)), { name: 'Relay', tagline: 'Turn website visitors into booked sales calls', description: '' });
  const page = await fetch(base + location);
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /Relay/);
  assert.match(body, /Closest launches/);
  assert.match(body, /noindex/);
  assert.doesNotMatch(body, /undefined|NaN|\[object Object\]/);
});

test('user text is escaped in reports', async () => {
  const res = await fetch(base + '/test', form({ name: '<img src=x onerror=alert(1)>', tagline: '<script>alert("x")</script> for agents' }));
  const body = await (await fetch(base + res.headers.get('location'))).text();
  assert.doesNotMatch(body, /<script>alert/);
  assert.doesNotMatch(body, /<img src=x/);
  assert.match(body, /&lt;script&gt;alert/);
});

test('a missing tagline re-renders the form with an error', async () => {
  const res = await fetch(base + '/test', form({ name: 'Relay', tagline: '  ' }));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Enter a tagline to test/);
});

test('unknown and malformed report ids are 404s', async () => {
  for (const path of ['/r/aaaaaaaaaa', '/r/..%2f..%2fpackage', '/c/aaaaaaaaaa', '/nope']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('a report link cannot be opened as a comparison', async () => {
  const res = await fetch(base + '/test', form({ tagline: 'Voice notes for busy founders' }));
  const token = res.headers.get('location').split('/').pop();
  assert.equal((await fetch(`${base}/c/${token}`)).status, 404);
});

test('share links are stateless: any server with the same data renders them', async () => {
  const token = encodeShare('r', { name: 'Quill', tagline: 'Private, local AI note-taking for your Mac', description: '' });
  const other = createApp({ corpus, dataDir, rateLimit: 1000 }).listen(0);
  await new Promise((r) => other.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${other.address().port}/r/${token}`);
  other.close();
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Quill/);
});

test('share tokens reject junk, the wrong kind and oversized input', () => {
  assert.equal(decodeShare('r', 'not-a-token'), null);
  assert.equal(decodeShare('r', '../../etc/passwd'), null);
  assert.equal(decodeShare('c', encodeShare('r', { tagline: 'x' })), null);
  assert.equal(decodeShare('r', 'A'.repeat(7000)), null);
  assert.equal(decodeShare('r', encodeShare('r', { tagline: 'x'.repeat(30_000) })), null);
});

test('comparison flow', async () => {
  const body = new URLSearchParams();
  for (const t of ['The Vercel for GTM', 'Sales automation for startups', '']) body.append('taglines', t);
  const res = await fetch(base + '/compare', { ...form({}), body });
  assert.equal(res.status, 303);
  const page = await (await fetch(base + res.headers.get('location'))).text();
  assert.match(page, /side by side/);
  assert.match(page, /The Vercel for GTM/);
  const tooFew = await fetch(base + '/compare', form({ taglines: 'Only one' }));
  assert.equal(tooFew.status, 400);
});

test('JSON API', async () => {
  const report = await (await fetch(base + '/api/test', json({ tagline: 'Open-source memory for coding agents' }))).json();
  assert.ok(report.conditions.label);
  assert.equal(report.forecast.length, 7);

  const bad = await fetch(base + '/api/test', json({}));
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'A tagline is required.' });

  const cmp = await (await fetch(base + '/api/compare', json({ taglines: ['The Vercel for GTM', 'A CRM'] }))).json();
  assert.equal(cmp.variants.length, 2);

  const found = await (await fetch(`${base}/api/comparables?q=voice+dictation+for+mac&limit=3`)).json();
  assert.equal(found.launches.length, 3);
  assert.equal((await fetch(`${base}/api/comparables?q=`)).status, 400);

  const trends = await (await fetch(base + '/api/trends')).json();
  assert.equal(trends.weekdays.length, 7);
  assert.ok(trends.topLaunches[0].votes >= trends.topLaunches[1].votes);
  assert.ok(!JSON.stringify(trends).includes('"vec"'));

  const bt = await (await fetch(base + '/api/backtest')).json();
  assert.ok(bt.conditionsModel.crossValidatedSpearman > 0);
  assert.equal((await fetch(base + '/api/nope')).status, 404);
});

test('malformed JSON is a 400, not a crash', async () => {
  const res = await fetch(base + '/api/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test('waitlist validates, stores and de-duplicates', async () => {
  const bad = await fetch(base + '/waitlist', form({ email: 'not-an-email', plan: 'launch' }));
  assert.equal(bad.status, 400);
  const first = await fetch(base + '/waitlist', form({ email: 'Maker@Example.com', plan: 'studio' }));
  assert.equal(first.headers.get('location'), '/pricing?joined=yes');
  const again = await fetch(base + '/waitlist', form({ email: 'maker@example.com', plan: 'launch' }));
  assert.equal(again.headers.get('location'), '/pricing?joined=already');
  const lines = readFileSync(join(dataDir, 'waitlist.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).plan, 'studio');
});

test('waitlist can forward sign-ups to a webhook', async () => {
  const { createServer } = await import('node:http');
  const received = [];
  const hook = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.end('ok');
    });
  }).listen(0);
  await new Promise((r) => hook.once('listening', r));
  const waitlist = createWaitlist({ webhookUrl: `http://127.0.0.1:${hook.address().port}/hook`, serverless: true });
  assert.equal(waitlist.mode, 'webhook');
  assert.equal(await waitlist.join('a@b.co', 'launch'), 'yes');
  hook.close();
  assert.equal(received.length, 1);
  assert.deepEqual({ email: received[0].email, plan: received[0].plan }, { email: 'a@b.co', plan: 'launch' });
});

test('on a serverless host with no webhook the waitlist form is hidden, not lossy', async () => {
  const waitlist = createWaitlist({ dir: dataDir, webhookUrl: '', serverless: true });
  assert.equal(waitlist.mode, 'closed');
  const closed = createApp({ corpus, dataDir, waitlist, rateLimit: 1000 }).listen(0);
  await new Promise((r) => closed.once('listening', r));
  const url = `http://127.0.0.1:${closed.address().port}`;
  const pricing = await (await fetch(`${url}/pricing`)).text();
  const post = await fetch(`${url}/waitlist`, form({ email: 'a@b.co', plan: 'launch' }));
  closed.close();
  assert.doesNotMatch(pricing, /action="\/waitlist"/);
  assert.match(pricing, /not open on this deployment/);
  assert.equal(post.status, 503);
});

test('the Vercel entry point exports the app as a request handler', async () => {
  const { default: handler } = await import('../api/index.js');
  assert.equal(typeof handler, 'function');
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.rewrites[0].destination, '/api');
  assert.match(vercel.functions['api/index.js'].includeFiles, /launches\.json/);
});

test('machine-readable endpoints', async () => {
  const health = await (await fetch(base + '/healthz')).json();
  assert.equal(health.ok, true);
  assert.equal(health.waitlist, 'file');
  assert.match(await (await fetch(base + '/llms.txt')).text(), /\/mcp/);
  assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \/r\//);
});

test('write endpoints are rate limited', async () => {
  const limited = createApp({ corpus, dataDir, rateLimit: 2 }).listen(0);
  await new Promise((r) => limited.once('listening', r));
  const url = `http://127.0.0.1:${limited.address().port}/api/test`;
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await fetch(url, json({ tagline: 'Voice notes for founders' }))).status);
  limited.close();
  assert.deepEqual(statuses, [200, 200, 429, 429]);
});
