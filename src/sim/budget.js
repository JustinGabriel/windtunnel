// Spend control for simulations. A run reserves its worst-case cost up front and
// settles to the real figure afterwards, so concurrent runs cannot jointly overshoot
// the daily cap. This is the app-level limit; the hard backstop is a spend limit on
// the Anthropic workspace the key belongs to.

import { createHash } from 'node:crypto';

const DAY = 36 * 3600; // counters outlive their UTC day comfortably

export function createBudget(kv, { dailyUsd = Number(process.env.SIM_DAILY_BUDGET_USD ?? 5), visitorRunsPerDay = Number(process.env.SIM_VISITOR_RUNS_PER_DAY ?? 8) } = {}) {
  const day = () => new Date().toISOString().slice(0, 10);

  return {
    dailyUsd,
    visitorRunsPerDay,

    /**
     * @param {{visitor: string, estimateUsd: number, countsAsRun?: boolean}} request
     * @returns {{ok: true, settle: (actualUsd: number) => Promise<void>} | {ok: false, reason: 'daily' | 'visitor'}}
     */
    async reserve({ visitor, estimateUsd, countsAsRun = true }) {
      const visitorKey = `sim:visitor:${day()}:${visitorId(visitor)}`;
      if (countsAsRun) {
        const runs = await kv.add(visitorKey, 1, DAY);
        if (runs > visitorRunsPerDay) {
          await kv.add(visitorKey, -1, DAY);
          return { ok: false, reason: 'visitor' };
        }
      }
      const spendKey = `sim:spend:${day()}`;
      const spent = await kv.add(spendKey, estimateUsd, DAY);
      if (spent > dailyUsd) {
        await kv.add(spendKey, -estimateUsd, DAY);
        if (countsAsRun) await kv.add(visitorKey, -1, DAY);
        return { ok: false, reason: 'daily' };
      }
      let settled = false;
      return {
        ok: true,
        async settle(actualUsd) {
          if (settled) return;
          settled = true;
          await kv.add(spendKey, actualUsd - estimateUsd, DAY);
        },
      };
    },

    async spentToday() {
      return Number(await kv.get(`sim:spend:${day()}`)) || 0;
    },
  };
}

/**
 * A stable, non-reversible id for a client address. IPv6 clients are keyed on their
 * /64, since one subscriber can rotate through the rest of the address at will.
 */
export function visitorId(address) {
  let key = String(address ?? 'unknown').trim().toLowerCase();
  const mapped = key.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) key = mapped[1];
  else if (key.includes(':')) key = expandIpv6(key).slice(0, 4).join(':');
  return createHash('sha256').update(`windtunnel:${key}`).digest('hex').slice(0, 20);
}

function expandIpv6(address) {
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = address.includes('::') ? new Array(Math.max(0, 8 - left.length - right.length)).fill('0') : [];
  return [...left, ...fill, ...right].map((h) => h.padStart(4, '0'));
}
