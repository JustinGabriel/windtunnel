// HTTP surface: server-rendered pages, a small JSON API, and the MCP endpoint.

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePitch, backtest, compareVariants } from '../engine/analyze.js';
import { loadCorpus, publicDoc } from '../engine/corpus.js';
import { sharedTerms } from '../engine/text.js';
import { existsSync, readFileSync } from 'node:fs';
import { createMcpServer } from '../mcp/server.js';
import { createSim } from '../sim/index.js';
import { ModelConfigError } from '../sim/llm.js';
import { decodeShare, encodeShare } from './share.js';
import * as simViews from './sim-views.js';
import { createWaitlist } from './store.js';
import * as views from './views.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @param {{corpus?: import('../engine/corpus.js').Corpus, dataDir?: string, rateLimit?: number, waitlist?: object, sim?: object}} [options]
 */
export function createApp(options = {}) {
  const corpus = options.corpus ?? loadCorpus();
  const waitlist = options.waitlist ?? createWaitlist({ dir: options.dataDir ?? process.env.WINDTUNNEL_DATA ?? join(ROOT, 'var') });
  const limiter = rateLimiter(options.rateLimit ?? 40);
  const dataDir = options.dataDir ?? process.env.WINDTUNNEL_DATA ?? join(ROOT, 'var');
  const sim = options.sim ?? createSim({ corpus, dataDir });
  const evalPath = join(ROOT, 'data/panel-eval.json');
  const panelEval = existsSync(evalPath) ? JSON.parse(readFileSync(evalPath, 'utf8')) : null;
  // The backtest is deterministic but takes about a second, so run it on first use:
  // API and MCP calls on a cold serverless instance should not wait for it.
  let bt;
  const ctx = {
    corpus,
    sim: sim.status,
    panelEval,
    waitlistOpen: waitlist.open,
    get backtest() {
      return (bt ??= backtest(corpus));
    },
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
  });
  app.use(express.static(join(ROOT, 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: true, limit: '20kb' }));
  app.use(express.json({ limit: '50kb' }));

  const page = (res, body, status = 200) => res.status(status).type('html').send(String(body));
  const origin = (req) => process.env.PUBLIC_URL?.replace(/\/$/, '') ?? `${req.protocol}://${req.get('host')}`;

  // ---- pages --------------------------------------------------------------------------

  app.get('/', (req, res) => page(res, views.home(ctx, { prefill: pick(req.query, ['name', 'tagline', 'description']) })));

  app.post('/test', limiter, (req, res) => {
    const input = pick(req.body, ['name', 'tagline', 'description']);
    if (!input.tagline?.trim()) return page(res, views.home(ctx, { prefill: input, error: 'Enter a tagline to test.' }), 400);
    res.redirect(303, `/r/${encodeShare('r', analyzePitch(corpus, input).input)}`);
  });

  app.get('/r/:token', (req, res) => {
    const input = decodeShare('r', req.params.token);
    if (!input?.tagline) return page(res, views.notFound(), 404);
    page(res, views.report(ctx, analyzePitch(corpus, input), { url: `${origin(req)}/r/${req.params.token}` }));
  });

  app.get('/compare', (req, res) => page(res, views.compare(ctx, {})));

  app.post('/compare', limiter, (req, res) => {
    const taglines = [].concat(req.body?.taglines ?? []).map(String).filter((t) => t.trim());
    const input = { ...pick(req.body, ['name', 'description']), taglines };
    if (taglines.length < 2) return page(res, views.compare(ctx, { prefill: input, error: 'Enter at least two taglines to compare.' }), 400);
    const trimmed = { name: (input.name ?? '').slice(0, 80), description: (input.description ?? '').slice(0, 2000), taglines: taglines.slice(0, 8).map((t) => t.trim().slice(0, 300)) };
    res.redirect(303, `/c/${encodeShare('c', trimmed)}`);
  });

  app.get('/c/:token', (req, res) => {
    const input = decodeShare('c', req.params.token);
    if (!Array.isArray(input?.taglines) || !input.taglines.length) return page(res, views.notFound(), 404);
    page(res, views.comparison(ctx, compareVariants(corpus, input), { url: `${origin(req)}/c/${req.params.token}` }));
  });

  // ---- simulated tests ----------------------------------------------------------------

  const pitchOf = (source) => pick(source, ['name', 'tagline', 'description']);
  const visitor = (req) => ({ visitor: req.ip });
  /** Limit and availability errors re-render the form with the reason; anything else propagates. */
  const simFailure = (err) => (err instanceof ModelConfigError ? { status: 503, message: 'Simulations are misconfigured on this deployment. The measured tests still work.' } : err.status ? { status: err.status, message: err.message } : null);

  app.get('/panel', (req, res) => page(res, simViews.panelPage(ctx, { prefill: pitchOf(req.query) })));
  app.post('/panel', limiter, async (req, res) => {
    const input = pitchOf(req.body);
    if (!input.tagline?.trim()) return page(res, simViews.panelPage(ctx, { prefill: input, error: 'Enter a tagline to test.' }), 400);
    try {
      const result = await sim.panel(input, visitor(req));
      res.redirect(303, `/p/${result.id}`);
    } catch (err) {
      const failure = simFailure(err);
      if (!failure) throw err;
      if (err instanceof ModelConfigError) console.error(err);
      page(res, simViews.panelPage(ctx, { prefill: input, error: failure.message }), failure.status);
    }
  });
  app.get('/p/:id', async (req, res) => {
    const result = sim.status.enabled ? await sim.getPanel(req.params.id) : null;
    if (!result) return page(res, views.notFound(), 404);
    page(res, simViews.panelResult(ctx, result, { url: `${origin(req)}/p/${result.id}` }));
  });

  // The thread: the maker answers a stored panel's comments and the panel is asked again.
  const repliesOf = (body) =>
    Object.entries(body ?? {})
      .filter(([k, v]) => /^reply_\d{1,2}$/.test(k) && typeof v === 'string' && v.trim())
      .map(([k, v]) => ({ comment: Number(k.slice(6)), reply: v }));

  app.post('/p/:id/thread', limiter, async (req, res) => {
    const mode = req.body?.mode === 'typed' ? 'typed' : 'stand_in';
    const facts = typeof req.body?.facts === 'string' ? req.body.facts : '';
    const panel = sim.status.enabled ? await sim.getPanel(req.params.id) : null;
    if (!panel) return page(res, views.notFound(), 404);
    const again = (message, status) => page(res, simViews.panelResult(ctx, panel, { url: `${origin(req)}/p/${panel.id}`, threadError: message, facts }), status);
    if (mode === 'stand_in' && !facts.trim()) return again('Add a facts sheet: it is the only thing the stand-in may say.', 400);
    try {
      let thread = await sim.startThread(panel.id, { facts, mode });
      if (mode === 'stand_in') thread = await sim.answerThread(thread.id, [], visitor(req));
      res.redirect(303, `/t/${thread.id}`);
    } catch (err) {
      const failure = simFailure(err);
      if (!failure) throw err;
      if (err instanceof ModelConfigError) console.error(err);
      again(failure.message, failure.status);
    }
  });
  app.get('/t/:id', async (req, res) => {
    const thread = sim.status.enabled ? await sim.getThread(req.params.id) : null;
    if (!thread) return page(res, views.notFound(), 404);
    page(res, simViews.threadPage(ctx, thread, { url: `${origin(req)}/t/${thread.id}` }));
  });
  app.post('/t/:id/replies', limiter, async (req, res) => {
    const replies = repliesOf(req.body);
    try {
      const thread = await sim.answerThread(req.params.id, replies, visitor(req));
      if (!thread) return page(res, views.notFound(), 404);
      res.redirect(303, `/t/${thread.id}`);
    } catch (err) {
      const failure = simFailure(err);
      const thread = failure && sim.status.enabled ? await sim.getThread(req.params.id) : null;
      if (!thread) throw err;
      page(res, simViews.threadPage(ctx, thread, { url: `${origin(req)}/t/${thread.id}`, error: failure.message, drafts: Object.fromEntries(replies.map((r) => [r.comment, r.reply])) }), failure.status);
    }
  });

  app.get('/buyers', (req, res) => page(res, simViews.buyersPage(ctx, { prefill: { ...pitchOf(req.query), ...pick(req.query, ['facts']) } })));
  app.post('/buyers', limiter, async (req, res) => {
    const input = pitchOf(req.body);
    if (!input.tagline?.trim()) return page(res, simViews.buyersPage(ctx, { prefill: input, error: 'Enter a tagline to test.' }), 400);
    try {
      const result = await sim.buyers(input, visitor(req));
      res.redirect(303, `/b/${result.id}`);
    } catch (err) {
      const failure = simFailure(err);
      if (!failure) throw err;
      if (err instanceof ModelConfigError) console.error(err);
      page(res, simViews.buyersPage(ctx, { prefill: input, error: failure.message }), failure.status);
    }
  });
  app.get('/b/:id', async (req, res) => {
    const result = sim.status.enabled ? await sim.getBuyers(req.params.id) : null;
    if (!result) return page(res, views.notFound(), 404);
    page(res, simViews.buyersResult(ctx, result, { url: `${origin(req)}/b/${result.id}` }));
  });

  app.post('/interview', limiter, async (req, res) => {
    const input = { ...pitchOf(req.body), ...pick(req.body, ['facts']) };
    if (!input.tagline?.trim()) return page(res, simViews.buyersPage(ctx, { prefill: input, interviewError: 'Enter a tagline to test.' }), 400);
    if (!input.facts?.trim()) return page(res, simViews.buyersPage(ctx, { prefill: input, interviewError: 'Add a facts sheet: it is the only thing the stand-in seller may say.' }), 400);
    try {
      const session = await sim.startInterview({ pitch: pitchOf(input), facts: input.facts, mode: 'rehearsal' }, visitor(req));
      res.redirect(303, `/i/${session.id}`);
    } catch (err) {
      const failure = simFailure(err);
      if (!failure) throw err;
      if (err instanceof ModelConfigError) console.error(err);
      page(res, simViews.buyersPage(ctx, { prefill: input, interviewError: failure.message }), failure.status);
    }
  });
  app.get('/i/:id', async (req, res) => {
    const session = sim.status.enabled ? await sim.getInterview(req.params.id) : null;
    if (!session) return page(res, views.notFound(), 404);
    page(res, simViews.interviewPage(ctx, session, { url: `${origin(req)}/i/${session.id}` }));
  });
  app.post('/i/:id/next', limiter, async (req, res) => {
    try {
      const session = await sim.rehearsalTurn(req.params.id, visitor(req));
      if (!session) return page(res, views.notFound(), 404);
      res.redirect(303, `/i/${session.id}`);
    } catch (err) {
      const failure = simFailure(err);
      const session = failure && sim.status.enabled ? await sim.getInterview(req.params.id) : null;
      if (!session) throw err;
      page(res, simViews.interviewPage(ctx, session, { url: `${origin(req)}/i/${session.id}`, error: failure.message }), failure.status);
    }
  });

  app.get('/trends', (req, res) => page(res, views.trends(ctx)));
  app.get('/method', (req, res) => page(res, views.method(ctx)));
  app.get('/agents', (req, res) => page(res, views.agents(ctx, { origin: origin(req) })));
  app.get('/pricing', (req, res) => page(res, views.pricing(ctx, { joined: req.query.joined })));

  app.post('/waitlist', limiter, async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const plan = ['launch', 'studio'].includes(req.body?.plan) ? req.body.plan : 'launch';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) {
      return page(res, views.pricing(ctx, { error: 'That does not look like an email address.' }), 400);
    }
    res.redirect(303, `/pricing?joined=${await waitlist.join(email, plan)}`);
  });

  // ---- JSON API -----------------------------------------------------------------------

  const api = express.Router();
  api.post('/test', limiter, (req, res) => res.json(analyzePitch(corpus, req.body ?? {})));
  api.post('/compare', limiter, (req, res) => res.json(compareVariants(corpus, { ...req.body, taglines: [].concat(req.body?.taglines ?? []) })));
  api.get('/comparables', (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 500);
    if (q.trim().length < 2) return res.status(400).json({ error: 'Pass ?q= with at least two characters.' });
    const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 10));
    const vec = corpus.vectorFor({ tagline: q });
    res.json({
      query: q,
      launches: corpus.nearest(vec, { limit }).map(({ doc, sim }) => ({
        ...publicDoc(doc),
        similarity: Math.round(sim * 1000) / 1000,
        matchedOn: sharedTerms(vec, doc.vec),
      })),
    });
  });
  api.get('/trends', (req, res) =>
    res.json({
      window: { from: corpus.meta.from, to: corpus.meta.to, launches: corpus.all.length, withText: corpus.docs.length },
      medianVotes: Math.round(corpus.baseline.medianVotes),
      weekdays: corpus.weekdays,
      themes: corpus.themeStats,
      framing: corpus.patternStats,
      topLaunches: [...corpus.all].sort((a, b) => b.votes - a.votes).slice(0, 50).map(publicDoc),
    }),
  );
  api.get('/backtest', (req, res) => res.json({ ...ctx.backtest, panel: panelEval }));

  // Simulated tests. Each returns the stored result with a link to its page.
  const withUrl = (req, path, doc) => ({ ...doc, url: `${origin(req)}/${path}/${doc.id}` });
  api.post('/panel', limiter, async (req, res) => res.json(withUrl(req, 'p', await sim.panel(pitchOf(req.body), visitor(req)))));
  api.post('/buyers', limiter, async (req, res) => res.json(withUrl(req, 'b', await sim.buyers(pitchOf(req.body), visitor(req)))));
  api.post('/interview', limiter, async (req, res) => {
    const mode = req.body?.mode === 'rehearsal' ? 'rehearsal' : 'external';
    res.json(withUrl(req, 'i', await sim.startInterview({ pitch: pitchOf(req.body), facts: req.body?.facts, mode }, visitor(req))));
  });
  api.post('/interview/:id/reply', limiter, async (req, res) => {
    const session = await sim.reply(req.params.id, String(req.body?.message ?? ''), visitor(req));
    if (!session) return res.status(404).json({ error: 'No such interview, or it is a rehearsal.' });
    res.json(withUrl(req, 'i', session));
  });
  api.post('/thread', limiter, async (req, res) => {
    const mode = req.body?.mode === 'stand_in' ? 'stand_in' : 'agent';
    let thread = await sim.startThread(String(req.body?.panel_id ?? ''), { facts: req.body?.facts, mode });
    if (!thread) return res.status(404).json({ error: 'No such panel. Run /api/panel first and pass its id as panel_id.' });
    if (mode === 'stand_in') thread = await sim.answerThread(thread.id, [], visitor(req));
    res.json(withUrl(req, 't', thread));
  });
  api.post('/thread/:id/replies', limiter, async (req, res) => {
    const replies = Array.isArray(req.body?.replies) ? req.body.replies.map((r) => ({ comment: Number(r?.comment), reply: String(r?.reply ?? '') })) : [];
    const thread = await sim.answerThread(req.params.id, replies, visitor(req));
    if (!thread) return res.status(404).json({ error: 'No such thread.' });
    res.json(withUrl(req, 't', thread));
  });
  api.post('/interview/:id/next', limiter, async (req, res) => {
    const session = await sim.rehearsalTurn(req.params.id, visitor(req));
    if (!session) return res.status(404).json({ error: 'No such rehearsal.' });
    res.json(withUrl(req, 'i', session));
  });
  api.use((req, res) => res.status(404).json({ error: 'No such endpoint. See /agents for the API.' }));
  app.use('/api', api);

  // ---- MCP (stateless streamable HTTP: a fresh server per request) ---------------------

  app.post('/mcp', limiter, async (req, res) => {
    const server = createMcpServer(corpus, { sim, visitor: req.ip, origin: origin(req) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (req, res) =>
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. POST JSON-RPC to this endpoint.' }, id: null }),
  );

  // ---- machine-readable odds and ends ---------------------------------------------------

  app.get('/healthz', (req, res) => res.json({ ok: true, launches: corpus.all.length, window: [corpus.meta.from, corpus.meta.to], waitlist: waitlist.mode, simulations: sim.status.enabled ? { enabled: true, model: sim.status.model, store: sim.status.store } : { enabled: false, reason: sim.status.reason } }));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /c/\n`));
  app.get('/llms.txt', (req, res) => res.type('text/plain').send(views.llmsTxt(ctx, origin(req))));

  app.use((req, res) => page(res, views.notFound(), 404));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const config = err instanceof ModelConfigError;
    const status = config ? 503 : (err.status ?? (err.message === 'A tagline is required.' || err.message === 'Give at least one tagline.' ? 400 : 500));
    if (status >= 500 && (config || !err.status)) console.error(err);
    // Errors that carry their own status were written for the person reading them.
    const message = config ? 'Simulations are misconfigured on this deployment.' : status >= 500 && !err.status ? 'Something went wrong on our side.' : err.message;
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/mcp')) return res.status(status).json({ error: message });
    page(res, views.errorPage(message), status);
  });

  return app;
}

function pick(source, keys) {
  const out = {};
  for (const k of keys) if (typeof source?.[k] === 'string') out[k] = source[k];
  return out;
}

/** Fixed-window limiter per client address: `max` write requests a minute. */
function rateLimiter(max) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60_000).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) ?? 0) + 1;
    hits.set(req.ip, n);
    if (n > max) {
      res.set('Retry-After', '60');
      return req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/mcp')
        ? res.status(429).json({ error: 'Too many requests. Try again in a minute.' })
        : res.status(429).type('html').send(String(views.errorPage('Too many requests. Try again in a minute.')));
    }
    next();
  };
}
