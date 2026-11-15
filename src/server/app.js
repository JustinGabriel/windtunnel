// HTTP surface: server-rendered pages, a small JSON API, and the MCP endpoint.

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePitch, backtest, compareVariants } from '../engine/analyze.js';
import { loadCorpus, publicDoc } from '../engine/corpus.js';
import { sharedTerms } from '../engine/text.js';
import { createMcpServer } from '../mcp/server.js';
import { decodeShare, encodeShare } from './share.js';
import { createWaitlist } from './store.js';
import * as views from './views.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @param {{corpus?: import('../engine/corpus.js').Corpus, dataDir?: string, rateLimit?: number, waitlist?: object}} [options]
 */
export function createApp(options = {}) {
  const corpus = options.corpus ?? loadCorpus();
  const waitlist = options.waitlist ?? createWaitlist({ dir: options.dataDir ?? process.env.WINDTUNNEL_DATA ?? join(ROOT, 'var') });
  const limiter = rateLimiter(options.rateLimit ?? 40);
  // The backtest is deterministic but takes about a second, so run it on first use:
  // API and MCP calls on a cold serverless instance should not wait for it.
  let bt;
  const ctx = {
    corpus,
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
  api.get('/backtest', (req, res) => res.json(ctx.backtest));
  api.use((req, res) => res.status(404).json({ error: 'No such endpoint. See /agents for the API.' }));
  app.use('/api', api);

  // ---- MCP (stateless streamable HTTP: a fresh server per request) ---------------------

  app.post('/mcp', limiter, async (req, res) => {
    const server = createMcpServer(corpus);
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

  app.get('/healthz', (req, res) => res.json({ ok: true, launches: corpus.all.length, window: [corpus.meta.from, corpus.meta.to], waitlist: waitlist.mode }));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /c/\n`));
  app.get('/llms.txt', (req, res) => res.type('text/plain').send(views.llmsTxt(ctx, origin(req))));

  app.use((req, res) => page(res, views.notFound(), 404));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? (err.message === 'A tagline is required.' || err.message === 'Give at least one tagline.' ? 400 : 500);
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Something went wrong on our side.' : err.message;
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
