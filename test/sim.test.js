import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { loadCorpus } from '../src/engine/corpus.js';
import { createApp } from '../src/server/app.js';
import { runBuyers } from '../src/sim/agents.js';
import { blindPromptHash, blindVote, pickBoard, runPanel, shuffle } from '../src/sim/audience.js';
import { createBudget, visitorId } from '../src/sim/budget.js';
import { createSim } from '../src/sim/index.js';
import { MAX_TURNS } from '../src/sim/interview.js';
import { createKv, fileKv, memoryKv, upstashKv } from '../src/sim/kv.js';
import { createFakeModel, createModel } from '../src/sim/llm.js';
import { FIXED, buildPanel } from '../src/sim/personas.js';

const corpus = loadCorpus();
const pitch = { name: 'Relay', tagline: 'Turn website visitors into booked sales calls', description: 'An AI sales agent that qualifies inbound visitors and books meetings.' };
const yours = (user) => Number(user.match(/(\d+)\. Relay —/)?.[1]);

/** A scripted model: sensible answers for every call the simulations make. */
function scripted(overrides = {}) {
  return createFakeModel((call) => {
    if (overrides[call.tag]) {
      const out = overrides[call.tag](call);
      if (out !== undefined) return out;
    }
    const { tag, user } = call;
    if (tag === 'panel.blind') return { opens: [yours(user), 1], upvotes: [yours(user)], why: 'Relevant to me.' };
    if (tag === 'panel.page') return { restatement: 'It books sales calls from website visitors.', would_try: 'maybe', objection: 'No pricing shown.', question: 'What does it cost?' };
    if (tag === 'panel.synth') return { comprehension: Array.from({ length: 12 }, (_, i) => ({ respondent: i + 1, verdict: i < 9 ? 'right' : 'partly' })), objection_themes: [{ label: 'Pricing unclear', respondents: [1, 2, 3, 4, 5, 6, 7] }, { label: 'Setup', respondents: [8, 9, 10, 11, 12, 1] }] };
    if (tag === 'buyers.prep') return { entries: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, summary: `Neutral sentence ${i + 1}.` })), briefs: [1, 2, 3, 4].map((i) => ({ buyer: `Buyer ${i}`, need: `Need ${i}`, constraint: `Limit ${i}` })) };
    if (tag === 'buyers.run') return { pick: yours(user), alternates: [1, 2], reason: 'Best fit.', passed_over: [], missing: [{ category: 'pricing', detail: 'No price' }] };
    if (tag === 'interview.open') return { buyer: 'Head of sales', need: 'More meetings', constraint: 'HubSpot', message: 'Does it sync with HubSpot?' };
    if (tag === 'interview.seller') return { message: 'Yes, it syncs with HubSpot.', lacked_information: false };
    if (tag === 'interview.buyer') return { message: 'And the price?', finished: false };
    if (tag === 'interview.grade') return { turns: Array.from({ length: 9 }, (_, i) => ({ turn: i + 1, handling: 'answered', note: 'Clear.' })), unsupported_claims: [{ turn: 1, claim: 'HubSpot sync' }], would_shortlist: 'yes', verdict: 'Good fit.', gaps: ['Pricing'] };
    throw new Error(`unscripted call ${tag}`);
  });
}

// ---- storage and budget ------------------------------------------------------------------

test('visitor ids group an IPv6 /64 and unwrap IPv4-mapped addresses', () => {
  assert.equal(visitorId('2001:db8:1:2:aaaa::1'), visitorId('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(visitorId('2001:db8:1:2::1'), visitorId('2001:db8:1:3::1'));
  assert.equal(visitorId('::ffff:203.0.113.9'), visitorId('203.0.113.9'));
  assert.doesNotMatch(visitorId('203.0.113.9'), /203/);
});

test('memory store expires entries and keeps counters', async () => {
  let now = 1000;
  const kv = memoryKv(() => now);
  await kv.set('a', { x: 1 }, 10);
  assert.deepEqual(await kv.get('a'), { x: 1 });
  assert.equal(await kv.add('n', 2, 10), 2);
  assert.equal(await kv.add('n', 0.5, 10), 2.5);
  now += 11_000;
  assert.equal(await kv.get('a'), null);
  assert.equal(await kv.add('n', 1, 10), 1);
});

test('file store survives a new handle on the same directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-kv-'));
  await fileKv(dir).set('doc', { hello: 'world' }, 60);
  await fileKv(dir).add('count', 3, 60);
  assert.deepEqual(await fileKv(dir).get('doc'), { hello: 'world' });
  assert.equal(await fileKv(dir).add('count', 1, 60), 4);
  rmSync(dir, { recursive: true, force: true });
});

