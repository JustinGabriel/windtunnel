// Pages for the simulated tests: the audience panel, buyer-agent selection and the
// agent interview. Every page says in its heading that the contents are simulated.

import { TAGLINE_LIMIT } from '../engine/patterns.js';
import { MAX_TURNS } from '../sim/interview.js';
import { REPLY_CAP } from '../sim/thread.js';
import { html } from './html.js';
import { day, kindChip, launchCell, layout, num, pitchForm } from './views.js';

const of = (n, total) => html`<span class="of">${n}<span class="of-total"> of ${total}</span></span>`;

function offNotice(sim) {
  return sim.enabled ? '' : html`<p class="notice off" role="status"><strong>Not available here.</strong> ${sim.message} The measured test on the <a href="/">home page</a> still works.</p>`;
}

function resultHead({ eyebrow, r, url, again }) {
  const over = r.input.tagline.length > TAGLINE_LIMIT;
  return html`<section class="report-head">
    <p class="eyebrow">${kindChip('simulated')} ${eyebrow}</p>
    <h1>${r.input.name || 'Your launch'}</h1>
    <p class="quote">“${r.input.tagline}” <span class="chip ${over ? 'warn' : ''}">${r.input.tagline.length}/${TAGLINE_LIMIT}</span></p>
    <div class="actions">
      <button type="button" class="secondary" data-copy="${url}">Copy link to this result</button>
      <a class="quiet" href="${again}?${new URLSearchParams(r.input)}">Edit and re-run</a>
    </div>
  </section>`;
}

function runFooter(r) {
  return html`<p class="run-note">
    Simulated by ${r.model} in ${r.usage.calls} calls${r.usage.failed ? html` (${r.usage.failed} did not answer)` : ''}, about
    $${r.usage.usd.toFixed(3)}. Results are kept for 90 days. <a href="/method#simulated">What simulated results can and cannot tell you</a>
  </p>`;
}

/** A row of filled and empty dots: n of total. Decorative; the number is printed beside it. */
function dots(n, total) {
  const size = 9;
  const gap = 4;
  return html`<svg class="dots" viewBox="0 0 ${total * (size + gap)} ${size}" width="${total * (size + gap)}" height="${size}" aria-hidden="true">
    ${Array.from({ length: total }, (_, i) => html`<circle class="${i < n ? 'on' : ''}" cx="${i * (size + gap) + size / 2}" cy="${size / 2}" r="${size / 2}" />`)}
  </svg>`;
}

// ---- audience panel ----------------------------------------------------------------------

export function panelPage({ sim, panelEval }, { prefill = {}, error } = {}) {
  return layout({
    title: 'Audience panel',
    description: 'Put a Product Hunt launch in front of twelve simulated visitors on a real past board: who opens it, who upvotes it, what they think it is.',
    active: '/panel',
    body: html`
      <section class="page-head">
        <p class="eyebrow">${kindChip('simulated')}</p>
        <h1>Audience panel</h1>
        <p class="lede">
          Twelve simulated visitors see your launch on a real past board, between the launches that actually competed that
          day. Nobody tells them which one is yours. Then each reads your launch page and says what they think it is.
        </p>
      </section>
      ${offNotice(sim)}
      <section class="panel form-panel">
        ${pitchForm({
          prefill,
          error,
          action: '/panel',
          button: 'Run the panel',
          busy: 'Running the panel. About 20 seconds',
          descriptionHint: 'what visitors read on your launch page; needed for the comprehension check',
        })}
      </section>
      <section class="split">
        <div>
          <h2>What you get</h2>
          <ul class="plain">
            <li><strong>Opened and upvoted.</strong> How many of the twelve picked you off the board, and where that puts you among the day’s real launches.</li>
            <li><strong>Understood.</strong> Each visitor says in their own words what the product is. Their versions are checked against yours.</li>
            <li><strong>What stops them.</strong> Objections, grouped, with how many raised each.</li>
            <li><strong>What they will ask.</strong> The comment-thread questions to have answers ready for.</li>
          </ul>
        </div>
        <div>
          <h2>What it is not</h2>
          <ul class="plain">
            <li>These are not people. An AI model plays eight kinds of Product Hunt visitor and four buyers chosen to fit your pitch. The mix is our assumption.</li>
            <li>It is not a vote forecast. ${panelEval
              ? html`On real past boards, the panel’s ranking agreed with the real one at ρ = ${panelEval.heldOut.meanSpearman.toFixed(2)} (0 is chance, 1 is perfect). <a href="/method#panel-backtest">The backtest</a>`
              : html`The panel has not yet been backtested against real boards, so treat its ranking as untested. <a href="/method#simulated">Method</a>`}</li>
            <li>Simulated respondents tend to be more agreeable and more articulate than real ones. Weigh objections more than praise.</li>
          </ul>
        </div>
      </section>`,
  });
}

