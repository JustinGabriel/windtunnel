// Buyer-agent selection test. Simulated purchasing agents are given a client brief
// and a catalogue containing the pitch and the real launches closest to it, and
// must recommend one. Nothing tells them which entry is under test.
//
// Two things keep the comparison fair. Every entry, the pitch included, is first
// rewritten into the same neutral one-sentence form, so maker copy does not stand
// out from third-party summaries. And the client briefs are written from the
// catalogue as a whole, not from the pitch, so they are not tailored to it.

import { z } from 'zod';
import { analyzePitch } from '../engine/analyze.js';
import { launchUrl } from '../server/html.js';
import { clip, seedOf, shuffle } from './audience.js';
import { costOf, totalUsage } from './llm.js';

export const BUYERS_ESTIMATE_USD = 0.05;
const COMPETITORS = 7;

export const DISPOSITIONS = [
  { id: 'cost', label: 'Cost-first', brief: 'Your client is price-sensitive. Prefer the option most likely to be affordable and quick to adopt, and be wary of anything that sounds like an enterprise contract.' },
  { id: 'risk', label: 'Risk-averse', brief: 'Your client cannot afford a failed rollout. Prefer the option with the clearest scope and the least that could go wrong, and penalise vague or sweeping claims.' },
  { id: 'capability', label: 'Capability-first', brief: 'Your client wants the strongest fit for the job, whatever the effort. Prefer the option whose description most directly covers the stated need.' },
];

export const MISSING = ['pricing', 'integrations', 'security_and_data', 'proof_and_customers', 'limits_and_scale', 'setup_effort', 'support', 'other'];

const PREP_SYSTEM = `You prepare material for a test in which purchasing agents choose between software products. Be neutral and literal. Never add a fact that is not in the source text.`;

const PrepSchema = z.object({
  entries: z.array(z.object({ number: z.number().int(), summary: z.string() })),
  briefs: z.array(z.object({ buyer: z.string(), need: z.string(), constraint: z.string() })),
});

const BUYER_SYSTEM = `You are a research agent acting for a client who needs a software tool. You have a catalogue of candidates and must recommend from it.

Decide only from what the catalogue says. Where it does not state something you need to know, treat that as unknown rather than assuming it. You must still recommend the best available option.`;

const BuyerSchema = z.object({
  pick: z.number().int(),
  alternates: z.array(z.number().int()),
  reason: z.string(),
  passed_over: z.array(z.object({ entry: z.number().int(), reason: z.string() })),
  missing: z.array(z.object({ category: z.enum(MISSING), detail: z.string() })),
});

/**
 * @param {{corpus: object, model: object, pitch: {name?: string, tagline: string, description?: string}}} args
 */
