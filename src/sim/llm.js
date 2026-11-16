// The only place that talks to a model. Everything above it works with plain
// objects, so tests swap in createFakeModel() and never touch the network.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export const MODEL = 'claude-haiku-5-5';

// USD per million tokens for prompts of 100K tokens or fewer, which is every prompt
// this app sends. Used for the budget, so it errs high rather than low.
const PRICE = { input: 0.1, output: 0.5 };

export function costOf(usage) {
  return ((usage?.input ?? 0) * PRICE.input + (usage?.output ?? 0) * PRICE.output) / 1e6;
}

/** A problem only the operator can fix (bad key, unknown model). Stops the run. */
export class ModelConfigError extends Error {}

/**
 * @returns a model, or null when no key is configured.
 * model.ask() never throws for an ordinary failure: one respondent refusing or
 * timing out should cost the run that respondent, not the whole panel.
 */
export function createModel({ apiKey = process.env.ANTHROPIC_API_KEY, model = MODEL, concurrency = 8, maxRetries = 1 } = {}) {
  if (!apiKey) return null;
  // baseURL is explicit so a host's ANTHROPIC_BASE_URL cannot redirect these calls.
  // One retry by default: on a web request, retries multiply both the wait and the spend.
  const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', maxRetries, timeout: 40_000 });
  const gate = semaphore(concurrency);

  return {
    name: model,
    async ask({ system, user, schema, effort = 'low', maxTokens = 2000 }) {
      return gate(async () => {
        try {
          const res = await client.messages.parse({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
            output_config: { effort, format: zodOutputFormat(schema) },
          });
          const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
          if (res.stop_reason === 'refusal') return { ok: false, reason: 'refusal', usage };
          if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'cut_off', usage };
          if (res.parsed_output == null) return { ok: false, reason: 'unparseable', usage };
          return { ok: true, data: res.parsed_output, usage };
        } catch (err) {
          if (
            err instanceof Anthropic.AuthenticationError ||
            err instanceof Anthropic.PermissionDeniedError ||
            err instanceof Anthropic.NotFoundError ||
            err instanceof Anthropic.BadRequestError
          ) {
            throw new ModelConfigError(`The model rejected the request (${err.status}): ${err.message}`);
          }
          if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: 'rate_limited', usage: null };
          if (err instanceof Anthropic.APIError) return { ok: false, reason: 'unavailable', usage: null };
          if (err?.name === 'ZodError' || err instanceof SyntaxError) return { ok: false, reason: 'unparseable', usage: null };
          throw err;
        }
      });
    },
  };
}

/**
 * A stand-in model for tests. `handler({ tag, system, user })` returns the object the
 * real model would have produced, or { refuse: true } / { fail: 'reason' }.
 * Output is validated against the same schema the real call would enforce.
 */
export function createFakeModel(handler, { name = 'fake-model' } = {}) {
  const calls = [];
  return {
    name,
    calls,
    async ask({ tag, system, user, schema }) {
      calls.push({ tag, system, user });
      const out = await handler({ tag, system, user });
      const usage = { input: Math.ceil((system.length + user.length) / 4), output: 120 };
      if (out?.refuse) return { ok: false, reason: 'refusal', usage };
      if (out?.fail) return { ok: false, reason: out.fail, usage: null };
      const parsed = schema.safeParse(out);
      return parsed.success ? { ok: true, data: parsed.data, usage } : { ok: false, reason: 'unparseable', usage };
    },
  };
}

/** Sums token usage across the results of a run. */
export function totalUsage(results) {
  const total = { input: 0, output: 0, calls: results.length, failed: 0 };
  for (const r of results) {
    total.input += r.usage?.input ?? 0;
    total.output += r.usage?.output ?? 0;
    if (!r.ok) total.failed++;
  }
  return total;
}

function semaphore(limit) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= limit || !waiting.length) return;
    active++;
    const { fn, resolve, reject } = waiting.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      next();
    });
}
