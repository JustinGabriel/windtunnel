// The synthetic audience panel. A pitch is placed on a real past board, among the
// launches that actually competed that day, and each simulated visitor decides what
// to open and upvote without being told which entry is under test. A second call
// then asks each visitor about the launch page itself.
//
// Everything this module returns is simulated. Whether it tracks real behaviour is
// what scripts/eval-panel.mjs measures.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { analyzePitch } from '../engine/analyze.js';
import { launchUrl } from '../server/html.js';
import { mulberry32 } from '../engine/stats.js';
import { costOf, totalUsage } from './llm.js';
import { FIXED, buildPanel } from './personas.js';

export const PANEL_ESTIMATE_USD = 0.06;
const BOARD_SIZE = 11; // real launches shown beside the pitch
const TAGLINE_CAP = 90;

export const BLIND_SYSTEM = `You are role-playing one visitor to Product Hunt's daily leaderboard, to help a maker test a launch. Stay in character as the person described.

Behave as that person really would on an ordinary day, not as a helpful reviewer. Real visitors skim. They open only the few launches that are relevant to them and upvote fewer than they open. Opening nothing is normal.

You know only what the board shows: a name and a tagline. Do not assume features that are not stated.`;

const blindUser = (persona, entries) => `Who you are: ${persona.brief}

Today's board, in the order you happen to see it:
${entries.map((e, i) => `${i + 1}. ${e.name} — ${e.tagline}`).join('\n')}

Which launches would you open to read more, and which of those would you upvote? Answer with their numbers. Then give one sentence on what drove your choices.`;

const BlindSchema = z.object({
  opens: z.array(z.number().int()),
  upvotes: z.array(z.number().int()),
  why: z.string(),
});

const PAGE_SYSTEM = `You are role-playing one visitor to Product Hunt, to help a maker test a launch page. Stay in character as the person described.

Be candid. Say what this person would really think, including indifference or confusion. Judge only what the page says; do not fill gaps with assumptions.`;

const pageUser = (persona, pitch) => `Who you are: ${persona.brief}

You opened this launch page:
Name: ${pitch.name || '(not given)'}
Tagline: ${pitch.tagline}
${pitch.description ? `Description: ${pitch.description}` : 'There is no description, only the tagline.'}

1. In one sentence and in your own words, what do you think this product does?
2. Would you try it: yes, maybe or no?
3. Your main hesitation or objection, in one sentence.
4. The one question you would ask the maker in the comments.`;

const PageSchema = z.object({
  restatement: z.string(),
  would_try: z.enum(['yes', 'maybe', 'no']),
  objection: z.string(),
  question: z.string(),
});

const SYNTH_SYSTEM = `You are analysing answers from a simulated audience panel for a product launch. Be literal. Do not add opinions of your own.`;

const SynthSchema = z.object({
  comprehension: z.array(z.object({ respondent: z.number().int(), verdict: z.enum(['right', 'partly', 'wrong']) })),
  objection_themes: z.array(z.object({ label: z.string(), respondents: z.array(z.number().int()) })),
});

/** Changes whenever the blind-vote prompt or the fixed personas change. */
export function blindPromptHash() {
  const sample = blindUser({ brief: '{brief}' }, [{ name: '{name}', tagline: '{tagline}' }]);
  return createHash('sha256').update(JSON.stringify([BLIND_SYSTEM, sample, FIXED])).digest('hex').slice(0, 16);
}

/**
 * One visitor's blind pass over a board. Shared by the product and the backtest, so
 * what is evaluated is exactly what runs.
 * @returns {{ok: true, opens: Set<string>, upvotes: Set<string>, why: string} | {ok: false, reason: string}} keyed by entry.key
 */
