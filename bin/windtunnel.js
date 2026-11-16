#!/usr/bin/env node
// windtunnel serve | mcp | test | compare | bar | eval

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { analyzePitch, backtest, compareVariants } from '../src/engine/analyze.js';
import { loadCorpus } from '../src/engine/corpus.js';
import { createMcpServer } from '../src/mcp/server.js';

const USAGE = `windtunnel: see the conditions before you launch

  windtunnel serve [--port 3000]                 web app, JSON API and MCP at /mcp
  windtunnel mcp                                 MCP server over stdio
  windtunnel test "<tagline>" [--name N] [--desc D] [--json]
  windtunnel compare "<tagline>" "<tagline>" ... [--name N] [--desc D] [--json]
  windtunnel bar                                 votes needed by weekday
  windtunnel eval                                backtest the model`;

const [command, ...rest] = process.argv.slice(2);
const { values: flags, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p' },
    name: { type: 'string' },
    desc: { type: 'string' },
    json: { type: 'boolean' },
  },
});
const pct = (x) => `${Math.round(x * 100)}%`;

switch (command) {
  case 'serve': {
    const { createApp } = await import('../src/server/app.js');
    const port = Number(flags.port ?? process.env.PORT ?? 3000);
    createApp().listen(port, () => console.log(`Windtunnel listening on http://localhost:${port}`));
    break;
  }

  case 'mcp': {
    // stdout belongs to the protocol; say nothing on it.
    const { createSim } = await import('../src/sim/index.js');
    const corpus = loadCorpus();
    // With ANTHROPIC_API_KEY set, the simulated tests are available too; state is in memory.
    await createMcpServer(corpus, { sim: createSim({ corpus }) }).connect(new StdioServerTransport());
    break;
  }

  case 'test': {
    if (!positionals[0]) fail('Give a tagline: windtunnel test "Turn website traffic into booked meetings"');
    const r = analyzePitch(loadCorpus(), { tagline: positionals[0], name: flags.name, description: flags.desc });
    if (flags.json) {
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    console.log(`\n“${r.input.tagline}”  (${r.input.tagline.length}/60)\n`);
    console.log(`${r.conditions.label}: better conditions than ${r.conditions.percentile}% of past launches`);
    for (const d of r.conditions.drivers) console.log(`  ×${d.effect.toFixed(2)}  ${d.label}  (${d.evidence.n} launches, p=${d.evidence.p})`);
    console.log(`  Trust: rank correlation ${r.conditions.reliability.crossValidatedSpearman} on unseen launches. Weather, not the result.\n`);
    for (const f of r.findings) console.log(`${{ good: '▲', bad: '▼', note: '●', idea: '✦' }[f.tone]} ${f.title}\n    ${f.body}`);
    console.log('\nClosest launches');
    for (const c of r.comparables.slice(0, 8)) {
      console.log(`  ${String(c.votes).padStart(4)} votes  #${String(c.rank).padEnd(2)} ${c.date}  ${c.name}: ${c.tagline}`);
    }
    console.log('\nBy weekday         #5 took   model (range)     top-five chance');
    for (const f of r.forecast) {
      console.log(`  ${f.label.padEnd(10)} ${String(f.bar[5]).padStart(12)}   ${String(f.votes).padStart(4)} (${f.low}-${f.high})`.padEnd(46) + pct(f.top5Chance).padStart(6));
    }
    console.log();
    break;
  }

  case 'compare': {
    if (positionals.length < 2) fail('Give at least two taglines.');
    const r = compareVariants(loadCorpus(), { taglines: positionals, name: flags.name, description: flags.desc });
    if (flags.json) {
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    console.log();
    for (const v of r.variants) {
      console.log(`${v.conditions.padEnd(15)} ${String(v.percentile).padStart(3)}%  ${v.checksPassed}/${v.checksTotal} checks  “${v.tagline}”`);
      for (const p of v.problems) console.log(`${' '.repeat(34)}${p}`);
    }
    console.log(`\n${r.verdict}\n`);
    break;
  }

  case 'bar': {
    const corpus = loadCorpus();
    console.log(`\nDay-one votes it took to finish at each rank (${corpus.meta.from} to ${corpus.meta.to})\n`);
    console.log('             #1    #3    #5   #10');
    for (const w of corpus.weekdays) {
      console.log(`  ${w.label.padEnd(10)}${[1, 3, 5, 10].map((k) => String(w.votesFor[k]).padStart(5)).join(' ')}`);
    }
    console.log();
    break;
  }

  case 'eval': {
    const r = backtest(loadCorpus());
    console.log(JSON.stringify(r, null, 2));
    break;
  }

  default:
    console.log(USAGE);
    if (command && command !== 'help' && command !== '--help') process.exitCode = 1;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
