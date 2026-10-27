import "server-only";
import { db } from "@/server/db";
import {
  computeStreak,
  dayKeyToUtcDate,
  fillDailySeries,
  meanOrNull,
  sumSeries,
  toDayKey,
  type DailyRow,
} from "@/server/domain/progress";

export interface ActivityDelta {
  practiceSeconds?: number;
  exercisesCompleted?: number;
  sessionsCompleted?: number;
  turnsSpoken?: number;
}

async function timezoneFor(userId: string): Promise<string> {
  const profile = await db.learnerProfile.findUnique({ where: { userId }, select: { timezone: true } });
  return profile?.timezone ?? "Europe/London";
}

/** Add to today's progress row (learner's local calendar day). */
export async function recordActivity(userId: string, delta: ActivityDelta, now = new Date()): Promise<void> {
  const date = dayKeyToUtcDate(toDayKey(now, await timezoneFor(userId)));
  const inc = {
    practiceSeconds: Math.max(0, Math.round(delta.practiceSeconds ?? 0)),
    exercisesCompleted: Math.max(0, delta.exercisesCompleted ?? 0),
    sessionsCompleted: Math.max(0, delta.sessionsCompleted ?? 0),
    turnsSpoken: Math.max(0, delta.turnsSpoken ?? 0),
  };
  await db.learningProgress.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, ...inc },
    update: {
      practiceSeconds: { increment: inc.practiceSeconds },
      exercisesCompleted: { increment: inc.exercisesCompleted },
      sessionsCompleted: { increment: inc.sessionsCompleted },
      turnsSpoken: { increment: inc.turnsSpoken },
    },
  });
}

export async function progressSummary(userId: string, days = 28, now = new Date()) {
  const timezone = await timezoneFor(userId);
  const todayKey = toDayKey(now, timezone);
  const since = dayKeyToUtcDate(todayKey);
  since.setUTCDate(since.getUTCDate() - 365);

  const [rows, profile, assessments, errorsByCategory, openErrors, practiceCounts] = await Promise.all([
    db.learningProgress.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: "asc" } }),
    db.learnerProfile.findUnique({ where: { userId } }),
    db.pronunciationAssessment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { createdAt: true, overallScore: true, accuracyScore: true, fluencyScore: true, completenessScore: true },
    }),
    db.errorRecord.groupBy({ by: ["category"], where: { userId, kind: "ERROR" }, _count: { _all: true } }),
    db.errorRecord.count({ where: { userId, kind: "ERROR", resolvedAt: null } }),
    db.practiceItem.groupBy({ by: ["masteryStatus"], where: { userId }, _count: { _all: true } }),
  ]);

  const daily: DailyRow[] = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    practiceSeconds: r.practiceSeconds,
    exercisesCompleted: r.exercisesCompleted,
    sessionsCompleted: r.sessionsCompleted,
    turnsSpoken: r.turnsSpoken,
  }));
  const activeDays = daily.filter((d) => d.practiceSeconds > 0 || d.turnsSpoken > 0 || d.exercisesCompleted > 0);
  const series = fillDailySeries(daily, todayKey, days);
  const today = series[series.length - 1]!;

  // Weekly pronunciation averages over measured assessments only.
  const pronunciationTrend = new Map<string, Array<number | null>>();
  for (const a of assessments) {
    const key = toDayKey(a.createdAt, timezone);
    const list = pronunciationTrend.get(key) ?? [];
    list.push(a.overallScore ?? a.accuracyScore);
    pronunciationTrend.set(key, list);
  }

  return {
    timezone,
    today: todayKey,
    dailyTargetMinutes: profile?.dailyPracticeMinutes ?? 10,
    todayPracticeSeconds: today.practiceSeconds,
    streakDays: computeStreak(
      activeDays.map((d) => d.date),
      todayKey,
    ),
    totals: sumSeries(series),
    allTime: sumSeries(daily),
    series,
    pronunciation: {
      assessments: assessments.length,
      recentAverage: meanOrNull(assessments.slice(0, 10).map((a) => a.overallScore ?? a.accuracyScore)),
      previousAverage: meanOrNull(assessments.slice(10, 20).map((a) => a.overallScore ?? a.accuracyScore)),
      byDay: [...pronunciationTrend.entries()]
        .map(([date, scores]) => ({ date, average: meanOrNull(scores) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
    errors: {
      open: openErrors,
      byCategory: errorsByCategory.map((e) => ({ category: e.category, count: e._count._all })),
    },
    practiceItems: Object.fromEntries(practiceCounts.map((p) => [p.masteryStatus, p._count._all])),
  };
}
