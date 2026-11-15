import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePitch, backtest, compareVariants, lowerFirst } from '../src/engine/analyze.js';
import { loadCorpus } from '../src/engine/corpus.js';
import { PATTERNS, TAGLINE_LIMIT, THEMES, clarityChecks } from '../src/engine/patterns.js';
import { median, percentileOf, permutationP, quantile, spearman, weightedQuantile } from '../src/engine/stats.js';
import { buildIdf, cosine, sharedTerms, stem, termCounts, tokenize, vectorize } from '../src/engine/text.js';

const corpus = loadCorpus();
const pattern = (id) => PATTERNS.find((p) => p.id === id);
const theme = (id) => THEMES.find((t) => t.id === id);

test('tokenize drops stopwords, stems plurals and adds bigrams', () => {
  const tokens = tokenize('The Agents for your Open-Source coding tools');
  assert.deepEqual(tokens.filter((t) => !t.includes(' ')), ['agent', 'opensource', 'code', 'tool']);
  assert.ok(tokens.includes('agent opensource'));
  assert.equal(stem('meetings'), 'meeting');
  assert.equal(stem('glass'), 'glass');
});

test('cosine similarity is 1 for identical text and 0 for disjoint text', () => {
  const counts = ['voice typing for mac', 'billing for ai builders', 'voice notes'].map((t) => termCounts([[t, 1]]));
  const idf = buildIdf(counts);
  const [a, b] = counts.map((c) => vectorize(c, idf));
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-9);
  assert.equal(cosine(a, b), 0);
  assert.deepEqual(sharedTerms(a, vectorize(counts[2], idf)), ['voice']);
});

test('statistics helpers', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.equal(weightedQuantile([[1, 1], [100, 9]], 0.5), 100);
  assert.equal(percentileOf([1, 2, 3, 4], 2), 0.5);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);
});

test('permutation test separates a real gap from noise and is deterministic', () => {
  const values = [...Array(40).fill(1), ...Array(40).fill(3)];
  const real = values.map((v) => v === 3);
  const noise = values.map((_, i) => i % 2 === 0);
  assert.ok(permutationP(values, real) < 0.01);
  assert.ok(permutationP(values, noise) > 0.5);
  assert.equal(permutationP(values, noise), permutationP(values, noise));
});

test('framing patterns detect what they claim to', () => {
  assert.ok(pattern('analogy').test({ name: 'Pancake', tagline: 'The Vercel for GTM' }));
  assert.ok(pattern('analogy').test({ name: 'Inbox Zero', tagline: 'Open-source Superhuman alternative' }));
  assert.ok(!pattern('analogy').test({ name: 'X', tagline: 'Analytics for small teams' }));
  assert.ok(pattern('mcp').test({ name: 'Clueso MCP', tagline: 'Edit videos by chatting' }));
  assert.ok(pattern('for_agents').test({ name: 'X', tagline: 'Cloud simulators built for coding agents' }));
  assert.ok(pattern('lives_in').test({ name: 'X', tagline: 'Bring any AI agent into Slack' }));
  assert.ok(pattern('number').test({ name: 'X', tagline: 'Make your agents 25% less wrong' }));
  assert.ok(!pattern('number').test({ name: 'X', tagline: 'Now with GPT-6 inside' }));
  assert.ok(pattern('version').test({ name: 'CREEM 2.0', tagline: 'Sell your product' }));
});

test('themes read the whole pitch', () => {
  assert.ok(theme('gtm').re.test('an ai sales agent that books meetings'));
  assert.ok(theme('mcp').re.test('an mcp server for stripe'));
  assert.ok(!theme('meetings').re.test('an ai sales agent that books meetings'));
  assert.ok(theme('meetings').re.test('an ai notetaker for zoom'));
});

test('clarity checks enforce the Product Hunt limit and flag filler', () => {
  const long = clarityChecks({ name: 'Acme', tagline: 'x'.repeat(TAGLINE_LIMIT + 1) });
  assert.equal(long.find((c) => c.id === 'length').pass, false);
  const hype = clarityChecks({ name: 'Acme', tagline: 'Acme is a revolutionary AI-powered platform' });
  assert.equal(hype.find((c) => c.id === 'hype').pass, false);
  assert.equal(hype.find((c) => c.id === 'no_name').pass, false);
  assert.ok(clarityChecks({ name: 'Acme', tagline: 'Turn website traffic into booked meetings' }).every((c) => c.pass));
});

