// Server-rendered pages. No client framework: the pages are documents, and the only
// script (public/app.js) adds a character counter, example fill-in, copy-link and
// the chart hover layer.

import { lowerFirst } from '../engine/analyze.js';
import { TAGLINE_LIMIT } from '../engine/patterns.js';
import { html, launchUrl, raw } from './html.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const num = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x) => `${Math.round(x * 100)}%`;
export const day = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const pValue = (p) => (p < 0.01 ? 'p < 0.01' : `p = ${p.toFixed(2)}`);

// ---- layout ------------------------------------------------------------------------------

const NAV = [
  ['/', 'Test a pitch'],
  ['/panel', 'Audience panel'],
  ['/buyers', 'Buyer agents'],
  ['/trends', 'Trends'],
  ['/method', 'Method'],
  ['/agents', 'For agents'],
  ['/pricing', 'Pricing'],
];

export function layout({ title, description, active, body, noindex = false }) {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title ? `${title} · Windtunnel` : 'Windtunnel: test your launch on the market, on people and on agents'}</title>
    <meta name="description" content="${description ?? 'Test a Product Hunt launch three ways before launch day: against thousands of real launches, on a simulated audience, and on simulated buyer agents.'}" />
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
          Windtunnel is independent and not affiliated with Product Hunt. Measured figures come from public mirrors of
          Product Hunt’s API and cover the daily top 30 only. Simulated figures come from an AI model playing a role, and are
          labelled as such. <a href="/method">How it works and where it falls short</a>.
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

