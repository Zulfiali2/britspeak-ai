import type { Plan, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";

/**
 * Plan limits are configuration, not code: defaults below can be overridden
 * with PLAN_LIMITS_JSON once unit economics are known. All limits are daily
 * (UTC day) to keep cost per learner predictable.
 */
export const limitsSchema = z.object({
  conversationTurnsPerDay: z.number().int().min(0),
  sttSecondsPerDay: z.number().int().min(0),
  ttsCharactersPerDay: z.number().int().min(0),
  pronunciationAssessmentsPerDay: z.number().int().min(0),
  llmTokensPerDay: z.number().int().min(0),
  realtimeMinutesPerDay: z.number().int().min(0),
  features: z.object({
    pronunciationLab: z.boolean(),
    realtime: z.boolean(),
    advancedReports: z.boolean(),
    personalisedReview: z.boolean(),
  }),
});

export type PlanLimits = z.infer<typeof limitsSchema>;

export const DEFAULT_PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    conversationTurnsPerDay: 20,
    sttSecondsPerDay: 10 * 60,
    ttsCharactersPerDay: 6_000,
    pronunciationAssessmentsPerDay: 10,
    llmTokensPerDay: 60_000,
    realtimeMinutesPerDay: 0,
    features: { pronunciationLab: true, realtime: false, advancedReports: false, personalisedReview: true },
  },
  PRO: {
    conversationTurnsPerDay: 150,
    sttSecondsPerDay: 60 * 60,
    ttsCharactersPerDay: 50_000,
    pronunciationAssessmentsPerDay: 100,
    llmTokensPerDay: 400_000,
    realtimeMinutesPerDay: 15,
    features: { pronunciationLab: true, realtime: true, advancedReports: false, personalisedReview: true },
  },
  PREMIUM: {
    conversationTurnsPerDay: 400,
    sttSecondsPerDay: 150 * 60,
    ttsCharactersPerDay: 120_000,
    pronunciationAssessmentsPerDay: 300,
    llmTokensPerDay: 1_000_000,
    realtimeMinutesPerDay: 45,
    features: { pronunciationLab: true, realtime: true, advancedReports: true, personalisedReview: true },
  },
};

export function resolvePlanLimits(overrideJson?: string): Record<Plan, PlanLimits> {
  if (!overrideJson) return DEFAULT_PLAN_LIMITS;
  const planOverride = limitsSchema
    .omit({ features: true })
    .partial()
    .extend({ features: limitsSchema.shape.features.partial().optional() });
  const parsed = z
    .object({ FREE: planOverride, PRO: planOverride, PREMIUM: planOverride })
    .partial()
    .parse(JSON.parse(overrideJson));
  const merge = (plan: Plan): PlanLimits => {
    const base = DEFAULT_PLAN_LIMITS[plan];
    const override = parsed[plan] ?? {};
    return limitsSchema.parse({
      ...base,
      ...override,
      features: { ...base.features, ...(override.features ?? {}) },
    });
  };
  return { FREE: merge("FREE"), PRO: merge("PRO"), PREMIUM: merge("PREMIUM") };
}

/** Statuses that grant paid features. PAST_DUE keeps access during the provider's retry window. */
const ENTITLED_STATUSES: SubscriptionStatus[] = ["ACTIVE", "TRIALING", "PAST_DUE"];

export function effectivePlan(
  subscription: { plan: Plan; status: SubscriptionStatus; currentPeriodEnd: Date | null } | null,
  now: Date = new Date(),
): Plan {
  if (!subscription || subscription.plan === "FREE") return "FREE";
  if (!ENTITLED_STATUSES.includes(subscription.status)) return "FREE";
  // Grace of 3 days past the period end for delayed renewal webhooks.
  if (
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000 < now.getTime()
  ) {
    return "FREE";
  }
  return subscription.plan;
}

export type QuotaKey = Exclude<keyof PlanLimits, "features">;

export interface QuotaCheck {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
}

export function checkQuota(limits: PlanLimits, key: QuotaKey, used: number, requested = 1): QuotaCheck {
  const limit = limits[key];
  return {
    allowed: used + requested <= limit,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}