export async function blindVote(model, persona, entries, seed) {
  const order = shuffle(entries, seed);
  const res = await model.ask({ tag: 'panel.blind', system: BLIND_SYSTEM, user: blindUser(persona, order), schema: BlindSchema, effort: 'low', maxTokens: 1500 });
  if (!res.ok) return { ok: false, reason: res.reason, usage: res.usage };
  const keys = (numbers, cap) =>
    [...new Set(numbers)]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= order.length)
      .slice(0, cap)
      .map((n) => order[n - 1].key);
  const upvotes = new Set(keys(res.data.upvotes, 4));
  // An upvote implies an open, whatever the model listed.
  const opens = new Set([...keys(res.data.opens, 6), ...upvotes]);
  return { ok: true, opens, upvotes, why: clip(res.data.why, 240), usage: res.usage };
}

/** A real past board to stand the pitch on: a weekday with enough launches, chosen by the seed. */
export function pickBoard(corpus, { seed = 1, date, exclude } = {}) {
  const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const dates = date ? [date] : corpus.boardDates(10).filter((d) => weekday(d) >= 1 && weekday(d) <= 4);
  if (!dates.length) throw new Error('No board with enough launches is available.');
  const chosen = dates[Math.floor(mulberry32(seed)() * dates.length)];
  const entries = corpus
    .launchesOn(chosen)
    .filter((d) => !exclude?.(d))
    .slice(0, BOARD_SIZE)
    .map(boardEntry);
  return { date: chosen, entries };
}

/** How a real launch appears on a board: name and tagline, nothing that hints at how it did. */
export function boardEntry(d) {
  return { key: d.id, name: d.name, tagline: clipWords(d.tagline, TAGLINE_CAP), url: d.url, realVotes: d.votes, realRank: d.rank };
}

/**
 * @param {{corpus: object, model: object, pitch: {name?: string, tagline: string, description?: string}, boardDate?: string}} args
 */
