#!/usr/bin/env node
// Backtest of the audience panel: does it rank a real board the way real voters did?
//
// For each real day, the eight fixed visitors see that day's launches exactly as the
// product shows a board (name and tagline, shuffled per visitor) and say what they
// would open and upvote. The panel's ranking is then compared with the real one.
//
// Held-out days get three passes, all in the same order for each visitor:
//   1  the blind vote, scored against the real ranking
//   2  the identical prompt again: how much the panel disagrees with itself
//   3  the same board with pass 1's upvote counts visible: does seeing votes help?
// The effect of seeing votes is pass 3 against pass 2; its noise is pass 2 against 1.
//
//   node scripts/eval-panel.mjs --set dev                 # while tuning prompts
//   node scripts/eval-panel.mjs --set heldout --write     # once, after freezing them
//   node scripts/eval-panel.mjs --set dev --limit 3       # a cheap smoke run
//   node scripts/eval-panel.mjs --estimate                # cost estimate, no calls
//   node scripts/eval-panel.mjs --set heldout --fake      # random votes: checks the script, not the panel
//
// Needs ANTHROPIC_API_KEY. --write saves data/panel-eval.json, which the method page
// shows and a test pins to the live prompt.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadCorpus } from '../src/engine/corpus.js';
import { contentScore } from '../src/engine/model.js';
import { mean, mulberry32, quantile, spearman } from '../src/engine/stats.js';
import { blindPromptHash, blindVote, boardEntry, seedOf, shuffle, wavePromptHash, waveVote } from '../src/sim/audience.js';
import { MODEL, costOf, createFakeModel, createModel } from '../src/sim/llm.js';
import { FIXED } from '../src/sim/personas.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((p) => p.length));
const MIN_LAUNCHES = 8;
const DEV_SHARE = 1 / 3;

const corpus = loadCorpus();

// A fixed split of days, so "held out" means the same days on every run.
const days = shuffle(corpus.boardDates(MIN_LAUNCHES), 20261115);
const cut = Math.round(days.length * DEV_SHARE);
const split = { dev: days.slice(0, cut).sort(), heldout: days.slice(cut).sort() };
const sizes = corpus.boardDates(MIN_LAUNCHES).map((d) => corpus.launchesOn(d).length).sort((a, b) => a - b);

if (args.estimate) {
  const perVote = (d) => 420 + corpus.launchesOn(d).reduce((s, l) => s + (l.name.length + l.tagline.length + 8) / 3.6, 0);
  const votes = (set) => split[set].reduce((s, d) => s + FIXED.length * perVote(d), 0);
  // Held-out days are voted three times and probed once for name recognition.
  const input = { dev: votes('dev'), heldout: votes('heldout') * 3.1 + split.heldout.length * 500 };
  const calls = { dev: split.dev.length * FIXED.length, heldout: split.heldout.length * (FIXED.length * 3 + 1) };
  for (const set of ['dev', 'heldout']) {
    const usage = { input: input[set], output: calls[set] * 450 };
    console.log(`${set}: ${split[set].length} days, ${calls[set]} calls, about ${Math.round(usage.input / 1000)}K input and ${Math.round(usage.output / 1000)}K output tokens, roughly $${costOf(usage).toFixed(2)}`);
  }
  console.log('Output tokens are a guess (thinking included); the real figure is printed after a run.');
  process.exit(0);
}

const set = args.set === 'heldout' ? 'heldout' : 'dev';
const noise = mulberry32(5);
const model = args.fake
  ? createFakeModel(({ tag, user }) => {
      const n = (user.match(/^\d+\. /gm) ?? []).length;
      const some = (k) => Array.from({ length: k }, () => 1 + Math.floor(noise() * n));
      return tag === 'eval.recognise' ? { recognised: some(3) } : { opens: some(3), upvotes: some(1), why: 'random' };
    })
  : createModel({ maxRetries: 6, concurrency: 4 });