const VERDICT = { right: ['Got it', 'good'], partly: ['Partly', 'mid'], wrong: ['Misread', 'bad'] };
const TRY = { yes: 'Would try', maybe: 'Might try', no: 'Would not try' };

export function panelResult(ctx, r, { url, threadError, facts = '' }) {
  const t = r.tallies;
  const fixed = r.board.fixedAnswered;
  return layout({
    title: `${r.input.name || 'Launch'}: audience panel`,
    active: '/panel',
    noindex: true,
    body: html`
      ${resultHead({ eyebrow: `Audience panel · board of ${day(r.board.date)} · ${t.answeredBoard} of ${t.panelSize} answered`, r, url, again: '/panel' })}

      <section class="tiles four">
        <div class="tile"><p class="tile-label">Opened your launch</p><p class="tile-value">${of(t.opened, t.answeredBoard)}</p><p class="tile-note">Chosen from the board on name and tagline alone</p></div>
        <div class="tile"><p class="tile-label">Upvoted it</p><p class="tile-value">${of(t.upvoted, t.answeredBoard)}</p><p class="tile-note">${t.wouldTry.yes} would try it, ${t.wouldTry.maybe} might, ${t.wouldTry.no} would not</p></div>
        <div class="tile"><p class="tile-label">Understood what it is</p><p class="tile-value">${t.judged ? of(t.understood, t.judged) : '—'}</p><p class="tile-note">${t.judged ? html`${t.partly} partly, ${t.misread} misread` : 'Not enough answers to judge'}</p></div>
        <div class="tile"><p class="tile-label">Place on the board</p><p class="tile-value">#${r.board.place}<span class="of-total"> of ${r.board.of}</span></p><p class="tile-note">By the ${fixed} regular visitors’ upvotes, then opens</p></div>
      </section>

      <section>
        <h2>The board</h2>
        <p class="section-note">
          Your launch among the real launches of ${day(r.board.date)}. The panel columns are simulated, from the ${fixed} regular
          visitors. The last two columns are what really happened that day.
        </p>
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Launch</th><th>Panel upvotes</th><th class="n">Panel opens</th><th class="n">Real votes</th><th class="n">Real day rank</th></tr></thead>
          <tbody>
            ${r.board.standing.map(
              (e) => html`<tr class="${e.isYou ? 'matched' : ''}">
                <td>${e.isYou ? html`<div class="launch"><span><strong>${e.name}</strong> <span class="chip on">Yours</span></span><span class="tag">${e.tagline}</span></div>` : launchCell(e)}</td>
                <td><span class="dotcell">${dots(e.panelUpvotes, fixed)} <span class="n">${e.panelUpvotes}</span></span></td>
                <td class="n">${e.panelOpens}</td>
                <td class="n">${e.realVotes == null ? '—' : num(e.realVotes)}</td>
                <td class="n">${e.realRank == null ? '—' : `#${e.realRank}`}</td>
              </tr>`,
            )}
          </tbody>
        </table></div>
      </section>

      ${r.themes.length
        ? html`<section>
            <h2>What stopped them</h2>
            <ul class="themes">
              ${r.themes.map((th) => html`<li><span class="theme-count">${of(th.count, t.answeredPage)}</span><div><strong>${th.label}</strong><br /><span class="muted">${th.who.join(', ')}</span></div></li>`)}
            </ul>
          </section>`
        : ''}

      <section>
        <h2>The panel</h2>
        <p class="section-note">Eight regular visitors and four buyers chosen to fit this pitch. Each answered twice: once looking at the board, once after opening your page.</p>
        <div class="cards">
          ${r.respondents.map(
            (p) => html`<article class="panel card">
              <header>
                <h3>${p.label}</h3>
                <span class="chip">${p.group === 'buyer' ? 'Target buyer' : 'Regular visitor'}</span>
              </header>
              <p class="card-flags">
                ${p.answeredBoard
                  ? html`<span class="flag ${p.opened ? 'yes' : 'no'}">${p.opened ? 'Opened' : 'Scrolled past'}</span>
                      <span class="flag ${p.upvoted ? 'yes' : 'no'}">${p.upvoted ? 'Upvoted' : 'No upvote'}</span>`
                  : html`<span class="flag no">Did not answer the board</span>`}
                ${p.answeredPage ? html`<span class="flag ${p.wouldTry === 'yes' ? 'yes' : p.wouldTry === 'no' ? 'no' : ''}">${TRY[p.wouldTry]}</span>` : ''}
              </p>
              ${p.answeredPage
                ? html`<dl>
                    <dt>Thinks it is ${p.verdict ? html`<span class="chip verdict-${VERDICT[p.verdict][1]}">${VERDICT[p.verdict][0]}</span>` : ''}</dt>
                    <dd>${p.restatement}</dd>
                    <dt>Hesitation</dt>
                    <dd>${p.objection}</dd>
                    <dt>Would ask</dt>
                    <dd>${p.question}</dd>
                  </dl>`
                : html`<p class="muted">Did not answer about the page.</p>`}
            </article>`,
          )}
        </div>
      </section>

      <section class="panel form-panel" id="thread">
        <h2 class="form-title">Answer them, and ask again ${kindChip('simulated')}</h2>
        <p class="section-note">
          Each visitor’s hesitation and question becomes a comment on your launch. Reply, and each one is asked again whether
          their hesitation still stands. They are also asked again after a reply of the same length that says nothing, because
          simulated people soften toward anyone who answers them. Your replies count only where they beat that.
        </p>
        <form class="pitch" method="post" action="/p/${r.id}/thread" data-busy="Asking the panel again. About 20 seconds">
          ${threadError ? html`<p class="error" role="alert">${threadError}</p>` : ''}
          <div class="field">
            <label for="thread-facts">Facts sheet <span class="opt">pricing, integrations, limits, data handling, customers. Needed for the stand-in; with your own replies it is what your claims are checked against</span></label>
            <textarea id="thread-facts" name="facts" rows="5" maxlength="4000" placeholder="$49 a month per seat, 14-day trial.&#10;Integrates with HubSpot and Salesforce.&#10;Data stored in the EU; SOC 2 in progress.">${facts}</textarea>
          </div>
          <div class="actions">
            <button class="primary" type="submit" name="mode" value="stand_in">Let a stand-in answer from these facts</button>
            <button class="secondary" type="submit" name="mode" value="typed">Write the replies myself</button>
          </div>
        </form>
        <p class="run-note">Your own agent can answer instead: it calls <code>start_launch_thread</code> with panel id <code>${r.id}</code>, then <code>post_maker_replies</code>. <a href="/agents">MCP setup</a></p>
      </section>

      <section>
        <h2>Next</h2>
        <div class="actions">
          <a class="button secondary" href="/buyers?${new URLSearchParams(r.input)}">Run the buyer-agent test</a>
          <form method="post" action="/test" class="inline">
            <input type="hidden" name="name" value="${r.input.name}" /><input type="hidden" name="tagline" value="${r.input.tagline}" /><input type="hidden" name="description" value="${r.input.description}" />
            <button class="secondary" type="submit">See the measured market report</button>
          </form>
        </div>
        ${runFooter(r)}
      </section>`,
  });
}

