/**
 * Request Rate Limiter — Unit Tests
 *
 * Covers the caps on the unauthenticated surfaces (magic-link sends, click
 * recording, invalid-signature logging) and, just as importantly, what happens
 * when Redis is not answering: these limiters guard availability, so they must
 * never be the reason a request fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEval, mockOn } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockOn: vi.fn(),
}));

vi.mock("ioredis", () => {
  const MockRedis = vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.eval = mockEval;
    this.on = mockOn;
    return this;
  });
  return { default: MockRedis };
});

vi.stubEnv("REDIS_URL", "redis://localhost:6379");

import { consumeRequestSlot } from "../lib/utils/request-limiter";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consumeRequestSlot", () => {
  it("allows a request that is inside the window's limit", async () => {
    mockEval.mockResolvedValue([1, 3, 3400]);

    const result = await consumeRequestSlot("login:email:a@b.com", 5, 3600);

    expect(result).toEqual({
      allowed: true,
      count: 3,
      retryAfterSeconds: 3400,
    });
  });

  it("blocks once the limit is exceeded and reports the window's remaining TTL", async () => {
    mockEval.mockResolvedValue([0, 6, 1200]);

    const result = await consumeRequestSlot("login:email:a@b.com", 5, 3600);

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(6);
    expect(result.retryAfterSeconds).toBe(1200);
  });

  it("namespaces keys so they cannot collide with the DM quota counters", async () => {
    mockEval.mockResolvedValue([1, 1, 3600]);

    await consumeRequestSlot("click:link_123", 30, 3600);

    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "rate:req:click:link_123",
      30,
      3600
    );
  });

  it("fails open when Redis rejects, rather than locking users out", async () => {
    mockEval.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await consumeRequestSlot("login:global", 200, 3600);

    expect(result.allowed).toBe(true);
  });

  it("fails open instead of hanging when Redis never answers", async () => {
    // An unreachable Redis must not turn every login into a stalled request,
    // so the command is raced against a timeout rather than awaited forever.
    mockEval.mockReturnValue(new Promise(() => {}));

    const result = await consumeRequestSlot("login:global", 200, 3600);

    expect(result.allowed).toBe(true);
  });
});
