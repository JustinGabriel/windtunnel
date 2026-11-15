// A ridge regression of log(votes) on theme, framing and weekday indicators.
//
// It is the only part of the product that estimates anything, and it is weak on
// purpose: wording and category explain a small share of how a launch does. The
// cross-validated score is computed at boot and shown wherever the estimate is.

import { PATTERNS, THEMES } from './patterns.js';
import { mulberry32, quantile, spearman } from './stats.js';

const LAMBDA = 20;
const FOLDS = 10;

export const FEATURES = [
  ...THEMES.map((t) => ({ id: `theme:${t.id}`, kind: 'theme', ref: t.id, label: t.label })),
  ...PATTERNS.map((p) => ({ id: `pattern:${p.id}`, kind: 'pattern', ref: p.id, label: p.label })),
];
const N_CONTENT = FEATURES.length;

/** Content features only; weekday is added separately so it can be varied. */
export function contentFeatures({ name, tagline, haystack }) {
  const x = new Array(N_CONTENT);
  THEMES.forEach((t, i) => (x[i] = t.re.test(haystack) ? 1 : 0));
  PATTERNS.forEach((p, i) => (x[THEMES.length + i] = p.test({ name, tagline }) ? 1 : 0));
  return x;
}

function row(content, weekday) {
  const wd = new Array(7).fill(0);
  wd[weekday] = 1;
  return [...content, ...wd];
}

export function fitModel(docs) {
  const content = docs.map((d) => contentFeatures(d));
  const X = docs.map((d, i) => row(content[i], d.weekday));
  const y = docs.map((d) => Math.log(d.votes + 1));
  const w = ridge(X, y, LAMBDA);

  // Out-of-fold predictions: the honest measure of how much this model knows.
  const rand = mulberry32(11);
  const fold = docs.map(() => Math.floor(rand() * FOLDS));
  const oof = new Array(docs.length);
  for (let k = 0; k < FOLDS; k++) {
    const train = [];
    const target = [];
    X.forEach((r, i) => fold[i] !== k && (train.push(r), target.push(y[i])));
    const wk = ridge(train, target, LAMBDA);
    X.forEach((r, i) => fold[i] === k && (oof[i] = predict(wk, r)));
  }
  const residuals = oof.map((p, i) => y[i] - p).sort((a, b) => a - b);

  // Time split: fit on the first 60% of the window, test on what came after.
  const order = docs.map((_, i) => i).sort((a, b) => (docs[a].date < docs[b].date ? -1 : docs[a].date > docs[b].date ? 1 : 0));
  const cut = Math.floor(order.length * 0.6);
  const wt = ridge(order.slice(0, cut).map((i) => X[i]), order.slice(0, cut).map((i) => y[i]), LAMBDA);
  const later = order.slice(cut);

  const weekdayCoef = w.slice(1 + N_CONTENT);
  const meanWeekday = weekdayCoef.reduce((s, c, wd) => s + c * (docs.filter((d) => d.weekday === wd).length / docs.length), 0);

  return {
    n: docs.length,
    intercept: w[0],
    coef: Object.fromEntries(FEATURES.map((f, j) => [f.id, w[1 + j]])),
    weekdayCoef,
    meanWeekday,
    residuals,
    outOfFold: oof,
    // Every corpus launch's own content score, for "better than N% of launches".
    contentScores: content.map((c) => c.reduce((sum, v, j) => sum + v * w[1 + j], 0)).sort((a, b) => a - b),
    cv: {
      folds: FOLDS,
      spearman: spearman(oof, y),
      timeSplitSpearman: spearman(later.map((i) => predict(wt, X[i])), later.map((i) => y[i])),
      timeSplitTestN: later.length,
      residualP25: Math.exp(quantile(residuals, 0.25)),
      residualP75: Math.exp(quantile(residuals, 0.75)),
    },
  };
}

/** Log-votes for a pitch on a given weekday (or the average weekday if omitted). */
export function predictLog(model, content, weekday) {
  let s = model.intercept;
  FEATURES.forEach((f, j) => (s += model.coef[f.id] * content[j]));
  return s + (weekday == null ? model.meanWeekday : model.weekdayCoef[weekday]);
}

/** Sum of the coefficients of the traits a pitch has: 0 for a pitch with none of them. */
export function contentScore(model, content) {
  let s = 0;
  FEATURES.forEach((f, j) => (s += model.coef[f.id] * content[j]));
  return s;
}

function predict(w, r) {
  let s = w[0];
  for (let j = 0; j < r.length; j++) s += w[j + 1] * r[j];
  return s;
}

/** Ridge regression by Gauss-Jordan elimination; the intercept is not penalised. */
function ridge(X, y, lambda) {
  const p = X[0].length + 1;
  const M = Array.from({ length: p }, () => new Float64Array(p + 1));
  for (let i = 0; i < X.length; i++) {
    const r = [1, ...X[i]];
    for (let a = 0; a < p; a++) {
      if (!r[a]) continue;
      M[a][p] += r[a] * y[i];
      for (let b = 0; b < p; b++) M[a][b] += r[a] * r[b];
    }
  }
  for (let a = 1; a < p; a++) M[a][a] += lambda;
  for (let i = 0; i < p; i++) {
    let pivot = i;
    for (let r = i + 1; r < p; r++) if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    [M[i], M[pivot]] = [M[pivot], M[i]];
    const d = M[i][i] || 1e-9;
    for (let j = i; j <= p; j++) M[i][j] /= d;
    for (let r = 0; r < p; r++) {
      if (r === i || !M[r][i]) continue;
      const f = M[r][i];
      for (let j = i; j <= p; j++) M[r][j] -= f * M[i][j];
    }
  }
  return Array.from(M, (r) => r[p]);
}
