/**
 * Scheduled job claims — Unit Tests
 *
 * The point of the Redis claim is that a job survives worker restarts: a deploy
 * must not re-run a daily job, and a worker that redeploys hourly must not skip
 * it forever. These tests pin that contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSet } = vi.hoisted(() => ({ mockSet: vi.fn() }));

vi.mock("@/lib/queue/client", () => ({
  getRedisConnection: () => ({ set: mockSet }),
}));

import { claimScheduledRun } from "../lib/ops/job-scheduler";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimScheduledRun", () => {
  it("claims the run when no other run holds the window", async () => {
    mockSet.mockResolvedValue("OK");

    await expect(claimScheduledRun("refresh-tokens", 86400)).resolves.toBe(true);
  });

  it("sets the key with NX and the interval as its TTL", async () => {
    mockSet.mockResolvedValue("OK");

    await claimScheduledRun("refresh-tokens", 86400);

    expect(mockSet).toHaveBeenCalledWith(
      "job:lastrun:refresh-tokens",
      expect.any(String),
      "EX",
      86400,
      "NX"
    );
  });

  it("declines when the window is already claimed", async () => {
    // Redis returns null for SET NX when the key exists — this is what stops a
    // restarted worker from running a daily job a second time.
    mockSet.mockResolvedValue(null);

    await expect(claimScheduledRun("snapshot-followers", 86400)).resolves.toBe(
      false
    );
  });

  it("fails closed when Redis is unreachable", async () => {
    // Opposite of the request limiter: skipping a maintenance run is safe,
    // running it repeatedly is not.
    mockSet.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(claimScheduledRun("attach-next-reel", 3600)).resolves.toBe(
      false
    );
  });

  it("keeps each job on its own key so their intervals stay independent", async () => {
    mockSet.mockResolvedValue("OK");

    await claimScheduledRun("attach-next-reel", 3600);

    expect(mockSet).toHaveBeenCalledWith(
      "job:lastrun:attach-next-reel",
      expect.any(String),
      "EX",
      3600,
      "NX"
    );
  });
});
