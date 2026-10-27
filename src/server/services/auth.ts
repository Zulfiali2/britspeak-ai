import "server-only";
import type { AuthTokenType } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { getConfig } from "@/server/config/env";
import { log } from "@/server/log";
import { AppError } from "@/server/http/errors";
import { burnPasswordCheck, generateToken, hashPassword, sha256, verifyPassword } from "@/server/auth/crypto";
import { createSession, revokeAllSessions } from "@/server/auth/session";
import { passwordResetEmail, sendEmail, verificationEmail } from "@/server/email/mailer";
import { audit } from "./audit";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address." }));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "Use at most 200 characters.")
  .refine((p) => /[a-zA-Z]/.test(p) && /[^a-zA-Z]/.test(p), "Include at least one letter and one number or symbol.");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1, "Enter your name.").max(80),
  acceptTerms: z.literal(true, { message: "Please accept the terms and privacy policy." }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

async function issueToken(userId: string, type: AuthTokenType): Promise<string> {
  const token = generateToken();
  await db.$transaction([
    // One live token per type: older links stop working.
    db.authToken.deleteMany({ where: { userId, type, usedAt: null } }),
    db.authToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]) },
    }),
  ]);
  return token;
}

async function consumeToken(token: string, type: AuthTokenType) {
  if (!token || token.length > 128) throw new AppError("bad_request", "This link is invalid or has expired.");
  const record = await db.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new AppError("bad_request", "This link is invalid or has expired.");
  }
  // Atomic single use: only one concurrent request can flip usedAt.
  const claimed = await db.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw new AppError("bad_request", "This link is invalid or has expired.");
  return record;
}

export async function sendVerification(user: { id: string; email: string; displayName: string }) {
  const token = await issueToken(user.id, "EMAIL_VERIFICATION");
  const url = new URL("/verify-email", getConfig().APP_URL);
  url.searchParams.set("token", token);
  await sendEmail(verificationEmail(user.email, user.displayName, url.toString()));
}

export async function register(input: z.infer<typeof registerSchema>, userAgent?: string | null) {
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError("conflict", "An account with this email already exists. Try signing in or resetting your password.");
  }
  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({
    data: {
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      profile: { create: { learningGoals: [] } },
      subscription: { create: { plan: "FREE", status: "ACTIVE", billingProvider: "none" } },
    },
  });
  try {
    await sendVerification(user);
  } catch (error) {
    // The account exists; the learner can request another email from the app.
    log.error("auth.verification_email_failed", { userId: user.id, error });
  }
  const session = await createSession(user.id, userAgent);
  return { user, session };
}

export async function login(input: z.infer<typeof loginSchema>, userAgent?: string | null) {
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await burnPasswordCheck(input.password);
    throw new AppError("unauthenticated", "Email or password is incorrect.");
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError("unauthenticated", "Email or password is incorrect.");
  }
  const session = await createSession(user.id, userAgent);
  return { user, session };
}

export async function verifyEmail(token: string): Promise<void> {
  const record = await consumeToken(token, "EMAIL_VERIFICATION");
  await db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  await sendVerification(user);
}

/** Always succeeds from the caller's point of view (no account enumeration). */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  const token = await issueToken(user.id, "PASSWORD_RESET");
  const url = new URL("/reset-password", getConfig().APP_URL);
  url.searchParams.set("token", token);
  try {
    await sendEmail(passwordResetEmail(user.email, url.toString()));
  } catch (error) {
    log.error("auth.reset_email_failed", { userId: user.id, error });
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await consumeToken(token, "PASSWORD_RESET");
  const passwordHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: record.userId },
    // Following a reset link proves control of the inbox.
    data: { passwordHash, emailVerifiedAt: new Date() },
  });
  await revokeAllSessions(record.userId);
  await audit(record.userId, "auth.password_reset", { type: "user", id: record.userId });
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError("bad_request", "Your current password is incorrect.");
  }
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await revokeAllSessions(userId, currentSessionId);
  await audit(userId, "auth.password_changed", { type: "user", id: userId });
}
