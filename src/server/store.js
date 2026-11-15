// File-backed persistence: one JSON file per saved report, one JSONL file for the
// waitlist. Enough for a single node; swap for a database behind the same four
// functions when it needs more.

import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z0-9]{10}$/;

export function createStore(dir) {
  const reports = join(dir, 'reports');
  mkdirSync(reports, { recursive: true });
  const waitlist = join(dir, 'waitlist.jsonl');

  return {
    /** Saves a report or comparison and returns its public id. */
    save(kind, payload) {
      const id = randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 10);
      writeFileSync(join(reports, `${id}.json`), JSON.stringify({ id, kind, createdAt: new Date().toISOString(), payload }));
      return id;
    },

    load(id, kind) {
      if (!ID.test(id)) return null;
      const file = join(reports, `${id}.json`);
      if (!existsSync(file)) return null;
      const record = JSON.parse(readFileSync(file, 'utf8'));
      return record.kind === kind ? record : null;
    },

    count() {
      return readdirSync(reports).length;
    },

    /** Returns false when the address was already on the list. */
    joinWaitlist(email, plan) {
      const seen = existsSync(waitlist)
        ? readFileSync(waitlist, 'utf8')
            .split('\n')
            .filter(Boolean)
            .some((line) => JSON.parse(line).email === email)
        : false;
      if (seen) return false;
      appendFileSync(waitlist, `${JSON.stringify({ email, plan, at: new Date().toISOString() })}\n`);
      return true;
    },
  };
}
