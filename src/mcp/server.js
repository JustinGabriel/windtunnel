// MCP surface. The same engine the web app uses, shaped for an agent: compact
// structured output, and tool descriptions that say what the numbers can and
// cannot support so the agent does not oversell them to its user.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { analyzePitch, backtest, compareVariants } from '../engine/analyze.js';
import { publicDoc } from '../engine/corpus.js';
import { sharedTerms } from '../engine/text.js';
import { MAX_TURNS } from '../sim/interview.js';
import { ModelConfigError } from '../sim/llm.js';

const CAVEAT =
  'Based on the daily top 30 only, with end-of-day votes. Category, framing and weekday explain a small part of launch outcomes; present this as conditions and evidence, never as a prediction.';

const SIMULATED =
  'SIMULATED: produced by an AI model playing a role, not by real people or real buyers. Useful for finding what is unclear and what will be asked; not a forecast. Report counts as given ("7 of 12") and always say the result is simulated.';

/**
 * @param {object} corpus
 * @param {{version?: string, sim?: object, visitor?: string, origin?: string}} [options]
 *   sim adds the simulated tests when it is enabled; visitor keys the spend limits.
 */
export function createMcpServer(corpus, { version = '0.2.0', sim, visitor = 'mcp', origin = '' } = {}) {
  const server = new McpServer(
    { name: 'windtunnel', version },
    {
      instructions:
        `Windtunnel answers questions about launching on Product Hunt from ${corpus.all.length} real launches ` +
        `(${corpus.meta.from} to ${corpus.meta.to}). Typical loop: draft taglines, call compare_taglines, read the ` +
        `comparables, revise, then test_pitch on the winner. ${CAVEAT}` +
        (sim?.status.enabled
          ? ` It can also run simulated tests: run_audience_panel, run_buyer_agents, and an interview in which you answer a ` +
            `simulated buyer's agent (start_agent_interview, then reply_to_buyer until it finishes). ${SIMULATED}`
          : ''),
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

  if (sim?.status.enabled) registerSimTools(server, { sim, visitor, origin, reply });
  return server;
}

function registerSimTools(server, { sim, visitor, origin, reply }) {
  const metered = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const who = { visitor };
  const link = (path, id) => (origin ? `${origin}/${path}/${id}` : null);
  const pitchShape = {
    tagline: z.string().min(3).max(300).describe('The one-line tagline.'),
    name: z.string().max(80).optional().describe('Product name.'),
    description: z.string().max(2000).optional().describe('What the product does, as on the launch page.'),
  };
  // Limits, availability and bad input come back as tool errors the agent can read.
  const guarded = (fn) => async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof ModelConfigError) return { isError: true, content: [{ type: 'text', text: 'Simulations are misconfigured on this server.' }] };
      if (err.status || err.message === 'A tagline is required.') return { isError: true, content: [{ type: 'text', text: err.message }] };
      throw err;
    }
  };

  server.registerTool(
    'run_audience_panel',
    {
      title: 'Run the simulated audience panel',
      description:
        'Put a launch in front of twelve simulated Product Hunt visitors on a real past board, without telling them which ' +
        'entry is under test, then ask each about the launch page. Returns how many opened and upvoted it, where it placed ' +
        'on that board, whether each understood what the product is, grouped objections, and the questions they would ask. ' +
        'Takes about 20 seconds and counts against a daily run limit. ' +
        SIMULATED,
      inputSchema: pitchShape,
      annotations: metered,
    },
    guarded(async (args) => {
      const r = await sim.panel(args, who);
      const t = r.tallies;
      const data = {
        simulated: true,
        tallies: t,
        board: { date: r.board.date, yourPlace: r.board.place, of: r.board.of, basis: `${r.board.fixedAnswered} regular visitors` },
        objections: r.themes,
        respondents: r.respondents.map((p) => ({ who: p.label, group: p.group, opened: p.opened, upvoted: p.upvoted, wouldTry: p.wouldTry, thinksItIs: p.restatement, understood: p.verdict, objection: p.objection, wouldAsk: p.question })),
        url: link('p', r.id),
        caveat: SIMULATED,
      };
      return reply(data, `Simulated panel: ${t.opened} of ${t.answeredBoard} opened it, ${t.upvoted} upvoted it, ${t.understood} of ${t.judged} understood what it is.`);
    }),
  );

  server.registerTool(
    'run_buyer_agents',
    {
      title: 'Run the simulated buyer-agent selection test',
      description:
        'Twelve simulated purchasing agents (four client briefs, three dispositions) each choose from a catalogue of this ' +
        'product and its closest real Product Hunt launches, all rewritten into the same neutral form. Returns how often ' +
        'the product was picked and shortlisted, who won instead, why agents passed on it, and what information they could ' +
        'not find. Takes about 20 seconds and counts against a daily run limit. ' +
        SIMULATED,
      inputSchema: pitchShape,
      annotations: metered,
    },
    guarded(async (args) => {
      const r = await sim.buyers(args, who);
      const data = {
        simulated: true,
        tallies: r.tallies,
        howAgentsSawYou: r.yourSummary,
        standing: r.standing.map((e) => ({ name: e.name, isYou: e.isYou, picked: e.picked, shortlisted: e.shortlisted, realVotes: e.realVotes })),
        whyAgentsPassed: r.whyNot,
        missingInformation: r.gaps,
        url: link('b', r.id),
        caveat: SIMULATED,
      };
      return reply(data, `Simulated buyer agents picked it in ${r.tallies.picked} of ${r.tallies.answered} runs and shortlisted it in ${r.tallies.shortlisted}.`);
    }),
  );

  const turn = (s) => {
    const answers = s.transcript.filter((m) => m.role === 'seller').length;
    return s.status === 'done'
      ? { simulated: true, interview_id: s.id, finished: true, closing_message: s.transcript.at(-1).role === 'buyer' ? s.transcript.at(-1).text : null, scorecard: s.scorecard, url: link('i', s.id), caveat: SIMULATED }
      : { simulated: true, interview_id: s.id, finished: false, buyer_message: s.transcript.at(-1).text, turns_left: MAX_TURNS - answers, url: link('i', s.id) };
  };

  server.registerTool(
    'start_agent_interview',
    {
      title: 'Start an interview with a simulated buyer agent',
      description:
        'Begin an interview in which YOU answer as the vendor\'s agent and a simulated purchasing agent asks the questions ' +
        `(at most ${MAX_TURNS}). Returns the buyer's client brief, its first question and an interview_id. Answer each ` +
        'buyer message by calling reply_to_buyer; when the interview finishes you get a scorecard: how each answer was ' +
        'handled, any claim the facts sheet does not support, and whether the buyer would shortlist the product. Pass a ' +
        'facts sheet if you want claims checked against it. ' +
        SIMULATED,
      inputSchema: { ...pitchShape, facts: z.string().max(4000).optional().describe('Ground truth about the product (pricing, integrations, limits, data handling). Vendor claims are checked against it.') },
      annotations: metered,
    },
    guarded(async ({ facts, ...pitch }) => {
      const s = await sim.startInterview({ pitch, facts, mode: 'external' }, who);
      return reply({ ...turn(s), client: s.client }, `The buyer's agent asks: ${s.transcript.at(-1).text}`);
    }),
  );

  server.registerTool(
    'reply_to_buyer',
    {
      title: 'Answer the simulated buyer agent',
      description:
        'Send the vendor agent\'s answer to the buyer\'s last message in an interview started with start_agent_interview. ' +
        'Returns the buyer\'s next message, or the scorecard when the interview is finished.',
      inputSchema: {
        interview_id: z.string().min(8).max(32).describe('From start_agent_interview.'),
        message: z.string().min(1).max(1200).describe('The vendor agent\'s answer.'),
      },
      annotations: metered,
    },
    guarded(async ({ interview_id, message }) => {
      const s = await sim.reply(interview_id, message, who);
      if (!s) return { isError: true, content: [{ type: 'text', text: 'No interview with that id is open. Start one with start_agent_interview.' }] };
      const data = turn(s);
      return reply(data, data.finished ? `Interview finished. The buyer ${{ yes: 'would', maybe: 'might', no: 'would not' }[s.scorecard.wouldShortlist]} shortlist the product. ${s.scorecard.verdict}` : `The buyer's agent asks: ${data.buyer_message}`);
    }),
  );
}

function pct(x) {
  return `${Math.round(x * 1000) / 10}%`;
}
