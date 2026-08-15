import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Cron routes are public URLs whose only guard is a shared secret in the
 * Authorization header, so that secret has to stand on its own. The previous
 * fallback to NEXTAUTH_SECRET meant an unset CRON_SECRET quietly put the
 * session-signing key into a header on every scheduled request — one leak
 * there would hand over the ability to forge sessions, not just to run a cron.
 *
 * With no CRON_SECRET set the routes refuse everything. That is the honest
 * failure: the schedule stops, which is visible, rather than the guard
 * silently widening.
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const received = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length) return false;

  return timingSafeEqual(received, expected);
}
