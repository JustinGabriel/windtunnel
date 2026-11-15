// Server-rendered pages. No client framework: the pages are documents, and the only
// script (public/app.js) adds a character counter, example fill-in, copy-link and
// the chart hover layer.

import { lowerFirst } from '../engine/analyze.js';
import { TAGLINE_LIMIT } from '../engine/patterns.js';
import { html, launchUrl, raw } from './html.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x) => `${Math.round(x * 100)}%`;
const day = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const pValue = (p) => (p < 0.01 ? 'p < 0.01' : `p = ${p.toFixed(2)}`);

// ---- layout ------------------------------------------------------------------------------

const NAV = [
  ['/', 'Test a pitch'],
  ['/compare', 'Compare taglines'],
  ['/trends', 'Trends'],
  ['/method', 'Method'],
  ['/agents', 'For agents'],
  ['/pricing', 'Pricing'],
];

function layout({ title, description, active, body, noindex = false }) {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title ? `${title} · Windtunnel` : 'Windtunnel: see the conditions before you launch'}</title>
    <meta name="description" content="${description ?? 'Check a Product Hunt pitch against thousands of real launches: who already shipped it, how they did, and how many votes top five takes on your day.'}" />
    ${noindex ? html`<meta name="robots" content="noindex" />` : ''}
    <link rel="stylesheet" href="/styles.css" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script src="/app.js" defer></script>
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap bar">
        <a class="brand" href="/" aria-label="Windtunnel home">${logo()}<span>Windtunnel</span></a>
        <nav aria-label="Main">
          ${NAV.map(([href, label]) => html`<a href="${href}" ${active === href ? raw('aria-current="page"') : ''}>${label}</a>`)}
        </nav>
      </div>
    </header>
    <main id="main" class="wrap">${body}</main>
    <footer class="site-footer">
      <div class="wrap">
        <p>
          Windtunnel is independent and not affiliated with Product Hunt. Figures come from public mirrors of Product Hunt’s
          API and cover the daily top 30 only. <a href="/method">How it works and where it falls short</a>.
        </p>
      </div>
    </footer>
  </body>
</html>`;
}

function logo() {
  return raw(
    `<svg class="logo" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="M2 8h9c4 0 6 3 10 3h5M2 14h7c5 0 7 0 12 0h5M2 20h9c4 0 6-3 10-3h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle class="accent-fill" cx="14" cy="14" r="2.6"/></svg>`,
  );
}

// ---- shared pieces -----------------------------------------------------------------------

const TONE = {
  good: ['▲', 'Helps'],
  bad: ['▼', 'Hurts'],
  note: ['●', 'Note'],
  idea: ['✦', 'Idea'],
};

function findingsList(findings) {
  return html`<ul class="findings">
    ${findings.map(
      (f) => html`<li class="finding tone-${f.tone}">
        <span class="tone" aria-hidden="true">${TONE[f.tone][0]}</span>
        <div><h3><span class="vh">${TONE[f.tone][1]}: </span>${f.title}</h3><p>${f.body}</p></div>
      </li>`,
    )}
  </ul>`;
}

const BANDS = ['Headwind', 'Light headwind', 'Neutral', 'Light tailwind', 'Tailwind'];

/** Five-band meter. The label beside it carries the meaning; the marker shows where in the range. */
function conditionsMeter(percentile, label) {
  const w = 500;
  const seg = 96;
  const gap = 5;
  const x = Math.max(6, Math.min(w - 6, (percentile / 100) * w));
  const active = BANDS.indexOf(label);
  return html`<svg class="meter" viewBox="0 0 ${w} 40" role="img" aria-label="${label}: better conditions than ${percentile}% of past launches">
    ${BANDS.map((b, i) => html`<rect class="band band-${i} ${i === active ? 'on' : ''}" x="${i * (seg + gap)}" y="18" width="${seg}" height="8" rx="4" />`)}
    <path class="marker" d="M${x - 6} 4h12l-6 10z" />
    <text class="meter-end" x="0" y="38">worse than most</text>
    <text class="meter-end" x="${w}" y="38" text-anchor="end">better than most</text>
  </svg>`;
}

function signalChip(direction, p) {
  const text = direction === 'tailwind' ? 'Tailwind' : direction === 'headwind' ? 'Headwind' : 'Unclear';
  const icon = direction === 'tailwind' ? '▲' : direction === 'headwind' ? '▼' : '○';
  return html`<span class="chip sig-${direction}" title="Permutation test, ${pValue(p)}"><span aria-hidden="true">${icon}</span> ${text}</span>`;
}

function launchCell(l) {
  const url = launchUrl(l.url);
  return html`<div class="launch">
    ${url ? html`<a href="${url}" rel="noopener nofollow">${l.name}</a>` : html`<strong>${l.name}</strong>`}
    ${l.tagline ? html`<span class="tag">${l.tagline}${l.taglineIsApproximate ? html` <abbr title="Tagline back-translated from a Chinese archive; wording is approximate.">≈</abbr>` : ''}</span>` : ''}
  </div>`;
}

/** Horizontal bar against a reference tick (the corpus median). */
function liftBar(value, reference, max) {
  const w = 150;
  const sx = (v) => Math.round((Math.min(v, max) / max) * (w - 2));
  return html`<svg class="liftbar" viewBox="0 0 ${w} 16" width="${w}" height="16" aria-hidden="true">
    <path class="bar" d="M0 3h${Math.max(2, sx(value) - 4)}a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H0z" />
    <rect class="ref" x="${sx(reference)}" y="0" width="2" height="16" />
  </svg>`;
}

