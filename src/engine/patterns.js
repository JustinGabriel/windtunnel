// Framing patterns (how a launch is pitched) and themes (what it is about).
//
// Nothing here carries a hard-coded "this works" judgement. Each definition is only a
// detector; whether it helps is measured against the corpus at boot (see corpus.js),
// and the advice strings are filled in from those measurements.

const BRANDS =
  'vercel|lovable|cursor|figma|stripe|openrouter|superhuman|notion|github|shopify|duolingo|uber|airbnb|canva|linear|slack|' +
  'zapier|photoshop|quickbooks|grammarly|datadog|sentry|postman|docker|chatgpt|claude code|claude|n8n|excel|spotify|tinder|' +
  'strava|bloomberg|google analytics|raycast|obsidian|calendly|typeform|intercom|hubspot|salesforce|after effects|grok bot|' +
  'perplexity|midjourney|loom|bolt|replit|supabase|firebase|twilio|plaid|segment|mixpanel|amplitude|webflow|framer|airtable|' +
  'tiktok|instagram|youtube|netflix|wikipedia|google|apple|xcode|copilot|granola|wispr flow|screen studio|arc|zoom';

/**
 * Framing patterns are tested against the product name and tagline only, never the
 * longer description, so that wording in the supporting copy does not count.
 */
export const PATTERNS = [
  {
    id: 'analogy',
    label: '“The X for Y” analogy',
    hint: 'Borrow a product people already understand: “The Vercel for GTM”, “Lovable for iPhone apps”.',
    test: ({ tagline }) => new RegExp(`\\b(${BRANDS})\\s+(for|of)\\b`, 'i').test(tagline) || /\balternative\b/i.test(tagline),
  },
  {
    id: 'mcp',
    label: 'MCP in the name or tagline',
    hint: 'Ship the product as an MCP server and say so: “Clueso MCP”, “Floot MCP”.',
    test: ({ name, tagline }) => /\bmcp\b/i.test(`${name} ${tagline}`),
  },
  {
    id: 'lives_in',
    label: 'Lives inside a tool people already use',
    hint: 'Name the surface: “in Slack”, “inside Claude or ChatGPT”, “in your terminal”.',
    test: ({ tagline }) =>
      /\b(in|inside|into|within|from|for|to)\s+(slack|chatgpt|claude( code)?|cursor|codex|figma|whatsapp|telegram|discord|teams|notion|gmail|chrome|jetbrains|obsidian|n8n|supabase|your (terminal|browser|ide|inbox|notch|menu bar|pocket))\b/i.test(
        tagline,
      ),
  },
  {
    id: 'named_audience',
    label: 'Names who it is for',
    hint: 'Say who buys it: “for solopreneurs”, “for AI builders”, “for small business owners”.',
    test: ({ tagline }) =>
      /\bfor\s+(the\s+)?(ai\s+)?(product\s+)?(founders?|solopreneurs?|developers?|devs|designers?|marketers?|creators?|startups?|small business(es)?( owners?)?|sales teams?|teams|builders|engineers?|students?|recruiters?|agenc(y|ies)|e-?commerce|non-(technical|designers?|developers?)|product (teams?|builders?|managers?)|indie (hackers?|makers?)|youtubers?|researchers?|freelancers?)\b/i.test(
        tagline,
      ),
  },
  {
    id: 'for_agents',
    label: 'Built for agents as the user',
    hint: 'Position the agent, not the human, as the customer: “for coding agents”, “your agent can …”.',
    test: ({ tagline }) =>
      /\bfor\s+(your\s+|ai\s+|coding\s+|every\s+|any\s+|production\s+)*agents?\b|\bagent[- ](ready|native|callable|economy)\b|\b(your|any|every) (ai )?agents?\s+(can|to|into)\b|\bgive (your )?(ai )?agents?\b/i.test(
        tagline,
      ),
  },
  {
    id: 'agent_word',
    label: 'Uses the word “agent”',
    hint: 'The most common word on the board. Measured below, so you can see whether it still earns its place.',
    test: ({ tagline }) => /\bagents?\b|\bagentic\b/i.test(tagline),
  },
  {
    id: 'ai_word',
    label: 'Says “AI” in the tagline',
    hint: 'Leading with “AI” rather than the outcome.',
    test: ({ tagline }) => /\bAI\b/i.test(tagline),
  },
  {
    id: 'open_source',
    label: 'Open source',
    hint: 'Says it is open source in the name or tagline.',
    test: ({ name, tagline }) => /open[- ]?source/i.test(`${name} ${tagline}`),
  },
  {
    id: 'transform',
    label: '“Turn X into Y” outcome',
    hint: 'State the before and after: “Turn website traffic into booked meetings”.',
    test: ({ tagline }) => /\bturns?\b.{2,60}\binto\b|\bfrom\b.{2,40}\bto\b.{2,40}/i.test(tagline),
  },
  {
    id: 'removes_pain',
    label: 'Promises to remove a pain',
    hint: '“Without After Effects”, “no prompts, no maintenance”, “never hit usage limits again”.',
    test: ({ tagline }) => /\bwithout\b|\bno[- ](code|prompts?|setup|maintenance|trackers?|editing|design)\b|\bnever\b|\bstop\b|\bno more\b/i.test(tagline),
  },
  {
    id: 'number',
    label: 'A concrete number',
    hint: 'A specific figure in the tagline: “25% fewer errors”, “$20/month”, “1,200+ actions”.',
    test: ({ tagline }) => /\d/.test(tagline.replace(/\b(v?\d+(\.\d+)+|[a-z]+-?\d(\.\d)?)\b/gi, '')),
  },
  {
    id: 'version',
    label: 'Versioned relaunch',
    hint: 'A “2.0” or “4.0” in the product name: an existing product launching again.',
    test: ({ name }) => /\b\d+\.\d+\b|\bv\d+\b/i.test(name),
  },
  {
    id: 'brand_extension',
    label: 'Launched under an existing brand',
    hint: '“X by Company” or “X from Company”: a new product riding an existing audience.',
    test: ({ name }) => /\s(by|from)\s+[A-Z0-9]/.test(name),
  },
  {
    id: 'free',
    label: 'Says it is free',
    hint: '“Free”, “free forever” or “100% free” in the tagline.',
    test: ({ tagline }) => /\bfree\b/i.test(tagline),
  },
];

