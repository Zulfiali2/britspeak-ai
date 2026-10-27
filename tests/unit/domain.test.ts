import { describe, expect, it } from "vitest";
import { canTransition, nextSessionStatus, activeSecondsSince } from "@/server/domain/session-state";
import { scheduleReview, qualityFromScore } from "@/server/domain/spaced-repetition";
import {
  DEFAULT_PLAN_LIMITS,
  checkQuota,
  effectivePlan,
  resolvePlanLimits,
} from "@/server/domain/entitlements";
import { estimateCostMicros, parseRates } from "@/server/domain/usage-cost";
import { computeStreak, fillDailySeries, meanOrNull, toDayKey } from "@/server/domain/progress";
import { assertOwner } from "@/server/domain/authorization";
import { alignWords, normalizeWords, recognitionMatchRate } from "@/server/domain/text-align";
import { parseLessonContent } from "@/server/domain/lesson-content";

describe("session state machine", () => {
  it("allows the documented transitions", () => {
    expect(nextSessionStatus("ACTIVE", "pause")).toBe("PAUSED");
    expect(nextSessionStatus("PAUSED", "resume")).toBe("ACTIVE");
    expect(nextSessionStatus("PAUSED", "complete")).toBe("COMPLETED");
    expect(nextSessionStatus("ACTIVE", "add_turn")).toBe("ACTIVE");
  });

  it("rejects transitions out of terminal states and turns while paused", () => {
    expect(canTransition("COMPLETED", "resume")).toBe(false);
    expect(canTransition("ABANDONED", "add_turn")).toBe(false);
    expect(canTransition("PAUSED", "add_turn")).toBe(false);
    expect(canTransition("ACTIVE", "resume")).toBe(false);
  });

  it("caps a single active stretch at 30 minutes", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(activeSecondsSince(start, new Date("2026-01-01T00:05:00Z"))).toBe(300);
    expect(activeSecondsSince(start, new Date("2026-01-02T00:00:00Z"))).toBe(1800);
    expect(activeSecondsSince(start, new Date("2025-12-31T00:00:00Z"))).toBe(0);
  });
});