test('Upstash store speaks the REST command protocol', async () => {
  const sent = [];
  const fakeFetch = async (url, init) => {
    const cmd = JSON.parse(init.body);
    sent.push({ url, auth: init.headers.authorization, cmd });
    const result = cmd[0] === 'GET' ? JSON.stringify({ a: 1 }) : cmd[0] === 'INCRBYFLOAT' ? cmd[2] : 'OK';
    return { ok: true, json: async () => ({ result }) };
  };
  const kv = upstashKv('https://example.upstash.io/', 'tok', fakeFetch);
  assert.deepEqual(await kv.get('k'), { a: 1 });
  await kv.set('k', { a: 1 }, 30);
  assert.equal(await kv.add('n', 0.25, 30), 0.25);
  assert.deepEqual(sent.map((s) => s.cmd[0]), ['GET', 'SET', 'INCRBYFLOAT', 'EXPIRE']);
  assert.deepEqual(sent[1].cmd, ['SET', 'k', '{"a":1}', 'EX', '30']);
  assert.ok(sent.every((s) => s.url === 'https://example.upstash.io' && s.auth === 'Bearer tok'));
});

test('store selection: Redis when configured, nothing on Vercel without it', () => {
  assert.equal(createKv({ env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' } }).backend, 'upstash');
  assert.equal(createKv({ env: { KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't', VERCEL: '1' } }).backend, 'upstash');
  assert.equal(createKv({ env: { VERCEL: '1' } }), null);
  assert.equal(createKv({ env: {} }).backend, 'memory');
});

test('budget reserves up front, settles to actual, and refuses past the cap', async () => {
  const budget = createBudget(memoryKv(), { dailyUsd: 0.1, visitorRunsPerDay: 3 });
  const a = await budget.reserve({ visitor: '1.1.1.1', estimateUsd: 0.06 });
  assert.equal(a.ok, true);
  const b = await budget.reserve({ visitor: '2.2.2.2', estimateUsd: 0.06 });
  assert.deepEqual(b, { ok: false, reason: 'daily' });
  await a.settle(0.01);
  await a.settle(0.5); // settling twice changes nothing
  assert.ok(Math.abs((await budget.spentToday()) - 0.01) < 1e-9);
  assert.equal((await budget.reserve({ visitor: '2.2.2.2', estimateUsd: 0.06 })).ok, true);
});

test('budget limits runs per visitor and does not count refused runs', async () => {
  const budget = createBudget(memoryKv(), { dailyUsd: 100, visitorRunsPerDay: 2 });
  const run = () => budget.reserve({ visitor: '9.9.9.9', estimateUsd: 0.01 });
  assert.equal((await run()).ok, true);
  assert.equal((await run()).ok, true);
  assert.deepEqual(await run(), { ok: false, reason: 'visitor' });
  assert.deepEqual(await run(), { ok: false, reason: 'visitor' });
  assert.equal((await budget.reserve({ visitor: '9.9.9.9', estimateUsd: 0.01, countsAsRun: false })).ok, true);
  assert.equal((await budget.reserve({ visitor: '8.8.8.8', estimateUsd: 0.01 })).ok, true);
});

test('concurrent reservations cannot jointly overshoot the daily cap', async () => {
  const budget = createBudget(memoryKv(), { dailyUsd: 0.25, visitorRunsPerDay: 100 });
  const holds = await Promise.all(Array.from({ length: 10 }, (_, i) => budget.reserve({ visitor: `10.0.0.${i}`, estimateUsd: 0.06 })));
  assert.equal(holds.filter((h) => h.ok).length, 4);
  assert.ok((await budget.spentToday()) <= 0.25);
});

// ---- model layer -------------------------------------------------------------------------

test('no key means no model, and simulations report why they are off', async () => {
  assert.equal(createModel({ apiKey: '' }), null);
  const noKey = createSim({ corpus, model: null, kv: memoryKv() });
  assert.deepEqual([noKey.status.enabled, noKey.status.reason], [false, 'no_key']);
  await assert.rejects(() => noKey.panel(pitch, { visitor: 'x' }), (err) => err.status === 503);
  const noStore = createSim({ corpus, model: scripted(), kv: null });
  assert.deepEqual([noStore.status.enabled, noStore.status.reason], [false, 'no_store']);
});

test('fake model validates output against the schema like the real one', async () => {
  const model = createFakeModel(() => ({ opens: 'not-a-list' }));
  const { z } = await import('zod');
  const res = await model.ask({ tag: 't', system: 's', user: 'u', schema: z.object({ opens: z.array(z.number()) }) });
  assert.deepEqual([res.ok, res.reason], [false, 'unparseable']);
});

// ---- audience panel ----------------------------------------------------------------------

test('the panel is eight fixed visitors plus four buyers fitted to the pitch', () => {
  const panel = buildPanel(['gtm', 'mcp']);
  assert.equal(panel.length, 12);
  assert.deepEqual(panel.slice(0, 8).map((p) => p.id), FIXED.map((p) => p.id));
  assert.deepEqual(panel.slice(8).map((p) => p.id), ['head_of_sales', 'mcp_user', 'revops', 'startup_cto']);
  assert.equal(new Set(buildPanel([]).map((p) => p.id)).size, 12);
});

test('boards are real days, name and tagline only, and stable for a seed', () => {
  const a = pickBoard(corpus, { seed: 42 });
  const b = pickBoard(corpus, { seed: 42 });
  assert.equal(a.date, b.date);
  assert.ok(a.entries.length >= 10 && a.entries.length <= 11);
  const day = new Date(`${a.date}T12:00:00Z`).getUTCDay();
  assert.ok(day >= 1 && day <= 4);
  for (const e of a.entries) {
    assert.deepEqual(Object.keys(e).sort(), ['key', 'name', 'realRank', 'realVotes', 'tagline', 'url']);
    assert.ok(e.tagline.length <= 90);
  }
});

test('the blind call hides which entry is under test and what the product does', async () => {
  const model = scripted();
  await runPanel({ corpus, model, pitch });
  const blind = model.calls.filter((c) => c.tag === 'panel.blind');
  const page = model.calls.filter((c) => c.tag === 'panel.page');
  assert.equal(blind.length, 12);
  assert.equal(page.length, 12);
  for (const c of blind) {
    assert.doesNotMatch(c.user + c.system, /qualifies inbound visitors/, 'description must not leak onto the board');
    // The pitch is listed exactly like every real launch, with nothing marking it out.
    assert.match(c.user, /^\d+\. Relay \u2014 Turn website visitors into booked sales calls$/m);
    assert.doesNotMatch(c.user.split('\n').at(-1), /Relay|your launch|under test/i);
    assert.equal((c.user.match(/^\d+\. /gm) ?? []).length, 12);
  }
  assert.ok(page.every((c) => c.user.includes('qualifies inbound visitors')));
  const positions = new Set(blind.map((c) => yours(c.user)));
  assert.ok(positions.size > 3, 'the pitch should land in different positions for different visitors');
});

test('panel results tally opens, upvotes, comprehension and objections', async () => {
  const r = await runPanel({ corpus, model: scripted(), pitch });
  assert.equal(r.kind, 'panel');
  assert.deepEqual([r.tallies.answeredBoard, r.tallies.opened, r.tallies.upvoted], [12, 12, 12]);
  assert.deepEqual([r.tallies.judged, r.tallies.understood, r.tallies.partly], [12, 9, 3]);
  assert.equal(r.board.place, 1);
  assert.equal(r.board.fixedAnswered, 8);
  const mine = r.board.standing.find((e) => e.isYou);
  assert.deepEqual([mine.panelUpvotes, mine.panelOpens, mine.realVotes], [8, 8, null]);
  assert.ok(r.board.standing.filter((e) => !e.isYou).every((e) => e.realVotes > 0 && e.realRank >= 1));
  // A respondent listed under two themes is counted once.
  assert.deepEqual(r.themes.map((t) => t.count), [7, 5]);
  assert.equal(r.usage.calls, 25);
  assert.ok(r.usage.usd > 0);
});

test('a refusal drops that respondent and the counts say so', async () => {
  let n = 0;
  const r = await runPanel({ corpus, model: scripted({ 'panel.blind': () => (++n === 3 ? { refuse: true } : undefined), 'panel.page': ({ user }) => (user.includes('venture fund') ? { fail: 'unavailable' } : undefined) }), pitch });
  assert.equal(r.tallies.answeredBoard, 11);
  assert.equal(r.tallies.answeredPage, 11);
  assert.equal(r.respondents.filter((p) => p.opened === null).length, 1);
  assert.equal(r.usage.failed, 2);
});

test('blind votes are sanitised: upvotes imply opens, junk numbers are ignored', async () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, name: `N${i}`, tagline: 't' }));
  const model = createFakeModel(() => ({ opens: [99, 0, 1, 1], upvotes: [2, -4], why: 'x' }));
  const vote = await blindVote(model, FIXED[0], entries, 7);
  const order = shuffle(entries, 7);
  assert.deepEqual([...vote.upvotes], [order[1].key]);
  assert.deepEqual([...vote.opens].sort(), [order[0].key, order[1].key].sort());
});