// ---- buyer agents ------------------------------------------------------------------------

export function buyersPage({ sim }, { prefill = {}, error, interviewError } = {}) {
  return layout({
    title: 'Buyer agents',
    description: 'Simulated purchasing agents choose between your product and its real competitors, and question your agent the way a buyer’s agent would.',
    active: '/buyers',
    body: html`
      <section class="page-head">
        <p class="eyebrow">${kindChip('simulated')}</p>
        <h1>Buyer agents</h1>
        <p class="lede">
          More buying starts with someone asking an agent to find a tool. Two tests of how that goes for you: whether a
          buyer’s agent picks you over real competitors, and whether your side can answer its questions.
        </p>
      </section>
      ${offNotice(sim)}

      <section class="panel form-panel" id="selection">
        <h2 class="form-title">1. Selection test</h2>
        <p class="section-note">
          Twelve runs: four client briefs, each given to a cost-first, a risk-averse and a capability-first agent. Each
          chooses from a catalogue of your product and the closest real launches, all rewritten into the same neutral
          one-line form. You see how often you are picked, who wins instead, and what the agents could not find out.
        </p>
        ${pitchForm({
          prefill,
          error,
          action: '/buyers',
          button: 'Run the selection test',
          busy: 'Running twelve buyer agents. About 20 seconds',
          descriptionHint: 'the more it says, the fairer the comparison',
          idPrefix: 'sel-',
        })}
      </section>

      <section class="panel form-panel" id="interview">
        <h2 class="form-title">2. Interview rehearsal</h2>
        <p class="section-note">
          A buyer’s agent questions a stand-in for your agent for up to ${MAX_TURNS} turns. The stand-in may say only what
          is in your facts sheet, so the interview shows which buyer questions your facts cannot answer. A grader then
          marks each answer and says whether the buyer would shortlist you.
        </p>
        ${pitchForm({
          prefill,
          error: interviewError,
          action: '/interview',
          button: 'Start the rehearsal',
          busy: 'Briefing the buyer agent',
          facts: true,
          idPrefix: 'int-',
        })}
      </section>

      <section class="prose">
        <h2>3. Test your own agent</h2>
        <p>
          If you already have a sales or support agent, let it sit the interview itself. Connect Windtunnel over MCP and ask
          your agent to call <code>start_agent_interview</code>, then answer each buyer message with
          <code>reply_to_buyer</code>. It gets the same scorecard, and a link to the transcript.
          <a href="/agents">MCP setup and the JSON API</a>
        </p>
      </section>`,
  });
}

