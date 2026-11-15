# Windtunnel

See the conditions before you launch. Windtunnel checks a Product Hunt pitch against
2,730 real launches and reports who already shipped it, how they did, how crowded the
space is, and how many votes top five takes on each weekday. It runs as a web app, a
JSON API, a CLI and an MCP server.

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

45 tests: the engine against the real dataset, every HTTP route, the MCP server over
both HTTP and stdio, and the ingest script against fixtures.

## Deploy

**Vercel.** Import the repository at vercel.com/new and deploy; there is nothing to
configure. `vercel.json` serves `public/` as static files and sends every other path to
`api/index.js`, which is the whole Express app as one function.

**Anywhere else.** It is a plain Node server: `npm install && npm start`.

The server keeps no report state. A share link carries the pitch itself, compressed
into the URL, and the report is recomputed when the link is opened. That means links
keep working across deploys and instances, a shared report always reflects the current
dataset, and anyone holding a link can read the pitch in it.

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
- **MCP server** (`/mcp`, or `npm run mcp` for stdio): `test_pitch`,
  `compare_taglines`, `find_comparables`, `launch_day_bar`, `launch_trends`. The user's
  own agent drafts the copy; Windtunnel supplies the evidence. No model API key needed.
- **JSON API** (`/api/test`, `/api/compare`, `/api/comparables`, `/api/trends`,
  `/api/backtest`) and a **CLI** (`node bin/windtunnel.js test "your tagline"`).

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

Free now: everything above. The pricing page describes two paid plans and collects a
waitlist; neither plan is built.

- **Launch pass, $39 per launch:** an alert when a similar product launches before you,
  a launch-day pace line against the day's bar, private reports, daily data.
- **Studio, $149 a month:** for agencies and launch consultants. Client workspaces,
  white-label reports, API without rate limits, a weekly brief.

## Not built

- Payments and accounts. The waitlist only records an email and a plan.
- Scheduled data refresh. `npm run ingest` is manual, and the result has to be committed.
- The paid features listed above.
- A database. Nothing needs one yet: reports are stateless and the waitlist is a file or a webhook.

## Layout

```
api/index.js             Vercel entry point
bin/windtunnel.js        CLI entry: serve, mcp, test, compare, bar, eval
src/engine/              text matching, statistics, patterns, model, analysis
src/server/              Express app, HTML views, share links, waitlist
src/mcp/server.js        MCP tools
scripts/ingest.mjs       dataset builder
data/                    launches.json and the hand back-translations
public/                  stylesheet, client script, favicon
test/                    node:test suites and ingest fixtures
```
