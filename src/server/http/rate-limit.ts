import "server-only";
import { db } from "@/server/db";
import { AppError } from "./errors";

export interface RateLimitRule {
  /** Logical bucket name, e.g. "auth:login". */
  name: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counter stored in PostgreSQL, so limits hold across serverless
 * instances without Redis. One atomic upsert per check.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${rule.name}:${subject}`;
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt: new Date(windowStart.getTime() + windowMs),
  };
}

export async function enforceRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  const result = await consumeRateLimit(rule, subject);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    throw new AppError("rate_limited", "Too many requests. Please wait a moment and try again.", {
      retryAfterSeconds: retryAfter,
    });
  }
}

export const RATE_LIMITS = {
  register: { name: "auth:register", limit: 5, windowSeconds: 3600 },
  login: { name: "auth:login", limit: 10, windowSeconds: 900 },
  passwordReset: { name: "auth:reset", limit: 5, windowSeconds: 3600 },
  verifyResend: { name: "auth:verify-resend", limit: 5, windowSeconds: 3600 },
  contact: { name: "contact", limit: 5, windowSeconds: 3600 },
  api: { name: "api", limit: 300, windowSeconds: 60 },
  speech: { name: "speech", limit: 30, windowSeconds: 60 },
  llm: { name: "llm", limit: 20, windowSeconds: 60 },
  realtime: { name: "realtime", limit: 5, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;
