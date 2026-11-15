// MCP surface. The same engine the web app uses, shaped for an agent: compact
// structured output, and tool descriptions that say what the numbers can and
// cannot support so the agent does not oversell them to its user.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { analyzePitch, backtest, compareVariants } from '../engine/analyze.js';
import { publicDoc } from '../engine/corpus.js';
import { sharedTerms } from '../engine/text.js';

const CAVEAT =
  'Based on the daily top 30 only, with end-of-day votes. Category, framing and weekday explain a small part of launch outcomes; present this as conditions and evidence, never as a prediction.';

export function createMcpServer(corpus, { version = '0.1.0' } = {}) {
  const server = new McpServer(
    { name: 'windtunnel', version },
    {
      instructions:
        `Windtunnel answers questions about launching on Product Hunt from ${corpus.all.length} real launches ` +
        `(${corpus.meta.from} to ${corpus.meta.to}). Typical loop: draft taglines, call compare_taglines, read the ` +
        `comparables, revise, then test_pitch on the winner. ${CAVEAT}`,
    },
  );
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const reply = (data, summary) => ({
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data)}` }],
    structuredContent: data,
  });

  server.registerTool(
    'test_pitch',
    {
      title: 'Test a launch pitch',
      description:
        'Report the conditions a Product Hunt pitch would launch into: how its theme and framing have performed, the ' +
        'most similar past launches and what they got, how crowded the space is, the votes needed for top five on each ' +
        'weekday, and tagline checks (60-character limit, filler words). Use before writing or finalising launch copy. ' +
        CAVEAT,
      inputSchema: {
        tagline: z.string().min(3).max(300).describe('The one-line tagline. Product Hunt allows 60 characters.'),
        name: z.string().max(80).optional().describe('Product name.'),
        description: z.string().max(2000).optional().describe('What the product does. Improves theme and comparable matching.'),
      },
      annotations: readOnly,
    },
    async (args) => {
      const r = analyzePitch(corpus, args);
      const data = {
        conditions: r.conditions,
        findings: r.findings.map((f) => `${f.title}. ${f.body}`),
        comparables: r.comparables.slice(0, 8),
        space: r.space,
        byWeekday: r.forecast.map((f) => ({
          day: f.label,
          votesForTop5: f.bar[5],
          votesForFirst: f.bar[1],
          modelVotes: f.votes,
          modelRange: [f.low, f.high],
          top5Chance: f.top5Chance,
        })),
        failedChecks: r.checks.filter((c) => !c.pass).map((c) => c.detail),
        caveat: CAVEAT,
      };
      return reply(data, `${r.conditions.label}: better conditions than ${r.conditions.percentile}% of past launches. ${r.findings[0].title}.`);
    },
  );

  server.registerTool(
    'compare_taglines',
    {
      title: 'Compare tagline variants',
      description:
        'Rank up to 8 candidate taglines for the same product by the conditions each would launch into, with the checks ' +
        'each one fails and its closest past launch. When variants land within about 10% of each other the difference ' +
        'is noise, and the verdict says so. ' +
        CAVEAT,
      inputSchema: {
        taglines: z.array(z.string().min(3).max(300)).min(1).max(8).describe('Candidate taglines.'),
        name: z.string().max(80).optional(),
        description: z.string().max(2000).optional().describe('What the product does; shared by every variant.'),
      },
      annotations: readOnly,
    },
    async (args) => {
      const data = { ...compareVariants(corpus, args), caveat: CAVEAT };
      return reply(data, data.verdict);
    },
  );

  server.registerTool(
    'find_comparables',
    {
      title: 'Find comparable launches',
      description:
        'Search past Product Hunt launches by what they do. Returns name, tagline, day-one votes, day rank, date and ' +
        'link, most similar first. Use for competitive research: who already launched this, what they said, how it went.',
      inputSchema: {
        query: z.string().min(2).max(500).describe('A product idea, category or tagline, in plain words.'),
        limit: z.number().int().min(1).max(25).optional().describe('Default 10.'),
        minVotes: z.number().int().min(0).optional().describe('Only launches with at least this many votes.'),
      },
      annotations: readOnly,
    },
    async ({ query, limit = 10, minVotes = 0 }) => {
      const vec = corpus.vectorFor({ tagline: query });
      const launches = corpus
        .nearest(vec, { limit: 80 })
        .filter((h) => h.doc.votes >= minVotes)
        .slice(0, limit)
        .map(({ doc, sim }) => ({ ...publicDoc(doc), similarity: Math.round(sim * 1000) / 1000, matchedOn: sharedTerms(vec, doc.vec) }));
      return reply({ query, launches }, `${launches.length} comparable launches for “${query}”.`);
    },
  );

  server.registerTool(
    'launch_day_bar',
    {
      title: 'Votes needed by weekday',
      description:
        'The median day-one votes it took to finish #1, #3, #5 and #10 on each weekday over the window. Optionally ' +
        'pass a vote count to see where it would have placed on each past day.',
      inputSchema: {
        votes: z.number().int().min(0).optional().describe('A vote count to place against every past board.'),
      },
      annotations: readOnly,
    },
    async ({ votes }) => {
      const days = corpus.weekdays.map((w) => {
        const row = { day: w.label, daysObserved: w.days, votesFor: w.votesFor };
        if (votes != null) {
          const boards = [...corpus.boards.values()].filter((b) => b.weekday === w.weekday);
          const ranks = boards.map((b) => 1 + b.votes.filter((v) => v > votes).length).sort((a, b) => a - b);
          row.medianRank = ranks[Math.floor(ranks.length / 2)];
          row.top5Share = Math.round((ranks.filter((r) => r <= 5).length / ranks.length) * 100) / 100;
        }
        return row;
      });
      const mon = days[0];
      return reply({ days, window: { from: corpus.meta.from, to: corpus.meta.to } }, `Top five took about ${mon.votesFor[5]} votes on a ${mon.day}.`);
    },
  );

  server.registerTool(
    'launch_trends',
    {
      title: 'What is working on Product Hunt',
      description:
        'Measured performance of themes (sales tooling, coding agents, MCP, voice, ...) and framing patterns ("the X for ' +
        'Y", "for agents", ...) over the window: how many launches, median votes with and without, a permutation-test ' +
        'p-value, and whether the theme is growing. Also the top launches and the model backtest. Entries marked ' +
        '"unclear" are not distinguishable from noise and should be reported that way.',
      inputSchema: {
        top: z.number().int().min(0).max(50).optional().describe('How many top launches to include. Default 15.'),
      },
      annotations: readOnly,
    },
    async ({ top = 15 }) => {
      const slim = (s) => ({
        label: s.label,
        launches: s.n,
        medianVotes: s.medianWith,
        medianVotesWithout: s.medianWithout,
        p: Math.round(s.p * 1000) / 1000,
        signal: s.direction,
        ...(s.momentum != null && { shareEarly: pct(s.shareEarly), shareLate: pct(s.shareLate) }),
      });
      const data = {
        window: { from: corpus.meta.from, to: corpus.meta.to, launches: corpus.all.length },
        medianVotes: Math.round(corpus.baseline.medianVotes),
        themes: corpus.themeStats.filter((t) => t.n >= 5).sort((a, b) => b.medianWith - a.medianWith).map(slim),
        framing: corpus.patternStats.filter((p) => p.n >= 5).sort((a, b) => b.medianWith - a.medianWith).map(slim),
        topLaunches: [...corpus.all].sort((a, b) => b.votes - a.votes).slice(0, top).map(publicDoc),
        backtest: backtest(corpus),
        caveat: CAVEAT,
      };
      const strong = data.themes.filter((t) => t.signal === 'tailwind').map((t) => t.label);
      return reply(data, `Themes running clearly above average: ${strong.join(', ') || 'none'}.`);
    },
  );

  return server;
}

function pct(x) {
  return `${Math.round(x * 1000) / 10}%`;
}