test('the live panel prompt matches the one the published backtest scored', () => {
  assert.match(blindPromptHash(), /^[0-9a-f]{16}$/);
  const path = new URL('../data/panel-eval.json', import.meta.url);
  if (existsSync(path)) {
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).promptHash, blindPromptHash(), 'prompt changed since the backtest: re-run scripts/eval-panel.mjs');
  }
});

// ---- buyer agents ------------------------------------------------------------------------

test('the catalogue is prepared blind and every run sees neutral summaries', async () => {
  const model = scripted();
  const r = await runBuyers({ corpus, model, pitch });
  const prep = model.calls.find((c) => c.tag === 'buyers.prep');
  assert.doesNotMatch(prep.user, /your product|yours|under test/i);
  assert.equal((prep.user.match(/^\d+\. /gm) ?? []).length, 8);
  const runs = model.calls.filter((c) => c.tag === 'buyers.run');
  assert.equal(runs.length, 12);
  assert.ok(runs.every((c) => /Neutral sentence \d\./.test(c.user) && !c.user.includes('qualifies inbound visitors')));
  assert.ok(new Set(runs.map((c) => yours(c.user))).size > 2);
  assert.deepEqual(r.tallies, { runs: 12, answered: 12, picked: 12, shortlisted: 12 });
  assert.match(r.yourSummary, /^Neutral sentence \d\.$/);
  assert.equal(r.standing[0].isYou, true);
  assert.deepEqual(r.gaps, [{ category: 'pricing', count: 12, examples: ['No price'] }]);
});

