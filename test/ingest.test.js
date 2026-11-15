import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Corpus } from '../src/engine/corpus.js';

const here = dirname(fileURLToPath(import.meta.url));

test('ingest joins the two sources into the launch schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'windtunnel-ingest-'));
  const out = join(dir, 'launches.json');
  execFileSync(process.execPath, [
    join(here, '../scripts/ingest.mjs'),
    '--archive', join(here, 'fixtures/archive'),
    '--digests', join(here, 'fixtures/digests'),
    '--from', '2026-10-01', '--to', '2026-10-31', '--out', out,
  ]);
  const data = JSON.parse(readFileSync(out, 'utf8'));
  rmSync(dir, { recursive: true, force: true });

  assert.equal(data.meta.launches, 3);
  const [alpha, beta, gamma] = data.launches;

  // Beijing afternoon on the 14th is just after midnight Pacific on the 14th: a Wednesday.
  assert.deepEqual(
    { name: alpha.name, date: alpha.date, weekday: alpha.weekday, rank: alpha.rank, votes: alpha.votes, featured: alpha.featured },
    { name: 'Alpha Rocket', date: '2026-10-14', weekday: 3, rank: 1, votes: 512, featured: true },
  );
  assert.equal(alpha.url, 'https://www.producthunt.com/products/alpha-rocket');
  assert.equal(alpha.tagline, 'The Vercel for growth teams');
  assert.equal(alpha.category, 'AI Agents & Assistants');
  assert.equal(alpha.comments, 81);
  assert.equal(alpha.taglineKind, 'digest');

  // Different slug in the two sources: joined on the normalised name instead.
  assert.equal(beta.tagline, 'A CLI for tidy logs');
  assert.equal(beta.category, 'Developer Tools');

  // No English source: kept for day-level statistics, with no text.
  assert.equal(gamma.tagline, null);
  assert.equal(gamma.votes, 44);
});

test('a freshly ingested file loads as a corpus', () => {
  const launches = [];
  for (let d = 1; d <= 28; d++) {
    for (let rank = 1; rank <= 6; rank++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      launches.push({
        id: `p${d}-${rank}`, name: `Product ${d}-${rank}`, slug: `p${d}-${rank}`, url: 'https://www.producthunt.com/products/x',
        date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), rank, votes: (rank % 2 ? 300 : 100) + d + rank, featured: true,
        tagline: rank % 2 ? 'Sales agent for founders' : 'Local notes app for Mac', text: 'text', taglineKind: 'digest', category: null, comments: 1,
      });
    }
  }
  const corpus = new Corpus({ meta: { from: '2026-09-01', to: '2026-09-28', sources: [], caveats: [] }, launches });
  assert.equal(corpus.weekdays.length, 7);
  assert.ok(corpus.model.cv.spearman > 0.5, 'votes here depend on the theme, so the model should find it');
});