export async function runBuyers({ corpus, model, pitch }) {
  const report = analyzePitch(corpus, pitch);
  const input = report.input;
  const seed = seedOf(`buyers|${input.name}|${input.tagline}`);
  const you = { key: 'you', name: input.name || 'Your product', tagline: input.tagline, source: input.description || input.tagline, isYou: true };
  const rivals = corpus
    .nearest(corpus.vectorFor(input), { limit: 30 })
    .filter((h) => h.doc.taglineKind === 'digest' && h.doc.name.toLowerCase() !== you.name.toLowerCase())
    .slice(0, COMPETITORS)
    .map(({ doc }) => ({ key: doc.id, name: doc.name, tagline: doc.tagline, source: doc.text, url: doc.url, realVotes: doc.votes, realRank: doc.rank, date: doc.date }));
  if (rivals.length < 2) {
    throw Object.assign(new Error('Too few comparable launches to build a catalogue. Add a description so competitors can be found.'), { status: 422 });
  }
  const catalogue = shuffle([...rivals, you], seed);
  const calls = [];

  const prep = await model.ask({
    tag: 'buyers.prep',
    system: PREP_SYSTEM,
    user: `Products:
${catalogue.map((e, i) => `${i + 1}. ${e.name}\n   Tagline: ${e.tagline}\n   Source text: ${clip(e.source, 600)}`).join('\n')}

A. For each product, write ONE neutral sentence of at most 30 words saying what it does and for whom. Remove praise, superlatives and marketing language. Use only what the source text states.
B. Write four different client briefs for which products of this kind could be considered. Each has a buyer (who the client is), a need (what they are trying to get done) and a constraint (one firm requirement or limit). Base them on the group as a whole, do not tailor them to any one product, and never name a product.`,
    schema: PrepSchema,
    effort: 'medium',
    maxTokens: 4000,
  });
  calls.push(prep);
  if (!prep.ok) throw Object.assign(new Error(`The catalogue could not be prepared (${prep.reason}). Try again.`), { status: 503 });
  for (const e of prep.data.entries) {
    const hit = catalogue[e.number - 1];
    if (hit) hit.summary = clip(e.summary, 260);
  }
  for (const e of catalogue) e.summary ??= clip(e.tagline, 260);
  const briefs = prep.data.briefs.slice(0, 4).map((b) => ({ buyer: clip(b.buyer, 160), need: clip(b.need, 220), constraint: clip(b.constraint, 180) }));
  if (!briefs.length) throw Object.assign(new Error('No client briefs were produced. Try again.'), { status: 503 });

  const jobs = briefs.flatMap((brief, b) => DISPOSITIONS.map((disposition, d) => ({ brief, disposition, n: b * DISPOSITIONS.length + d })));
  const runs = await Promise.all(
    jobs.map(async ({ brief, disposition, n }) => {
      const order = shuffle(catalogue, seed + 1 + n * 104729);
      const res = await model.ask({
        tag: 'buyers.run',
        system: BUYER_SYSTEM,
        user: `Client: ${brief.buyer}
Need: ${brief.need}
Firm requirement: ${brief.constraint}
How to weigh options: ${disposition.brief}

Catalogue:
${order.map((e, i) => `${i + 1}. ${e.name} — ${e.tagline}\n   ${e.summary}`).join('\n')}

Give: your pick (its number); up to two alternates (numbers); one sentence on why you picked it; for each entry you did not shortlist, a reason of at most twelve words; and up to three pieces of information the catalogue lacked that you most needed, each with a category and a short detail.`,
        schema: BuyerSchema,
        effort: 'low',
        maxTokens: 2500,
      });
      calls.push(res);
      if (!res.ok) return { brief, disposition, ok: false, reason: res.reason };
      const at = (n2) => (Number.isInteger(n2) && n2 >= 1 && n2 <= order.length ? order[n2 - 1] : null);
      const pick = at(res.data.pick);
      if (!pick) return { brief, disposition, ok: false, reason: 'unparseable' };
      const alternates = [...new Set(res.data.alternates.map(at).filter((e) => e && e !== pick))].slice(0, 2);
      const whyNotYou = res.data.passed_over.find((p) => at(p.entry)?.isYou)?.reason;
      return {
        brief,
        disposition,
        ok: true,
        pick,
        alternates,
        reason: clip(res.data.reason, 240),
        whyNotYou: whyNotYou ? clip(whyNotYou, 160) : null,
        missing: res.data.missing.slice(0, 3).map((m) => ({ category: m.category, detail: clip(m.detail, 140) })),
      };
    }),
  );

  const answered = runs.filter((r) => r.ok);
  const standing = catalogue
    .map((e) => ({
      name: e.name,
      tagline: e.tagline,
      summary: e.summary,
      url: launchUrl(e.url),
      isYou: Boolean(e.isYou),
      realVotes: e.realVotes ?? null,
      realRank: e.realRank ?? null,
      date: e.date ?? null,
      picked: answered.filter((r) => r.pick === e).length,
      shortlisted: answered.filter((r) => r.pick === e || r.alternates.includes(e)).length,
    }))
    .sort((a, b) => b.picked - a.picked || b.shortlisted - a.shortlisted);
  const mine = standing.find((e) => e.isYou);

  const gaps = new Map();
  for (const r of answered) {
    for (const m of r.missing) {
      if (!gaps.has(m.category)) gaps.set(m.category, { category: m.category, count: 0, examples: [] });
      const g = gaps.get(m.category);
      g.count++;
      if (g.examples.length < 3 && !g.examples.includes(m.detail)) g.examples.push(m.detail);
    }
  }

  const usage = totalUsage(calls);
  return {
    kind: 'buyers',
    input,
    yourSummary: catalogue.find((e) => e.isYou).summary,
    briefs,
    standing,
    tallies: { runs: runs.length, answered: answered.length, picked: mine.picked, shortlisted: mine.shortlisted },
    runs: runs.map((r) => ({
      buyer: r.brief.buyer,
      need: r.brief.need,
      disposition: r.disposition.label,
      ok: r.ok,
      pick: r.ok ? r.pick.name : null,
      pickedYou: r.ok ? Boolean(r.pick.isYou) : null,
      shortlistedYou: r.ok ? Boolean(r.pick.isYou) || r.alternates.some((e) => e.isYou) : null,
      reason: r.ok ? r.reason : null,
      whyNotYou: r.ok ? r.whyNotYou : null,
    })),
    whyNot: [...new Set(answered.filter((r) => !r.pick.isYou && r.whyNotYou).map((r) => r.whyNotYou))].slice(0, 8),
    gaps: [...gaps.values()].sort((a, b) => b.count - a.count),
    model: model.name,
    usage: { ...usage, usd: Math.round(costOf(usage) * 1e4) / 1e4 },
    createdAt: new Date().toISOString(),
  };
}