test('buyer runs that fail or pick nonsense are not counted as answers', async () => {
  let n = 0;
  const r = await runBuyers({
    corpus,
    model: scripted({
      'buyers.run': ({ user }) => {
        n++;
        if (n === 1) return { fail: 'rate_limited' };
        if (n === 2) return { pick: 99, alternates: [], reason: 'x', passed_over: [], missing: [] };
        return { pick: (yours(user) % 8) + 1, alternates: [yours(user)], reason: 'Rival fits better.', passed_over: [{ entry: yours(user), reason: 'No pricing shown' }], missing: [] };
      },
    }),
    pitch,
  });
  assert.deepEqual(r.tallies, { runs: 12, answered: 10, picked: 0, shortlisted: 10 });
  assert.deepEqual(r.whyNot, ['No pricing shown']);
  assert.equal(r.runs.filter((x) => !x.ok).length, 2);
});

test('a pitch with no comparable launches is refused with a reason', async () => {
  await assert.rejects(() => runBuyers({ corpus, model: scripted(), pitch: { tagline: 'Zxqv blorp wibble' } }), (err) => err.status === 422);
});

// ---- interview ---------------------------------------------------------------------------

test('a rehearsal runs to the turn limit, is graded, and is stored', async () => {
  const model = scripted();
  const sim = createSim({ corpus, model, kv: memoryKv() });
  let s = await sim.startInterview({ pitch, facts: 'Syncs with HubSpot.', mode: 'rehearsal' }, { visitor: 'v' });
  assert.equal(s.status, 'awaiting_seller');
  let steps = 0;
  while (s.status !== 'done') {
    s = await sim.rehearsalTurn(s.id, { visitor: 'v' });
    assert.ok(++steps <= MAX_TURNS);
  }
  assert.equal(s.transcript.filter((m) => m.role === 'seller').length, MAX_TURNS);
  assert.equal(s.scorecard.turns.length, MAX_TURNS, 'grades for turns that never happened are dropped');
  assert.deepEqual([s.scorecard.wouldShortlist, s.scorecard.claimsChecked, s.scorecard.unsupportedClaims.length], ['yes', true, 1]);
  assert.deepEqual(await sim.getInterview(s.id), s);
  assert.equal(await sim.getPanel(s.id), null, 'an interview id is not a panel id');
});

