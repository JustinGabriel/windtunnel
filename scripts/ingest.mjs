#!/usr/bin/env node
// Rebuilds data/launches.json from two public, API-derived mirrors of Product Hunt:
//
//   1. ViggoZ/producthunt-daily-hot (MIT)   - the daily top 30 with votes, day rank
//      and featured flag. Text is in Chinese, so it supplies outcomes, not wording.
//   2. duanyytop/agents-radar digest issues - English taglines/summaries, categories
//      and comment counts for the AI-related launches.
//
// The two are joined on Product Hunt slug or normalised name. Top launches that the
// English source missed get a hand back-translated tagline from data/backtranslations.json.
//
// Usage:
//   node scripts/ingest.mjs                       # clone + fetch into .cache, then build
//   node scripts/ingest.mjs --archive DIR --digests DIR --from 2026-08-15 --to 2026-11-14 [--out FILE]
//
// Network: needs github.com (git clone) and api.github.com (issue search, 2-3 requests).
// Set GITHUB_TOKEN to raise the search rate limit. Behind an HTTPS proxy, run with
// NODE_USE_ENV_PROXY=1.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE_REPO = 'https://github.com/ViggoZ/producthunt-daily-hot';
const DIGEST_REPO = 'duanyytop/agents-radar';

// Words the digest's own commentary tends to open a sentence with. A sentence that
// starts with one of these is the digest talking, not the maker's tagline.
const COMMENTARY =
  /^(It|Its|This|Solves|Helps|Enables|Eliminates|Stands|Ideal|Designed|Differentiates|Provides|Offers|Makes|Uses|Acts|Brings|Breaks|Sets|Turns|Transforms|Automates|Addresses|Reduces|Ensures|Combines|Integrates|Allows|Lets|Gives|Delivers|Features|Notable|Unique|Great|Perfect|Built|Aims|Targets|Focuses|Supports|Simplifies|Streamlines|Bridges|Fills|Tackles|Removes|Boosts|Improves|Accelerates|Empowers|First|Fast|Novel|Differentiated)\b/;

const args = parseArgs(process.argv.slice(2));
const to = args.to ?? isoDay(new Date(Date.now() - 2 * 864e5));
const from = args.from ?? isoDay(new Date(Date.parse(to) - 91 * 864e5));

const archiveDir = args.archive ?? cloneArchive();
const digestDir = args.digests ?? (await fetchDigests());

const launches = parseArchive(archiveDir).filter((l) => l.date >= from && l.date <= to);
const english = parseDigests(digestDir);
const back = JSON.parse(readFileSync(join(ROOT, 'data/backtranslations.json'), 'utf8'));

let joined = 0;
let approximated = 0;
for (const l of launches) {
  const hit = matchEnglish(l, english);
  if (hit) {
    const { tagline, text } = splitSummary(hit.summary);
    Object.assign(l, { tagline, text, taglineKind: 'digest', category: hit.category, comments: hit.comments });
    joined++;
  } else if (back[l.name.trim()]) {
    const tagline = back[l.name.trim()];
    Object.assign(l, { tagline, text: tagline, taglineKind: 'approx', category: null, comments: null });
    approximated++;
  } else {
    Object.assign(l, { tagline: null, text: null, taglineKind: null, category: null, comments: null });
  }
}

launches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rank - b.rank));
const out = {
  meta: {
    from,
    to,
    builtAt: new Date().toISOString(),
    launches: launches.length,
    days: new Set(launches.map((l) => l.date)).size,
    withEnglishText: joined + approximated,
    approximatedTaglines: approximated,
    sources: [
      { name: 'ViggoZ/producthunt-daily-hot', license: 'MIT', url: ARCHIVE_REPO, provides: 'daily top 30: votes, rank, featured' },
      { name: DIGEST_REPO, url: `https://github.com/${DIGEST_REPO}`, provides: 'English summaries, category, comments (AI launches)' },
    ],
    caveats: [
      'Only the daily top 30 is recorded, so launches that sank are missing (survivorship).',
      'Votes are an end-of-launch-day snapshot, not the final count.',
      'English text exists for roughly a third of records; the rest contribute to day-level statistics only.',
    ],
  },
  launches,
};
const outPath = args.out ? resolve(args.out) : join(ROOT, 'data/launches.json');
writeFileSync(outPath, JSON.stringify(out));
console.log(
  `${outPath}: ${launches.length} launches over ${out.meta.days} days (${from}..${to}); ` +
    `${joined} with digest text, ${approximated} back-translated`,
);

// ---------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i];
  }
  return o;
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function cloneArchive() {
  const dir = join(ROOT, '.cache/archive');
  if (existsSync(join(dir, '.git'))) {
    execFileSync('git', ['-C', dir, 'pull', '--depth', '1', '--quiet'], { stdio: 'inherit' });
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', '--quiet', ARCHIVE_REPO, dir], {
      stdio: 'inherit',
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    });
  }
  return join(dir, 'data');
}

