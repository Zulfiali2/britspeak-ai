-- CreateEnum
CREATE TYPE "Role" AS ENUM ('LEARNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ProficiencyLevel" AS ENUM ('BEGINNER', 'ELEMENTARY', 'INTERMEDIATE', 'UPPER_INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "ExplanationLanguage" AS ENUM ('ENGLISH', 'URDU');

-- CreateEnum
CREATE TYPE "LearningMode" AS ENUM ('FREE_CONVERSATION', 'GUIDED_LESSON', 'CLIENT_COMMUNICATION', 'PRONUNCIATION_LAB', 'REPEAT_AFTER_ME', 'ROLE_PLAY', 'DAILY_CHALLENGE', 'REVIEW_MISTAKES', 'BASELINE_ASSESSMENT');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Speaker" AS ENUM ('LEARNER', 'TUTOR');

-- CreateEnum
CREATE TYPE "InputMode" AS ENUM ('VOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'COMPLETED', 'UNAVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('GRAMMAR', 'VERB_TENSE', 'SUBJECT_VERB_AGREEMENT', 'ARTICLES_PREPOSITIONS', 'WORD_CHOICE', 'WORD_ORDER', 'NATURALNESS', 'BRITISH_USAGE', 'PRONUNCIATION', 'RECOGNITION_UNCERTAINTY');

-- CreateEnum
CREATE TYPE "CorrectionKind" AS ENUM ('ERROR', 'SUGGESTION');

-- CreateEnum
CREATE TYPE "PracticeTargetType" AS ENUM ('GRAMMAR', 'VOCABULARY', 'PRONUNCIATION', 'SENTENCE');

-- CreateEnum
CREATE TYPE "MasteryStatus" AS ENUM ('NEW', 'LEARNING', 'REVIEWING', 'MASTERED');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAUSED');

-- CreateEnum
CREATE TYPE "UsageOperation" AS ENUM ('STT', 'TTS', 'PRONUNCIATION', 'LLM', 'REALTIME');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'LEARNER',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proficiencyLevel" "ProficiencyLevel" NOT NULL DEFAULT 'BEGINNER',
    "levelSource" TEXT NOT NULL DEFAULT 'self_selected',
    "learningGoals" TEXT[],
    "explanationLanguage" "ExplanationLanguage" NOT NULL DEFAULT 'ENGLISH',
    "speechLocale" TEXT NOT NULL DEFAULT 'en-GB',
    "preferredVoice" TEXT,
    "preferredSpeakingRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "dailyPracticeMinutes" INTEGER NOT NULL DEFAULT 10,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "onboardingCompletedAt" TIMESTAMPTZ(3),
    "baselineCompletedAt" TIMESTAMPTZ(3),
    "transcriptRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "modelTrainingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LearnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" "LearningMode" NOT NULL,
    "level" "ProficiencyLevel" NOT NULL,
    "learningObjectives" TEXT[],
    "estimatedMinutes" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT,
    "mode" "LearningMode" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "pausedAt" TIMESTAMPTZ(3),
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastResumedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "speaker" "Speaker" NOT NULL,
    "transcript" TEXT NOT NULL,
    "correctedText" TEXT,
    "inputMode" "InputMode" NOT NULL DEFAULT 'TEXT',
    "recognizedText" TEXT,
    "sttConfidence" DOUBLE PRECISION,
    "assessmentStatus" "AssessmentStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "feedback" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PronunciationAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "practiceItemId" TEXT,
    "referenceText" TEXT NOT NULL,
    "recognizedText" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "overallScore" DOUBLE PRECISION,
    "accuracyScore" DOUBLE PRECISION,
    "fluencyScore" DOUBLE PRECISION,
    "completenessScore" DOUBLE PRECISION,
    "prosodyScore" DOUBLE PRECISION,
    "assessmentPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PronunciationAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "turnId" TEXT,
    "category" "ErrorCategory" NOT NULL,
    "kind" "CorrectionKind" NOT NULL DEFAULT 'ERROR',
    "originalText" TEXT NOT NULL,
    "correctedText" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "explanationUrdu" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "patternKey" TEXT NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "PracticeTargetType" NOT NULL,
    "targetText" TEXT NOT NULL,
    "prompt" TEXT,
    "explanation" TEXT,
    "sourceErrorId" TEXT,
    "nextReviewAt" TIMESTAMPTZ(3) NOT NULL,
    "lastReviewedAt" TIMESTAMPTZ(3),
    "reviewIntervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "masteryStatus" "MasteryStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PracticeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "practiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "exercisesCompleted" INTEGER NOT NULL DEFAULT 0,
    "sessionsCompleted" INTEGER NOT NULL DEFAULT 0,
    "turnsSpoken" INTEGER NOT NULL DEFAULT 0,
    "progressMetrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "billingProvider" TEXT NOT NULL DEFAULT 'stripe',
    "externalCustomerId" TEXT,
    "subscriptionId" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingPeriod" TEXT,
    "currentPeriodStart" TIMESTAMPTZ(3),
    "currentPeriodEnd" TIMESTAMPTZ(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "lastEventCreatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "operation" "UsageOperation" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "units" DOUBLE PRECISION NOT NULL,
    "unitType" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicros" INTEGER,
    "latencyMs" INTEGER,
    "success" BOOLEAN NOT NULL,
    "failureCategory" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "SpeechCache" (
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "audio" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeechCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMPTZ(3),

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_type_idx" ON "AuthToken"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfile_userId_key" ON "LearnerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_slug_key" ON "Lesson"("slug");

-- CreateIndex
CREATE INDEX "Lesson_status_mode_level_idx" ON "Lesson"("status", "mode", "level");

-- CreateIndex
CREATE INDEX "LearningSession_userId_startedAt_idx" ON "LearningSession"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "LearningSession_userId_status_idx" ON "LearningSession"("userId", "status");

-- CreateIndex
CREATE INDEX "ConversationTurn_userId_createdAt_idx" ON "ConversationTurn"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_sessionId_sequence_key" ON "ConversationTurn"("sessionId", "sequence");

-- CreateIndex
CREATE INDEX "PronunciationAssessment_userId_createdAt_idx" ON "PronunciationAssessment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PronunciationAssessment_userId_referenceText_idx" ON "PronunciationAssessment"("userId", "referenceText");

-- CreateIndex
CREATE INDEX "ErrorRecord_userId_createdAt_idx" ON "ErrorRecord"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ErrorRecord_userId_patternKey_idx" ON "ErrorRecord"("userId", "patternKey");

-- CreateIndex
CREATE INDEX "ErrorRecord_userId_resolvedAt_idx" ON "ErrorRecord"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "PracticeItem_userId_nextReviewAt_idx" ON "PracticeItem"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeItem_userId_targetType_targetText_key" ON "PracticeItem"("userId", "targetType", "targetText");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_userId_date_key" ON "LearningProgress"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_externalCustomerId_key" ON "Subscription"("externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriptionId_key" ON "Subscription"("subscriptionId");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_operation_createdAt_idx" ON "UsageEvent"("userId", "operation", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_createdAt_idx" ON "UsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_provider_createdAt_idx" ON "UsageEvent"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE INDEX "SpeechCache_lastUsedAt_idx" ON "SpeechCache"("lastUsedAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerProfile" ADD CONSTRAINT "LearnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationAssessment" ADD CONSTRAINT "PronunciationAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationAssessment" ADD CONSTRAINT "PronunciationAssessment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationAssessment" ADD CONSTRAINT "PronunciationAssessment_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorRecord" ADD CONSTRAINT "ErrorRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorRecord" ADD CONSTRAINT "ErrorRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorRecord" ADD CONSTRAINT "ErrorRecord_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ConversationTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_sourceErrorId_fkey" FOREIGN KEY ("sourceErrorId") REFERENCES "ErrorRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
