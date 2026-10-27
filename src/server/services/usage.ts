import "server-only";
import type { Plan, UsageOperation } from "@prisma/client";
import { db } from "@/server/db";
import { getConfig } from "@/server/config/env";
import { log } from "@/server/log";
import { AppError } from "@/server/http/errors";
import {
  checkQuota,
  effectivePlan,
  resolvePlanLimits,
  type PlanLimits,
  type QuotaKey,
} from "@/server/domain/entitlements";
import { estimateCostMicros, parseRates, type ProviderRates } from "@/server/domain/usage-cost";
import { ProviderError } from "@/server/providers/types";

let ratesCache: { json: string | undefined; rates: ProviderRates } | undefined;
function rates(): ProviderRates {
  const json = getConfig().PROVIDER_RATES_JSON;
  if (!ratesCache || ratesCache.json !== json) ratesCache = { json, rates: parseRates(json) };
  return ratesCache.rates;
}

export function planLimits(): Record<Plan, PlanLimits> {
  return resolvePlanLimits(getConfig().PLAN_LIMITS_JSON);
}

export async function getUserPlan(userId: string): Promise<{ plan: Plan; limits: PlanLimits }> {
  const subscription = await db.subscription.findUnique({ where: { userId } });
  const plan = effectivePlan(subscription);
  return { plan, limits: planLimits()[plan] };
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface UsageRecord {
  userId: string | null;
  operation: UsageOperation;
  provider: string;
  model?: string | null;
  units: number;
  unitType: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  success: boolean;
  failureCategory?: string | null;
  retryCount?: number;
  requestId?: string | null;
}

/** Persist one metered provider call. Never throws: metering must not break learning. */
export async function recordUsage(record: UsageRecord): Promise<void> {
  const costMicros = estimateCostMicros(rates(), {
    provider: record.provider,
    operation: record.operation,
    model: record.model,
    units: record.units,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
  });
  try {
    await db.usageEvent.create({
      data: {
        userId: record.userId,
        operation: record.operation,
        provider: record.provider,
        model: record.model ?? null,
        units: record.units,
        unitType: record.unitType,
        inputTokens: record.inputTokens ?? null,
        outputTokens: record.outputTokens ?? null,
        costMicros,
        latencyMs: record.latencyMs ?? null,
        success: record.success,
        failureCategory: record.failureCategory ?? null,
        retryCount: record.retryCount ?? 0,
        requestId: record.requestId ?? null,
      },
    });
  } catch (error) {
    log.error("usage.record_failed", { error, operation: record.operation });
  }
  log.info("provider.call", {
    requestId: record.requestId,
    provider: record.provider,
    model: record.model,
    operation: record.operation,
    success: record.success,
    failureCategory: record.failureCategory,
    latencyMs: record.latencyMs,
    retryCount: record.retryCount,
    costMicros,
  });
}

/** Today's (UTC) successful usage for one quota. */
export async function usedToday(userId: string, key: QuotaKey, now = new Date()): Promise<number> {
  const since = startOfUtcDay(now);
  if (key === "conversationTurnsPerDay") {
    return db.conversationTurn.count({ where: { userId, speaker: "LEARNER", createdAt: { gte: since } } });
  }
  const operation: Record<Exclude<QuotaKey, "conversationTurnsPerDay">, UsageOperation> = {
    sttSecondsPerDay: "STT",
    ttsCharactersPerDay: "TTS",
    pronunciationAssessmentsPerDay: "PRONUNCIATION",
    llmTokensPerDay: "LLM",
    realtimeMinutesPerDay: "REALTIME",
  };
  const op = operation[key];
  const agg = await db.usageEvent.aggregate({
    where: { userId, operation: op, success: true, createdAt: { gte: since } },
    _sum: { units: true, inputTokens: true, outputTokens: true },
  });
  if (op === "LLM") return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
  return Math.ceil(agg._sum.units ?? 0);
}

const QUOTA_MESSAGES: Record<QuotaKey, string> = {
  conversationTurnsPerDay: "You have reached today's speaking-turn limit for your plan.",
  sttSecondsPerDay: "You have reached today's speech-recognition limit for your plan.",
  ttsCharactersPerDay: "You have reached today's generated-audio limit for your plan.",
  pronunciationAssessmentsPerDay: "You have reached today's pronunciation-assessment limit for your plan.",
  llmTokensPerDay: "You have reached today's AI tutor limit for your plan.",
  realtimeMinutesPerDay: "You have reached today's live-conversation limit for your plan.",
};

/** Server-side quota enforcement. Throws `quota_exceeded` with transparent numbers. */
export async function assertQuota(userId: string, key: QuotaKey, requested = 1): Promise<void> {
  const { plan, limits } = await getUserPlan(userId);
  const used = await usedToday(userId, key);
  const check = checkQuota(limits, key, used, requested);
  if (!check.allowed) {
    throw new AppError("quota_exceeded", `${QUOTA_MESSAGES[key]} It resets at midnight UTC.`, {
      quota: key,
      plan,
      limit: check.limit,
      used: check.used,
    });
  }
}

export async function assertFeature(userId: string, feature: keyof PlanLimits["features"]): Promise<void> {
  const { plan, limits } = await getUserPlan(userId);
  if (!limits.features[feature]) {
    throw new AppError("plan_required", "This feature is not included in your current plan.", { feature, plan });
  }
}

export async function quotaSnapshot(userId: string) {
  const { plan, limits } = await getUserPlan(userId);
  const keys: QuotaKey[] = [
    "conversationTurnsPerDay",
    "sttSecondsPerDay",
    "ttsCharactersPerDay",
    "pronunciationAssessmentsPerDay",
    "llmTokensPerDay",
    "realtimeMinutesPerDay",
  ];
  const used = await Promise.all(keys.map((k) => usedToday(userId, k)));
  return {
    plan,
    features: limits.features,
    resetsAt: new Date(startOfUtcDay().getTime() + 86_400_000).toISOString(),
    quotas: Object.fromEntries(keys.map((k, i) => [k, { limit: limits[k], used: used[i]! }])),
  };
}

/** Map provider failures to safe client errors (with metering done by the caller). */
export function providerFailureToAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ProviderError) {
    switch (error.category) {
      case "rate_limited":
        return new AppError("provider_unavailable", "The speech/AI service is busy. Please try again in a moment.");
      case "circuit_open":
      case "unavailable":
      case "timeout":
      case "network":
        return new AppError("provider_unavailable", "The speech/AI service is not responding. Please try again shortly.");
      case "refused":
        return new AppError("bad_request", "The tutor could not respond to that message. Please rephrase it.");
      case "auth":
        log.error("provider.auth_failure", { provider: error.provider });
        return new AppError("provider_unavailable", "The service is misconfigured. Our team has been notified.");
      default:
        return new AppError("provider_error", "The speech/AI service returned an unexpected result. Please try again.");
    }
  }
  return new AppError("internal_error", "Something went wrong. Please try again.");
}

export function failureCategory(error: unknown): string {
  if (error instanceof ProviderError) return error.category;
  if (error instanceof AppError) return error.code;
  return "unknown";
}
