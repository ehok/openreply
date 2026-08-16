/**
 * Scheduled job claims.
 *
 * The worker checks its scheduled jobs every few minutes, but each job should
 * only run once per its own interval. A plain `setInterval(24h)` cannot express
 * that: the worker restarts on every deploy, which resets the timer, so a
 * service that redeploys more often than the interval would never run the job
 * at all. Token refresh failing that way is silent and only surfaces ~60 days
 * later when every account's token has expired.
 *
 * So the schedule lives in Redis instead of in process memory. A job runs only
 * if it can claim a key that expires after its interval, which also means two
 * workers can never run the same job in the same window.
 */

import { getRedisConnection } from "@/lib/queue/client";

/**
 * Try to claim the next run of a scheduled job.
 *
 * @param jobName - Stable identifier, e.g. `refresh-tokens`.
 * @param intervalSeconds - Minimum gap between runs.
 * @returns true when the caller owns this run and should do the work.
 */
export async function claimScheduledRun(
  jobName: string,
  intervalSeconds: number
): Promise<boolean> {
  try {
    // SET ... NX succeeds only if no run has been claimed inside the window;
    // EX expires the claim so the next window opens on its own.
    const claimed = await getRedisConnection().set(
      `job:lastrun:${jobName}`,
      new Date().toISOString(),
      "EX",
      intervalSeconds,
      "NX"
    );
    return claimed === "OK";
  } catch (error) {
    // Fail closed, unlike the request limiter: a job that cannot verify it is
    // due is better skipped than run repeatedly. Redis being unreachable also
    // means the queue is down, so there is no work to protect here anyway.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Scheduler] Could not claim ${jobName}:`, message);
    return false;
  }
}