test('an external interview takes the caller’s answers and can end early', async () => {
  const sim = createSim({ corpus, model: scripted({ 'interview.buyer': ({ user }) => (user.includes('asked 2 of') ? { message: 'That is all.', finished: true } : undefined) }), kv: memoryKv() });
  let s = await sim.startInterview({ pitch, mode: 'external' }, { visitor: 'v' });
  assert.equal(await sim.rehearsalTurn(s.id, { visitor: 'v' }), null, 'external sessions cannot be advanced by the stand-in');
  s = await sim.reply(s.id, 'Yes, natively.', { visitor: 'v' });
  assert.equal(s.status, 'awaiting_seller');
  s = await sim.reply(s.id, '$99 a month.', { visitor: 'v' });
  assert.equal(s.status, 'done');
  assert.deepEqual(s.transcript.map((m) => m.role), ['buyer', 'seller', 'buyer', 'seller', 'buyer']);
  assert.deepEqual([s.scorecard.claimsChecked, s.scorecard.unsupportedClaims.length], [false, 0], 'no facts sheet, so claims are not checked');
  assert.equal((await sim.reply(s.id, 'more', { visitor: 'v' })).status, 'done');
  assert.equal(await sim.reply('missing-id-00', 'x', { visitor: 'v' }), null);
});

test('a failed turn leaves the interview where it was, ready to retry', async () => {
  let fail = true;
  const sim = createSim({ corpus, model: scripted({ 'interview.buyer': () => (fail ? { fail: 'unavailable' } : undefined) }), kv: memoryKv() });
  const s = await sim.startInterview({ pitch, mode: 'external' }, { visitor: 'v' });
  await assert.rejects(() => sim.reply(s.id, 'An answer.', { visitor: 'v' }), (err) => err.status === 503);
  assert.equal((await sim.getInterview(s.id)).transcript.length, 1);
  fail = false;
  assert.equal((await sim.reply(s.id, 'An answer.', { visitor: 'v' })).transcript.length, 3);
});

test('runs are charged to the budget and refused when it is spent', async () => {
  const kv = memoryKv();
  const sim = createSim({ corpus, model: scripted(), kv, budget: createBudget(kv, { dailyUsd: 0.07, visitorRunsPerDay: 10 }) });
  const first = await sim.panel(pitch, { visitor: 'a' });
  assert.ok(Math.abs((await sim.budget.spentToday()) - first.usage.usd) < 1e-9, 'settled to the real cost, not the estimate');
  await sim.buyers(pitch, { visitor: 'a' });
  const tight = createSim({ corpus, model: scripted(), kv: memoryKv(), budget: createBudget(memoryKv(), { dailyUsd: 0.01 }) });
  await assert.rejects(() => tight.panel(pitch, { visitor: 'a' }), (err) => err.status === 429 && /today/.test(err.message));
});

// ---- HTTP and MCP ------------------------------------------------------------------------

