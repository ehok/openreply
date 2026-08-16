import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/ops/cron-auth";
import { refreshExpiringTokens } from "@/lib/ops/refresh-tokens";

// The work itself lives in lib so the worker can run it on its own schedule.
// This route stays for platforms with a real cron (Vercel) and for triggering a
// refresh by hand; both paths call exactly the same code.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const data = await refreshExpiringTokens();
  return NextResponse.json({ success: true, data });
}