if (args.fake && args.write) {
  console.error('--fake results are random and are never written.');
  process.exit(1);
}
if (!model) {
  console.error('Set ANTHROPIC_API_KEY to run the backtest.');
  process.exit(1);
}
const chosen = args.limit ? split[set].slice(0, Number(args.limit)) : split[set];
const usage = { input: 0, output: 0, calls: 0, failed: 0 };
const track = (res) => {
  usage.calls++;
  usage.input += res.usage?.input ?? 0;
  usage.output += res.usage?.output ?? 0;
  if (!res.ok) usage.failed++;
  return res;
};

/**
 * One pass of the eight fixed visitors over a day's board: a score per launch.
 * Every pass uses the same order for a given visitor, so passes differ only in what
 * the model does, or in the counts shown when `counts` is given.
 */
async function panelScores(entries, date, counts) {
  const seed = (i) => seedOf(`${date}|order`) + i * 7919;
  const votes = await Promise.all(FIXED.map((persona, i) => (counts ? waveVote(model, persona, entries, seed(i), counts) : blindVote(model, persona, entries, seed(i))).then(track)));
  const answered = votes.filter((v) => v.ok);
  // Upvotes decide; opens only break ties, as on the product's board.
  const scores = entries.map((e) => answered.filter((v) => v.upvotes.has(e.key)).length + answered.filter((v) => v.opens.has(e.key)).length / 100);
  const upvoteCounts = new Map(entries.map((e) => [e.key, answered.filter((v) => v.upvotes.has(e.key)).length]));
  return { scores, answered: answered.length, votes, upvoteCounts };
}

const RecogniseSchema = z.object({ recognised: z.array(z.number().int()) });
async function recognised(entries) {
  const res = track(
    await model.ask({
      tag: 'eval.recognise',
      system: 'You answer questions about your own prior knowledge, precisely and without guessing.',
      user: `Which of these product names do you recognise as real products you already knew of before this conversation? List their numbers. Do not include a name merely because it sounds plausible or because you know the company's other products.\n\n${entries.map((e, i) => `${i + 1}. ${e.name}`).join('\n')}`,
      schema: RecogniseSchema,
      effort: 'low',
      maxTokens: 1500,
    }),
  );
  return res.ok ? new Set(res.data.recognised.filter((n) => n >= 1 && n <= entries.length).map((n) => entries[n - 1].key)) : null;
}

const perDay = [];
for (const date of chosen) {
  const docs = corpus.launchesOn(date);
  const entries = docs.map(boardEntry);
  const real = docs.map((d) => d.votes);
  const first = await panelScores(entries, date);
  const row = {
    date,
    n: docs.length,
    answered: first.answered,
    panel: spearman(first.scores, real),
    taglineLength: spearman(docs.map((d) => d.tagline.length), real),
    conditionsModel: spearman(docs.map((d) => contentScore(corpus.model, corpus.featuresFor({ name: d.name, tagline: d.tagline, description: d.text }))), real),
    top3: topHits(first.scores, real, 3, seedOf(date)),
  };
  if (set === 'heldout') {
    const second = await panelScores(entries, date);
    row.retest = spearman(first.scores, second.scores);
    row.second = spearman(second.scores, real);
    // Of the upvotes each visitor gave the first time, how many they gave again.
    row.upvotesFirst = 0;
    row.upvotesRepeated = 0;
    first.votes.forEach((v, i) => {
      if (!v.ok || !second.votes[i].ok) return;
      for (const key of v.upvotes) {
        row.upvotesFirst++;
        if (second.votes[i].upvotes.has(key)) row.upvotesRepeated++;
      }
    });
    const third = await panelScores(entries, date, first.upvoteCounts);
    row.withCounts = spearman(third.scores, real);
    const known = await recognised(entries);
    if (known) {
      const keep = entries.map((e, i) => (known.has(e.key) ? -1 : i)).filter((i) => i >= 0);
      row.unrecognisedN = keep.length;
      if (keep.length >= 5) row.unrecognised = spearman(keep.map((i) => first.scores[i]), keep.map((i) => real[i]));
    }
  }
  perDay.push(row);
  console.log(`${date}  n=${String(row.n).padStart(2)}  panel rho=${row.panel.toFixed(2)}  length=${row.taglineLength.toFixed(2)}  model=${row.conditionsModel.toFixed(2)}  top3=${row.top3}/3${row.retest == null ? '' : `  again=${row.second.toFixed(2)}  self-agreement=${row.retest.toFixed(2)}  with-counts=${row.withCounts.toFixed(2)}`}`);
}

