// Loads the launch dataset and precomputes everything the analyses read from:
// the TF-IDF index, measured pattern/theme lifts and weekday leaderboards.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentFeatures, fitModel, predictLog } from './model.js';
import { PATTERNS, THEMES } from './patterns.js';
import { median, percentileOf, permutationP, quantile } from './stats.js';
import { buildIdf, cosine, termCounts, vectorize } from './text.js';

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../data/launches.json');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TOP = 5;

/** A group needs at least this many launches before we call its lift a signal. */
const MIN_GROUP = 15;

export function loadCorpus(path = DATA_PATH) {
  return new Corpus(JSON.parse(readFileSync(path, 'utf8')));
}

export class Corpus {
  constructor({ meta, launches }) {
    this.meta = meta;
    this.all = launches;
    this.docs = launches.filter((l) => l.tagline);

    const counts = this.docs.map((d) => fieldCounts(d.name, d.tagline, d.text));
    this.idf = buildIdf(counts);
    this.docs.forEach((d, i) => {
      d.vec = vectorize(counts[i], this.idf);
      d.haystack = `${d.name} ${d.text}`.toLowerCase();
    });

    // Statistics use only launches whose text came from the English digest. The
    // back-translated ones were hand-picked because they ranked high, so including
    // them would inflate whatever they happen to have in common.
    this.statDocs = this.docs.filter((d) => d.taglineKind === 'digest');
    const votes = this.statDocs.map((d) => d.votes);
    this.votesSorted = [...votes].sort((a, b) => a - b);
    this.baseline = {
      n: this.statDocs.length,
      medianVotes: median(votes),
      p25: quantile(this.votesSorted, 0.25),
      p75: quantile(this.votesSorted, 0.75),
      top5Rate: this.statDocs.filter((d) => d.rank <= TOP).length / this.statDocs.length,
    };

    this.boards = new Map();
    for (const l of this.all) {
      if (!this.boards.has(l.date)) this.boards.set(l.date, { date: l.date, weekday: l.weekday, votes: [] });
      this.boards.get(l.date).votes.push(l.votes);
    }
    for (const b of this.boards.values()) b.votes.sort((a, b2) => b2 - a);

    this.patternStats = PATTERNS.map((p) => ({
      id: p.id,
      label: p.label,
      hint: p.hint,
      ...this.#lift(this.statDocs.map((d) => p.test({ name: d.name, tagline: d.tagline }))),
    }));
    this.themeStats = THEMES.map((t) => {
      const member = this.statDocs.map((d) => t.re.test(d.haystack));
      return { id: t.id, label: t.label, ...this.#lift(member), ...this.#momentum(member) };
    });
    this.weekdays = this.#weekdayStats();
    this.model = fitModel(this.statDocs);
  }

  /** Theme and framing indicators for a pitch that is not in the corpus. */
  featuresFor({ name = '', tagline = '', description = '' }) {
    return contentFeatures({ name, tagline, haystack: `${name} ${tagline} ${description}`.toLowerCase() });
  }

  /**
   * Model estimate for one weekday: expected votes, and the chance of a top-five
   * finish found by replaying the model's own out-of-fold errors against every past
   * board for that weekday. Conditional on reaching the daily top 30, because that
   * is all the data records.
   */
  forecast(content, weekday) {
    const log = predictLog(this.model, content, weekday);
    const boards = [...this.boards.values()].filter((b) => b.weekday === weekday && b.votes.length >= TOP);
    const res = this.model.residuals;
    let chance = 0;
    for (const b of boards) chance += 1 - percentileOf(res, Math.log(b.votes[TOP - 1] + 1) - log);
    const votes = Math.exp(log) - 1;
    return {
      votes: Math.round(votes),
      low: Math.round(Math.exp(log + quantile(res, 0.25)) - 1),
      high: Math.round(Math.exp(log + quantile(res, 0.75)) - 1),
      top5Chance: chance / boards.length,
      medianRank: Math.round(median(boards.map((b) => 1 + b.votes.filter((v) => v > votes).length))),
    };
  }

  /** Vector for a pitch that is not in the corpus. */
  vectorFor({ name = '', tagline = '', description = '' }) {
    return vectorize(fieldCounts(name, tagline, description), this.idf);
  }

  /** Launches ranked by similarity to `vec`, optionally leaving some out (for backtests). */
  nearest(vec, { limit = 20, minSim = 0.04, exclude } = {}) {
    const hits = [];
    for (const d of this.docs) {
      if (exclude?.(d)) continue;
      const sim = cosine(vec, d.vec);
      if (sim >= minSim) hits.push({ doc: d, sim });
    }
    hits.sort((a, b) => b.sim - a.sim);
    return hits.slice(0, limit);
  }

  #lift(member) {
    const inside = [];
    const outside = [];
    this.statDocs.forEach((d, i) => (member[i] ? inside : outside).push(d));
    const n = inside.length;
    if (!n) return { n: 0, share: 0, reliable: false, direction: 'unknown', examples: [] };
    const medianWith = median(inside.map((d) => d.votes));
    const medianWithout = median(outside.map((d) => d.votes));
    const top5With = inside.filter((d) => d.rank <= TOP).length / n;
    const top5Without = outside.filter((d) => d.rank <= TOP).length / (outside.length || 1);
    const lift = medianWith / medianWithout;
    const p = permutationP(this.statDocs.map((d) => Math.log(d.votes + 1)), member);
    const reliable = n >= MIN_GROUP && p < 0.1;
    return {
      n,
      share: n / this.statDocs.length,
      medianWith: Math.round(medianWith),
      medianWithout: Math.round(medianWithout),
      top5With,
      top5Without,
      lift,
      p,
      reliable,
      direction: !reliable ? 'unclear' : lift >= 1.08 ? 'tailwind' : lift <= 0.92 ? 'headwind' : 'unclear',
      examples: [...inside].sort((a, b) => b.votes - a.votes).slice(0, 3).map(publicDoc),
    };
  }