const GAP = {
  pricing: 'Pricing',
  integrations: 'Integrations',
  security_and_data: 'Security and data handling',
  proof_and_customers: 'Proof and customers',
  limits_and_scale: 'Limits and scale',
  setup_effort: 'Setup effort',
  support: 'Support',
  other: 'Other',
};

export function buyersResult(ctx, r, { url }) {
  const t = r.tallies;
  const winner = r.standing[0];
  return layout({
    title: `${r.input.name || 'Launch'}: buyer agents`,
    active: '/buyers',
    noindex: true,
    body: html`
      ${resultHead({ eyebrow: `Buyer-agent selection · ${t.answered} of ${t.runs} runs answered`, r, url, again: '/buyers' })}

      <section class="tiles">
        <div class="tile"><p class="tile-label">Picked you</p><p class="tile-value">${of(t.picked, t.answered)}</p><p class="tile-note">As the agent’s single recommendation</p></div>
        <div class="tile"><p class="tile-label">Shortlisted you</p><p class="tile-value">${of(t.shortlisted, t.answered)}</p><p class="tile-note">As the pick or one of two alternates</p></div>
        <div class="tile"><p class="tile-label">Picked most often</p><p class="tile-value small">${winner.isYou ? 'You' : winner.name}</p><p class="tile-note">${winner.picked} of ${t.answered} runs</p></div>
      </section>

      <section>
        <h2>How the agents saw you</h2>
        <p class="section-note">Every entry was rewritten into one neutral sentence before the agents saw it, yours included. This is yours:</p>
        <p class="quote neutral">${r.yourSummary}</p>
      </section>

      <section>
        <h2>Who wins instead</h2>
        <p class="section-note">The catalogue: you and the closest real launches. Picks and shortlists are simulated; votes and rank are what each launch really got.</p>
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Product</th><th>Picked</th><th class="n">Shortlisted</th><th class="n">Real votes</th><th class="n">Launched</th></tr></thead>
          <tbody>
            ${r.standing.map(
              (e) => html`<tr class="${e.isYou ? 'matched' : ''}">
                <td>${e.isYou ? html`<div class="launch"><span><strong>${e.name}</strong> <span class="chip on">Yours</span></span><span class="tag">${e.summary}</span></div>` : html`<div class="launch">${launchCell({ name: e.name, url: e.url })}<span class="tag">${e.summary}</span></div>`}</td>
                <td><span class="dotcell">${dots(e.picked, t.answered)} <span class="n">${e.picked}</span></span></td>
                <td class="n">${e.shortlisted}</td>
                <td class="n">${e.realVotes == null ? '—' : num(e.realVotes)}</td>
                <td class="n">${e.date ? day(e.date) : '—'}</td>
              </tr>`,
            )}
          </tbody>
        </table></div>
      </section>

      ${r.whyNot.length
        ? html`<section>
            <h2>Why they passed on you</h2>
            <ul class="reasons">${r.whyNot.map((w) => html`<li>${w}</li>`)}</ul>
          </section>`
        : ''}

      ${r.gaps.length
        ? html`<section>
            <h2>What the agents could not find out</h2>
            <p class="section-note">Information the agents wanted and the catalogue did not give them, across all products. Where you can answer these in your own listing, you are ahead of the catalogue.</p>
            <div class="table-scroll"><table class="data">
              <thead><tr><th>Missing</th><th class="n">Runs</th><th>For example</th></tr></thead>
              <tbody>${r.gaps.map((g) => html`<tr><th scope="row">${GAP[g.category] ?? g.category}</th><td class="n">${g.count}</td><td>${g.examples.join(' · ')}</td></tr>`)}</tbody>
            </table></div>
          </section>`
        : ''}

      <section>
        <h2>Every run</h2>
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Client and need</th><th>Agent</th><th>Picked</th><th>Why, or why not you</th></tr></thead>
          <tbody>
            ${r.runs.map(
              (run) => html`<tr>
                <td><strong>${run.buyer}</strong><br /><span class="muted">${run.need}</span></td>
                <td>${run.disposition}</td>
                <td>${run.ok ? html`${run.pick} ${run.pickedYou ? html`<span class="chip on">You</span>` : run.shortlistedYou ? html`<span class="chip">You shortlisted</span>` : ''}` : html`<span class="muted">No answer</span>`}</td>
                <td>${run.ok ? (run.pickedYou ? run.reason : (run.whyNotYou ?? run.reason)) : ''}</td>
              </tr>`,
            )}
          </tbody>
        </table></div>
      </section>

      <section>
        <h2>Next</h2>
        <div class="actions">
          <a class="button secondary" href="/buyers?${new URLSearchParams(r.input)}#interview">Rehearse a buyer interview</a>
          <a class="button secondary" href="/panel?${new URLSearchParams(r.input)}">Run the audience panel</a>
        </div>
        ${runFooter(r)}
      </section>`,
  });
}

