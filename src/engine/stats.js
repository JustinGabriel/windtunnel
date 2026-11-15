// Small, dependency-free statistics helpers.

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values) {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Quantile of values weighted by non-negative weights. */
export function weightedQuantile(pairs, q) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= q * total) return v;
  }
  return sorted.at(-1)[0];
}

/** Share of `sorted` values that are <= x, in 0..1. */
export function percentileOf(sorted, x) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length ? lo / sorted.length : 0;
}

function ranks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export function pearson(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

export function spearman(x, y) {
  return pearson(ranks(x), ranks(y));
}

/** Deterministic PRNG so permutation tests give the same answer on every boot. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two-sided permutation test on the difference in mean log(votes) between a group and
 * the rest. Returns the share of random relabellings at least as extreme as observed.
 */
export function permutationP(logVotes, inGroup, { rounds = 1000, seed = 7 } = {}) {
  const n = logVotes.length;
  const k = inGroup.reduce((s, b) => s + (b ? 1 : 0), 0);
  if (k === 0 || k === n) return 1;
  const total = logVotes.reduce((a, b) => a + b, 0);
  const diff = (sum) => sum / k - (total - sum) / (n - k);
  let observed = 0;
  for (let i = 0; i < n; i++) if (inGroup[i]) observed += logVotes[i];
  const target = Math.abs(diff(observed));
  const rand = mulberry32(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  let extreme = 0;
  for (let r = 0; r < rounds; r++) {
    // Partial Fisher-Yates: the first k slots become a uniform random subset.
    let sum = 0;
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rand() * (n - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
      sum += logVotes[idx[i]];
    }
    if (Math.abs(diff(sum)) >= target) extreme++;
  }
  return (extreme + 1) / (rounds + 1);
}
