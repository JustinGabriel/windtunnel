// The wind tunnel itself: take a pitch and report the conditions it would launch
// into. Every number is derived from the corpus; nothing here is a forecast of a
// specific launch, and the report says so wherever an estimate appears.

import { publicDoc } from './corpus.js';
import { FEATURES, contentScore } from './model.js';
import { PATTERNS, THEMES, clarityChecks } from './patterns.js';
import { percentileOf, spearman } from './stats.js';
import { sharedTerms } from './text.js';

const CLOSE = 0.12; // similarity above which a launch counts as "in your space"
const TWIN = 0.45; // similarity above which a launch is nearly the same pitch

/**
 * @param {import('./corpus.js').Corpus} corpus
 * @param {{name?: string, tagline: string, description?: string}} pitch
 */
export function analyzePitch(corpus, pitch) {
  const input = {
    name: String(pitch.name ?? '').trim().slice(0, 80),
    tagline: String(pitch.tagline ?? '').trim().slice(0, 300),
    description: String(pitch.description ?? '').trim().slice(0, 2000),
  };
  if (!input.tagline) throw new Error('A tagline is required.');

  const vec = corpus.vectorFor(input);
  const hits = corpus.nearest(vec, { limit: 60 });
  const comparables = hits.slice(0, 12).map(({ doc, sim }) => ({
    ...publicDoc(doc),
    similarity: round(sim, 3),
    matchedOn: sharedTerms(vec, doc.vec),
  }));
  const space = describeSpace(corpus, hits);

  const content = corpus.featuresFor(input);
  const conditions = describeConditions(corpus, content);
  const forecast = corpus.weekdays.map((w) => {
    const f = corpus.forecast(content, w.weekday);
    return { weekday: w.weekday, label: w.label, days: w.days, bar: w.votesFor, ...f, top5Chance: round(f.top5Chance, 3) };
  });

  const patterns = corpus.patternStats.map((stat) => ({
    ...stat,
    matched: PATTERNS.find((p) => p.id === stat.id).test(input),
  }));
  const haystack = `${input.name} ${input.tagline} ${input.description}`.toLowerCase();
  const themes = corpus.themeStats.filter((t) => THEMES.find((x) => x.id === t.id).re.test(haystack));
  const checks = clarityChecks(input);

  return {
    input,
    conditions,
    forecast,
    space,
    comparables,
    patterns,
    themes,
    checks,
    findings: findings({ conditions, forecast, space, patterns, themes, checks, comparables }),
    corpus: {
      from: corpus.meta.from,
      to: corpus.meta.to,
      launches: corpus.all.length,
      withText: corpus.docs.length,
      medianVotes: Math.round(corpus.baseline.medianVotes),
    },
  };
}

/** Compare several taglines for the same product, side by side. */
export function compareVariants(corpus, { name = '', description = '', taglines }) {
  const variants = taglines
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((tagline) => {
      const r = analyzePitch(corpus, { name, tagline, description });
      return {
        tagline,
        length: tagline.length,
        multiplier: r.conditions.multiplier,
        percentile: r.conditions.percentile,
        conditions: r.conditions.label,
        drivers: r.conditions.drivers.filter((d) => d.kind === 'pattern').map((d) => ({ label: d.label, effect: d.effect })),
        checksPassed: r.checks.filter((c) => c.pass).length,
        checksTotal: r.checks.length,
        problems: r.checks.filter((c) => !c.pass).map((c) => c.detail),
        closestLaunch: r.comparables[0] ?? null,
      };
    })
    .sort((a, b) => b.multiplier - a.multiplier || b.checksPassed - a.checksPassed);
  if (!variants.length) throw new Error('Give at least one tagline.');
  const spread = variants[0].multiplier / variants.at(-1).multiplier;
  const clearest = [...variants].sort((a, b) => b.checksPassed - a.checksPassed || a.length - b.length)[0];
  return {
    name,
    variants,
    verdict:
      spread < 1.1
        ? `These read the same to the model (within ${Math.round((spread - 1) * 100)}% of each other), which is inside its noise. Pick on clarity: “${clearest.tagline}” passes ${clearest.checksPassed} of ${clearest.checksTotal} checks.`
        : `“${variants[0].tagline}” launches into the most favourable conditions (×${variants[0].multiplier} against ×${variants.at(-1).multiplier} for the weakest). The gap comes from framing the model has seen do better, not from a forecast of your launch.`,
  };
}

