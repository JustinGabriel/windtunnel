#!/usr/bin/env node
// Runs every simulated test once against the real model and saves what came back,
// so the prompts can be read for sense and not just for shape.
//
//   ANTHROPIC_API_KEY=... node scripts/live-smoke.mjs
//
// Writes data/samples/*.json: real model output, kept as examples.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../src/engine/corpus.js';
import { createBudget } from '../src/sim/budget.js';
import { createSim } from '../src/sim/index.js';
import { memoryKv } from '../src/sim/kv.js';
import { createModel } from '../src/sim/llm.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../data/samples');
const PITCHES = [
  {
    slug: 'relay',
    name: 'Relay',
    tagline: 'Turn website visitors into booked sales calls',
    description: 'An AI sales agent that qualifies inbound visitors on your site and books meetings for your sales team.',
    facts: [
      '$99 a month per site, 14-day free trial, no setup fee.',
      'Writes contacts and booked meetings into HubSpot and Salesforce. One-way sync.',
      'Qualifies visitors by asking up to three questions you configure.',
      'Data is stored in the US. No SOC 2 report yet.',
      'Founded this year; twelve paying customers.',
    ].join('\n'),
  },
  { slug: 'quill', name: 'Quill', tagline: 'Private, local AI note-taking for your Mac', description: 'A Mac app that transcribes and summarises meetings on-device. Nothing leaves your computer.' },
  { slug: 'ledger-mcp', name: 'Ledger MCP', tagline: 'Give your coding agent your Stripe data', description: 'An MCP server that lets Claude Code and Cursor query billing, subscriptions and revenue.' },
];

const model = createModel({ maxRetries: 4 });
if (!model) {
  console.error('Set ANTHROPIC_API_KEY.');
  process.exit(1);
}
const corpus = loadCorpus();
const kv = memoryKv();
const sim = createSim({ corpus, model, kv, budget: createBudget(kv, { dailyUsd: 3, visitorRunsPerDay: 100 }) });
const who = { visitor: 'live-smoke' };
mkdirSync(OUT, { recursive: true });
const save = (name, doc) => writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
const rule = (title) => console.log(`\n======== ${title} ========`);
const seconds = (since) => Math.round((Date.now() - since) / 1000);

for (const { slug, facts, ...pitch } of PITCHES) {
  rule(`${pitch.name}: audience panel`);
  let started = Date.now();
  const p = await sim.panel(pitch, who);
  save(`${slug}-panel`, p);
  console.log(`${seconds(started)}s, ${p.usage.calls} calls (${p.usage.failed} failed), $${p.usage.usd}, board ${p.board.date}`);
  console.log(`opened ${p.tallies.opened}/${p.tallies.answeredBoard}, upvoted ${p.tallies.upvoted}, understood ${p.tallies.understood}/${p.tallies.judged}, place #${p.board.place} of ${p.board.of}`);
  for (const e of p.board.standing) console.log(`  ${e.isYou ? '>>' : '  '} up ${e.panelUpvotes} open ${e.panelOpens}  real ${e.realVotes ?? '-'}  ${e.name} | ${e.tagline}`);
  for (const r of p.respondents) {
    console.log(`  [${r.label}] open=${r.opened} up=${r.upvoted} try=${r.wouldTry} (${r.verdict})`);
    console.log(`     is: ${r.restatement}`);
    console.log(`     but: ${r.objection}`);
    console.log(`     asks: ${r.question}`);
    console.log(`     why: ${r.why}`);
  }
  console.log('  themes:', p.themes.map((t) => `${t.label} (${t.count})`).join('; '));

  rule(`${pitch.name}: buyer agents`);
  started = Date.now();
  const b = await sim.buyers(pitch, who);
  save(`${slug}-buyers`, b);
  console.log(`${seconds(started)}s, ${b.usage.calls} calls (${b.usage.failed} failed), $${b.usage.usd}`);
  console.log(`picked ${b.tallies.picked}/${b.tallies.answered}, shortlisted ${b.tallies.shortlisted}`);
  console.log(`  you, neutrally: ${b.yourSummary}`);
  for (const e of b.standing) console.log(`  ${e.isYou ? '>>' : '  '} picked ${e.picked} short ${e.shortlisted}  ${e.name}: ${e.summary}`);
  for (const brief of b.briefs) console.log(`  brief: ${brief.buyer} | ${brief.need} | ${brief.constraint}`);
  console.log('  why not:', b.whyNot.join(' | '));
  console.log('  gaps:', b.gaps.map((g) => `${g.category} x${g.count} (${g.examples[0]})`).join('; '));

  if (facts) {
    rule(`${pitch.name}: interview rehearsal`);
    started = Date.now();
    let s = await sim.startInterview({ pitch, facts, mode: 'rehearsal' }, who);
    while (s.status !== 'done') s = await sim.rehearsalTurn(s.id, who);
    save(`${slug}-interview`, s);
    console.log(`${seconds(started)}s, ${s.usage.calls} calls, $${s.usage.usd}`);
    console.log(`client: ${s.client.buyer} | ${s.client.need} | ${s.client.constraint}`);
    for (const m of s.transcript) console.log(`  ${m.role.toUpperCase()}: ${m.text}`);
    console.log(`  scorecard: ${JSON.stringify(s.scorecard, null, 2)}`);
  }
}
console.log(`\nSpent: $${(await sim.budget.spentToday()).toFixed(3)}`);
