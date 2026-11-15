// Where waitlist sign-ups go. Three cases:
//
//   webhook  WAITLIST_WEBHOOK_URL is set: each sign-up is POSTed there as JSON
//            ({ email, plan, at }). Works anywhere, including serverless hosts.
//   file     a JSONL file under the data directory. Right for a single long-lived node.
//   closed   a serverless host with no webhook. Local files there vanish between
//            requests, so the form is hidden rather than collecting emails it would lose.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function createWaitlist({ dir, webhookUrl = process.env.WAITLIST_WEBHOOK_URL, serverless = Boolean(process.env.VERCEL) } = {}) {
  if (webhookUrl) {
    return {
      mode: 'webhook',
      open: true,
      async join(email, plan) {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, plan, at: new Date().toISOString() }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`Waitlist webhook answered ${res.status}`);
        return 'yes';
      },
    };
  }

  if (serverless || !dir) {
    return {
      mode: 'closed',
      open: false,
      async join() {
        throw Object.assign(new Error('The waitlist is not open on this deployment.'), { status: 503 });
      },
    };
  }

  const file = join(dir, 'waitlist.jsonl');
  return {
    mode: 'file',
    open: true,
    /** Resolves to 'already' when the address was on the list. */
    async join(email, plan) {
      mkdirSync(dir, { recursive: true });
      const seen =
        existsSync(file) &&
        readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .some((line) => JSON.parse(line).email === email);
      if (seen) return 'already';
      appendFileSync(file, `${JSON.stringify({ email, plan, at: new Date().toISOString() })}\n`);
      return 'yes';
    },
  };
}