const dataDir = mkdtempSync(join(tmpdir(), 'wt-sim-'));
let server;
let base;
let offServer;
let offBase;
const form = (fields) => ({ method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  const hostile = scripted({ 'panel.page': () => ({ restatement: '<script>alert(1)</script> a sales tool', would_try: 'no', objection: '<img src=x onerror=alert(2)>', question: 'Why?' }) });
  const kv = memoryKv();
  const roomy = createBudget(kv, { dailyUsd: 100, visitorRunsPerDay: 1000 });
  server = createApp({ corpus, dataDir, rateLimit: 1000, sim: createSim({ corpus, model: hostile, kv, budget: roomy }) }).listen(0);
  offServer = createApp({ corpus, dataDir, rateLimit: 1000, sim: createSim({ corpus, model: null, kv: memoryKv() }) }).listen(0);
  await Promise.all([new Promise((r) => server.once('listening', r)), new Promise((r) => offServer.once('listening', r))]);
  base = `http://127.0.0.1:${server.address().port}`;
  offBase = `http://127.0.0.1:${offServer.address().port}`;
});
after(() => {
  server.close();
  offServer.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('panel flow: form, run, result page labelled simulated, model text escaped', async () => {
  assert.match(await (await fetch(`${base}/panel?${new URLSearchParams(pitch)}`)).text(), /value="Turn website visitors into booked sales calls"/);
  const res = await fetch(`${base}/panel`, form(pitch));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/p\/[\w-]{12}$/);
  const body = await (await fetch(base + res.headers.get('location'))).text();
  assert.match(body, /Simulated/);
  assert.match(body, /The board/);
  assert.match(body, /noindex/);
  assert.doesNotMatch(body, /<script>alert|<img src=x/);
  assert.match(body, /&lt;script&gt;alert\(1\)/);
  assert.doesNotMatch(body, /undefined|NaN|\[object Object\]/);
  assert.equal((await fetch(`${base}/panel`, form({ tagline: ' ' }))).status, 400);
});

test('buyer flow and interview rehearsal flow', async () => {
  const res = await fetch(`${base}/buyers`, form(pitch));
  assert.equal(res.status, 303);
  const body = await (await fetch(base + res.headers.get('location'))).text();
  assert.match(body, /Who wins instead/);
  assert.match(body, /12<span class="of-total"> of 12/);
  assert.doesNotMatch(body, /undefined|NaN|\[object Object\]/);

  assert.equal((await fetch(`${base}/interview`, form(pitch))).status, 400, 'a rehearsal needs a facts sheet');
  const start = await fetch(`${base}/interview`, form({ ...pitch, facts: 'Syncs with HubSpot. $99 a month.' }));
  const path = start.headers.get('location');
  assert.match(path, /^\/i\/[\w-]{12}$/);
  assert.match(await (await fetch(base + path)).text(), /data-autosubmit/);
  let page = '';
  for (let i = 0; i < MAX_TURNS; i++) {
    assert.equal((await fetch(`${base}${path}/next`, form({}))).status, 303);
    page = await (await fetch(base + path)).text();
  }
  assert.match(page, /Would shortlist/);
  assert.doesNotMatch(page, /data-autosubmit/);
  assert.doesNotMatch(page, /undefined|NaN|\[object Object\]/);
});

test('unknown result ids are 404s, and a panel id is not a buyers id', async () => {
  const res = await fetch(`${base}/panel`, form(pitch));
  const id = res.headers.get('location').split('/').pop();
  for (const path of [`/b/${id}`, `/i/${id}`, '/p/aaaaaaaaaaaa', '/p/..%2f..%2fx', '/i/short']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(`${base}/i/aaaaaaaaaaaa/next`, form({}))).status, 404);
});

test('JSON API for simulated tests', async () => {
  const panel = await (await fetch(`${base}/api/panel`, json(pitch))).json();
  assert.equal(panel.kind, 'panel');
  assert.match(panel.url, /\/p\/[\w-]{12}$/);
  const buyers = await (await fetch(`${base}/api/buyers`, json(pitch))).json();
  assert.equal(buyers.tallies.runs, 12);
  const bad = await fetch(`${base}/api/panel`, json({}));
  assert.equal(bad.status, 400);
  let s = await (await fetch(`${base}/api/interview`, json({ ...pitch, facts: 'x' }))).json();
  assert.equal(s.mode, 'external');
  s = await (await fetch(`${base}/api/interview/${s.id}/reply`, json({ message: 'Yes.' }))).json();
  assert.equal(s.transcript.length, 3);
  assert.equal((await fetch(`${base}/api/interview/nope/reply`, json({ message: 'x' }))).status, 404);
  assert.equal((await fetch(`${base}/api/interview/${s.id}/reply`, json({ message: '' }))).status, 400);
});

