import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/http/errors";
import { verifyPassword } from "@/server/auth/crypto";
import { GOAL_VALUES } from "@/lib/labels";
import { audit } from "./audit";

const timezoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone");

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    proficiencyLevel: z.enum(["BEGINNER", "ELEMENTARY", "INTERMEDIATE", "UPPER_INTERMEDIATE", "ADVANCED"]),
    learningGoals: z.array(z.enum(GOAL_VALUES)).max(7),
    explanationLanguage: z.enum(["ENGLISH", "URDU"]),
    preferredVoice: z.string().max(100).nullable(),
    preferredSpeakingRate: z.number().min(0.6).max(1.3),
    dailyPracticeMinutes: z.number().int().min(5).max(120),
    timezone: timezoneSchema,
    transcriptRetentionDays: z.number().int().min(7).max(730),
    modelTrainingConsent: z.boolean(),
    completeOnboarding: z.boolean(),
  })
  .partial()
  .strict();

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export async function getProfile(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      profile: true,
    },
  });
  if (!user.profile) {
    const profile = await db.learnerProfile.create({ data: { userId, learningGoals: [] } });
    return { ...user, profile };
  }
  return user as typeof user & { profile: NonNullable<typeof user.profile> };
}

export async function updateProfile(userId: string, input: ProfileUpdate) {
  const { displayName, completeOnboarding, proficiencyLevel, ...rest } = input;
  await db.$transaction(async (tx) => {
    if (displayName !== undefined) await tx.user.update({ where: { id: userId }, data: { displayName } });
    const current = await tx.learnerProfile.findUnique({ where: { userId } });
    await tx.learnerProfile.upsert({
      where: { userId },
      create: {
        userId,
        learningGoals: rest.learningGoals ?? [],
        ...rest,
        ...(proficiencyLevel ? { proficiencyLevel, levelSource: "self_selected" } : {}),
        ...(completeOnboarding ? { onboardingCompletedAt: new Date() } : {}),
      },
      update: {
        ...rest,
        // A manual change after the baseline is recorded as such.
        ...(proficiencyLevel ? { proficiencyLevel, levelSource: "self_selected" } : {}),
        ...(completeOnboarding && !current?.onboardingCompletedAt ? { onboardingCompletedAt: new Date() } : {}),
      },
    });
  });
  if (input.modelTrainingConsent !== undefined) {
    await audit(userId, "privacy.training_consent_changed", { type: "user", id: userId }, {
      consent: input.modelTrainingConsent,
    });
  }
  return getProfile(userId);
}

/** Everything we hold about the learner, as JSON (data portability). */
export async function exportUserData(userId: string) {
  const [user, sessions, assessments, errors, practice, progress, subscription, usage] = await Promise.all([
    getProfile(userId),
    db.learningSession.findMany({
      where: { userId },
      include: { turns: { orderBy: { sequence: "asc" } } },
      orderBy: { startedAt: "asc" },
    }),
    db.pronunciationAssessment.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.errorRecord.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.practiceItem.findMany({ where: { userId } }),
    db.learningProgress.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.subscription.findUnique({
      where: { userId },
      select: { plan: true, status: true, billingPeriod: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
    }),
    db.usageEvent.findMany({
      where: { userId },
      select: { operation: true, provider: true, units: true, unitType: true, createdAt: true, success: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    note: "BritSpeak AI never stores your audio recordings, so none are included.",
    account: user,
    subscription,
    sessions,
    pronunciationAssessments: assessments,
    errorRecords: errors,
    practiceItems: practice,
    dailyProgress: progress,
    usage,
  };
}

/** Delete learning history but keep the account, profile and billing. */
export async function deleteLearningHistory(userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.practiceItem.deleteMany({ where: { userId } });
    await tx.errorRecord.deleteMany({ where: { userId } });
    await tx.pronunciationAssessment.deleteMany({ where: { userId } });
    await tx.conversationTurn.deleteMany({ where: { userId } });
    await tx.learningSession.deleteMany({ where: { userId } });
    await tx.learningProgress.deleteMany({ where: { userId } });
    await tx.learnerProfile.updateMany({ where: { userId }, data: { baselineCompletedAt: null } });
    await audit(userId, "privacy.history_deleted", { type: "user", id: userId }, {}, tx);
  });
}

/**
 * Delete the account and all learning data (cascades). Usage events are kept
 * without the user link for aggregate cost accounting; billing records held by
 * the payment provider are subject to its own legal retention (see privacy policy).
 */
export async function deleteAccount(userId: string, password: string): Promise<{ stripeCustomerId: string | null }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { subscription: true } });
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new AppError("bad_request", "Your password is incorrect.");
  }
  if (user.subscription && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(user.subscription.status) && user.subscription.plan !== "FREE") {
    throw new AppError(
      "conflict",
      "Please cancel your subscription in the billing portal before deleting your account.",
    );
  }
  await db.$transaction(async (tx) => {
    await audit(null, "privacy.account_deleted", { type: "user", id: userId }, {}, tx);
    await tx.user.delete({ where: { id: userId } });
  });
  return { stripeCustomerId: user.subscription?.externalCustomerId ?? null };
}
