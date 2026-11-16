// A small key-value store for the three things simulations must remember: spend
// counters, finished results, and interview sessions in progress.
//
//   upstash  Upstash Redis over its REST API. The only backend shared between
//            serverless instances, so the only one a hosted spend cap can rest on.
//   file     JSON files in a directory. Right for one long-lived server.
//   memory   A Map. Tests and the stdio MCP server.
//
// On a serverless host with no Redis configured there is no store at all, and
// simulations stay off rather than run uncapped.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function createKv({ dir, env = process.env } = {}) {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return upstashKv(url, token);
  if (env.VERCEL) return null;
  return dir ? fileKv(dir) : memoryKv();
}

export function memoryKv(now = () => Date.now()) {
  const data = new Map();
  const live = (key) => {
    const hit = data.get(key);
    if (hit && hit.expires <= now()) data.delete(key);
    return data.get(key);
  };
  return {
    backend: 'memory',
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, ttlSeconds) {
      data.set(key, { value, expires: now() + ttlSeconds * 1000 });
    },
    async add(key, amount, ttlSeconds) {
      const current = live(key);
      const value = (Number(current?.value) || 0) + amount;
      data.set(key, { value, expires: current?.expires ?? now() + ttlSeconds * 1000 });
      return value;
    },
  };
}

export function fileKv(dir) {
  mkdirSync(dir, { recursive: true });
  const path = (key) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  const read = (key) => {
    const file = path(key);
    if (!existsSync(file)) return null;
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    if (entry.expires <= Date.now()) {
      rmSync(file, { force: true });
      return null;
    }
    return entry;
  };
  const write = (key, value, expires) => writeFileSync(path(key), JSON.stringify({ key, value, expires }));
  return {
    backend: 'file',
    async get(key) {
      return read(key)?.value ?? null;
    },
    async set(key, value, ttlSeconds) {
      write(key, value, Date.now() + ttlSeconds * 1000);
    },
    async add(key, amount, ttlSeconds) {
      const current = read(key);
      const value = (Number(current?.value) || 0) + amount;
      write(key, value, current?.expires ?? Date.now() + ttlSeconds * 1000);
      return value;
    },
  };
}

export function upstashKv(url, token, fetchImpl = fetch) {
  const base = url.replace(/\/$/, '');
  const command = async (...args) => {
    const res = await fetchImpl(base, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Redis ${args[0]} failed: ${body.error ?? res.status}`);
    return body.result;
  };
  return {
    backend: 'upstash',
    async get(key) {
      const raw = await command('GET', key);
      return raw == null ? null : JSON.parse(raw);
    },
    async set(key, value, ttlSeconds) {
      await command('SET', key, JSON.stringify(value), 'EX', String(ttlSeconds));
    },
    // INCRBYFLOAT is atomic across instances, which is the point of this backend.
    async add(key, amount, ttlSeconds) {
      const value = Number(await command('INCRBYFLOAT', key, String(amount)));
      if (Math.abs(value - amount) < 1e-9) await command('EXPIRE', key, String(ttlSeconds));
      return value;
    },
  };
}
