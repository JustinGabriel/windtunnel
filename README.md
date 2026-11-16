# Windtunnel

Test a Product Hunt launch three ways before launch day. It runs as a web app, a JSON
API, a CLI and an MCP server.

| Test | Kind | What it tells you |
|---|---|---|
| The market | Measured | Against 2,730 real launches: who already shipped it, how they did, how crowded the space is, and how many votes top five takes on each weekday. |
| The audience | Simulated | Twelve simulated visitors see the launch on a real past board, without knowing which entry is under test: who opens it, who upvotes it, what they think it is, what stops them. |
| Buyer agents | Simulated | Simulated purchasing agents choose between the product and its real competitors, and interview the product's agent the way a buyer's agent would. |

Measured means counted from real launches. Simulated means an AI model playing a role;
every simulated figure is labelled, and given as a count ("7 of 12") rather than a
percentage.

It does not give you a launch score. We tested whether a pitch can predict votes; it
mostly cannot, and the product is built around that result (see [Honest limits](#honest-limits)).

## Run it

Requires Node 22 or later.

```bash
npm install
```

```bash
npm start
```

The app is at `http://localhost:3000`. Set `PORT` to change the port and `PUBLIC_URL`
for the address shown in the MCP and API docs.

```bash
npm test
```

89 tests: the engine against the real dataset, every HTTP route, the MCP server over
both HTTP and stdio, the ingest script against fixtures, and the simulated tests
against a scripted fake model (no key or network needed).

The measured test needs nothing else. The simulated tests need a model key:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Without a key the simulated pages say they are switched off and everything else works.

## Deploy

**Vercel.** Import the repository at vercel.com/new and deploy; there is nothing to
configure. `vercel.json` serves `public/` as static files and sends every other path to
`api/index.js`, which is the whole Express app as one function.

**Anywhere else.** It is a plain Node server: `npm install && npm start`.

Measured reports keep no server state. A share link carries the pitch itself,
compressed into the URL, and the report is recomputed when the link is opened. That
means links keep working across deploys and instances, a shared report always reflects
the current dataset, and anyone holding a link can read the pitch in it.

### Switching on the simulated tests

| Setting | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Required. The simulations run on `claude-haiku-5-5`. Use a key from a dedicated workspace with a monthly spend limit: that limit is the hard backstop. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Required on Vercel. Holds the spend counters, stored results and interviews in progress. Add Upstash Redis from Vercel's storage integrations and these are set for you. |
| `SIM_DAILY_BUDGET_USD` | The app's own daily cap across all visitors. Default 5. |
| `SIM_VISITOR_RUNS_PER_DAY` | Runs per visitor per day. Default 8. |

On Vercel with no Redis, the simulated tests stay **off** rather than run without a
cap: serverless instances share no memory, so a cap held in one of them is not a cap.
On a single long-lived server the same state is kept in files under `var/sim/`.

A full panel is about 25 model calls and a buyer test about 13; each is a few cents at
most on this model. A run reserves its worst-case cost before it starts and settles to
the real figure afterwards, so concurrent runs cannot jointly overshoot the daily cap.
Results are stored for 90 days under a short id.

Waitlist sign-ups need somewhere durable to go:

| Setting | Behaviour |
|---|---|
| `WAITLIST_WEBHOOK_URL` set | Each sign-up is POSTed there as `{ email, plan, at }`. Use this on Vercel. |
| Not set, long-lived server | Appended to `var/waitlist.jsonl` (`WINDTUNNEL_DATA` changes the directory). |
| Not set, on Vercel | The form is hidden, because files written there do not persist. |

The rate limit (40 writes a minute per address) is held in memory, so on a serverless
host it applies per instance rather than globally.

## Why this product

The brief was to read three months of Product Hunt, find what performs, and build
something that community would pick up. The dataset is the daily top 30 for 91 days
(15 Aug to 14 Nov 2026): 2,730 launches, 847 of them with English text.

What the data showed:

| Finding | Evidence |
|---|---|
| Tools that help makers sell win | Sales and go-to-market launches took a median 212 day-one votes against 119 for the rest (35 launches, p = 0.005); 63% reached the daily top five against 35%. Ten of the top 25 launches sell, monetise or market a product: Pancake, CREEM 2.0, tiun, GenPage 3.0, Ami AI, Astute, Naoma, Alsona, ReSO AI, Anysite. |
| Agents as the user | Launches pitched as "for agents" took a median 170 against 120 (53 launches, p = 0.007). Infrastructure for agents grew from 6.7% to 11.6% of launches within the window. |
| "The X for Y" still works | 19 launches used it ("The Vercel for GTM", "Lovable for iPhone apps"); median 232 against 120 (p = 0.03). |
| MCP is a product surface | "Clueso MCP" (504 votes), "Product Hunt MCP" (432), "Floot MCP" (367). Median 153 against 120, though at 30 launches that gap is not statistically clear. |
| Launch tooling sells to this crowd | Product Hunt Visual Launch Editor (402, #1), Pexo launch videos (414, #1), Screen Studio 4.0 (417, #1), Topview Motion Studio (318, #1). |
| Local-first and job-search tools lag | Medians of 102 and 84 against roughly 121. |
| The bar | Top five took a median 187 votes on a Monday or Tuesday and 142 on a Saturday. The median #1 took 372. |

Windtunnel sits where those meet: a tool that helps makers launch, delivered as an MCP
server as well as a site, aimed at the people already on Product Hunt. Two ideas were
dropped on the way. An "is your site usable by AI agents" checker already launched
(Dedica, 28 Oct, 299 votes). A predictive launch score failed its own backtest.

## What it does

- **Pitch report** (`/`): conditions for your theme and framing, the closest past
  launches with their votes and day rank, crowding over the last 30 days against the 30
  before, the bar for each weekday, and tagline checks including Product Hunt's
  60-character limit. Each report has a shareable link.
- **Tagline comparison** (`/compare`): up to four variants side by side. When the model
  cannot separate them it says so and falls back to the clarity checks.
- **Trends** (`/trends`): votes needed by weekday, every theme and framing pattern with
  sample size and a permutation-test p-value, and the top 25 launches.
- **Method** (`/method`): data sources, how each number is computed, the backtest.
- **Audience panel** (`/panel`): the pitch on a real past board, shown as a name and a
  tagline among that day's real launches. Twelve simulated visitors (eight fixed kinds
  of Product Hunt visitor, four buyers fitted to the pitch) choose what to open and
  upvote, then each reads the launch page and says what they think it is, what stops
  them and what they would ask.
- **The thread** (from any panel result): each visitor's hesitation and question becomes
  a comment on your launch. You reply, a stand-in limited to your facts sheet replies,
  or your own agent replies over MCP. Every visitor is then asked again twice: after the
  reply, and after a placebo of the same length that says nothing. Simulated people warm
  to being answered at all, so a reply counts only where it beats the placebo. A grader
  marks each reply and flags claims your facts do not support.
- **Buyer agents** (`/buyers`): a selection test (twelve purchasing-agent runs choosing
  from a catalogue of the product and its closest real launches, all rewritten into the
  same neutral form) and an interview (a buyer's agent asks up to five questions; a
  stand-in answers from your facts sheet, or your own agent answers over MCP; a grader
  marks each answer).
- **MCP server** (`/mcp`, or `npm run mcp` for stdio). Measured tools, which need no
  key: `test_pitch`, `compare_taglines`, `find_comparables`, `launch_day_bar`,
  `launch_trends`. Simulated tools, present when a key is configured:
  `run_audience_panel`, `run_buyer_agents`, `start_agent_interview`, `reply_to_buyer`,
  `start_launch_thread`, `post_maker_replies`.
- **JSON API** (`/api/test`, `/api/compare`, `/api/comparables`, `/api/trends`,
  `/api/backtest`, `/api/panel`, `/api/buyers`, `/api/interview`, `/api/thread`) and a
  **CLI**
  (`node bin/windtunnel.js test "your tagline"`).

## Honest limits

`npm run eval` prints the backtest.

| Approach | Rank correlation with real votes |
|---|---|
| Wording alone (nearest neighbours, leave-one-out) | 0.05 |
| Theme + framing + weekday (ridge, 10-fold cross-validation) | 0.20 |
| Same model trained on the first 60% of the window, tested on the rest | 0.13 |

Zero is a coin flip. Most of what decides a launch (the maker's audience, the hunter,
the product) is not in the text. So the report shows conditions as a five-step read
with the backtest figure beside it, and never a point prediction on its own.

### The simulated tests

Simulated respondents are not customers. They are more agreeable and more articulate
than real people, the model may recognise well-known products and favour them, and
twelve is a small panel. They are useful for finding what is unclear, what people
object to and what they will ask.

Whether the panel ranks a board the way real voters did is a measurable question, so
there is a backtest for it:

```bash
npm run eval:panel -- --estimate
```

```bash
npm run eval:panel -- --set heldout --write
```

It shows the eight fixed visitors real days, as names and taglines only, and compares
their upvotes with the real day rank. Held-out days get two more passes: the identical
prompt again, which measures how much the panel disagrees with itself (the noise any
later comparison has to clear), and the same board with the first pass's upvote counts
visible, which measures whether seeing votes moves the ranking toward the real one. Days are split into a tuning set and a held-out
set; only held-out figures are written to `data/panel-eval.json`, with the prompt's
hash, and a test fails if the live prompt drifts from the one that was scored. The
method page shows the result, or says the backtest has not been run. It can only test
ordering among launches that made the board, not whether a launch would have sunk.

`.github/workflows/simulations.yml` runs the backtest and a live smoke test in GitHub
Actions with a repository secret, and commits the output.

### The measured test

Other limits, also listed on the method page:

- Only the daily top 30 is recorded, so launches that sank are missing.
- Votes are an end-of-launch-day snapshot, not the final count.
- English text covers AI-related launches, which is most of the board but not all.
- Taglines for 94 top launches were back-translated by hand from a Chinese archive.
  They show up as comparables, marked ≈, and are excluded from the statistics.
- Twenty-four themes and fourteen patterns are tested at once, so one or two of the
  "signals" are probably chance.
- Ninety days is one season.

## Data

`data/launches.json` is built by `scripts/ingest.mjs` from two public mirrors of
Product Hunt's API:

- [ViggoZ/producthunt-daily-hot](https://github.com/ViggoZ/producthunt-daily-hot) (MIT):
  daily top 30 with votes, rank and featured flag.
- [duanyytop/agents-radar](https://github.com/duanyytop/agents-radar) digest issues:
  English summaries, categories and comment counts.

To refresh it:

```bash
npm run ingest
```

That clones the archive and fetches the digests into `.cache/`, then rebuilds the file
for the 91 days ending two days ago. Set `GITHUB_TOKEN` to raise the search rate limit,
and `NODE_USE_ENV_PROXY=1` behind an HTTPS proxy.

Before running this commercially, move to Product Hunt's own API. Its default terms
do not allow commercial use without their agreement, so that conversation comes first.
The mirrors are fine for a prototype and a liability for a business.

## Business model

Free now: everything above, with the simulated tests limited to a few runs a day per
visitor. The pricing page describes two paid plans and collects a waitlist; neither
plan is built.

- **Launch pass, $39 per launch:** larger panels on several boards, your own personas,
  tagline variants through the panel side by side, an alert when a similar product
  launches first, private results.
- **Studio, $149 a month:** for agencies and launch consultants. Client workspaces,
  scheduled buyer-agent tests against named competitors, scheduled interviews of a
  production agent, white-label reports, API without run limits.

## Not built

- Payments and accounts. The waitlist only records an email and a plan.
- Scheduled data refresh. `npm run ingest` is manual, and the result has to be committed.
- The paid features listed above.
- Comparing two versions of a pitch on the same simulated people, and feeding the
  thread to buyer agents as evidence. Both are designed, and both wait on the backtest:
  if the panel disagrees with itself too much, their differences would be noise.
- Testing an agent at a URL. Your agent can sit the interview by calling Windtunnel
  over MCP or the JSON API; Windtunnel does not call out to an agent endpoint you
  supply. Doing that safely needs address pinning and somewhere to hold your agent's
  credentials, and it would let the site post generated text at arbitrary hosts.
- Accounts. Results are reachable by anyone with the link.

## Layout

```
api/index.js             Vercel entry point
bin/windtunnel.js        CLI entry: serve, mcp, test, compare, bar, eval
src/engine/              text matching, statistics, patterns, model, analysis
src/sim/                 simulated tests: model layer, personas, panel, buyer agents,
                         interview, budget, key-value store
src/server/              Express app, HTML views, share links, waitlist
src/mcp/server.js        MCP tools
scripts/ingest.mjs       dataset builder
scripts/eval-panel.mjs   backtest of the audience panel against real boards
scripts/live-smoke.mjs   runs every simulated test once on the real model
data/                    launches.json and the hand back-translations
public/                  stylesheet, client script, favicon
test/                    node:test suites and ingest fixtures
```
