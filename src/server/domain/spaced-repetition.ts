import type { MasteryStatus } from "@prisma/client";

/**
 * SM-2 style scheduler.
 * quality: 0 = no attempt / complete failure … 5 = perfect, effortless.
 */
export interface ReviewState {
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  lapses: number;
}

export interface ReviewResult extends ReviewState {
  nextReviewAt: Date;
  masteryStatus: MasteryStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_EASE = 1.3;
export const MAX_INTERVAL_DAYS = 120;
/** Repetitions at or beyond this, with a long interval, count as mastered. */
const MASTERED_REPETITIONS = 4;
const MASTERED_INTERVAL_DAYS = 21;

export function scheduleReview(state: ReviewState, quality: number, now: Date = new Date()): ReviewResult {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { repetitions, easeFactor, intervalDays, lapses } = state;

  if (q < 3) {
    // Failed recall: relearn soon, keep (slightly lowered) ease.
    lapses += 1;
    repetitions = 0;
    intervalDays = 10 / (24 * 60); // 10 minutes, so it reappears within the same session
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 3;
    else intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalDays * easeFactor * 10) / 10);
  }
  easeFactor = Math.max(MIN_EASE, easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  easeFactor = Math.round(easeFactor * 100) / 100;

  const masteryStatus: MasteryStatus =
    repetitions === 0
      ? lapses > 0
        ? "LEARNING"
        : "NEW"
      : repetitions >= MASTERED_REPETITIONS && intervalDays >= MASTERED_INTERVAL_DAYS
        ? "MASTERED"
        : repetitions >= 2
          ? "REVIEWING"
          : "LEARNING";

  return {
    repetitions,
    easeFactor,
    intervalDays,
    lapses,
    masteryStatus,
    nextReviewAt: new Date(now.getTime() + intervalDays * DAY_MS),
  };
}

/** Map a pronunciation score (0-100) to an SM-2 quality grade. */
export function qualityFromScore(score: number): number {
  if (score >= 90) return 5;
  if (score >= 80) return 4;
  if (score >= 70) return 3;
  if (score >= 50) return 2;
  if (score >= 30) return 1;
  return 0;
}
