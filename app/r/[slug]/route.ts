import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";
import { consumeRequestSlot } from "@/lib/utils/request-limiter";

// Every hit here writes a LinkClick row, and the endpoint is public. These caps
// bound that write, not the redirect: a throttled visitor still reaches their
// destination, the click just stops counting. Both sit far above what a real
// campaign produces — the DM quota is 750 sends/hour, so one slug cannot
// legitimately outrun them.
const CLICK_WINDOW_SECONDS = 3600;
const CLICKS_PER_VISITOR = 30;
const CLICKS_PER_LINK = 5000;

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  // Attribute per visitor where we can. Behind a proxy that strips forwarding
  // headers there is no visitor to attribute to, so fall back to the whole-link
  // cap rather than lumping every such request into one shared bucket.
  const ipHash = hashClickIp(getRequestIp(request));
  const slot = await consumeRequestSlot(
    ipHash ? `click:${trackedLink.id}:${ipHash}` : `click:${trackedLink.id}`,
    ipHash ? CLICKS_PER_VISITOR : CLICKS_PER_LINK,
    CLICK_WINDOW_SECONDS
  );

  if (slot.allowed) {
    await prisma.linkClick.create({
      data: {
        workspaceId: trackedLink.workspaceId,
        automationId: trackedLink.automationId,
        instagramAccountId: trackedLink.automation.instagramAccountId,
        trackedLinkId: trackedLink.id,
        ipHash,
        userAgent: request.headers.get("user-agent"),
        referrer: request.headers.get("referer"),
      },
    });
  }

  return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
}
