import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/ops/cron-auth";
import { attachNextReels } from "@/lib/ops/attach-next-reel";

// See lib/ops/attach-next-reel.ts. The worker runs this hourly, which binds a
// pending campaign to a new reel far sooner than a daily cron could.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const data = await attachNextReels();
  return NextResponse.json({ success: true, data });
}