function describeConditions(corpus, content) {
  const { model } = corpus;
  const score = contentScore(model, content);
  const percentile = percentileOf(model.contentScores, score - 1e-9);
  const drivers = FEATURES.map((f, j) => ({ f, on: content[j] === 1, coef: model.coef[f.id] }))
    .filter((d) => d.on && Math.abs(d.coef) >= 0.02)
    .sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
    .map(({ f, coef }) => {
      const stat = (f.kind === 'theme' ? corpus.themeStats : corpus.patternStats).find((s) => s.id === f.ref);
      return {
        kind: f.kind,
        id: f.ref,
        label: f.label,
        effect: round(Math.exp(coef), 2),
        evidence: { n: stat.n, medianWith: stat.medianWith, medianWithout: stat.medianWithout, p: round(stat.p, 3), direction: stat.direction },
      };
    });
  return {
    // Product of the driver effects: 1.00 means a pitch with no measured traits.
    multiplier: round(Math.exp(score), 2),
    // Share of past launches whose own traits gave them worse conditions than this.
    percentile: Math.round(percentile * 100),
    label: percentile >= 0.8 ? 'Tailwind' : percentile >= 0.6 ? 'Light tailwind' : percentile > 0.4 ? 'Neutral' : percentile > 0.2 ? 'Light headwind' : 'Headwind',
    drivers,
    reliability: {
      crossValidatedSpearman: round(model.cv.spearman, 2),
      timeSplitSpearman: round(model.cv.timeSplitSpearman, 2),
      typicalError: `Actual votes usually land between ×${round(model.cv.residualP25, 2)} and ×${round(model.cv.residualP75, 2)} of the estimate.`,
      note: 'Category, framing and weekday explain a small part of how a launch does. Read this as the weather, not the result.',
    },
  };
}

function describeSpace(corpus, hits) {
  const close = hits.filter((h) => h.sim >= CLOSE);
  const end = Date.parse(corpus.meta.to);
  const age = (h) => (end - Date.parse(h.doc.date)) / 864e5;
  const last30 = close.filter((h) => age(h) < 30).length;
  const prev30 = close.filter((h) => age(h) >= 30 && age(h) < 60).length;
  const votes = close.map((h) => h.doc.votes).sort((a, b) => a - b);
  const twin = hits[0]?.sim >= TWIN ? hits[0] : null;
  return {
    closeLaunches: close.length,
    last30Days: last30,
    previous30Days: prev30,
    trend: last30 > prev30 * 1.3 && last30 - prev30 >= 2 ? 'heating up' : prev30 > last30 * 1.3 && prev30 - last30 >= 2 ? 'cooling' : 'steady',
    medianVotes: votes.length ? Math.round(votes[Math.floor(votes.length / 2)]) : null,
    top5Rate: close.length ? round(close.filter((h) => h.doc.rank <= 5).length / close.length, 3) : null,
    nearTwin: twin ? { ...publicDoc(twin.doc), similarity: round(twin.sim, 3) } : null,
    maxSimilarity: round(hits[0]?.sim ?? 0, 3),
  };
}

/** Plain-language takeaways, ordered by how much they should change the launch. */
function findings({ conditions, forecast, space, patterns, themes, checks, comparables }) {
  const out = [];
  const pct = (x) => `${Math.round(x * 100)}%`;

  if (space.nearTwin) {
    out.push({
      tone: 'bad',
      title: `${space.nearTwin.name} already launched with nearly this pitch`,
      body: `“${space.nearTwin.tagline}” took ${space.nearTwin.votes} votes and #${space.nearTwin.rank} on ${space.nearTwin.date}. Lead with what you do that it does not.`,
    });
  }

  const up = conditions.drivers.filter((d) => d.effect > 1);
  const down = conditions.drivers.filter((d) => d.effect < 1);
  if (conditions.drivers.length) {
    const list = (ds) => ds.slice(0, 3).map((d) => `${lowerFirst(d.label)} (×${d.effect})`).join(', ');
    out.push({
      tone: conditions.percentile >= 60 ? 'good' : conditions.percentile <= 40 ? 'bad' : 'note',
      title: `${conditions.label}: better conditions than ${conditions.percentile}% of past launches`,
      body: [up.length && `Helping: ${list(up)}.`, down.length && `Hurting: ${list(down)}.`, `Together ×${conditions.multiplier} against a pitch with none of these traits. Averages across past launches, not a forecast of yours.`]
        .filter(Boolean)
        .join(' '),
    });
  } else {
    out.push({
      tone: 'note',
      title: `${conditions.label}: nothing in this pitch moves the model`,
      body: `It does not fall into a theme or use a framing the model has a view on, which puts it ahead of ${conditions.percentile}% of past launches. Add a description so the theme can be placed.`,
    });
  }

  if (space.closeLaunches >= 3) {
    out.push({
      tone: space.trend === 'heating up' ? 'bad' : 'note',
      title: `${space.closeLaunches} similar launches in 90 days, ${space.trend}`,
      body: `${space.last30Days} in the last 30 days against ${space.previous30Days} in the 30 before. They took a median of ${space.medianVotes} votes and ${pct(space.top5Rate)} reached the top five. That is what happened to them, not a forecast for you.`,
    });
  } else if (comparables.length) {
    out.push({
      tone: 'note',
      title: 'Open space: few launches pitched like this',
      body: `Only ${space.closeLaunches} close match${space.closeLaunches === 1 ? '' : 'es'} in 90 days. Either nobody has tried it or nobody describes it this way; check the comparables to tell which.`,
    });
  } else {
    out.push({
      tone: 'note',
      title: 'No comparable launches found',
      body: 'None of the words in this pitch appear in the corpus. Describe what the product does in plainer terms.',
    });
  }

  const unused = patterns
    .filter((x) => !x.matched && x.direction === 'tailwind' && !['version', 'brand_extension', 'agent_word'].includes(x.id))
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 2);
  for (const p of unused) {
    out.push({
      tone: 'idea',
      title: `Untried: ${lowerFirst(p.label)}`,
      body: `${p.hint} Median ${p.medianWith} votes across ${p.n} launches, against ${p.medianWithout} without it. Only use it if it is true of your product.`,
    });
  }

  const rising = themes.filter((t) => t.momentum && t.momentum >= 1.3 && t.n >= 15).sort((a, b) => b.momentum - a.momentum)[0];
  if (rising) {
    out.push({
      tone: 'note',
      title: `${rising.label} is getting more crowded`,
      body: `Its share of launches went from ${pct(rising.shareEarly)} in the first half of the window to ${pct(rising.shareLate)} in the second.`,
    });
  }

  for (const c of checks.filter((x) => !x.pass)) out.push({ tone: 'bad', title: FAILED[c.id], body: c.detail });

  const byOdds = [...forecast].sort((a, b) => b.top5Chance - a.top5Chance);
  const easiest = byOdds[0];
  const hardest = byOdds.at(-1);
  out.push({
    tone: 'note',
    title: `Best odds of top five on a ${easiest.label} (${pct(easiest.top5Chance)}), worst on a ${hardest.label} (${pct(hardest.top5Chance)})`,
    body: `Top five took a median of ${easiest.bar[5]} votes on a ${easiest.label} and ${hardest.bar[5]} on a ${hardest.label}. The odds are the model's, for a launch with this profile, among launches that reach the daily top 30.`,
  });
  return out;
}

