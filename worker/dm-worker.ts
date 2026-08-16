import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { claimScheduledRun } from "@/lib/ops/job-scheduler";
import { refreshExpiringTokens } from "@/lib/ops/refresh-tokens";
import { snapshotFollowers } from "@/lib/ops/snapshot-followers";
import { attachNextReels } from "@/lib/ops/attach-next-reel";
import os from "node:os";

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);
// Maintenance jobs that used to rely on vercel.json crons. Those only fire on
// Vercel, so a worker-hosted deployment (Railway, Fly, a plain VM) silently ran
// none of them — and an unrefreshed token stops every send about 60 days later.
// The worker checks often; each job's own interval decides whether it is due.
const SCHEDULED_TICK_MS = Number(
  process.env.SCHEDULED_JOB_TICK_MS ?? 15 * 60_000
);
const DAILY_SECONDS = 24 * 60 * 60;
const HOURLY_SECONDS = 60 * 60;

console.log("[DM Worker] Started");

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

/** Run a scheduled job, but only when its interval says it is due. */
async function runIfDue(
  name: string,
  intervalSeconds: number,
  run: () => Promise<string>
) {
  if (!(await claimScheduledRun(name, intervalSeconds))) return;

  try {
    console.log(`[Scheduler] ${name}: ${await run()}`);
  } catch (error) {
    // One failing job must not stop the others from being attempted.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Scheduler] ${name} failed:`, message);
  }
}

async function runScheduledJobs() {
  await runIfDue("refresh-tokens", DAILY_SECONDS, async () => {
    const result = await refreshExpiringTokens();
    const failed = result.results.filter((r) => r.status === "failed").length;
    return `${result.totalProcessed} account(s) due, ${failed} failed, ${result.workspacesReset} usage counter(s) reset`;
  });

  await runIfDue("snapshot-followers", DAILY_SECONDS, async () => {
    const result = await snapshotFollowers();
    return `${result.recorded} recorded, ${result.backfilled} backfilled, ${result.failures.length} failed`;
  });

  // Hourly: a campaign waiting on the creator's next reel goes live within an
  // hour of it being posted, instead of waiting for the next day.
  await runIfDue("attach-next-reel", HOURLY_SECONDS, async () => {
    const result = await attachNextReels();
    return `${result.bound} bound of ${result.checked} pending`;
  });
}

// Stagger the first pass behind the comment sweep so a cold start does not fire
// every Meta call it has at once.
setTimeout(() => void runScheduledJobs(), 20_000);
const scheduledTimer = setInterval(
  () => void runScheduledJobs(),
  SCHEDULED_TICK_MS
);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(scheduledTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