/** One weekday row: model range as a band, estimate as a dot, the top-five bar as a tick. */
function rangePlot(f, max) {
  const w = 220;
  const sx = (v) => 4 + (Math.min(v, max) / max) * (w - 8);
  return html`<svg class="rangeplot" viewBox="0 0 ${w} 24" width="${w}" height="24" role="img" aria-label="Model estimate ${f.votes} votes, range ${f.low} to ${f.high}; top five took ${f.bar[5]}">
    <title>${f.label}: model ${f.votes} votes (${f.low} to ${f.high}); top five took ${f.bar[5]}</title>
    <line class="track" x1="4" x2="${w - 4}" y1="12" y2="12" />
    <rect class="band" x="${sx(f.low)}" y="8" width="${Math.max(2, sx(f.high) - sx(f.low))}" height="8" rx="4" />
    <rect class="bar5" x="${sx(f.bar[5]) - 1}" y="3" width="2" height="18" />
    <circle class="dot" cx="${sx(f.votes)}" cy="12" r="5" />
  </svg>`;
}

function pitchForm({ prefill = {}, error }) {
  return html`<form class="pitch" method="post" action="/test">
    ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
    <div class="field">
      <label for="tagline">Tagline</label>
      <input id="tagline" name="tagline" required maxlength="300" autocomplete="off" value="${prefill.tagline ?? ''}"
        placeholder="Turn website traffic into booked meetings" data-count="#tagline-count" data-limit="${TAGLINE_LIMIT}" />
      <p class="help"><span id="tagline-count" class="count">0</span> / ${TAGLINE_LIMIT} characters, Product Hunt’s limit</p>
    </div>
    <div class="row">
      <div class="field">
        <label for="name">Product name <span class="opt">optional</span></label>
        <input id="name" name="name" maxlength="80" autocomplete="off" value="${prefill.name ?? ''}" placeholder="Acme" />
      </div>
    </div>
    <div class="field">
      <label for="description">What it does <span class="opt">optional, sharpens the match</span></label>
      <textarea id="description" name="description" rows="3" maxlength="2000" placeholder="Two or three plain sentences about what the product does and who uses it.">${prefill.description ?? ''}</textarea>
    </div>
    <div class="actions">
      <button class="primary" type="submit">Run the tunnel</button>
      <a class="quiet" href="/compare">or compare several taglines</a>
    </div>
  </form>`;
}

// ---- home --------------------------------------------------------------------------------

const EXAMPLES = [
  { label: 'A sales agent', name: 'Relay', tagline: 'Turn website visitors into booked sales calls', description: 'An AI sales agent that qualifies inbound visitors on your site and books meetings for your sales team.' },
  { label: 'A local Mac app', name: 'Quill', tagline: 'Private, local AI note-taking for your Mac', description: 'A Mac app that transcribes and summarises meetings on-device. Nothing leaves your computer.' },
  { label: 'An MCP server', name: 'Ledger MCP', tagline: 'Give your coding agent your Stripe data', description: 'An MCP server that lets Claude Code and Cursor query billing, subscriptions and revenue.' },
];

export function home({ corpus, backtest }, { prefill, error }) {
  const tue = corpus.weekdays.find((w) => w.label === 'Tuesday');
  const sat = corpus.weekdays.find((w) => w.label === 'Saturday');
  const best = corpus.themeStats.filter((t) => t.direction === 'tailwind').sort((a, b) => b.lift - a.lift)[0];
  return layout({
    active: '/',
    body: html`
      <section class="hero">
        ${streamlines()}
        <h1>See the conditions before you launch.</h1>
        <p class="lede">
          Windtunnel checks your Product Hunt pitch against ${num(corpus.all.length)} real launches from the last 90 days:
          who already shipped it, how they did, how crowded it is, and how many votes top five takes on your day.
        </p>
      </section>

      <section class="panel form-panel" aria-label="Test a pitch">
        ${pitchForm({ prefill, error })}
        <p class="examples">
          Try one:
          ${EXAMPLES.map((e) => html`<button type="button" class="link" data-example="${JSON.stringify(e)}">${e.label}</button>`)}
        </p>
      </section>

      <section class="tiles" aria-label="From the data">
        <div class="tile">
          <p class="tile-label">Votes that took #5 on a median Tuesday</p>
          <p class="tile-value">${num(tue.votesFor[5])}</p>
          <p class="tile-note">${num(sat.votesFor[5])} on a Saturday. <a href="/trends">Every weekday</a></p>
        </div>
        ${best
          ? html`<div class="tile">
              <p class="tile-label">${best.label}, against everything else</p>
              <p class="tile-value">×${best.lift.toFixed(1)}</p>
              <p class="tile-note">Median ${num(best.medianWith)} votes across ${best.n} launches, ${pValue(best.p)}. <a href="/trends">All themes</a></p>
            </div>`
          : ''}
        <div class="tile">
          <p class="tile-label">How well wording alone predicts votes</p>
          <p class="tile-value">ρ = ${backtest.wordingOnly.leaveOneOutSpearman.toFixed(2)}</p>
          <p class="tile-note">Close to a coin flip, so we do not sell you a score. <a href="/method">Our backtest</a></p>
        </div>
      </section>

      <section class="split">
        <div>
          <h2>What a report tells you</h2>
          <ul class="plain">
            <li><strong>Who got there first.</strong> The launches closest to yours, what they said, and the votes and day rank they finished with.</li>
            <li><strong>The weather.</strong> Whether your theme and framing have run above or below average, with sample sizes and significance shown.</li>
            <li><strong>The bar.</strong> Votes needed for #1, #3, #5 and #10 on each weekday, from every board in the window.</li>
            <li><strong>The crowd.</strong> How many similar launches shipped in the last 30 days against the 30 before.</li>
            <li><strong>The basics.</strong> Whether the tagline fits the ${TAGLINE_LIMIT}-character field and says something specific.</li>
          </ul>
        </div>
        <div>
          <h2>Works inside your agent</h2>
          <p>Windtunnel is also an MCP server. Ask Claude, ChatGPT or Cursor to draft taglines and test them against the data in the same conversation.</p>
          <pre><code>{
  "mcpServers": {
    "windtunnel": { "url": "https://your-host/mcp" }
  }
}</code></pre>
          <p><a href="/agents">Setup, tools and the JSON API</a></p>
        </div>
      </section>`,
  });
}