test('with simulations off, pages explain and runs are refused; measured test unaffected', async () => {
  const pageBody = await (await fetch(`${offBase}/panel`)).text();
  assert.match(pageBody, /Not available here/);
  const run = await fetch(`${offBase}/panel`, form(pitch));
  assert.equal(run.status, 503);
  assert.match(await run.text(), /no model key is configured/);
  assert.equal((await fetch(`${offBase}/api/buyers`, json(pitch))).status, 503);
  assert.equal((await fetch(`${offBase}/p/aaaaaaaaaaaa`)).status, 404);
  assert.equal((await fetch(`${offBase}/test`, form(pitch))).status, 303);
  const health = await (await fetch(`${offBase}/healthz`)).json();
  assert.deepEqual(health.simulations, { enabled: false, reason: 'no_key' });
  assert.match(await (await fetch(`${offBase}/`)).text(), /Not switched on for this deployment/);
});

test('a visitor over the daily run limit is told so on the form', async () => {
  const kv = memoryKv();
  const limited = createApp({ corpus, dataDir, rateLimit: 1000, sim: createSim({ corpus, model: scripted(), kv, budget: createBudget(kv, { dailyUsd: 5, visitorRunsPerDay: 1 }) }) }).listen(0);
  await new Promise((r) => limited.once('listening', r));
  const url = `http://127.0.0.1:${limited.address().port}`;
  assert.equal((await fetch(`${url}/panel`, form(pitch))).status, 303);
  const second = await fetch(`${url}/buyers`, form(pitch));
  limited.close();
  assert.equal(second.status, 429);
  assert.match(await second.text(), /today’s free simulation runs/);
});

test('every page still renders with simulations on', async () => {
  for (const path of ['/', '/panel', '/buyers', '/method', '/pricing', '/agents', '/llms.txt']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.doesNotMatch(await res.text(), /undefined|NaN|\[object Object\]/, path);
  }
});

test('MCP: simulated tools appear only when enabled, and an agent can sit an interview', async () => {
  const connect = async (url) => {
    const client = new Client({ name: 'sim-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    return client;
  };
  const off = await connect(offBase);
  assert.equal((await off.listTools()).tools.length, 5);
  await off.close();

  const client = await connect(base);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  for (const name of ['run_audience_panel', 'run_buyer_agents', 'start_agent_interview', 'reply_to_buyer']) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool.annotations.readOnlyHint, false, name);
    if (name !== 'reply_to_buyer') assert.match(tool.description, /SIMULATED/, name);
  }

  const panel = await client.callTool({ name: 'run_audience_panel', arguments: pitch });
  assert.ok(!panel.isError, panel.content?.[0]?.text);
  assert.equal(panel.structuredContent.simulated, true);
  assert.equal(panel.structuredContent.respondents.length, 12);
  assert.match(panel.structuredContent.url, /\/p\/[\w-]{12}$/);
  assert.match(panel.content[0].text, /^Simulated panel:/);

  const buyers = await client.callTool({ name: 'run_buyer_agents', arguments: pitch });
  assert.equal(buyers.structuredContent.tallies.answered, 12);

  let turn = (await client.callTool({ name: 'start_agent_interview', arguments: { ...pitch, facts: 'Syncs with HubSpot.' } })).structuredContent;
  assert.equal(turn.finished, false);
  assert.equal(turn.turns_left, MAX_TURNS);
  assert.ok(turn.client.buyer);
  let guard = 0;
  while (!turn.finished) {
    turn = (await client.callTool({ name: 'reply_to_buyer', arguments: { interview_id: turn.interview_id, message: 'Yes, it does.' } })).structuredContent;
    assert.ok(++guard <= MAX_TURNS);
  }
  assert.equal(turn.scorecard.wouldShortlist, 'yes');
  assert.match(turn.url, /\/i\/[\w-]{12}$/);

  const bad = await client.callTool({ name: 'reply_to_buyer', arguments: { interview_id: 'not-a-real-id', message: 'x' } });
  assert.equal(bad.isError, true);
  await client.close();
});