/** Themes are matched against everything we know about a launch. */
export const THEMES = [
  { id: 'gtm', label: 'Sales & go-to-market', re: /\bgtm\b|go-to-market|\bsales\b|outbound|\bleads?\b|\bsdr\b|prospect|booked (sales )?(calls|meetings)|get(ting)? customers|buying signals|cold (email|outreach)|qualified (pipeline|meetings)|website visitors/ },
  { id: 'ai_visibility', label: 'AI search visibility (AEO/GEO)', re: /\baeo\b|\bgeo\b|ai (search|visibility)|recommends? (you|your)|when customers ask ai|discover(ed)? (and recommended|by ai|in chatgpt|your business)|llms\.txt|ai-driven conversations|ai recommends/ },
  { id: 'payments', label: 'Payments & monetisation', re: /billing|\bpayments?\b|checkout|subscriptions?|monetiz|invoic|merchant of record|sell and grow|recurring revenue/ },
  { id: 'coding_agents', label: 'Coding agents & dev workflow', re: /coding agents?|code review|claude code|\bcodex\b|\bcursor\b|\bide\b|pull requests?|\bprs?\b|jetbrains|vibe[- ]cod|codebase|\bgit\b|\bcli\b|terminal/ },
  { id: 'agent_infra', label: 'Infrastructure for agents', re: /for (ai |coding |your |every |any |production[- ]ready )*agents?\b|agent (infrastructure|runtime|gateway|memory|sandbox|harness|economy)|mcp (gateway|servers?)|headless browser|cloud computers?/ },
  { id: 'mcp', label: 'MCP servers & connectors', re: /\bmcp\b/ },
  { id: 'trust', label: 'Agent security & oversight', re: /secur|guardrail|\baudit|oversight|prompt injection|misalign|governed|compliance|babysit/ },
  { id: 'voice', label: 'Voice & dictation', re: /\bvoice\b|dictat|speech|transcri|voicemail|voiceover/ },
  { id: 'video', label: 'Video creation & editing', re: /\bvideos?\b|screen record|motion graphics|\bclips\b/ },
  { id: 'launch_tools', label: 'Launch & demo tooling', re: /\blaunch(es)? videos?|product hunt|demo videos?|screen record|launch (editor|page)|product demos?|demo agent/ },
  { id: 'meetings', label: 'Meetings & notes', re: /\bmeeting (notes?|assistants?|recorder|bots?|summar\w+)|note-?tak\w*|\bnotetaker|\bstandups?\b|(before|during|after|in|into|live|your) (your )?(meetings|calls)\b|\bto your call\b/ },
  { id: 'memory', label: 'Memory & context', re: /\bmemory\b|context (layer|engine|window|management|loss)|knowledge (base|graph)|second brain|system of record/ },
  { id: 'email', label: 'Email', re: /\be-?mails?\b|\binbox/ },
  { id: 'design', label: 'Design & landing pages', re: /\bdesigns?\b|figma|landing pages?|website builder|mockup|\bui\b/ },
  { id: 'app_builders', label: 'App builders', re: /app builder|build (and|&) (ship|publish|deploy)|no-?code|lovable|from (idea|prompt) to|ship (real )?apps|game engine/ },
  { id: 'analytics', label: 'Analytics', re: /analytics|dashboards?|\bmetrics\b|\bbi\b|observability/ },
  { id: 'local', label: 'Local-first & private', re: /\blocal(ly)?\b|on-device|privacy|\bprivate\b|offline|self-host|no trackers?/ },
  { id: 'mac', label: 'Mac-native apps', re: /\bmac\b|macos|menu bar|\bnotch\b/ },
  { id: 'mobile', label: 'Mobile', re: /\bios\b|android|iphone|mobile (app|devices?)|in your pocket/ },
  { id: 'learning', label: 'Learning & tutoring', re: /\btutor|\bcourses?\b|education|\bstudents?\b|\bcoach\b|\blearn (english|a language|any|to|by)\b|language learning|learn as you|\bstudy\b|academy/ },
  { id: 'models', label: 'Frontier model releases', re: /\b(gpt|gemini|claude (opus|sonnet|haiku)|grok|glm|qwen|deepseek|llama)[- ]?\d|frontier (model|intelligence|ai)|most (capable|advanced) model/ },
  { id: 'cost', label: 'AI cost & token efficiency', re: /\btokens?\b|\bcosts?\b|\bspend\b|\bbudgets?\b|usage limits?|credits back/ },
  { id: 'solo', label: 'Solo founders & small business', re: /solopreneur|solo founders?|\bindie\b|one-person|small business|for founders/ },
  { id: 'jobs', label: 'Jobs & hiring', re: /\bjobs?\b|hiring|resume|career|recruit/ },
];