describe("spaced repetition", () => {
  const fresh = { repetitions: 0, easeFactor: 2.5, intervalDays: 0, lapses: 0 };
  const now = new Date("2026-03-01T10:00:00Z");

  it("schedules 1 day, 3 days, then grows by ease", () => {
    const r1 = scheduleReview(fresh, 5, now);
    expect(r1.intervalDays).toBe(1);
    const r2 = scheduleReview(r1, 4, now);
    expect(r2.intervalDays).toBe(3);
    const r3 = scheduleReview(r2, 4, now);
    expect(r3.intervalDays).toBeGreaterThan(3);
    expect(r3.masteryStatus).toBe("REVIEWING");
  });

  it("resets on failure, counts a lapse and brings the item back within minutes", () => {
    const learned = scheduleReview(scheduleReview(fresh, 5, now), 5, now);
    const failed = scheduleReview(learned, 1, now);
    expect(failed.repetitions).toBe(0);
    expect(failed.lapses).toBe(1);
    expect(failed.masteryStatus).toBe("LEARNING");
    expect(failed.nextReviewAt.getTime() - now.getTime()).toBeLessThan(15 * 60 * 1000);
  });

  it("never lets ease drop below 1.3", () => {
    let state = { ...fresh };
    for (let i = 0; i < 20; i++) state = scheduleReview(state, 0, now);
    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("marks long, repeated success as mastered", () => {
    let state = scheduleReview(fresh, 5, now);
    for (let i = 0; i < 6; i++) state = scheduleReview(state, 5, now);
    expect(state.masteryStatus).toBe("MASTERED");
  });

  it("maps scores to quality grades", () => {
    expect(qualityFromScore(95)).toBe(5);
    expect(qualityFromScore(72)).toBe(3);
    expect(qualityFromScore(10)).toBe(0);
  });
});

describe("entitlements", () => {
  const future = new Date(Date.now() + 10 * 86400_000);
  it("grants paid plans only for entitled statuses", () => {
    expect(effectivePlan(null)).toBe("FREE");
    expect(effectivePlan({ plan: "PRO", status: "ACTIVE", currentPeriodEnd: future })).toBe("PRO");
    expect(effectivePlan({ plan: "PRO", status: "PAST_DUE", currentPeriodEnd: future })).toBe("PRO");
    expect(effectivePlan({ plan: "PREMIUM", status: "CANCELED", currentPeriodEnd: future })).toBe("FREE");
    expect(effectivePlan({ plan: "PRO", status: "UNPAID", currentPeriodEnd: future })).toBe("FREE");
  });

  it("drops to FREE once the period has ended beyond the grace window", () => {
    const longAgo = new Date(Date.now() - 10 * 86400_000);
    expect(effectivePlan({ plan: "PRO", status: "ACTIVE", currentPeriodEnd: longAgo })).toBe("FREE");
  });

  it("checks quotas including the requested amount", () => {
    const limits = DEFAULT_PLAN_LIMITS.FREE;
    expect(checkQuota(limits, "conversationTurnsPerDay", 19).allowed).toBe(true);
    expect(checkQuota(limits, "conversationTurnsPerDay", 20).allowed).toBe(false);
    expect(checkQuota(limits, "sttSecondsPerDay", 590, 20).allowed).toBe(false);
  });

  it("merges JSON overrides onto defaults and validates them", () => {
    const limits = resolvePlanLimits(JSON.stringify({ FREE: { conversationTurnsPerDay: 5, features: { realtime: true } } }));
    expect(limits.FREE.conversationTurnsPerDay).toBe(5);
    expect(limits.FREE.features.realtime).toBe(true);
    expect(limits.FREE.features.pronunciationLab).toBe(true);
    expect(limits.PRO).toEqual(DEFAULT_PLAN_LIMITS.PRO);
    expect(() => resolvePlanLimits(JSON.stringify({ FREE: { conversationTurnsPerDay: -1 } }))).toThrow();
  });
});

describe("usage cost estimation", () => {
  const rates = parseRates(
    JSON.stringify({
      "azure:STT": { perUnit: 0.0003, unitType: "seconds" },
      "anthropic:LLM": { perInputToken: 0.000001, perOutputToken: 0.000005 },
      "anthropic:LLM:special": { perInputToken: 0.00001, perOutputToken: 0.00001 },
    }),
  );

  it("returns null when no rate is configured (never a guess)", () => {
    expect(estimateCostMicros(rates, { provider: "openai", operation: "TTS", units: 100 })).toBeNull();
  });

  it("computes per-unit and per-token costs in micro-USD", () => {
    expect(estimateCostMicros(rates, { provider: "azure", operation: "STT", units: 10 })).toBe(3000);
    expect(
      estimateCostMicros(rates, { provider: "anthropic", operation: "LLM", units: 0, inputTokens: 1000, outputTokens: 200 }),
    ).toBe(2000);
  });

  it("prefers model-specific rates", () => {
    expect(
      estimateCostMicros(rates, {
        provider: "anthropic",
        operation: "LLM",
        model: "special",
        units: 0,
        inputTokens: 100,
        outputTokens: 100,
      }),
    ).toBe(2000);
  });
});

describe("progress aggregation", () => {
  it("computes streaks ending today or yesterday", () => {
    expect(computeStreak(["2026-05-10", "2026-05-09", "2026-05-08"], "2026-05-10")).toBe(3);
    expect(computeStreak(["2026-05-09", "2026-05-08"], "2026-05-10")).toBe(2);
    expect(computeStreak(["2026-05-08"], "2026-05-10")).toBe(0);
    expect(computeStreak([], "2026-05-10")).toBe(0);
  });

  it("handles month boundaries", () => {
    expect(computeStreak(["2026-03-01", "2026-02-28", "2026-02-27"], "2026-03-01")).toBe(3);
  });

  it("uses the learner's timezone for the calendar day", () => {
    const lateEvening = new Date("2026-06-01T23:30:00Z");
    expect(toDayKey(lateEvening, "Europe/London")).toBe("2026-06-02");
    expect(toDayKey(lateEvening, "UTC")).toBe("2026-06-01");
    expect(toDayKey(lateEvening, "Asia/Karachi")).toBe("2026-06-02");
  });

  it("fills missing days with real zeros", () => {
    const series = fillDailySeries(
      [{ date: "2026-05-09", practiceSeconds: 60, exercisesCompleted: 1, sessionsCompleted: 1, turnsSpoken: 3 }],
      "2026-05-10",
      3,
    );
    expect(series.map((r) => r.date)).toEqual(["2026-05-08", "2026-05-09", "2026-05-10"]);
    expect(series[0]!.practiceSeconds).toBe(0);
    expect(series[1]!.practiceSeconds).toBe(60);
  });

  it("averages only measured values", () => {
    expect(meanOrNull([null, undefined])).toBeNull();
    expect(meanOrNull([80, null, 90])).toBe(85);
  });
});

describe("authorization", () => {
  const alice = { id: "alice", role: "LEARNER" as const };
  it("allows owners and hides other users' records as not found", () => {
    expect(() => assertOwner(alice, { userId: "alice" })).not.toThrow();
    expect(() => assertOwner(alice, { userId: "bob" })).toThrowError(/not found/);
    expect(() => assertOwner(alice, null)).toThrowError(/not found/);
  });
  it("does not grant admins implicit access to learner records", () => {
    expect(() => assertOwner({ id: "admin", role: "ADMIN" }, { userId: "alice" })).toThrow();
  });
});

describe("transcript alignment", () => {
  it("normalises case, punctuation and contractions", () => {
    expect(normalizeWords("I'm working on it, aren't I?")).toEqual(["i", "am", "working", "on", "it", "are", "not", "i"]);
    expect(normalizeWords("It’s a well-known fact.")).toEqual(["it", "is", "a", "well", "known", "fact"]);
  });

  it("identifies substitutions, omissions and insertions", () => {
    const aligned = alignWords("I would like to schedule a meeting", "I would like schedule the meeting today");
    expect(aligned.filter((w) => w.op === "omission").map((w) => w.reference)).toEqual(["to"]);
    expect(aligned.find((w) => w.op === "substitution")).toMatchObject({ reference: "a", recognized: "the" });
    expect(aligned.filter((w) => w.op === "insertion").map((w) => w.recognized)).toEqual(["today"]);
    expect(recognitionMatchRate(aligned)).toBeCloseTo(5 / 7);
  });

  it("treats contractions as equivalent", () => {
    expect(recognitionMatchRate(alignWords("I am ready", "I'm ready."))).toBe(1);
  });
});

describe("lesson content validation", () => {
  const base = { intro: "x", openingLine: "Hello", tutorBrief: "brief" };
  it("applies defaults", () => {
    const c = parseLessonContent(base);
    expect(c.vocabulary).toEqual([]);
    expect(c.requireBritish).toBe(false);
  });
  it("rejects an out-of-range listening answer", () => {
    expect(() =>
      parseLessonContent({ ...base, listening: [{ text: "t", question: "q", options: ["a", "b"], answerIndex: 2 }] }),
    ).toThrow(/out of range/);
  });
});