  /** Share of launches in the first vs second half of the window, and by month. */
  #momentum(member) {
    const dates = this.statDocs.map((d) => d.date).sort();
    const mid = dates[Math.floor(dates.length / 2)];
    const share = (pred) => {
      let pool = 0;
      let hits = 0;
      this.statDocs.forEach((d, i) => {
        if (!pred(d)) return;
        pool++;
        if (member[i]) hits++;
      });
      return pool ? hits / pool : 0;
    };
    const early = share((d) => d.date < mid);
    const late = share((d) => d.date >= mid);
    const months = [...new Set(this.statDocs.map((d) => d.date.slice(0, 7)))].sort();
    return {
      shareEarly: early,
      shareLate: late,
      momentum: early ? late / early : null,
      byMonth: months.map((m) => ({ month: m, share: share((d) => d.date.startsWith(m)) })),
    };
  }

  #weekdayStats() {
    // Monday first: launch weeks are planned that way.
    return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
      const boards = [...this.boards.values()].filter((b) => b.weekday === wd);
      const at = (k) => Math.round(median(boards.filter((b) => b.votes.length >= k).map((b) => b.votes[k - 1])));
      return {
        weekday: wd,
        label: WEEKDAYS[wd],
        days: boards.length,
        votesFor: { 1: at(1), 3: at(3), 5: at(5), 10: at(10) },
      };
    });
  }
}

function fieldCounts(name, tagline, body) {
  return termCounts([
    [name, 1.5],
    [tagline, 3],
    [body, 1],
  ]);
}

/** The fields safe to hand to API clients (no vectors, no scratch fields). */
export function publicDoc(d) {
  return {
    name: d.name,
    tagline: d.tagline,
    taglineIsApproximate: d.taglineKind === 'approx',
    votes: d.votes,
    comments: d.comments ?? null,
    rank: d.rank,
    date: d.date,
    category: d.category ?? null,
    url: d.url,
  };
}
