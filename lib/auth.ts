import NextAuth, { type NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";
import { consumeRequestSlot } from "@/lib/utils/request-limiter";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

// Magic links are the only way in, and requesting one is unauthenticated: the
// endpoint sends mail to any address handed to it. The per-address cap is what
// stops someone using this instance to flood a stranger's inbox; the global cap
// keeps an attacker cycling addresses from burning the Resend quota. Set high
// enough that a person retrying a lost email never notices either one.
const LOGIN_LINK_WINDOW_SECONDS = 3600;
const LOGIN_LINKS_PER_EMAIL = 5;
const LOGIN_LINKS_GLOBAL = 200;

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
      from: process.env.EMAIL_FROM ?? "OpenReply <login@example.com>",
    }),
  ],
  callbacks: {
    async signIn({ user, email }) {
      // Only gates the "send me a magic link" step. Returning false here aborts
      // before sendVerificationRequest, so a throttled request costs no email.
      if (!email?.verificationRequest) return true;

      const identifier = user.email?.toLowerCase().trim();
      if (!identifier) return false;

      const perAddress = await consumeRequestSlot(
        `login:email:${identifier}`,
        LOGIN_LINKS_PER_EMAIL,
        LOGIN_LINK_WINDOW_SECONDS
      );
      if (!perAddress.allowed) return false;

      const global = await consumeRequestSlot(
        "login:global",
        LOGIN_LINKS_GLOBAL,
        LOGIN_LINK_WINDOW_SECONDS
      );

      return global.allowed;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    strategy: "database",
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
