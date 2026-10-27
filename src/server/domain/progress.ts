/** Pure helpers for progress aggregation. Dates are calendar days ("YYYY-MM-DD"). */

export function toDayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dayKeyToUtcDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

function previousDay(dayKey: string): string {
  const d = dayKeyToUtcDate(dayKey);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive practice days ending today (or yesterday, so a streak is not
 * shown as broken before the learner has had a chance to practise today).
 */
export function computeStreak(practiceDays: Iterable<string>, todayKey: string): number {
  const days = new Set(practiceDays);
  let cursor = days.has(todayKey) ? todayKey : previousDay(todayKey);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return streak;
}

export interface DailyRow {
  date: string;
  practiceSeconds: number;
  exercisesCompleted: number;
  sessionsCompleted: number;
  turnsSpoken: number;
}

/** Fill gaps so charts show real zeros rather than skipping days. */
export function fillDailySeries(rows: DailyRow[], endDayKey: string, days: number): DailyRow[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: DailyRow[] = [];
  let cursor = endDayKey;
  for (let i = 0; i < days; i++) {
    out.unshift(
      byDate.get(cursor) ?? {
        date: cursor,
        practiceSeconds: 0,
        exercisesCompleted: 0,
        sessionsCompleted: 0,
        turnsSpoken: 0,
      },
    );
    cursor = previousDay(cursor);
  }
  return out;
}

export function sumSeries(rows: DailyRow[]) {
  return rows.reduce(
    (acc, r) => ({
      practiceSeconds: acc.practiceSeconds + r.practiceSeconds,
      exercisesCompleted: acc.exercisesCompleted + r.exercisesCompleted,
      sessionsCompleted: acc.sessionsCompleted + r.sessionsCompleted,
      turnsSpoken: acc.turnsSpoken + r.turnsSpoken,
    }),
    { practiceSeconds: 0, exercisesCompleted: 0, sessionsCompleted: 0, turnsSpoken: 0 },
  );
}

/** Average of a numeric series, ignoring nulls; null when nothing is measured. */
export function meanOrNull(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}
