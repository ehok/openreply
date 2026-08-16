import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/ops/cron-auth";
import { snapshotFollowers } from "@/lib/ops/snapshot-followers";

// See lib/ops/snapshot-followers.ts for what this does and why missing a run
// costs a day of history permanently. The worker runs the same function daily.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const data = await snapshotFollowers();
  return NextResponse.json({ success: true, data });
}
