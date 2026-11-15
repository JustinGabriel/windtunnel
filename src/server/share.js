// Share links carry the pitch itself, compressed into the URL. Opening one re-runs
// the analysis, so the server keeps no report state (which also makes it deployable
// to serverless hosts) and a shared report always reflects the current dataset.

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const MAX_TOKEN = 6000;
const MAX_JSON = 20_000;

/** @param {'r' | 'c'} kind report or comparison */
export function encodeShare(kind, input) {
  return deflateRawSync(JSON.stringify({ k: kind, ...input })).toString('base64url');
}

/** Returns the original input, or null for anything that is not a valid token of that kind. */
export function decodeShare(kind, token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN || !/^[\w-]+$/.test(token)) return null;
  try {
    const { k, ...input } = JSON.parse(inflateRawSync(Buffer.from(token, 'base64url'), { maxOutputLength: MAX_JSON }).toString('utf8'));
    return k === kind ? input : null;
  } catch {
    return null;
  }
}
