/**
 * Request Rate Limiter
 *
 * Redis fixed-window limiter for the surfaces that are reachable without a
 * session: magic-link sends, tracked-link click recording, and the webhook's
 * invalid-signature log. Each one does real work per request — sends an email,
 * writes a row — so without a cap each is an amplification vector: an inbox to
 * flood, a quota to burn, or a table to grow.
 *
 * Separate from lib/utils/rate-limiter.ts, which enforces Meta's DM quota and
 * speaks in the requeue/skip decisions the worker acts on.
 */

import Redis from "ioredis";
import { clearTimeout, setTimeout } from "node:timers";

// A limiter on the request path must answer or give up quickly. BullMQ's
// `maxRetriesPerRequest: null` is the opposite of what is wanted here: it
// retries forever, so an unreachable Redis turns every login and every click
// into a hung request instead of a fast fall-through.
const COMMAND_TIMEOUT_MS = 1000;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
    });
    // ioredis emits connection errors on the instance; without a listener Node
    // treats them as unhandled and can take the process down. The command-level
    // catch below is what actually decides the request.
    redis.on("error", (error: Error) => {
      console.error("[RequestLimiter] Redis connection error:", error.message);
    });
  }
  return redis;
}

function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis did not respond within ${ms}ms`)),
      ms
    );
    // Never let a pending limiter check hold the worker or a test run open.
    timer.unref();
  });

  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

// INCR, then EXPIRE only on the first hit of a window. Setting the TTL on
// every request would slide the window forward indefinitely under sustained
// load, so a fast enough attacker would never see the counter reset.
const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("TTL", KEYS[1])
if count > tonumber(ARGV[1]) then
  return {0, count, ttl}
end
return {1, count, ttl}
`;

export interface RequestLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

function toScriptNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}

/**
 * Consume one slot from a fixed window.
 *
 * @param key - Limiter identity, e.g. `login:email:<address>`. Namespaced
 *              under `rate:req:` so it cannot collide with the DM quota keys.
 * @param limit - Requests allowed per window.
 * @param windowSeconds - Window length.
 */
export async function consumeRequestSlot(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RequestLimitResult> {
  try {
    const result = await withTimeout(
      getRedis().eval(CONSUME_SCRIPT, 1, `rate:req:${key}`, limit, windowSeconds),
      COMMAND_TIMEOUT_MS
    );
    const values = Array.isArray(result) ? result : [];
    const ttl = toScriptNumber(values[2]);

    return {
      allowed: toScriptNumber(values[0]) === 1,
      count: toScriptNumber(values[1]),
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (error) {
    // Redis being unreachable or slow must not take sign-in down with it. Fail
    // open and make the outage loud: a limiter that fails closed here locks
    // every user out of the app for the duration of a Redis blip.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[RequestLimiter] Redis unavailable, allowing request:", message);
    return { allowed: true, count: 0, retryAfterSeconds: 0 };
  }
}