test('corpus is loaded and internally consistent', () => {
  assert.ok(corpus.all.length > 2000);
  assert.ok(corpus.statDocs.length > 500);
  assert.ok(corpus.statDocs.every((d) => d.taglineKind === 'digest'));
  assert.equal(corpus.weekdays.length, 7);
  for (const w of corpus.weekdays) {
    assert.ok(w.votesFor[1] > w.votesFor[3] && w.votesFor[3] > w.votesFor[5] && w.votesFor[5] > w.votesFor[10], w.label);
  }
  for (const s of [...corpus.patternStats, ...corpus.themeStats]) {
    assert.ok(['tailwind', 'headwind', 'unclear', 'unknown'].includes(s.direction));
    if (s.direction !== 'unclear' && s.direction !== 'unknown') assert.ok(s.n >= 15 && s.p < 0.1, s.id);
  }
});

test('analyzePitch returns a full, bounded report', () => {
  const r = analyzePitch(corpus, {
    name: 'Relay',
    tagline: 'Turn website visitors into booked sales calls',
    description: 'An AI sales agent that qualifies inbound visitors and books meetings.',
  });
  assert.ok(['Tailwind', 'Light tailwind', 'Neutral', 'Light headwind', 'Headwind'].includes(r.conditions.label));
  assert.ok(r.conditions.percentile >= 0 && r.conditions.percentile <= 100);
  assert.ok(r.conditions.drivers.some((d) => d.id === 'gtm'));
  assert.equal(r.forecast.length, 7);
  for (const f of r.forecast) {
    assert.ok(f.low <= f.votes && f.votes <= f.high);
    assert.ok(f.top5Chance >= 0 && f.top5Chance <= 1);
  }
  assert.ok(r.comparables.length > 0 && r.comparables.length <= 12);
  assert.ok(r.comparables[0].similarity >= r.comparables.at(-1).similarity);
  assert.ok(r.comparables.every((c) => !('vec' in c) && !('haystack' in c)));
  assert.ok(r.findings.length >= 3);
});

test('an existing pitch is recognised as a near twin', () => {
  const r = analyzePitch(corpus, { tagline: 'The Vercel for GTM' });
  assert.equal(r.space.nearTwin?.name, 'Pancake');
  assert.equal(r.findings[0].tone, 'bad');
});

test('a pitch in no known words still yields a report', () => {
  const r = analyzePitch(corpus, { tagline: 'Zxqv blorp wibble' });
  assert.equal(r.comparables.length, 0);
  assert.equal(r.conditions.drivers.length, 0);
  assert.ok(r.findings.some((f) => f.title === 'No comparable launches found'));
});

test('input is required and trimmed to sane lengths', () => {
  assert.throws(() => analyzePitch(corpus, { tagline: '   ' }), /tagline is required/);
  const r = analyzePitch(corpus, { tagline: 'a '.repeat(1000), description: 'b'.repeat(9000) });
  assert.ok(r.input.tagline.length <= 300 && r.input.description.length <= 2000);
});

test('compareVariants ranks by conditions and admits ties', () => {
  const r = compareVariants(corpus, { taglines: ['The Vercel for GTM', 'A private local Mac app for job seekers', ''] });
  assert.equal(r.variants.length, 2);
  assert.equal(r.variants[0].tagline, 'The Vercel for GTM');
  assert.match(r.verdict, /most favourable conditions/);
  const tie = compareVariants(corpus, { taglines: ['Notes that write themselves', 'Notes which write themselves'] });
  assert.match(tie.verdict, /inside its noise/);
  assert.throws(() => compareVariants(corpus, { taglines: [] }), /at least one tagline/);
});

test('backtest reports a weak but positive model and a near-zero wording baseline', () => {
  const b = backtest(corpus);
  assert.ok(b.conditionsModel.crossValidatedSpearman > 0.1 && b.conditionsModel.crossValidatedSpearman < 0.5);
  assert.ok(Math.abs(b.wordingOnly.leaveOneOutSpearman) < 0.15);
  assert.equal(b.quartiles.reduce((s, q) => s + q.n, 0), b.n);
  assert.ok(b.quartiles[3].medianVotes > b.quartiles[0].medianVotes);
});

test('lowerFirst keeps acronyms and quoted labels intact', () => {
  assert.equal(lowerFirst('Open source'), 'open source');
  assert.equal(lowerFirst('MCP in the name'), 'MCP in the name');
  assert.equal(lowerFirst('“The X for Y” analogy'), '“The X for Y” analogy');
});