const summary = summarise(perDay);
console.log(`\n${set}: ${JSON.stringify(summary, null, 2)}`);
console.log(`\n${usage.calls} calls, ${usage.failed} failed, ${usage.input} input and ${usage.output} output tokens, $${costOf(usage).toFixed(2)}`);

if (args.write) {
  if (set !== 'heldout') {
    console.error('--write is for the held-out set: publishing tuning-set figures would overstate the panel.');
    process.exit(1);
  }
  const out = {
    model: MODEL,
    promptHash: blindPromptHash(),
    wavePromptHash: wavePromptHash(),
    ranAt: new Date().toISOString(),
    design: { minLaunchesPerDay: MIN_LAUNCHES, launchesPerDay: { min: sizes[0], median: sizes[sizes.length >> 1], max: sizes.at(-1) }, visitors: FIXED.length, shown: 'name and tagline' },
    dev: { days: split.dev.length },
    heldOut: summary,
    usage: { ...usage, usd: Math.round(costOf(usage) * 100) / 100 },
  };
  writeFileSync(join(ROOT, 'data/panel-eval.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('Wrote data/panel-eval.json');
}

function summarise(rows) {
  const rho = rows.map((r) => r.panel);
  const r2 = (x) => Math.round(x * 100) / 100;
  /** 95% bootstrap interval for a mean over days. */
  const interval = (values, seed) => {
    const rand = mulberry32(seed);
    const means = Array.from({ length: 2000 }, () => mean(values.map(() => values[Math.floor(rand() * values.length)]))).sort((a, b) => a - b);
    return [r2(quantile(means, 0.025)), r2(quantile(means, 0.975))];
  };
  const have = (key) => rows.filter((r) => r[key] != null);
  const out = {
    days: rows.length,
    launches: rows.reduce((s, r) => s + r.n, 0),
    visitorsAnswered: r2(mean(rows.map((r) => r.answered / FIXED.length))),
    meanSpearman: r2(mean(rho)),
    ci: interval(rho, 99),
    top3: { hit: r2(mean(rows.map((r) => r.top3 / 3))), chance: r2(mean(rows.map((r) => 3 / r.n))) },
    baselines: { taglineLength: r2(mean(rows.map((r) => r.taglineLength))), conditionsModel: r2(mean(rows.map((r) => r.conditionsModel))) },
  };
  if (have('retest').length) {
    const again = have('retest');
    out.retest = r2(mean(again.map((r) => r.retest)));
    const first = again.reduce((s, r) => s + r.upvotesFirst, 0);
    out.upvotesRepeated = first ? r2(again.reduce((s, r) => s + r.upvotesRepeated, 0) / first) : null;
    const effect = again.map((r) => r.withCounts - r.second);
    const noise = again.map((r) => r.second - r.panel);
    out.withCounts = {
      meanSpearman: r2(mean(again.map((r) => r.withCounts))),
      withoutCounts: r2(mean(again.map((r) => r.second))),
      difference: r2(mean(effect)),
      differenceCi: interval(effect, 7),
      // The same subtraction between two passes that saw no counts: what chance alone gives.
      noise: r2(mean(noise)),
      noiseCi: interval(noise, 8),
    };
  }
  if (have('unrecognised').length) {
    out.unrecognised = { days: have('unrecognised').length, launches: have('unrecognised').reduce((s, r) => s + r.unrecognisedN, 0), meanSpearman: r2(mean(have('unrecognised').map((r) => r.unrecognised))) };
  }
  return out;
}

/** How many of the panel's top k are in the real top k. Panel ties are broken at random. */
function topHits(scores, real, k, seed) {
  const rand = mulberry32(seed);
  const jitter = scores.map(() => rand());
  const top = (values, tie) => values.map((v, i) => [v, tie ? tie[i] : 0, i]).sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, k).map((x) => x[2]);
  const truth = new Set(top(real));
  return top(scores, jitter).filter((i) => truth.has(i)).length;
}