export async function runPanel({ corpus, model, pitch, boardDate }) {
  const report = analyzePitch(corpus, pitch);
  const input = report.input;
  const seed = seedOf(`${input.name}|${input.tagline}`);
  const sameName = (d) => input.name && d.name.toLowerCase() === input.name.toLowerCase();
  const board = pickBoard(corpus, { seed, date: boardDate, exclude: sameName });
  const you = { key: 'you', name: input.name || 'Your launch', tagline: clipWords(input.tagline, TAGLINE_CAP), isYou: true };
  const entries = [...board.entries, you];
  const panel = buildPanel(report.themes.map((t) => t.id));

  const results = await Promise.all(
    panel.map(async (persona, i) => {
      const [blind, page] = await Promise.all([
        blindVote(model, persona, entries, seed + i * 7919),
        model.ask({ tag: 'panel.page', system: PAGE_SYSTEM, user: pageUser(persona, input), schema: PageSchema, effort: 'low', maxTokens: 1500 }),
      ]);
      return { persona, blind, page };
    }),
  );
  const calls = results.flatMap((r) => [r.blind, r.page]);

  const respondents = results.map(({ persona, blind, page }) => ({
    id: persona.id,
    label: persona.label,
    group: persona.group,
    answeredBoard: blind.ok,
    opened: blind.ok ? blind.opens.has('you') : null,
    upvoted: blind.ok ? blind.upvotes.has('you') : null,
    why: blind.ok ? blind.why : null,
    answeredPage: page.ok,
    restatement: page.ok ? clip(page.data.restatement, 240) : null,
    wouldTry: page.ok ? page.data.would_try : null,
    objection: page.ok ? clip(page.data.objection, 240) : null,
    question: page.ok ? clip(page.data.question, 240) : null,
    verdict: null,
  }));

  // One more call reads the answers: does each restatement match what the maker says
  // the product does, and what do the objections have in common?
  const answered = respondents.map((r, i) => ({ r, n: i + 1 })).filter(({ r }) => r.answeredPage);
  let themes = [];
  if (answered.length >= 3) {
    const synth = await model.ask({
      tag: 'panel.synth',
      system: SYNTH_SYSTEM,
      user: `What the maker says the product does:
${input.description || `(No description given. Judge against the tagline: "${input.tagline}")`}

Panel answers:
${answered.map(({ r, n }) => `${n}. Thinks it is: ${r.restatement}\n   Objection: ${r.objection}`).join('\n')}

A. For each respondent, does their idea of the product match what the maker says? "right" if it does, "partly" if it captures some of it or is too vague, "wrong" if they have misunderstood.
B. Group the objections into two to five themes. Give each a label of at most six words and list the respondent numbers that raised it. A respondent may appear under one theme only.`,
      schema: SynthSchema,
      effort: 'medium',
      maxTokens: 3000,
    });
    calls.push(synth);
    if (synth.ok) {
      for (const c of synth.data.comprehension) {
        const hit = respondents[c.respondent - 1];
        if (hit?.answeredPage) hit.verdict = c.verdict;
      }
      const claimed = new Set();
      themes = synth.data.objection_themes
        .map((t) => ({
          label: clip(t.label, 60),
          respondents: [...new Set(t.respondents)].filter((n) => respondents[n - 1]?.answeredPage && !claimed.has(n) && claimed.add(n)),
        }))
        .filter((t) => t.respondents.length)
        .map((t) => ({ label: t.label, count: t.respondents.length, who: t.respondents.map((n) => respondents[n - 1].label) }))
        .sort((a, b) => b.count - a.count);
    }
  }

  // Board standing uses the fixed eight only: they are the respondents the backtest covers.
  const fixed = results.filter((r) => r.persona.group === 'fixed' && r.blind.ok);
  const standing = entries
    .map((e) => ({
      name: e.name,
      tagline: e.tagline,
      url: launchUrl(e.url),
      isYou: Boolean(e.isYou),
      realVotes: e.realVotes ?? null,
      realRank: e.realRank ?? null,
      panelOpens: fixed.filter((r) => r.blind.opens.has(e.key)).length,
      panelUpvotes: fixed.filter((r) => r.blind.upvotes.has(e.key)).length,
    }))
    .sort((a, b) => b.panelUpvotes - a.panelUpvotes || b.panelOpens - a.panelOpens || (b.realVotes ?? 0) - (a.realVotes ?? 0));
  const mine = standing.find((e) => e.isYou);
  const place = 1 + standing.filter((e) => e.panelUpvotes > mine.panelUpvotes || (e.panelUpvotes === mine.panelUpvotes && e.panelOpens > mine.panelOpens)).length;

  const boardAnswers = respondents.filter((r) => r.answeredBoard);
  const pageAnswers = respondents.filter((r) => r.answeredPage);
  const judged = pageAnswers.filter((r) => r.verdict);
  const usage = totalUsage(calls);
  return {
    kind: 'panel',
    input,
    board: { date: board.date, standing, place, of: standing.length, fixedAnswered: fixed.length },
    respondents,
    tallies: {
      panelSize: respondents.length,
      answeredBoard: boardAnswers.length,
      opened: boardAnswers.filter((r) => r.opened).length,
      upvoted: boardAnswers.filter((r) => r.upvoted).length,
      answeredPage: pageAnswers.length,
      wouldTry: { yes: pageAnswers.filter((r) => r.wouldTry === 'yes').length, maybe: pageAnswers.filter((r) => r.wouldTry === 'maybe').length, no: pageAnswers.filter((r) => r.wouldTry === 'no').length },
      judged: judged.length,
      understood: judged.filter((r) => r.verdict === 'right').length,
      partly: judged.filter((r) => r.verdict === 'partly').length,
      misread: judged.filter((r) => r.verdict === 'wrong').length,
    },
    themes,
    questions: pageAnswers.map((r) => ({ who: r.label, question: r.question })),
    model: model.name,
    usage: { ...usage, usd: round(costOf(usage), 4) },
    createdAt: new Date().toISOString(),
  };
}

export function seedOf(text) {
  return createHash('sha256').update(text).digest().readUInt32BE(0);
}

export function shuffle(items, seed) {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function clip(text, max) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** Cut at a word boundary with no ellipsis, so board entries all read as taglines. */
function clipWords(text, max) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, '');
}

function round(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