const HYPE = /\b(revolutionary|revolutionize|game[- ]chang\w+|next[- ]gen(eration)?|cutting[- ]edge|world[- ]class|best[- ]in[- ]class|all[- ]in[- ]one|supercharge\w*|seamless(ly)?|effortless(ly)?|ultimate|powerful|innovative|unleash|10x|ai[- ]powered|state[- ]of[- ]the[- ]art|disrupt\w*|leverage\w*|synerg\w+)\b/gi;

/** Product Hunt's own field limit for taglines. */
export const TAGLINE_LIMIT = 60;

/**
 * Editorial checks that do not depend on the corpus. They are labelled as heuristics
 * in the UI: house rules and platform limits, not measured effects.
 */
export function clarityChecks({ name, tagline }) {
  const t = tagline.trim();
  const words = t.split(/\s+/).filter(Boolean);
  const hype = [...new Set((t.match(HYPE) ?? []).map((w) => w.toLowerCase()))];
  const startsWithName = name && t.toLowerCase().startsWith(name.trim().toLowerCase());
  return [
    {
      id: 'length',
      pass: t.length <= TAGLINE_LIMIT,
      label: `Fits Product Hunt’s ${TAGLINE_LIMIT}-character tagline field`,
      detail:
        t.length <= TAGLINE_LIMIT
          ? `${t.length} characters.`
          : `${t.length} characters: ${t.length - TAGLINE_LIMIT} over. It will not fit the field as written.`,
      points: 5,
    },
    {
      id: 'hype',
      pass: hype.length === 0,
      label: 'No filler adjectives',
      detail: hype.length ? `Cut: ${hype.join(', ')}. Every launch claims these, so they carry no information.` : 'No stock hype words found.',
      points: 4,
    },
    {
      id: 'specific',
      pass: words.length >= 4 && words.length <= 12,
      label: 'Specific enough to picture, short enough to scan',
      detail:
        words.length < 4
          ? `${words.length} words. Too short to say what it does or for whom.`
          : words.length > 12
            ? `${words.length} words. Readers scan a list of thirty; aim for 12 or fewer.`
            : `${words.length} words.`,
      points: 3,
    },
    {
      id: 'no_name',
      pass: !startsWithName,
      label: 'Does not repeat the product name',
      detail: startsWithName ? 'The name is already shown beside the tagline. Use the space for the outcome.' : 'Name is not repeated.',
      points: 3,
    },
  ];
}
