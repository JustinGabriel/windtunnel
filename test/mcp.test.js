import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../src/engine/corpus.js';
import { createApp } from '../src/server/app.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../bin/windtunnel.js');
const TOOLS = ['compare_taglines', 'find_comparables', 'launch_day_bar', 'launch_trends', 'test_pitch'];
const dataDir = mkdtempSync(join(tmpdir(), 'windtunnel-mcp-'));
let server;
let http;
let stdio;

before(async () => {
  server = createApp({ corpus: loadCorpus(), dataDir, rateLimit: 1000 }).listen(0);
  await new Promise((r) => server.once('listening', r));
  http = new Client({ name: 'test-http', version: '1.0.0' });
  await http.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  stdio = new Client({ name: 'test-stdio', version: '1.0.0' });
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp'] }));
});
after(async () => {
  await http.close();
  await stdio.close();
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

for (const [name, client] of [['HTTP', () => http], ['stdio', () => stdio]]) {
  test(`${name}: lists the five tools, all read-only`, async () => {
    const { tools } = await client().listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
    for (const t of tools) {
      assert.equal(t.annotations.readOnlyHint, true);
      assert.ok(t.description.length > 60);
    }
  });

  test(`${name}: test_pitch returns conditions, comparables and the caveat`, async () => {
    const res = await client().callTool({
      name: 'test_pitch',
      arguments: { name: 'Relay', tagline: 'Turn website visitors into booked sales calls' },
    });
    assert.ok(!res.isError);
    const data = res.structuredContent;
    assert.ok(data.conditions.label);
    assert.equal(data.byWeekday.length, 7);
    assert.ok(data.comparables.length > 0);
    assert.match(data.caveat, /never as a prediction/);
    assert.match(res.content[0].text, /better conditions than/);
  });
}

test('compare_taglines ranks variants', async () => {
  const res = await http.callTool({ name: 'compare_taglines', arguments: { taglines: ['The Vercel for GTM', 'A private local Mac app for job seekers'] } });
  assert.equal(res.structuredContent.variants[0].tagline, 'The Vercel for GTM');
});

test('find_comparables honours limit and minVotes', async () => {
  const res = await http.callTool({ name: 'find_comparables', arguments: { query: 'AI sales agent for website visitors', limit: 4, minVotes: 300 } });
  const { launches } = res.structuredContent;
  assert.ok(launches.length > 0 && launches.length <= 4);
  assert.ok(launches.every((l) => l.votes >= 300));
});

test('launch_day_bar places a vote count on every weekday', async () => {
  const res = await http.callTool({ name: 'launch_day_bar', arguments: { votes: 200 } });
  const { days } = res.structuredContent;
  assert.equal(days.length, 7);
  assert.ok(days.every((d) => d.medianRank >= 1 && d.top5Share >= 0 && d.top5Share <= 1));
});

test('launch_trends includes themes, framing and the backtest', async () => {
  const res = await http.callTool({ name: 'launch_trends', arguments: { top: 3 } });
  const data = res.structuredContent;
  assert.equal(data.topLaunches.length, 3);
  assert.ok(data.themes.length > 5 && data.framing.length > 5);
  assert.ok(data.backtest.conditionsModel.crossValidatedSpearman > 0);
});

test('invalid arguments are rejected by the schema', async () => {
  const res = await http.callTool({ name: 'test_pitch', arguments: { tagline: '' } }).catch((e) => ({ isError: true, thrown: e }));
  assert.ok(res.isError);
});

test('GET on the MCP endpoint is refused', async () => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/mcp`);
  assert.equal(res.status, 405);
});