async function fetchDigests() {
  const dir = join(ROOT, '.cache/digests');
  mkdirSync(dir, { recursive: true });
  const q = encodeURIComponent(`repo:${DIGEST_REPO} is:issue "Product Hunt AI Digest" in:title`);
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'windtunnel-ingest' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/search/issues?q=${q}&per_page=100&page=${page}&sort=created&order=desc`,
      { headers },
    );
    if (!res.ok) throw new Error(`GitHub search failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    writeFileSync(join(dir, `p${page}.json`), JSON.stringify(body));
    const oldest = body.items.at(-1)?.title.split(' ').at(-1);
    if (body.items.length < 100 || (oldest && oldest < from)) break;
  }
  return dir;
}

/** Daily top-30 markdown files -> launch records with outcomes. */
function parseArchive(dir) {
  const rows = [];
  for (const file of readdirSync(dir).filter((f) => /^producthunt-daily-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort()) {
    const md = readFileSync(join(dir, file), 'utf8');
    for (const block of md.split(/\n(?=## \[)/)) {
      const head = block.match(/^## \[(\d+)\.\s*(.+?)\]\((https:\/\/www\.producthunt\.com\/(?:products|posts)\/([^?)]+))/);
      if (!head) continue;
      const votes = block.match(/🔺\s*(\d+)/);
      const when = block.match(/(\d{4})年(\d{2})月(\d{2})日\s*(AM|PM)(\d{2}):(\d{2})/);
      if (!votes || !when) continue;
      // Timestamps are Beijing time; a Product Hunt day starts at 00:01 Pacific.
      const [, y, mo, d, ap, h, mi] = when;
      const hour = (Number(h) % 12) + (ap === 'PM' ? 12 : 0);
      const pacific = new Date(Date.UTC(+y, +mo - 1, +d, hour - 15, +mi));
      const date = isoDay(pacific);
      rows.push({
        id: `${head[4]}@${date}`,
        name: head[2].trim(),
        slug: head[4],
        url: head[3],
        date,
        weekday: pacific.getUTCDay(),
        rank: Number(head[1]),
        votes: Number(votes[1]),
        featured: /\*\*是否精选\*\*[：:]\s*是/.test(block),
      });
    }
  }
  return rows;
}

/** GitHub issue-search pages -> English rows keyed for joining. */
function parseDigests(dir) {
  const rows = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const issue of JSON.parse(readFileSync(join(dir, file), 'utf8')).items ?? []) {
      const date = issue.title.split(' ').at(-1);
      let category = null;
      for (const line of (issue.body ?? '').split('\n')) {
        const h = line.match(/^#{3,4}\s*(.+)$/);
        if (h) {
          category = h[1].replace(/\(.*?\)/g, '').replace(/[^\w&/ -]/g, '').trim();
          continue;
        }
        const row = line.match(
          /^\|\s*\[(.+?)\]\(https:\/\/www\.producthunt\.com\/(?:products|posts)\/([^)?]+)[^)]*\)[^|]*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*(.*?)\s*\|\s*$/,
        );
        if (!row) continue;
        rows.push({
          date,
          name: row[1].replace(/\s*·\s*\[site.*$/, '').trim(),
          slug: row[2],
          comments: Number(row[4].replace(/,/g, '')),
          summary: row[5],
          category,
        });
      }
    }
  }
  const bySlug = new Map();
  const byName = new Map();
  for (const r of rows) {
    push(bySlug, r.slug, r);
    push(byName, normName(r.name), r);
  }
  return { bySlug, byName };
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function normName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A digest dated D covers launches from about D-2, so prefer that offset. */
function matchEnglish(launch, { bySlug, byName }) {
  const day = Date.parse(launch.date);
  const candidates = [...(bySlug.get(launch.slug) ?? []), ...(byName.get(normName(launch.name)) ?? [])]
    .map((r) => ({ r, lag: Math.round((Date.parse(r.date) - day) / 864e5) }))
    .filter(({ lag }) => lag >= 0 && lag <= 3)
    .sort((a, b) => Math.abs(a.lag - 2) - Math.abs(b.lag - 2) || b.r.summary.length - a.r.summary.length);
  return candidates[0]?.r ?? null;
}

/** "Tagline — commentary" / "Tagline · commentary" / "Tagline. Commentary." */
function splitSummary(summary) {
  const text = summary.replace(/\s+/g, ' ').trim();
  let tagline = text.split(/\s*(?:—|–|·)\s*/)[0];
  const sentences = tagline.split(/(?<=[a-z0-9)%])[.!?]\s+(?=[A-Z])/);
  const cut = sentences.findIndex((sentence, i) => i > 0 && COMMENTARY.test(sentence));
  if (cut > 0) tagline = sentences.slice(0, cut).join('. ');
  else if (tagline.length > 110) tagline = sentences[0];
  tagline = tagline.replace(/^["“”']+|["“”'.]+$/g, '').trim();
  if (tagline.length > 140) tagline = tagline.slice(0, 140).replace(/\s+\S*$/, '');
  return { tagline, text };
}
