// The simulation service: ties the model, the store and the budget together behind
// the handful of operations the web routes and MCP tools call.

import { randomBytes } from 'node:crypto';
import { analyzePitch } from '../engine/analyze.js';
import { BUYERS_ESTIMATE_USD, runBuyers } from './agents.js';
import { PANEL_ESTIMATE_USD, runPanel } from './audience.js';
import { createBudget } from './budget.js';
import { INTERVIEW_TURN_ESTIMATE_USD, MAX_TURNS, sellerReplies, standInAnswers, startInterview } from './interview.js';
import { createKv } from './kv.js';
import { createModel } from './llm.js';
import { THREAD_ESTIMATE_USD, answerThread, openThread } from './thread.js';

const RESULT_TTL = 90 * 24 * 3600;
const SESSION_TTL = 6 * 3600;
const ID = /^[A-Za-z0-9_-]{12}$/;
const STEP_DEADLINE_MS = 45_000; // a serverless request gets 60 seconds
const LOCK_SECONDS = 90;

/**
 * The same model, but any call still unanswered at the deadline comes back as a
 * respondent who "did not answer", so a slow call costs one answer, not the page.
 */
export function withDeadline(model, ms = STEP_DEADLINE_MS) {
  const end = Date.now() + ms;
  const late = { ok: false, reason: 'timed_out', usage: null };
  return {
    name: model.name,
    ask(request) {
      const left = end - Date.now();
      if (left <= 0) return Promise.resolve(late);
      let timer;
      return Promise.race([model.ask(request), new Promise((resolve) => (timer = setTimeout(() => resolve(late), left)))]).finally(() => clearTimeout(timer));
    },
  };
}

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
  async function metered({ visitor, estimateUsd, countsAsRun, wholeRunUsd }, run) {
    requireEnabled();
    const hold = await funds.reserve({ visitor, estimateUsd, countsAsRun, wholeRunUsd });
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

  /**
   * One step of a stored session at a time. Sessions are loaded, changed and saved,
   * so two requests for the same step (a double click, a retry) would otherwise both
   * run and both be charged.
   */
  async function locked(id, fn) {
    const key = `sim:lock:${id}`;
    if ((await kv.add(key, 1, LOCK_SECONDS)) > 1) {
      await kv.add(key, -1, LOCK_SECONDS);
      throw Object.assign(new Error('That step is already running. Give it a moment and reload.'), { status: 409 });
    }
    try {
      return await fn();
    } finally {
      await kv.add(key, -1, LOCK_SECONDS);
    }
  }

  async function interviewStep(id, mode, visitor, step) {
    return locked(id, async () => {
      const session = await load(id, 'interview');
      if (!session || session.mode !== mode) return null;
      if (session.status === 'done') return session;
      return metered({ visitor, estimateUsd: INTERVIEW_TURN_ESTIMATE_USD, countsAsRun: false }, async () => {
        const before = session.usage.usd;
        try {
          await step(session, withDeadline(model));
        } finally {
          // A failed step can leave an unanswered seller message; drop it so the turn can be retried.
          if (session.status === 'awaiting_seller' && session.transcript.at(-1)?.role === 'seller') session.transcript.pop();
        }
        await save(session, session.status === 'done' ? RESULT_TTL : SESSION_TTL);
        return { result: session, usd: Math.max(0, session.usage.usd - before) };
      });
    });
  }

  return {
    status,
    budget: funds,

    panel: (pitch, { visitor }) =>
      metered({ visitor, estimateUsd: PANEL_ESTIMATE_USD, countsAsRun: true }, async () => {
        const result = await save(await runPanel({ corpus, model: withDeadline(model), pitch }));
        return { result, usd: result.usage.usd };
      }),

    buyers: (pitch, { visitor }) =>
      metered({ visitor, estimateUsd: BUYERS_ESTIMATE_USD, countsAsRun: true }, async () => {
        const result = await save(await runBuyers({ corpus, model: withDeadline(model), pitch }));
        return { result, usd: result.usage.usd };
      }),

    /** @param {'rehearsal' | 'external'} mode */
    async startInterview({ pitch, facts, mode }, { visitor }) {
      requireEnabled();
      const input = analyzePitch(corpus, pitch).input;
      // Refused unless a whole interview fits under today's cap, so it can always finish.
      const wholeRunUsd = INTERVIEW_TURN_ESTIMATE_USD * (MAX_TURNS + 2);
      return metered({ visitor, estimateUsd: INTERVIEW_TURN_ESTIMATE_USD, countsAsRun: true, wholeRunUsd }, async () => {
        const session = await save(await startInterview({ model: withDeadline(model), input, facts, mode }), SESSION_TTL);
        return { result: session, usd: session.usage.usd };
      });
    },

    /** Rehearsal: the stand-in seller answers, then the buyer follows up or the interview is graded. */
    rehearsalTurn(id, { visitor }) {
      requireEnabled();
      return interviewStep(id, 'rehearsal', visitor, async (session, m) => {
        const answer = await standInAnswers({ model: m, session });
        await sellerReplies({ model: m, session, text: answer });
      });
    },

    /** External: the caller's own agent supplies the seller's answer. */
    reply(id, text, { visitor }) {
      requireEnabled();
      return interviewStep(id, 'external', visitor, (session, m) => sellerReplies({ model: m, session, text }));
    },

    /**
     * Opens a comment thread from a stored panel. Free: the comments already exist.
     * @param {'typed' | 'stand_in' | 'agent'} mode who writes the maker's replies
     */
    async startThread(panelId, { facts, mode }) {
      const panel = await load(panelId, 'panel');
      if (!panel) return null;
      return save(openThread({ panel, facts, mode }), SESSION_TTL);
    },

    /** The maker's replies go in; each visitor is asked again, under the reply and under a placebo. */
    answerThread(id, replies, { visitor }) {
      requireEnabled();
      return locked(id, async () => {
        const session = await load(id, 'thread');
        if (!session) return null;
        if (session.status === 'done') return session;
        return metered({ visitor, estimateUsd: THREAD_ESTIMATE_USD, countsAsRun: true }, async () => {
          await answerThread({ model: withDeadline(model), session, replies });
          await save(session, RESULT_TTL);
          return { result: session, usd: session.usage.usd };
        });
      });
    },

    getThread: (id) => load(id, 'thread'),

    getPanel: (id) => load(id, 'panel'),
    getBuyers: (id) => load(id, 'buyers'),
    getInterview: (id) => load(id, 'interview'),
  };
}
