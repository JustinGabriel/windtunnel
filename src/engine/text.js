// Tokenising and TF-IDF vectors. Deliberately dependency-free and deterministic:
// every match the product shows can be traced back to shared terms.

const STOP = new Set(
  `a an the and or but if then else of to in on at by for with from into onto over under about as is are was were be been
  being it its this that these those you your yours we our they their them he she his her i me my not no nor so than too very
  can will just do does did done have has had having get gets got make makes made let lets use uses used using via per up out
  off all any each every more most other some such only own same both few how what when where which who why while during
  before after again once here there also now new one two ever even yet still across between through within without
  stands stand standout unique ideal enables enabling enable solves solving solve designed helps help helping offers
  offering provides providing differentiates differentiate notable notably seamless seamlessly powerful game changer
  revolutionary novel approach makes making allows allowing ensures ensuring brings bringing delivers features feature
  first-of-its-kind standing sets apart real-time`.split(/\s+/),
);

// Collapse the handful of word families that dominate launch copy.
const CANON = new Map(
  Object.entries({
    agentic: 'agent',
    coding: 'code',
    coder: 'code',
    developers: 'developer',
    dev: 'developer',
    devs: 'developer',
    engineers: 'developer',
    engineer: 'developer',
    founders: 'founder',
    solopreneurs: 'solopreneur',
    llms: 'llm',
    automates: 'automate',
    automated: 'automate',
    automating: 'automate',
    automation: 'automate',
    autonomous: 'automate',
    autonomously: 'automate',
    emails: 'email',
    inbox: 'email',
    meetings: 'meeting',
    videos: 'video',
    'go-to-market': 'gtm',
    selling: 'sales',
    sell: 'sales',
    sells: 'sales',
    customers: 'customer',
    leads: 'lead',
    payments: 'payment',
    billing: 'payment',
    dictation: 'voice',
    speech: 'voice',
    transcription: 'transcribe',
    transcribes: 'transcribe',
    'open-source': 'opensource',
    macos: 'mac',
    iphone: 'ios',
    websites: 'website',
    site: 'website',
    sites: 'website',
    apps: 'app',
    testing: 'test',
    tests: 'test',
    docs: 'doc',
    documents: 'doc',
    documentation: 'doc',
  }),
);

export function stem(word) {
  const canon = CANON.get(word);
  if (canon) return canon;
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lowercased, stemmed content words, plus adjacent-word bigrams. */
export function tokenize(text, { bigrams = true } = {}) {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/open[- ]source/g, 'opensource')
    .replace(/[’']/g, '')
    .split(/[^a-z0-9+#.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
    .filter((w) => !STOP.has(w));
  if (!bigrams) return words;
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** Weighted term counts across fields: [[text, weight], ...] -> Map(term -> weight). */
export function termCounts(fields) {
  const counts = new Map();
  for (const [text, weight] of fields) {
    for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + weight);
  }
  return counts;
}

export function buildIdf(docCounts) {
  const df = new Map();
  for (const counts of docCounts) for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docCounts.length;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(1 + n / d));
  return idf;
}

/** Sub-linear TF x IDF, L2-normalised. Terms unseen in the corpus are dropped. */
export function vectorize(counts, idf) {
  const vec = new Map();
  let norm = 0;
  for (const [t, c] of counts) {
    const w = idf.get(t);
    if (!w) continue;
    // Bigrams are rarer and more specific; damp them so one phrase cannot dominate.
    const v = (1 + Math.log(c)) * w * (t.includes(' ') ? 0.7 : 1);
    vec.set(t, v);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, v] of vec) vec.set(t, v / norm);
  return vec;
}

export function cosine(a, b) {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, v] of small) {
    const w = large.get(t);
    if (w) dot += v * w;
  }
  return dot;
}

/** The terms contributing most to a match, for "matched on: ..." explanations. */
export function sharedTerms(a, b, limit = 4) {
  const hits = [];
  for (const [t, v] of a) {
    const w = b.get(t);
    if (w) hits.push([t, v * w]);
  }
  hits.sort((x, y) => y[1] - x[1]);
  const out = [];
  for (const [t] of hits) {
    // Skip a unigram already covered by a stronger bigram, and vice versa.
    if (out.some((o) => o.includes(t) || t.includes(o))) continue;
    out.push(t);
    if (out.length === limit) break;
  }
  return out;
}