// ---- interview ---------------------------------------------------------------------------

const HANDLING = { answered: ['Answered', 'good'], partly: ['Partly answered', 'mid'], evaded: ['Evaded', 'bad'], no_information: ['Had no information', 'mid'] };
const SHORTLIST = { yes: 'Would shortlist', maybe: 'Might shortlist', no: 'Would not shortlist' };

export function interviewPage(ctx, s, { url, error }) {
  const answers = s.transcript.filter((m) => m.role === 'seller').length;
  const done = s.status === 'done';
  const card = s.scorecard;
  let turn = 0;
  return layout({
    title: `${s.input.name || 'Launch'}: agent interview`,
    active: '/buyers',
    noindex: true,
    body: html`
      <section class="report-head">
        <p class="eyebrow">${kindChip('simulated')} Agent interview · ${s.mode === 'rehearsal' ? 'stand-in seller, facts sheet only' : 'your agent as the seller'} · ${done ? 'finished' : `turn ${answers + 1} of at most ${MAX_TURNS}`}</p>
        <h1>${s.input.name || 'Your launch'}</h1>
        <p class="quote">“${s.input.tagline}”</p>
        <p class="client"><strong>The buyer’s client:</strong> ${s.client.buyer}. <strong>Need:</strong> ${s.client.need} <strong>Firm requirement:</strong> ${s.client.constraint}</p>
      </section>

      ${done
        ? html`<section class="panel conditions">
            <div>
              <p class="eyebrow">Outcome</p>
              <p class="hero-figure small">${SHORTLIST[card.wouldShortlist]}</p>
              <p class="hero-sub">${card.verdict}</p>
            </div>
            <div>
              <p class="eyebrow">Facts the seller needed and did not have</p>
              ${card.gaps.length ? html`<ul class="reasons">${card.gaps.map((g) => html`<li>${g}</li>`)}</ul>` : html`<p class="muted">None noted.</p>`}
              ${card.claimsChecked
                ? card.unsupportedClaims.length
                  ? html`<p class="eyebrow">Claims the facts sheet does not support</p>
                      <ul class="reasons">${card.unsupportedClaims.map((c) => html`<li>Turn ${c.turn}: ${c.claim}</li>`)}</ul>`
                  : html`<p class="muted">Every claim was supported by the facts sheet.</p>`
                : html`<p class="muted">No facts sheet was supplied, so claims were not checked.</p>`}
            </div>
          </section>`
        : ''}

      <section>
        <h2>Transcript</h2>
        <ol class="transcript">
          ${s.transcript.map((m) => {
            if (m.role === 'seller') turn++;
            const answerNumber = turn;
            const mark = m.role === 'seller' ? (card?.turns.find((x) => x.turn === answerNumber) ?? null) : null;
            return html`<li class="msg ${m.role}">
              <p class="who">${m.role === 'buyer' ? 'Buyer’s agent' : s.mode === 'rehearsal' ? 'Stand-in seller' : 'Your agent'}
                ${mark ? html`<span class="chip verdict-${HANDLING[mark.handling][1]}">${HANDLING[mark.handling][0]}</span>` : ''}</p>
              <p>${m.text}</p>
              ${mark ? html`<p class="muted">${mark.note}</p>` : ''}
            </li>`;
          })}
        </ol>
        ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
        ${done
          ? ''
          : s.mode === 'rehearsal'
            ? html`<form method="post" action="/i/${s.id}/next" data-busy="The agents are talking" ${error ? '' : html`data-autosubmit`}>
                <button class="primary" type="submit">${answers ? 'Next turn' : 'Let the stand-in answer'}</button>
              </form>`
            : html`<p class="notice" role="status">Waiting for your agent’s reply. It answers with the <code>reply_to_buyer</code> tool; reload this page to see new turns.</p>`}
      </section>

      <section>
        <div class="actions">
          <button type="button" class="secondary" data-copy="${url}">Copy link to this interview</button>
          <a class="quiet" href="/buyers?${new URLSearchParams(s.input)}#interview">Start another</a>
        </div>
        <p class="run-note">Simulated by ${s.model} in ${s.usage.calls} calls${done ? '' : ' so far'}, about $${s.usage.usd.toFixed(3)}. <a href="/method#simulated">What simulated results can and cannot tell you</a></p>
      </section>`,
  });
}

