// The simulation service: ties the model, the store and the budget together behind
// the handful of operations the web routes and MCP tools call.

import { randomBytes } from 'node:crypto';
import { analyzePitch } from '../engine/analyze.js';
import { BUYERS_ESTIMATE_USD, runBuyers } from './agents.js';
import { PANEL_ESTIMATE_USD, runPanel } from './audience.js';
import { createBudget } from './budget.js';
import { INTERVIEW_TURN_ESTIMATE_USD, sellerReplies, standInAnswers, startInterview } from './interview.js';
import { createKv } from './kv.js';
import { createModel } from './llm.js';

const RESULT_TTL = 90 * 24 * 3600;
const SESSION_TTL = 6 * 3600;
const ID = /^[A-Za-z0-9_-]{12}$/;

const LIMIT_MESSAGES = {
  visitor: 'You have used today’s free simulation runs. They reset at midnight UTC.',
  daily: 'Simulations have reached today’s budget for this site. They reset at midnight UTC; the measured tests still work.',
};

/**
 * @returns a service whose `status.enabled` says whether simulations can run, and
 * why not when they cannot. Every run method rejects when disabled.
 */
export function createSim({ corpus, dataDir, model = createModel(), kv = createKv({ dir: dataDir ? `${dataDir}/sim` : undefined }), budget } = {}) {
  const status = !model
    ? { enabled: false, reason: 'no_key', message: 'Simulations are switched off on this deployment: no model key is configured.' }
    : !kv
      ? { enabled: false, reason: 'no_store', message: 'Simulations are switched off on this deployment: it has no shared store to hold the spend cap.' }
      : { enabled: true, model: model.name, store: kv.backend };
  const funds = status.enabled ? (budget ?? createBudget(kv)) : null;

  const requireEnabled = () => {
    if (!status.enabled) throw Object.assign(new Error(status.message), { status: 503 });
  };
  const newId = () => randomBytes(9).toString('base64url');

  /** Reserves budget, runs, settles to the real cost, and stores the result. */
  async function metered({ visitor, estimateUsd, countsAsRun }, run) {
    requireEnabled();
    const hold = await funds.reserve({ visitor, estimateUsd, countsAsRun });
    if (!hold.ok) throw Object.assign(new Error(LIMIT_MESSAGES[hold.reason]), { status: 429 });
    let spent = estimateUsd;
    try {
      const { result, usd } = await run();
      spent = usd;
      return result;
    } finally {
      await hold.settle(spent);
    }
  }

  async function save(result, ttl = RESULT_TTL) {
    const id = result.id ?? newId();
    result.id = id;
    await kv.set(`sim:doc:${id}`, result, ttl);
    return result;
  }

  async function load(id, kind) {
    requireEnabled();
    if (!ID.test(String(id))) return null;
    const doc = await kv.get(`sim:doc:${id}`);
    return doc && doc.kind === kind ? doc : null;
  }

  async function interviewStep(session, visitor, step, countsAsRun = false) {
    return metered({ visitor, estimateUsd: INTERVIEW_TURN_ESTIMATE_USD, countsAsRun }, async () => {
      const before = session.usage.usd;
      try {
        await step();
      } finally {
        // A failed step can leave an unanswered seller message; drop it so the turn can be retried.
        if (session.status === 'awaiting_seller' && session.transcript.at(-1)?.role === 'seller') session.transcript.pop();
      }
      await save(session, session.status === 'done' ? RESULT_TTL : SESSION_TTL);
      return { result: session, usd: Math.max(0, session.usage.usd - before) };
    });
  }

  return {
    status,
    budget: funds,

    panel: (pitch, { visitor }) =>
      metered({ visitor, estimateUsd: PANEL_ESTIMATE_USD, countsAsRun: true }, async () => {
        const result = await save(await runPanel({ corpus, model, pitch }));
        return { result, usd: result.usage.usd };
      }),

    buyers: (pitch, { visitor }) =>
      metered({ visitor, estimateUsd: BUYERS_ESTIMATE_USD, countsAsRun: true }, async () => {
        const result = await save(await runBuyers({ corpus, model, pitch }));
        return { result, usd: result.usage.usd };
      }),

    /** @param {'rehearsal' | 'external'} mode */
    async startInterview({ pitch, facts, mode }, { visitor }) {
      requireEnabled();
      const input = analyzePitch(corpus, pitch).input;
      return metered({ visitor, estimateUsd: INTERVIEW_TURN_ESTIMATE_USD, countsAsRun: true }, async () => {
        const session = await save(await startInterview({ model, input, facts, mode }), SESSION_TTL);
        return { result: session, usd: session.usage.usd };
      });
    },

    /** Rehearsal: the stand-in seller answers, then the buyer follows up or the interview is graded. */
    async rehearsalTurn(id, { visitor }) {
      const session = await load(id, 'interview');
      if (!session || session.mode !== 'rehearsal') return null;
      if (session.status === 'done') return session;
      return interviewStep(session, visitor, async () => {
        const answer = await standInAnswers({ model, session });
        await sellerReplies({ model, session, text: answer });
      });
    },

    /** External: the caller's own agent supplies the seller's answer. */
    async reply(id, text, { visitor }) {
      const session = await load(id, 'interview');
      if (!session || session.mode !== 'external') return null;
      if (session.status === 'done') return session;
      return interviewStep(session, visitor, () => sellerReplies({ model, session, text }));
    },

    getPanel: (id) => load(id, 'panel'),
    getBuyers: (id) => load(id, 'buyers'),
    getInterview: (id) => load(id, 'interview'),
  };
}