function streamlines() {
  return raw(
    `<svg class="streamlines" viewBox="0 0 900 120" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M0 20h300c80 0 110-14 180-14s120 14 420 14"/><path d="M0 44h290c70 0 100-10 190-10s130 10 420 10"/><path d="M0 60h900"/><path d="M0 76h290c70 0 100 10 190 10s130-10 420-10"/><path d="M0 100h300c80 0 110 14 180 14s120-14 420-14"/></g><ellipse class="accent-fill" cx="480" cy="60" rx="46" ry="13"/></svg>`,
  );
}

// ---- report ------------------------------------------------------------------------------

export function report(ctx, record, { url }) {
  const r = record.payload;
  const c = r.conditions;
  const over = r.input.tagline.length - TAGLINE_LIMIT;
  const max = Math.max(...r.forecast.map((f) => Math.max(f.high, f.bar[5]))) * 1.05;
  const top = Math.max(...r.patterns.map((p) => p.medianWith ?? 0), r.corpus.medianVotes) * 1.05;
  return layout({
    title: r.input.name ? `${r.input.name}: launch conditions` : 'Launch conditions',
    active: '/',
    noindex: true,
    body: html`
      <section class="report-head">
        <p class="eyebrow">Launch conditions · ${day(record.createdAt)} · ${num(r.corpus.launches)} launches, ${day(r.corpus.from)} to ${day(r.corpus.to)}</p>
        <h1>${r.input.name || 'Your launch'}</h1>
        <p class="quote">“${r.input.tagline}” <span class="chip ${over > 0 ? 'warn' : ''}">${r.input.tagline.length}/${TAGLINE_LIMIT}</span></p>
        <div class="actions">
          <button type="button" class="secondary" data-copy="${url}">Copy link to this report</button>
          <a class="quiet" href="/?${new URLSearchParams(r.input)}">Edit and re-run</a>
        </div>
      </section>

      <section class="panel conditions">
        <div>
          <p class="eyebrow">Conditions</p>
          <p class="hero-figure">${c.label}</p>
          <p class="hero-sub">Better conditions than <strong>${c.percentile}%</strong> of past launches.</p>
          ${conditionsMeter(c.percentile, c.label)}
        </div>
        <div>
          <p class="eyebrow">What moves it</p>
          ${c.drivers.length
            ? html`<ul class="drivers">
                ${c.drivers.map(
                  (d) => html`<li>
                    <span class="effect ${d.effect >= 1 ? 'up' : 'down'}"><span aria-hidden="true">${d.effect >= 1 ? '▲' : '▼'}</span> ×${d.effect.toFixed(2)}</span>
                    <span><strong>${d.label}</strong><br /><span class="muted">${d.evidence.n} launches, median ${num(d.evidence.medianWith)} against ${num(d.evidence.medianWithout)}, ${pValue(d.evidence.p)}</span></span>
                  </li>`,
                )}
              </ul>`
            : html`<p class="muted">Nothing in this pitch matches a theme or framing the model has a view on. Add a description to place it.</p>`}
          <p class="trust">
            <strong>How far to trust this.</strong> On launches it had not seen, the model’s ranking correlated with real votes at
            ρ = ${c.reliability.crossValidatedSpearman.toFixed(2)} (0 is a coin flip, 1 is perfect). ${c.reliability.typicalError}
            It is the weather, not the result. <a href="/method">Method</a>
          </p>
        </div>
      </section>

      <section>
        <h2>What to take from it</h2>
        ${findingsList(r.findings)}
      </section>

      <section>
        <h2>The bar, by weekday</h2>
        <p class="section-note">What it took to finish in the top five on each weekday, and where the model puts a launch with this profile. The chance is among launches that reach the daily top 30.</p>
        <div class="table-scroll">
          <table class="data">
            <thead>
              <tr><th>Day</th><th class="n">Votes for #5</th><th class="n">Votes for #1</th><th>Model estimate and range</th><th class="n">Estimate</th><th class="n">Chance of top five</th></tr>
            </thead>
            <tbody>
              ${r.forecast.map(
                (f) => html`<tr>
                  <th scope="row">${f.label}</th>
                  <td class="n">${num(f.bar[5])}</td>
                  <td class="n">${num(f.bar[1])}</td>
                  <td>${rangePlot(f, max)}</td>
                  <td class="n">${num(f.votes)} <span class="muted">(${num(f.low)}–${num(f.high)})</span></td>
                  <td class="n">${pct(f.top5Chance)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
        <p class="legend"><span class="key key-band"></span> middle half of model error <span class="key key-dot"></span> model estimate <span class="key key-tick"></span> votes that took #5</p>
      </section>

      <section>
        <h2>Closest launches</h2>
        <p class="section-note">
          ${r.space.closeLaunches
            ? html`${r.space.closeLaunches} close match${r.space.closeLaunches === 1 ? '' : 'es'} in 90 days: ${r.space.last30Days} in the last 30, ${r.space.previous30Days} in the 30 before (${r.space.trend}).`
            : 'No close matches in the window.'}
          This is what happened to them, not a forecast for you.
        </p>
        ${r.comparables.length
          ? html`<div class="table-scroll"><table class="data">
              <thead><tr><th>Launch</th><th class="n">Votes</th><th class="n">Day rank</th><th class="n">Date</th><th>Matched on</th></tr></thead>
              <tbody>
                ${r.comparables.map(
                  (l) => html`<tr>
                    <td>${launchCell(l)}</td>
                    <td class="n">${num(l.votes)}</td>
                    <td class="n">#${l.rank}</td>
                    <td class="n">${day(l.date)}</td>
                    <td>${l.matchedOn.map((t) => html`<span class="chip">${t}</span> `)}</td>
                  </tr>`,
                )}
              </tbody>
            </table></div>`
          : html`<p class="muted">None of the words in this pitch appear in the corpus.</p>`}
      </section>

      <section>
        <h2>Framing, measured</h2>
        <p class="section-note">How each way of pitching has done across the corpus (median ${num(r.corpus.medianVotes)} votes, marked by the tick). “Unclear” means the gap could be chance.</p>
        <div class="table-scroll">
          <table class="data">
            <thead><tr><th>Framing</th><th>Yours</th><th class="n">Launches</th><th>Median votes</th><th class="n">With</th><th class="n">Without</th><th>Signal</th></tr></thead>
            <tbody>
              ${r.patterns
                .filter((p) => p.n >= 5)
                .map(
                  (p) => html`<tr class="${p.matched ? 'matched' : ''}">
                    <td><strong>${p.label}</strong><br /><span class="muted">${p.hint}</span></td>
                    <td>${p.matched ? html`<span class="chip on">Yes</span>` : html`<span class="muted">No</span>`}</td>
                    <td class="n">${p.n}</td>
                    <td>${liftBar(p.medianWith, r.corpus.medianVotes, top)}</td>
                    <td class="n">${num(p.medianWith)}</td>
                    <td class="n">${num(p.medianWithout)}</td>
                    <td>${signalChip(p.direction, p.p)}</td>
                  </tr>`,
                )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Tagline checks</h2>
        <p class="section-note">House rules and Product Hunt’s field limit. These are editorial, not measured effects.</p>
        <ul class="checks">
          ${r.checks.map(
            (k) => html`<li class="${k.pass ? 'pass' : 'fail'}"><span class="mark" aria-hidden="true">${k.pass ? '✓' : '✕'}</span><div><strong>${k.label}</strong><br /><span class="muted">${k.detail}</span></div></li>`,
          )}
        </ul>
      </section>`,
  });
}

// ---- compare -----------------------------------------------------------------------------

export function compare(ctx, { prefill = {}, error }) {
  const taglines = [...(prefill.taglines ?? []), '', '', '', ''].slice(0, 4);
  return layout({
    title: 'Compare taglines',
    active: '/compare',
    body: html`
      <section class="page-head">
        <h1>Compare taglines</h1>
        <p class="lede">Put up to four candidates side by side. You get the conditions each one launches into, the checks it fails and the closest launch to it. When they are too close to call, it says so.</p>
      </section>
      <section class="panel form-panel">
        <form class="pitch" method="post" action="/compare">
          ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
          ${taglines.map(
            (t, i) => html`<div class="field">
              <label for="t${i}">Tagline ${i + 1} ${i > 1 ? html`<span class="opt">optional</span>` : ''}</label>
              <input id="t${i}" name="taglines" maxlength="300" autocomplete="off" value="${t}" data-count="#c${i}" data-limit="${TAGLINE_LIMIT}" ${i < 2 ? raw('required') : ''} />
              <p class="help"><span id="c${i}" class="count">0</span> / ${TAGLINE_LIMIT}</p>
            </div>`,
          )}
          <div class="field">
            <label for="name">Product name <span class="opt">optional</span></label>
            <input id="name" name="name" maxlength="80" autocomplete="off" value="${prefill.name ?? ''}" />
          </div>
          <div class="field">
            <label for="description">What it does <span class="opt">optional, shared by every variant</span></label>
            <textarea id="description" name="description" rows="3" maxlength="2000">${prefill.description ?? ''}</textarea>
          </div>
          <div class="actions"><button class="primary" type="submit">Compare</button></div>
        </form>
      </section>`,
  });
}

export function comparison(ctx, record, { url }) {
  const r = record.payload;
  return layout({
    title: 'Tagline comparison',
    active: '/compare',
    noindex: true,
    body: html`
      <section class="report-head">
        <p class="eyebrow">Tagline comparison · ${day(record.createdAt)}</p>
        <h1>${r.name || 'Your taglines'}, side by side</h1>
        <p class="verdict">${r.verdict}</p>
        <div class="actions">
          <button type="button" class="secondary" data-copy="${url}">Copy link</button>
          <a class="quiet" href="/compare">Compare another set</a>
        </div>
      </section>
      <section>
        <ol class="variants">
          ${r.variants.map(
            (v) => html`<li class="panel variant">
              <div class="variant-main">
                <p class="quote">“${v.tagline}” <span class="chip ${v.length > TAGLINE_LIMIT ? 'warn' : ''}">${v.length}/${TAGLINE_LIMIT}</span></p>
                <p class="muted">
                  ${v.drivers.length
                    ? html`Framing the model reads: ${v.drivers.map((d, i) => html`${i ? ', ' : ''}${lowerFirst(d.label)} (×${d.effect.toFixed(2)})`)}.`
                    : 'No framing pattern detected; the read comes from the product’s theme alone.'}
                </p>
                ${v.problems.length ? html`<ul class="problems">${v.problems.map((p) => html`<li>${p}</li>`)}</ul>` : ''}
                ${v.closestLaunch
                  ? html`<div class="closest"><p class="eyebrow">Closest launch · ${num(v.closestLaunch.votes)} votes, #${v.closestLaunch.rank} on ${day(v.closestLaunch.date)}</p>${launchCell(v.closestLaunch)}</div>`
                  : ''}
              </div>
              <div class="variant-side">
                <p class="tile-label">Conditions</p>
                <p class="tile-value small">${v.conditions}</p>
                <p class="tile-note">Better than ${v.percentile}% of launches · ${v.checksPassed}/${v.checksTotal} checks</p>
                <form method="post" action="/test">
                  <input type="hidden" name="tagline" value="${v.tagline}" /><input type="hidden" name="name" value="${r.name}" />
                  <button class="link" type="submit">Full report</button>
                </form>
              </div>
            </li>`,
          )}
        </ol>
      </section>`,
  });
}

// ---- trends ------------------------------------------------------------------------------

function weekdayChart(weekdays) {
  const W = 720;
  const H = 300;
  const left = 48;
  const right = 56;
  const topPad = 16;
  const bottom = 34;
  const ranks = [1, 3, 5, 10];
  const yMax = Math.ceil(Math.max(...weekdays.map((w) => w.votesFor[1])) / 100) * 100;
  const x = (i) => left + (i * (W - left - right)) / (weekdays.length - 1);
  const y = (v) => topPad + (1 - v / yMax) * (H - topPad - bottom);
  const ticks = [];
  for (let v = 0; v <= yMax; v += 100) ticks.push(v);
  const data = { x: weekdays.map((_, i) => x(i)), days: weekdays.map((w) => w.label), series: ranks.map((r) => ({ label: `#${r}`, values: weekdays.map((w) => w.votesFor[r]) })) };
  return html`<figure class="chart">
    <figcaption>
      <strong>Day-one votes it took to finish at each rank</strong>
      <span class="legend">${ranks.map((r, i) => html`<span class="key key-line s${i}"></span> #${r} `)}</span>
    </figcaption>
    <div class="chart-body" data-linechart="${JSON.stringify(data)}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Votes needed for ranks 1, 3, 5 and 10 by weekday. Weekdays need more than weekends.">
        ${ticks.map((v) => html`<line class="grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" /><text class="axis" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`)}
        ${weekdays.map((w, i) => html`<text class="axis" x="${x(i)}" y="${H - 10}" text-anchor="middle">${w.label.slice(0, 3)}</text>`)}
        <line class="crosshair" x1="0" x2="0" y1="${topPad}" y2="${H - bottom}" />
        ${ranks.map(
          (r, s) => html`<polyline class="line s${s}" points="${weekdays.map((w, i) => `${x(i)},${y(w.votesFor[r])}`).join(' ')}" />
            ${weekdays.map((w, i) => html`<circle class="pt s${s}" cx="${x(i)}" cy="${y(w.votesFor[r])}" r="4" />`)}
            <text class="endlabel" x="${W - right + 10}" y="${y(weekdays.at(-1).votesFor[r]) + 4}">#${r}</text>`,
        )}
      </svg>
      <div class="tooltip" hidden></div>
    </div>
    <details>
      <summary>Show as a table</summary>
      <table class="data">
        <thead><tr><th>Day</th>${ranks.map((r) => html`<th class="n">#${r}</th>`)}<th class="n">Days observed</th></tr></thead>
        <tbody>${weekdays.map((w) => html`<tr><th scope="row">${w.label}</th>${ranks.map((r) => html`<td class="n">${num(w.votesFor[r])}</td>`)}<td class="n">${w.days}</td></tr>`)}</tbody>
      </table>
    </details>
  </figure>`;
}

function liftTable(rows, median, { momentum = false } = {}) {
  const max = Math.max(...rows.map((r) => r.medianWith), median) * 1.05;
  return html`<div class="table-scroll"><table class="data">
    <thead>
      <tr><th>${momentum ? 'Theme' : 'Framing'}</th><th class="n">Launches</th><th>Median votes</th><th class="n">With</th><th class="n">Without</th><th class="n">Top five</th><th>Signal</th>${momentum ? html`<th class="n">Share of launches</th>` : ''}</tr>
    </thead>
    <tbody>
      ${rows.map(
        (r) => html`<tr>
          <td><strong>${r.label}</strong>${r.examples?.[0] ? html`<br /><span class="muted">e.g. ${r.examples.slice(0, 2).map((e, i) => html`${i ? ', ' : ''}${e.name} (${num(e.votes)})`)}</span>` : ''}</td>
          <td class="n">${r.n}</td>
          <td>${liftBar(r.medianWith, median, max)}</td>
          <td class="n">${num(r.medianWith)}</td>
          <td class="n">${num(r.medianWithout)}</td>
          <td class="n">${pct(r.top5With)}</td>
          <td>${signalChip(r.direction, r.p)}</td>
          ${momentum ? html`<td class="n">${(r.shareEarly * 100).toFixed(1)}% → ${(r.shareLate * 100).toFixed(1)}% <span aria-hidden="true">${r.shareLate > r.shareEarly * 1.25 ? '↑' : r.shareLate < r.shareEarly * 0.8 ? '↓' : ''}</span></td>` : ''}
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

export function trends({ corpus }) {
  const median = Math.round(corpus.baseline.medianVotes);
  const weekdayOnly = corpus.weekdays.filter((w) => w.weekday >= 1 && w.weekday <= 5);
  const avg = (k) => Math.round(weekdayOnly.reduce((s, w) => s + w.votesFor[k], 0) / weekdayOnly.length);
  const themes = corpus.themeStats.filter((t) => t.n >= 8).sort((a, b) => b.medianWith - a.medianWith);
  const framing = corpus.patternStats.filter((p) => p.n >= 8).sort((a, b) => b.medianWith - a.medianWith);
  const top = [...corpus.all].sort((a, b) => b.votes - a.votes).slice(0, 25);
  return layout({
    title: 'What is working on Product Hunt',
    description: `Measured from ${corpus.all.length} Product Hunt launches: the votes each rank takes by weekday, which themes run above average, and which framing patterns hold up.`,
    active: '/trends',
    body: html`
      <section class="page-head">
        <h1>What is working on Product Hunt</h1>
        <p class="lede">${num(corpus.all.length)} launches from the daily top 30, ${day(corpus.meta.from)} to ${day(corpus.meta.to)} 2026. Theme and framing figures use the ${num(corpus.statDocs.length)} launches with English text.</p>
      </section>

      <section class="tiles">
        <div class="tile"><p class="tile-label">Votes for top five, weekday average</p><p class="tile-value">${num(avg(5))}</p><p class="tile-note">Day-one votes at the end of launch day</p></div>
        <div class="tile"><p class="tile-label">Votes for #1, weekday average</p><p class="tile-value">${num(avg(1))}</p><p class="tile-note">The best day took ${num(top[0].votes)}</p></div>
        <div class="tile"><p class="tile-label">Median launch in the corpus</p><p class="tile-value">${num(median)}</p><p class="tile-note">Half of recorded launches got fewer votes</p></div>
      </section>

      <section>
        <h2>The bar</h2>
        <p class="section-note">Weekends take about a quarter fewer votes to place, on thinner traffic.</p>
        ${weekdayChart(corpus.weekdays)}
      </section>

      <section>
        <h2>Themes</h2>
        <p class="section-note">Median day-one votes for launches in each theme. The tick marks the corpus median (${num(median)}). “Unclear” means a permutation test cannot tell the gap from chance; with this many rows, expect one or two false signals.</p>
        ${liftTable(themes, median, { momentum: true })}
      </section>

      <section>
        <h2>Framing</h2>
        <p class="section-note">The same measure for how a launch is pitched, read from the name and tagline only.</p>
        ${liftTable(framing, median)}
      </section>

      <section>
        <h2>Top 25 launches</h2>
        <div class="table-scroll"><table class="data">
          <thead><tr><th class="n">Votes</th><th>Launch</th><th class="n">Day rank</th><th class="n">Date</th></tr></thead>
          <tbody>${top.map((l) => html`<tr><td class="n">${num(l.votes)}</td><td>${launchCell({ ...l, taglineIsApproximate: l.taglineKind === 'approx' })}</td><td class="n">#${l.rank}</td><td class="n">${day(l.date)}</td></tr>`)}</tbody>
        </table></div>
      </section>`,
  });
}

// ---- method ------------------------------------------------------------------------------

export function method({ corpus, backtest }) {
  const m = backtest.conditionsModel;
  return layout({
    title: 'Method and limits',
    active: '/method',
    body: html`
      <section class="page-head prose">
        <h1>Method, and where it falls short</h1>
        <p class="lede">Most launch-score tools give you a number and no way to check it. This page is the check.</p>
      </section>

      <section class="prose">
        <h2>The short version</h2>
        <p>
          We tried to predict a launch’s votes from its pitch and tested the attempt on launches the model had not seen.
          Wording alone ranks launches about as well as a coin flip (ρ = ${backtest.wordingOnly.leaveOneOutSpearman.toFixed(2)}).
          Theme, framing and weekday together do a little better (ρ = ${m.crossValidatedSpearman.toFixed(2)}).
          So Windtunnel reports conditions and evidence, and does not claim to forecast your launch. What decides most of the
          outcome, the maker’s audience, the hunter and the product, is not in the text.
        </p>
      </section>

      <section>
        <h2>Backtest</h2>
        <div class="tiles">
          <div class="tile"><p class="tile-label">Conditions model, 10-fold cross-validation</p><p class="tile-value">ρ = ${m.crossValidatedSpearman.toFixed(2)}</p><p class="tile-note">Rank correlation with real votes on held-out launches</p></div>
          <div class="tile"><p class="tile-label">Same model, trained on the past only</p><p class="tile-value">ρ = ${m.timeSplitSpearman.toFixed(2)}</p><p class="tile-note">Fitted on the first 60% of the window, tested on the ${m.timeSplitTestN} launches after it</p></div>
          <div class="tile"><p class="tile-label">Wording alone, nearest neighbours</p><p class="tile-value">ρ = ${backtest.wordingOnly.leaveOneOutSpearman.toFixed(2)}</p><p class="tile-note">Leave-one-out over ${num(backtest.n)} launches</p></div>
        </div>
        <p class="section-note">Launches sorted by the conditions the model gave them before seeing their result, in four equal groups:</p>
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Group</th><th class="n">Launches</th><th class="n">Median votes</th><th class="n">Reached top five</th></tr></thead>
          <tbody>${backtest.quartiles.map((q) => html`<tr><th scope="row">${q.label}</th><td class="n">${q.n}</td><td class="n">${num(q.medianVotes)}</td><td class="n">${pct(q.top5Rate)}</td></tr>`)}</tbody>
        </table></div>
        <p class="section-note">The best group does better and the worst does worse, but the middle two are not in order. That is how weak the signal is. Actual votes usually land between ×${m.residualP25} and ×${m.residualP75} of the model’s estimate.</p>
      </section>

      <section class="prose">
        <h2>Where the data comes from</h2>
        <ul>
          ${corpus.meta.sources.map((s) => html`<li><a href="${s.url}" rel="noopener">${s.name}</a>${s.license ? ` (${s.license})` : ''}: ${s.provides}.</li>`)}
        </ul>
        <p>
          Both are public mirrors of Product Hunt’s own API. The first gives outcomes for ${num(corpus.all.length)} launches over
          ${corpus.meta.days} days. The second gives English text for ${num(corpus.statDocs.length)} of them, which is what
          the theme and framing statistics use. A further ${corpus.meta.approximatedTaglines} top launches have taglines
          back-translated by hand from Chinese; they appear as comparables, marked ≈, and are left out of the statistics
          because they were picked for ranking high.
        </p>

        <h2>How each part is computed</h2>
        <ul>
          <li><strong>Closest launches.</strong> TF-IDF over name, tagline and summary, cosine similarity. The words a match rests on are listed beside it.</li>
          <li><strong>Themes and framing.</strong> Plain pattern matches (“MCP”, “the X for Y”, “for agents”). For each, the median votes with and without it, and a two-sided permutation test on log votes. A group needs 15 launches and p &lt; 0.1 to be called a tailwind or headwind.</li>
          <li><strong>Conditions.</strong> A ridge regression of log votes on those indicators plus weekday. The headline is where your pitch’s traits put it among past launches.</li>
          <li><strong>Chance of top five.</strong> The model’s estimate for a weekday, with its own out-of-fold errors replayed against every board for that weekday.</li>
          <li><strong>The bar.</strong> The median votes at each rank across all boards for a weekday. No modelling.</li>
        </ul>

        <h2>Limits</h2>
        <ul>
          ${corpus.meta.caveats.map((c) => html`<li>${c}</li>`)}
          <li>The English text covers AI-related launches. That is most of the board, but a hardware or consumer launch will find fewer comparables.</li>
          <li>Summaries were written by the digest’s own model. The opening clause is the maker’s tagline or close to it; the rest is paraphrase.</li>
          <li>Ninety days is one season. A theme that is hot now may not be in spring.</li>
          <li>Many themes and patterns are tested at once, so one or two “signals” on the trends page are likely to be chance.</li>
        </ul>
      </section>`,
  });
}

// ---- agents ------------------------------------------------------------------------------

export function agents(ctx, { origin }) {
  return layout({
    title: 'For agents: MCP, API and CLI',
    active: '/agents',
    body: html`
      <section class="page-head prose">
        <h1>For agents</h1>
        <p class="lede">Everything on this site is available to an agent over MCP, to a script over JSON, and from a terminal.</p>
      </section>
      <section class="prose">
        <h2>MCP server</h2>
        <p>Streamable HTTP, no key needed. Add it to Claude, ChatGPT, Cursor or any MCP client:</p>
        <pre><code>{
  "mcpServers": {
    "windtunnel": { "url": "${origin}/mcp" }
  }
}</code></pre>
        <p>Or run it locally over stdio from a checkout:</p>
        <pre><code>{
  "mcpServers": {
    "windtunnel": { "command": "node", "args": ["/path/to/windtunnel/bin/windtunnel.js", "mcp"] }
  }
}</code></pre>
        <table class="data">
          <thead><tr><th>Tool</th><th>What it returns</th></tr></thead>
          <tbody>
            <tr><td><code>test_pitch</code></td><td>Conditions, findings, closest launches, crowding, the bar by weekday and failed checks for one pitch.</td></tr>
            <tr><td><code>compare_taglines</code></td><td>Up to eight taglines ranked by conditions, with a verdict that says when the gap is noise.</td></tr>
            <tr><td><code>find_comparables</code></td><td>Past launches similar to a plain-language query, with votes, day rank and links.</td></tr>
            <tr><td><code>launch_day_bar</code></td><td>Votes needed for #1, #3, #5 and #10 on each weekday; optionally where a vote count would have placed.</td></tr>
            <tr><td><code>launch_trends</code></td><td>Measured theme and framing performance, top launches and the backtest.</td></tr>
          </tbody>
        </table>
        <p>A prompt that works well: <em>“Draft six taglines for my product, compare them with Windtunnel, show me the closest past launches, then revise the best two.”</em></p>

        <h2>JSON API</h2>
        <pre><code>curl -s ${origin}/api/test -H 'content-type: application/json' \\
  -d '{"name":"Acme","tagline":"Turn website traffic into booked meetings"}'

curl -s ${origin}/api/compare -H 'content-type: application/json' \\
  -d '{"taglines":["The Vercel for GTM","Sales automation for startups"]}'

curl -s '${origin}/api/comparables?q=voice+dictation+for+mac&limit=5'
curl -s ${origin}/api/trends
curl -s ${origin}/api/backtest</code></pre>
        <p>Write endpoints are limited to 40 requests a minute per address.</p>

        <h2>Command line</h2>
        <pre><code>windtunnel test "Turn website traffic into booked meetings" --name Acme
windtunnel compare "The Vercel for GTM" "Sales automation for startups"
windtunnel bar            # votes needed by weekday
windtunnel eval           # run the backtest
windtunnel serve --port 3000</code></pre>
      </section>`,
  });
}

// ---- pricing -----------------------------------------------------------------------------

export function pricing(ctx, { joined, error } = {}) {
  return layout({
    title: 'Pricing',
    active: '/pricing',
    body: html`
      <section class="page-head">
        <h1>Free now. Paid when it earns it.</h1>
        <p class="lede">Everything on this site is free today. The two paid plans below are planned, not built. Join the list and you will hear once, when they open.</p>
      </section>
      ${joined ? html`<p class="notice" role="status">${joined === 'yes' ? 'You are on the list. One email, when it opens.' : 'You were already on the list.'}</p>` : ''}
      ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
      <section class="plans">
        <div class="panel plan">
          <h2>Free</h2>
          <p class="price">$0</p>
          <p class="muted">Available now</p>
          <ul class="plain">
            <li>Unlimited pitch reports and comparisons</li>
            <li>Trends, the weekday bar and the backtest</li>
            <li>MCP server, JSON API and CLI</li>
            <li>Shareable report links</li>
          </ul>
          <a class="button primary" href="/">Test a pitch</a>
        </div>
        <div class="panel plan">
          <h2>Launch pass</h2>
          <p class="price">$39 <span>per launch</span></p>
          <p class="muted">Planned</p>
          <ul class="plain">
            <li>Watch your space: an alert when a similar product launches before you do</li>
            <li>Launch-day pace line against the day’s bar, hour by hour</li>
            <li>Private reports and saved tagline history</li>
            <li>Data refreshed every day</li>
          </ul>
          ${waitlistForm('launch')}
        </div>
        <div class="panel plan">
          <h2>Studio</h2>
          <p class="price">$149 <span>a month</span></p>
          <p class="muted">Planned, for agencies and launch consultants</p>
          <ul class="plain">
            <li>Unlimited products and client workspaces</li>
            <li>White-label reports</li>
            <li>API without rate limits</li>
            <li>A weekly brief on what moved</li>
          </ul>
          ${waitlistForm('studio')}
        </div>
      </section>`,
  });
}

function waitlistForm(plan) {
  return html`<form class="waitlist" method="post" action="/waitlist">
    <input type="hidden" name="plan" value="${plan}" />
    <label class="vh" for="email-${plan}">Email address</label>
    <input id="email-${plan}" type="email" name="email" required placeholder="you@company.com" autocomplete="email" />
    <button class="secondary" type="submit">Join the waitlist</button>
  </form>`;
}

// ---- misc --------------------------------------------------------------------------------

export function notFound() {
  return layout({
    title: 'Not found',
    body: html`<section class="page-head"><h1>Nothing here</h1><p class="lede">That page or report does not exist. Reports are kept on this server and may have been cleared.</p><p><a class="button primary" href="/">Test a pitch</a></p></section>`,
  });
}

export function errorPage(message) {
  return layout({
    title: 'Something went wrong',
    body: html`<section class="page-head"><h1>That did not work</h1><p class="lede">${message}</p><p><a class="button primary" href="/">Back to the start</a></p></section>`,
  });
}

export function llmsTxt({ corpus }, origin) {
  return `# Windtunnel

> Launch intelligence for Product Hunt. Checks a pitch against ${corpus.all.length} real launches (${corpus.meta.from} to ${corpus.meta.to}) and reports conditions and evidence, not a forecast.

## For agents
- MCP endpoint (streamable HTTP, no auth): ${origin}/mcp
- Tools: test_pitch, compare_taglines, find_comparables, launch_day_bar, launch_trends
- [Setup and API reference](${origin}/agents)

## JSON API
- POST ${origin}/api/test {"tagline": "...", "name": "...", "description": "..."}
- POST ${origin}/api/compare {"taglines": ["...", "..."]}
- GET ${origin}/api/comparables?q=...&limit=10
- GET ${origin}/api/trends
- GET ${origin}/api/backtest

## Pages
- [Trends](${origin}/trends): votes needed by weekday, theme and framing performance
- [Method and limits](${origin}/method): data sources, backtest, caveats
`;
}