export function launchCell(l) {
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

/** What kind of evidence a figure is. Shown beside every test and every result. */
export function kindChip(kind) {
  return kind === 'measured'
    ? html`<span class="chip kind measured" title="Counted from real Product Hunt launches">Measured</span>`
    : html`<span class="chip kind simulated" title="Produced by an AI model playing a role. Not real people or real buyers.">Simulated</span>`;
}

export function pitchForm({ prefill = {}, error, action = '/test', button = 'Run the tunnel', busy, aside, facts = false, descriptionHint = 'optional, sharpens the match', idPrefix = '' }) {
  const id = (name) => `${idPrefix}${name}`;
  return html`<form class="pitch" method="post" action="${action}" ${busy ? raw(`data-busy="${busy}"`) : ''}>
    ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
    <div class="field">
      <label for="${id('tagline')}">Tagline</label>
      <input id="${id('tagline')}" class="tagline-input" name="tagline" required maxlength="300" autocomplete="off" value="${prefill.tagline ?? ''}"
        placeholder="Turn website traffic into booked meetings" data-count="#${id('tagline-count')}" data-limit="${TAGLINE_LIMIT}" />
      <p class="help"><span id="${id('tagline-count')}" class="count">0</span> / ${TAGLINE_LIMIT} characters, Product Hunt’s limit</p>
    </div>
    <div class="field">
      <label for="${id('name')}">Product name <span class="opt">optional</span></label>
      <input id="${id('name')}" name="name" maxlength="80" autocomplete="off" value="${prefill.name ?? ''}" placeholder="Acme" />
    </div>
    <div class="field">
      <label for="${id('description')}">What it does <span class="opt">${descriptionHint}</span></label>
      <textarea id="${id('description')}" name="description" rows="3" maxlength="2000" placeholder="Two or three plain sentences about what the product does and who uses it.">${prefill.description ?? ''}</textarea>
    </div>
    ${facts
      ? html`<div class="field">
          <label for="${id('facts')}">Facts sheet <span class="opt">what your agent is allowed to say: pricing, integrations, limits, data handling, customers</span></label>
          <textarea id="${id('facts')}" name="facts" rows="6" maxlength="4000" placeholder="$49 a month per seat, 14-day trial.&#10;Integrates with HubSpot and Salesforce.&#10;Data stored in the EU; SOC 2 in progress.">${prefill.facts ?? ''}</textarea>
        </div>`
      : ''}
    <div class="actions">
      <button class="primary" type="submit">${button}</button>
      ${aside ?? ''}
    </div>
  </form>`;
}

// ---- home --------------------------------------------------------------------------------

const EXAMPLES = [
  { label: 'A sales agent', name: 'Relay', tagline: 'Turn website visitors into booked sales calls', description: 'An AI sales agent that qualifies inbound visitors on your site and books meetings for your sales team.' },
  { label: 'A local Mac app', name: 'Quill', tagline: 'Private, local AI note-taking for your Mac', description: 'A Mac app that transcribes and summarises meetings on-device. Nothing leaves your computer.' },
  { label: 'An MCP server', name: 'Ledger MCP', tagline: 'Give your coding agent your Stripe data', description: 'An MCP server that lets Claude Code and Cursor query billing, subscriptions and revenue.' },
];

export function home({ corpus, backtest, sim }, { prefill, error }) {
  const tue = corpus.weekdays.find((w) => w.label === 'Tuesday');
  const sat = corpus.weekdays.find((w) => w.label === 'Saturday');
  const best = corpus.themeStats.filter((t) => t.direction === 'tailwind').sort((a, b) => b.lift - a.lift)[0];
  return layout({
    active: '/',
    body: html`
      <section class="hero">
        ${streamlines()}
        <h1>Test your launch on the market, on people and on agents.</h1>
        <p class="lede">
          Three tests for a Product Hunt launch, before launch day. One is measured from ${num(corpus.all.length)} real
          launches. Two are simulated, and say so.
        </p>
      </section>

      <section class="tests" aria-label="The three tests">
        <article class="panel test">
          <p class="test-kind">${kindChip('measured')}</p>
          <h2>The market</h2>
          <p>Who already shipped this, how they did, how crowded it is, and how many votes top five takes on each weekday.</p>
          <p class="muted">Instant. Start here.</p>
        </article>
        <article class="panel test">
          <p class="test-kind">${kindChip('simulated')}</p>
          <h2><a href="/panel">The audience</a></h2>
          <p>Twelve simulated visitors see your launch on a real past board. Who opens it, who upvotes it, what they think it is, what stops them.</p>
          <p class="muted">${sim.enabled ? 'About 20 seconds.' : 'Not switched on for this deployment.'}</p>
        </article>
        <article class="panel test">
          <p class="test-kind">${kindChip('simulated')}</p>
          <h2><a href="/buyers">Buyer agents</a></h2>
          <p>Simulated purchasing agents choose between you and your real competitors, then question your agent the way a buyer’s would.</p>
          <p class="muted">${sim.enabled ? 'About 20 seconds, or turn by turn.' : 'Not switched on for this deployment.'}</p>
        </article>
      </section>

      <section class="panel form-panel" aria-label="Test a pitch against the market">
        <h2 class="form-title">Start with the market ${kindChip('measured')}</h2>
        ${pitchForm({ prefill, error, aside: html`<a class="quiet" href="/compare">or compare several taglines</a>` })}
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
          <p class="tile-note">Close to a coin flip, so we do not sell you a score. <a href="/method">Our backtests</a></p>
        </div>
      </section>

      <section class="split">
        <div>
          <h2>Measured and simulated are kept apart</h2>
          <ul class="plain">
            <li><strong>Measured</strong> means counted from real launches: votes, day ranks, how themes and framings actually did. We publish how little of a launch these explain.</li>
            <li><strong>Simulated</strong> means an AI model playing a visitor or a buyer’s agent. It is good at telling you what is unclear and what people will ask. It is not a forecast of real behaviour.</li>
            <li><strong>Every figure carries its label</strong>, and simulated results are given as counts (“7 of 12”), never as percentages of a market.</li>
          </ul>
          <p><a href="/method">How each test works, and where it falls short</a></p>
        </div>
        <div>
          <h2>Works inside your agent</h2>
          <p>Windtunnel is also an MCP server. Your agent can draft taglines, test them against the data, run the panel, and sit an interview with a simulated buyer’s agent, all in one conversation.</p>
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

export function report(ctx, r, { url }) {
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
        <p class="eyebrow">${kindChip('measured')} Launch conditions · ${num(r.corpus.launches)} launches, ${day(r.corpus.from)} to ${day(r.corpus.to)}</p>
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
      </section>

      <section>
        <h2>Go further</h2>
        <p class="section-note">The figures above are measured from past launches. These two tests are simulated: an AI model plays the audience and the buyer.</p>
        <div class="tests two">
          <article class="panel test">
            <p class="test-kind">${kindChip('simulated')}</p>
            <h3>Audience panel</h3>
            <p>Put this pitch on a real past board in front of twelve simulated visitors.</p>
            <a class="button secondary" href="/panel?${new URLSearchParams(r.input)}">Set up the panel</a>
          </article>
          <article class="panel test">
            <p class="test-kind">${kindChip('simulated')}</p>
            <h3>Buyer agents</h3>
            <p>See whether purchasing agents pick this over the launches listed above.</p>
            <a class="button secondary" href="/buyers?${new URLSearchParams(r.input)}">Set up the buyer test</a>
          </article>
        </div>
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

export function comparison(ctx, r, { url }) {
  return layout({
    title: 'Tagline comparison',
    active: '/compare',
    noindex: true,
    body: html`
      <section class="report-head">
        <p class="eyebrow">Tagline comparison · ${num(ctx.corpus.all.length)} launches, ${day(ctx.corpus.meta.from)} to ${day(ctx.corpus.meta.to)}</p>
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

function panelBacktest(e) {
  if (!e) {
    return html`<p class="notice off" role="status"><strong>Not run yet.</strong> The panel has not been scored against real boards. Until it has, read its ranking as untested and use the panel for what it says about clarity, objections and questions.</p>`;
  }
  const h = e.heldOut;
  return html`
    <div class="tiles">
      <div class="tile"><p class="tile-label">Panel ranking against the real ranking</p><p class="tile-value">ρ = ${h.meanSpearman.toFixed(2)}</p><p class="tile-note">Mean within-day rank correlation over ${h.days} held-out days, 95% interval ${h.ci[0].toFixed(2)} to ${h.ci[1].toFixed(2)}</p></div>
      <div class="tile"><p class="tile-label">Panel’s top three that were real top three</p><p class="tile-value">${pct(h.top3.hit)}</p><p class="tile-note">Chance on these boards is ${pct(h.top3.chance)}</p></div>
      <div class="tile"><p class="tile-label">The panel against itself</p><p class="tile-value">ρ = ${h.retest.toFixed(2)}</p><p class="tile-note">Two runs of the identical prompt on the same boards. ${h.upvotesRepeated == null ? '' : html`A visitor repeated ${pct(h.upvotesRepeated)} of their own upvotes.`} This is the noise any comparison has to clear.</p></div>
    </div>
    ${h.withCounts
      ? html`<p class="section-note">
          <strong>Does seeing votes help?</strong> A third pass showed each visitor the first pass’s upvote counts. Agreement with the
          real ranking was ρ = ${h.withCounts.meanSpearman.toFixed(2)} with counts and ${h.withCounts.withoutCounts.toFixed(2)} without, a difference of
          ${h.withCounts.difference.toFixed(2)} (interval ${h.withCounts.differenceCi[0].toFixed(2)} to ${h.withCounts.differenceCi[1].toFixed(2)}). Two passes that both saw no
          counts differed by ${h.withCounts.noise.toFixed(2)} (${h.withCounts.noiseCi[0].toFixed(2)} to ${h.withCounts.noiseCi[1].toFixed(2)}), so read the first figure against
          that.
        </p>`
      : ''}
    <div class="table-scroll"><table class="data">
      <thead><tr><th>Ranking a real board by</th><th class="n">Mean within-day ρ</th></tr></thead>
      <tbody>
        <tr><th scope="row">The audience panel (${e.model})</th><td class="n">${h.meanSpearman.toFixed(2)}</td></tr>
        <tr><th scope="row">The panel, only launches the model did not recognise${h.unrecognised ? ` (${h.unrecognised.launches} launches)` : ''}</th><td class="n">${h.unrecognised ? h.unrecognised.meanSpearman.toFixed(2) : '—'}</td></tr>
        <tr><th scope="row">The measured conditions model</th><td class="n">${h.baselines.conditionsModel.toFixed(2)}</td></tr>
        <tr><th scope="row">Tagline length alone</th><td class="n">${h.baselines.taglineLength.toFixed(2)}</td></tr>
      </tbody>
    </table></div>
    <p class="section-note">
      Scored on ${h.launches} launches across ${h.days} days the prompts were never tuned on (${e.dev.days} other days were
      used for tuning). Run ${day(e.ranAt)} ${e.ranAt.slice(0, 4)}. A test in the code fails if the live panel prompt differs from the one scored here.
    </p>`;
}

export function method({ corpus, backtest, panelEval }) {
  const m = backtest.conditionsModel;
  return layout({
    title: 'Method and limits',
    active: '/method',
    body: html`
      <section class="page-head prose">
        <h1>Method, and where it falls short</h1>
        <p class="lede">Most launch tools give you a number and no way to check it. This page is the check, for the measured test and the simulated ones.</p>
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
        <h2>Backtest of the measured test ${kindChip('measured')}</h2>
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

      <section class="prose" id="simulated">
        <h2>The simulated tests ${kindChip('simulated')}</h2>
        <p>
          The audience panel and the buyer-agent tests are produced by an AI model (${panelEval?.model ?? 'claude-haiku-5-5'}) playing
          roles. They are useful for a different job from the measured test: finding what is unclear, what people object to
          and what they will ask. They are not evidence of what real people or real buyers will do.
        </p>
        <ul>
          <li><strong>Audience panel.</strong> Your launch is placed on a real past board among the launches that competed that day, as a name and a tagline, which is all the board shows. Twelve simulated visitors each choose what to open and upvote without being told which entry is yours; the order is reshuffled for each. A second call shows each visitor your launch page and asks what they think it is, their objection and their question. A final call checks their restatements against your description and groups the objections.</li>
          <li><strong>Who is on the panel.</strong> Eight fixed kinds of Product Hunt visitor and four buyers chosen from your pitch’s themes. This mix is our assumption, not a measurement of Product Hunt’s audience. Your place on the board uses the fixed eight only, because those are what the backtest covers.</li>
          <li><strong>Buyer-agent selection.</strong> One call rewrites every entry, yours included, into a neutral sentence and writes four client briefs from the group as a whole. Twelve agent runs (four briefs, three dispositions) each choose from the catalogue in a different order.</li>
          <li><strong>Agent interview.</strong> A buyer’s agent asks up to five questions. In a rehearsal a stand-in seller answers from your facts sheet only; over MCP your own agent answers. A grader marks each answer and checks claims against the facts sheet.</li>
        </ul>
        <h3>Limits of simulated respondents</h3>
        <ul>
          <li>They are more agreeable and more articulate than real people. Weigh objections more than approval.</li>
          <li>The model may recognise well-known products on a board and favour them. The backtest reports the unrecognised launches separately for this reason.</li>
          <li>The catalogue for buyer agents is built from launch listings. A real buyer’s agent would read your site, your pricing page and your documentation.</li>
          <li>Runs vary. The same pitch can score a visitor or two differently the next time; the repeat-run figure below shows by how much.</li>
          <li>Twelve respondents is a small panel. Results are given as counts so that nobody reads “58%” into seven of twelve.</li>
        </ul>
      </section>

      <section class="prose" id="thread">
        <h2>The thread, and its placebo ${kindChip('simulated')}</h2>
        <p>
          After a panel, each visitor’s hesitation and question becomes a comment on your launch. You reply, or a stand-in
          limited to your facts sheet does, or your own agent does over MCP. Each visitor then reads the reply to their own
          comment and says whether the hesitation is resolved, partly resolved or still stands, and whether they would try
          the product now.
        </p>
        <ul>
          <li><strong>The placebo.</strong> Each visitor is asked the same thing a second time, after a reply of the same length that thanks them and tells them nothing. Simulated people warm to being answered at all. A reply has done something only where it beats the placebo, so the two counts are always shown together.</li>
          <li><strong>The grade.</strong> One more call marks each reply as answering, partly answering or evading the comment, and lists any claim the facts sheet does not support.</li>
          <li><strong>What it cannot tell you.</strong> It is one run of at most twelve visitors, and the model’s answers vary from run to run. A difference of one or two visitors between reply and placebo is within the noise. It shows which replies fail to answer the question and which claims you cannot back; it does not show how real commenters will react.</li>
          <li><strong>Your words are data.</strong> Replies are passed to the model as quoted text, capped at 500 characters, and shown exactly as written with their source.</li>
        </ul>
      </section>

      <section id="panel-backtest">
        <h2>Backtest of the audience panel</h2>
        <p class="section-note">
          Does the panel rank a board the way real voters did? We showed it real days, as names and taglines only, and compared
          its upvotes with the real day rank. This tests ordering among launches that made the board. It cannot test whether
          a launch would have sunk without trace, because those are not in the data.
        </p>
        ${panelBacktest(panelEval)}
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
  const sim = ctx.sim.enabled;
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
            <tr><td><code>run_audience_panel</code></td><td>Simulated. Twelve visitors on a real past board: opens, upvotes, comprehension, objections, questions.</td></tr>
            <tr><td><code>run_buyer_agents</code></td><td>Simulated. Twelve purchasing-agent runs choosing between the product and real competitors.</td></tr>
            <tr><td><code>start_agent_interview</code></td><td>Simulated. Opens an interview in which the calling agent is the seller. Returns the buyer’s first question.</td></tr>
            <tr><td><code>reply_to_buyer</code></td><td>Simulated. Sends the seller’s answer; returns the next question, or the scorecard at the end.</td></tr>
            <tr><td><code>start_launch_thread</code></td><td>Simulated. Turns a finished panel into a comment thread for the calling agent to answer as the maker.</td></tr>
            <tr><td><code>post_maker_replies</code></td><td>Simulated. Sends the replies; returns who moved after each reply and after a placebo, a mark per reply, and unsupported claims.</td></tr>
          </tbody>
        </table>
        <p>${sim
          ? 'The six simulated tools are switched on here. They take about 20 seconds, or one turn at a time, and count against a daily run limit.'
          : 'The six simulated tools are not switched on for this deployment, so its MCP server lists only the first five.'}</p>
        <p>Prompts that work well:</p>
        <ul>
          <li><em>“Draft six taglines for my product, compare them with Windtunnel, show me the closest past launches, then revise the best two.”</em></li>
          <li><em>“Run the Windtunnel audience panel on our launch page copy and rewrite the description to fix whatever people misread.”</em></li>
          <li><em>“You are our sales agent. Start a Windtunnel interview and answer the buyer from this pricing page and these docs only.”</em></li>
          <li><em>“Run the Windtunnel panel on our launch, open the thread, and answer every comment as our community agent would. Tell me which replies did no better than the placebo.”</em></li>
        </ul>

        <h2>JSON API</h2>
        <pre><code>curl -s ${origin}/api/test -H 'content-type: application/json' \\
  -d '{"name":"Acme","tagline":"Turn website traffic into booked meetings"}'

curl -s ${origin}/api/compare -H 'content-type: application/json' \\
  -d '{"taglines":["The Vercel for GTM","Sales automation for startups"]}'

curl -s '${origin}/api/comparables?q=voice+dictation+for+mac&limit=5'
curl -s ${origin}/api/trends
curl -s ${origin}/api/backtest

# Simulated tests
curl -s ${origin}/api/panel -H 'content-type: application/json' \\
  -d '{"name":"Acme","tagline":"Turn website traffic into booked meetings","description":"..."}'
curl -s ${origin}/api/buyers -H 'content-type: application/json' -d '{"tagline":"...","description":"..."}'

# Interview with your own agent as the seller
curl -s ${origin}/api/interview -H 'content-type: application/json' -d '{"tagline":"...","facts":"..."}'
curl -s ${origin}/api/interview/INTERVIEW_ID/reply -H 'content-type: application/json' -d '{"message":"..."}'

# Answer a panel's comments as the maker
curl -s ${origin}/api/thread -H 'content-type: application/json' -d '{"panel_id":"PANEL_ID","facts":"..."}'
curl -s ${origin}/api/thread/THREAD_ID/replies -H 'content-type: application/json' \\
  -d '{"replies":[{"comment":1,"reply":"..."}]}'</code></pre>
        <p>Write endpoints are limited to 40 requests a minute per address, and simulated runs to a few a day.</p>

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
  const signup = (plan) => (ctx.waitlistOpen ? waitlistForm(plan) : html`<p class="muted">The waitlist is not open on this deployment yet.</p>`);
  return layout({
    title: 'Pricing',
    active: '/pricing',
    body: html`
      <section class="page-head">
        <h1>Free now. Paid when it earns it.</h1>
        <p class="lede">Everything on this site is free today. The two paid plans below are planned, not built.${ctx.waitlistOpen ? ' Join the list and you will hear once, when they open.' : ''}</p>
      </section>
      ${joined ? html`<p class="notice" role="status">${joined === 'yes' ? 'You are on the list. One email, when it opens.' : 'You were already on the list.'}</p>` : ''}
      ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
      <section class="plans">
        <div class="panel plan">
          <h2>Free</h2>
          <p class="price">$0</p>
          <p class="muted">Available now</p>
          <ul class="plain">
            <li>Unlimited market reports and tagline comparisons</li>
            <li>Trends, the weekday bar and both backtests</li>
            ${ctx.sim.enabled
              ? html`<li>Audience panel, buyer-agent test and interview rehearsal: a few runs a day per visitor, within a shared daily budget</li>`
              : html`<li>Audience panel and buyer-agent tests, where the deployment has them switched on</li>`}
            <li>MCP server, JSON API and CLI</li>
          </ul>
          <a class="button primary" href="/">Test a pitch</a>
        </div>
        <div class="panel plan">
          <h2>Launch pass</h2>
          <p class="price">$39 <span>per launch</span></p>
          <p class="muted">Planned</p>
          <ul class="plain">
            <li>Larger panels, on several past boards at once</li>
            <li>Your own personas: describe your real customers and put them on the panel</li>
            <li>Tagline variants run through the panel side by side</li>
            <li>An alert when a similar product launches before you do</li>
            <li>Private results and saved history</li>
          </ul>
          ${signup('launch')}
        </div>
        <div class="panel plan">
          <h2>Studio</h2>
          <p class="price">$149 <span>a month</span></p>
          <p class="muted">Planned, for agencies and launch consultants</p>
          <ul class="plain">
            <li>Unlimited products and client workspaces</li>
            <li>Scheduled buyer-agent tests against named competitors</li>
            <li>Interviews of your production agent on a schedule, with regressions flagged</li>
            <li>White-label reports and an API without run limits</li>
          </ul>
          ${signup('studio')}
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
    body: html`<section class="page-head"><h1>Nothing here</h1><p class="lede">That page does not exist, or the report link is incomplete. Report links carry the whole pitch, so check that the address was copied in full.</p><p><a class="button primary" href="/">Test a pitch</a></p></section>`,
  });
}

export function errorPage(message) {
  return layout({
    title: 'Something went wrong',
    body: html`<section class="page-head"><h1>That did not work</h1><p class="lede">${message}</p><p><a class="button primary" href="/">Back to the start</a></p></section>`,
  });
}

export function llmsTxt({ corpus, sim }, origin) {
  return `# Windtunnel

> Tests a Product Hunt launch three ways. Measured: a pitch against ${corpus.all.length} real launches (${corpus.meta.from} to ${corpus.meta.to}). Simulated: an audience panel on a real past board, and buyer agents choosing between the product and real competitors or interviewing its agent. Simulated output is labelled and is not a forecast.

## For agents
- MCP endpoint (streamable HTTP, no auth): ${origin}/mcp
- Measured tools: test_pitch, compare_taglines, find_comparables, launch_day_bar, launch_trends
- Simulated tools${sim.enabled ? '' : ' (not switched on for this deployment)'}: run_audience_panel, run_buyer_agents, start_agent_interview, reply_to_buyer, start_launch_thread, post_maker_replies
- [Setup and API reference](${origin}/agents)

## JSON API
- POST ${origin}/api/test {"tagline": "...", "name": "...", "description": "..."}
- POST ${origin}/api/compare {"taglines": ["...", "..."]}
- GET ${origin}/api/comparables?q=...&limit=10
- GET ${origin}/api/trends
- GET ${origin}/api/backtest
- POST ${origin}/api/panel, ${origin}/api/buyers {"tagline": "...", "name": "...", "description": "..."} (simulated)
- POST ${origin}/api/interview {"tagline": "...", "facts": "..."} then POST ${origin}/api/interview/{id}/reply {"message": "..."} (simulated)
- POST ${origin}/api/thread {"panel_id": "...", "facts": "..."} then POST ${origin}/api/thread/{id}/replies {"replies": [{"comment": 1, "reply": "..."}]} (simulated)

## Pages
- [Audience panel](${origin}/panel) and [buyer agents](${origin}/buyers): the simulated tests
- [Trends](${origin}/trends): votes needed by weekday, theme and framing performance
- [Method and limits](${origin}/method): data sources, backtest, caveats
`;
}
