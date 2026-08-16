import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getUserInfo } from "@/lib/meta/client";
import {
  backfillFollowerHistory,
  recordFollowerSnapshot,
} from "@/lib/reports/follower-history";

export interface FollowerSnapshotResult {
  accounts: number;
  recorded: number;
  backfilled: number;
  failures: Array<{ username: string; reason: string }>;
}

/**
 * Records one follower total per connected account per day.
 *
 * Instagram retains only ~30 days of account insights, so this job is the only
 * source of longer-range follower history. Missing a run loses that day
 * permanently — there is no way to backfill beyond the insights window.
 *
 * Safe to run more than once a day: the snapshot is upserted per UTC day, so a
 * second run overwrites the day's value rather than duplicating it.
 */
export async function snapshotFollowers(): Promise<FollowerSnapshotResult> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { accessToken: { not: "" } },
    select: {
      id: true,
      workspaceId: true,
      username: true,
      instagramId: true,
      accessToken: true,
    },
  });

  let recorded = 0;
  let backfilled = 0;
  const failures: FollowerSnapshotResult["failures"] = [];

  for (const account of accounts) {
    try {
      const token = decryptToken(account.accessToken);
      const info = await getUserInfo(token);

      if (typeof info.followers_count !== "number") {
        failures.push({
          username: account.username,
          reason: "followers_count not returned",
        });
        continue;
      }

      await recordFollowerSnapshot(account.id, info.followers_count);
      recorded += 1;

      // First time we see this account, try to recover the last 30 days.
      const existing = await prisma.followerSnapshot.count({
        where: { instagramAccountId: account.id },
      });
      if (existing <= 1) {
        backfilled += await backfillFollowerHistory(
          account.id,
          token,
          account.instagramId,
          info.followers_count
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      failures.push({ username: account.username, reason });
      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "WARNING",
            workspaceId: account.workspaceId,
            message: "Follower snapshot failed",
            payload: { username: account.username, reason },
          },
        })
        .catch(() => {});
    }
  }

  return { accounts: accounts.length, recorded, backfilled, failures };
}