const FAILED = {
  length: 'Too long for Product Hunt’s tagline field',
  hype: 'Filler adjectives',
  specific: 'Length works against it',
  no_name: 'Repeats the product name',
};

/**
 * The honesty check. Reports how well the conditions model ranks real launches it
 * has not seen, and how badly text similarity alone does at the same job.
 */
export function backtest(corpus) {
  const { model } = corpus;
  const docs = corpus.statDocs;
  const actual = docs.map((d) => d.votes);

  // Baseline to beat: predict a launch's votes from its nearest neighbours by wording.
  const byWording = docs.map((d) => {
    const hits = corpus.nearest(d.vec, { limit: 20, exclude: (x) => x.slug === d.slug || x.name === d.name });
    const w = hits.reduce((s, h) => s + h.sim, 0);
    return w ? hits.reduce((s, h) => s + h.sim * Math.log(h.doc.votes + 1), 0) / w : Math.log(corpus.baseline.medianVotes + 1);
  });

  const rows = docs.map((d, i) => ({ pred: model.outOfFold[i], votes: d.votes, top5: d.rank <= 5 })).sort((a, b) => a.pred - b.pred);
  const quartiles = [0, 1, 2, 3].map((q) => {
    const slice = rows.slice(Math.floor((q * rows.length) / 4), Math.floor(((q + 1) * rows.length) / 4));
    const votes = slice.map((r) => r.votes).sort((a, b) => a - b);
    return {
      quartile: q + 1,
      label: ['Worst conditions', 'Below average', 'Above average', 'Best conditions'][q],
      n: slice.length,
      medianVotes: votes[Math.floor(votes.length / 2)],
      top5Rate: round(slice.filter((r) => r.top5).length / slice.length, 3),
    };
  });
  return {
    n: docs.length,
    conditionsModel: {
      crossValidatedSpearman: round(model.cv.spearman, 3),
      timeSplitSpearman: round(model.cv.timeSplitSpearman, 3),
      timeSplitTestN: model.cv.timeSplitTestN,
      residualP25: round(model.cv.residualP25, 2),
      residualP75: round(model.cv.residualP75, 2),
    },
    wordingOnly: { leaveOneOutSpearman: round(spearman(byWording, actual.map((v) => Math.log(v + 1))), 3) },
    quartiles,
    reading:
      'A Spearman of 0 is a coin flip and 1 is perfect ranking. Wording alone is close to a coin flip. Theme, framing and weekday do a little better. Most of what decides a launch (the maker’s audience, the hunter, the product itself) is not in the text.',
  };
}

/** "Open source" -> "open source", but leaves "MCP ..." and quoted labels alone. */
export function lowerFirst(label) {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

function round(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