// ---- thread ------------------------------------------------------------------------------

const SOURCE = { typed: 'Your reply', stand_in: 'Stand-in, from your facts', agent: 'Your agent' };
const HESITATION = { resolved: ['Resolved', 'good'], partly: ['Partly resolved', 'mid'], stands: ['Still stands', 'bad'] };
const REPLY_HANDLING = { answered: ['Answered the question', 'good'], partly: ['Partly answered', 'mid'], evaded: ['Evaded', 'bad'] };
const TRY_SHORT = { yes: 'would try', maybe: 'might try', no: 'would not try' };

function armLine(label, arm, before) {
  if (!arm) return html`<p class="arm"><span class="arm-label">${label}</span> <span class="muted">Did not answer.</span></p>`;
  const [text, tone] = HESITATION[arm.hesitation];
  return html`<p class="arm">
    <span class="arm-label">${label}</span>
    <span class="chip verdict-${tone}">${text}</span>
    <span class="muted">${TRY_SHORT[before]} → ${TRY_SHORT[arm.wouldTry]}</span><br />
    <span class="arm-why">${arm.why}</span>
  </p>`;
}

export function threadPage(ctx, s, { url, error, drafts = {} }) {
  const done = s.status === 'done';
  const sum = s.summary;
  const who = { typed: 'you', stand_in: 'a stand-in limited to your facts', agent: 'your agent' }[s.mode];
  return layout({
    title: `${s.input.name || 'Launch'}: the thread`,
    active: '/panel',
    noindex: true,
    body: html`
      <section class="report-head">
        <p class="eyebrow">${kindChip('simulated')} Launch thread · replies by ${who} · ${done ? `${sum.compared} of ${s.comments.length} visitors asked again` : 'waiting for replies'}</p>
        <h1>${s.input.name || 'Your launch'}</h1>
        <p class="quote">“${s.input.tagline}”</p>
        <div class="actions">
          <button type="button" class="secondary" data-copy="${url}">Copy link to this thread</button>
          <a class="quiet" href="/p/${s.panelId}">Back to the panel</a>
        </div>
      </section>

      ${done
        ? html`<section class="tiles four">
              <div class="tile"><p class="tile-label">Hesitations resolved by your reply</p><p class="tile-value">${of(sum.resolved.reply, sum.compared)}</p><p class="tile-note"><strong>${sum.resolved.placebo} of ${sum.compared}</strong> after a reply that said nothing</p></div>
              <div class="tile"><p class="tile-label">More willing to try it</p><p class="tile-value">${of(sum.moreWilling.reply, sum.compared)}</p><p class="tile-note"><strong>${sum.moreWilling.placebo} of ${sum.compared}</strong> after the placebo; ${sum.lessWilling.reply} became less willing</p></div>
              <div class="tile"><p class="tile-label">Replies that answered the question</p><p class="tile-value">${sum.graded ? of(sum.handling.answered, sum.replied) : '—'}</p><p class="tile-note">${sum.graded ? html`${sum.handling.partly} partly, ${sum.handling.evaded} evaded` : 'The replies could not be graded this time'}</p></div>
              <div class="tile"><p class="tile-label">Claims your facts do not support</p><p class="tile-value">${sum.claimsChecked ? sum.unsupportedClaims : '—'}</p><p class="tile-note">${sum.claimsChecked ? 'Checked against your facts sheet' : 'No facts sheet, so claims were not checked'}</p></div>
            </section>
            <section class="prose">
              <p class="section-note">
                <strong>How to read this.</strong> Every visitor was asked twice: once after your reply, once after a reply of the
                same length that only thanked them. Simulated people warm to being answered at all, so the second number is the
                baseline. Where the two are close, the reply did little. This is one run of twelve; a difference of one or two
                is within the noise.
              </p>
            </section>`
        : ''}

      <section>
        <h2>${done ? 'Comment by comment' : 'The comments'}</h2>
        ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
        ${done
          ? html`<ol class="thread">
              ${s.comments.map((c) => {
                const o = s.outcomes.find((x) => x.n === c.n);
                return html`<li class="thread-item">
                  <div class="msg buyer">
                    <p class="who">${c.who} <span class="chip kind simulated">Simulated comment</span></p>
                    <p>${c.objection} ${c.question}</p>
                  </div>
                  ${o.reply
                    ? html`<div class="msg seller">
                          <p class="who">${SOURCE[o.source]} ${o.handling ? html`<span class="chip verdict-${REPLY_HANDLING[o.handling][1]}">${REPLY_HANDLING[o.handling][0]}</span>` : ''}</p>
                          <p>${o.reply}</p>
                          ${o.note ? html`<p class="muted">${o.note}</p>` : ''}
                          ${o.unsupported.length ? html`<p class="unsupported"><strong>Not in your facts sheet:</strong> ${o.unsupported.join(' · ')}</p>` : ''}
                        </div>
                        <div class="arms">
                          ${armLine('After your reply', o.afterReply, c.wouldTry)}
                          ${armLine('After the placebo', o.afterPlacebo, c.wouldTry)}
                        </div>`
                    : html`<p class="muted no-reply">No reply was given, so this visitor was not asked again.</p>`}
                </li>`;
              })}
            </ol>`
          : s.mode === 'agent'
            ? html`<ol class="thread">
                  ${s.comments.map((c) => html`<li class="thread-item"><div class="msg buyer"><p class="who">${c.n}. ${c.who} <span class="chip kind simulated">Simulated comment</span></p><p>${c.objection} ${c.question}</p></div></li>`)}
                </ol>
                <p class="notice" role="status">Waiting for your agent’s replies. It sends them with the <code>post_maker_replies</code> tool; reload this page to see the result.</p>`
            : html`<form method="post" action="/t/${s.id}/replies" data-busy="Asking the panel again. About 20 seconds">
                <ol class="thread">
                  ${s.comments.map(
                    (c) => html`<li class="thread-item">
                      <div class="msg buyer">
                        <p class="who">${c.who} <span class="chip kind simulated">Simulated comment</span></p>
                        <p>${c.objection} ${c.question}</p>
                      </div>
                      <div class="field reply-field">
                        <label for="reply-${c.n}">Your reply <span class="opt">optional; up to ${REPLY_CAP} characters</span></label>
                        <textarea id="reply-${c.n}" name="reply_${c.n}" rows="3" maxlength="${REPLY_CAP}">${drafts[c.n] ?? ''}</textarea>
                      </div>
                    </li>`,
                  )}
                </ol>
                <div class="actions"><button class="primary" type="submit">Post the replies and ask them again</button></div>
              </form>`}
      </section>

      <section>
        <p class="run-note">
          ${done ? html`Simulated by ${s.model} in ${s.usage.calls} calls${s.usage.failed ? html` (${s.usage.failed} did not answer)` : ''}, about $${s.usage.usd.toFixed(3)}. Kept for 90 days.` : 'Nothing has been run yet for this thread.'}
          <a href="/method#thread">How the placebo works, and what this cannot tell you</a>
        </p>
      </section>`,
  });
}
