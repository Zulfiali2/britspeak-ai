import type { SessionStatus } from "@prisma/client";

export type SessionAction = "pause" | "resume" | "complete" | "abandon" | "add_turn";

const TRANSITIONS: Record<SessionStatus, Partial<Record<SessionAction, SessionStatus>>> = {
  ACTIVE: { pause: "PAUSED", complete: "COMPLETED", abandon: "ABANDONED", add_turn: "ACTIVE" },
  PAUSED: { resume: "ACTIVE", complete: "COMPLETED", abandon: "ABANDONED" },
  COMPLETED: {},
  ABANDONED: {},
};

export function nextSessionStatus(current: SessionStatus, action: SessionAction): SessionStatus | null {
  return TRANSITIONS[current][action] ?? null;
}

export function canTransition(current: SessionStatus, action: SessionAction): boolean {
  return nextSessionStatus(current, action) !== null;
}

/** Cap a single active stretch so a tab left open overnight does not inflate practice time. */
export const MAX_ACTIVE_STRETCH_SECONDS = 30 * 60;

export function activeSecondsSince(lastResumedAt: Date, now: Date): number {
  const seconds = Math.floor((now.getTime() - lastResumedAt.getTime()) / 1000);
  return Math.max(0, Math.min(seconds, MAX_ACTIVE_STRETCH_SECONDS));
}

/** Sessions with no activity for this long are treated as abandoned by maintenance jobs. */
export const SESSION_IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
