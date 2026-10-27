import "server-only";
import type { Role } from "@prisma/client";
import { db } from "@/server/db";
import { getConfig } from "@/server/config/env";
import { generateToken, sha256 } from "./crypto";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function sessionCookieName(): string {
  // __Host- cookies must be Secure, path=/ and have no Domain: prevents
  // subdomain cookie injection in production.
  return getConfig().NODE_ENV === "production" ? "__Host-bs_session" : "bs_session";
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  emailVerified: boolean;
  sessionId: string;
}

export async function createSession(
  userId: string,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.authSession.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 128) return null;
  const session = await db.authSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // Sliding expiry, written at most hourly.
    await db.authSession
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
      })
      .catch(() => undefined);
  }
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    role: session.user.role,
    emailVerified: session.user.emailVerifiedAt !== null,
    sessionId: session.id,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.authSession.deleteMany({ where: { id: sessionId } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db.authSession.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

export function serializeSessionCookie(token: string, expiresAt: Date): string {
  const secure = getConfig().NODE_ENV === "production";
  return [
    `${sessionCookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  const secure = getConfig().NODE_ENV === "production";
  return [
    `${sessionCookieName()}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}
