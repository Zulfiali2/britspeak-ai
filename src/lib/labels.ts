import type { LearningMode, ProficiencyLevel } from "@prisma/client";

export const LEVELS: Array<{ value: ProficiencyLevel; label: string; description: string }> = [
  {
    value: "BEGINNER",
    label: "Beginner",
    description: "I know some words but find it hard to make sentences.",
  },
  {
    value: "ELEMENTARY",
    label: "Elementary",
    description: "I can make simple sentences about myself and daily life.",
  },
  {
    value: "INTERMEDIATE",
    label: "Intermediate",
    description: "I can hold a conversation but make mistakes and search for words.",
  },
  {
    value: "UPPER_INTERMEDIATE",
    label: "Upper-intermediate",
    description: "I speak fairly fluently at work but want to sound clearer and more natural.",
  },
  {
    value: "ADVANCED",
    label: "Advanced",
    description: "I am fluent and want to polish pronunciation and professional style.",
  },
];

export const levelLabel = (level: ProficiencyLevel) =>
  LEVELS.find((l) => l.value === level)?.label ?? level;

export const MODES: Record<LearningMode, { label: string; description: string }> = {
  FREE_CONVERSATION: {
    label: "Free conversation",
    description: "Chat about your day, interests and work.",
  },
  GUIDED_LESSON: { label: "Guided lesson", description: "Short, step-by-step lessons." },
  CLIENT_COMMUNICATION: {
    label: "UK client communication",
    description: "Practise real conversations with UK clients.",
  },
  PRONUNCIATION_LAB: {
    label: "Pronunciation lab",
    description: "Sounds, minimal pairs, stress and connected speech.",
  },
  REPEAT_AFTER_ME: {
    label: "Repeat after me",
    description: "Listen to a model sentence and repeat it.",
  },
  ROLE_PLAY: {
    label: "Role-play",
    description: "Meetings, interviews and calls with feedback at the end.",
  },
  DAILY_CHALLENGE: { label: "Daily challenge", description: "A short task with a clear goal." },
  REVIEW_MISTAKES: { label: "Review mistakes", description: "Revisit your recurring mistakes." },
  BASELINE_ASSESSMENT: {
    label: "Baseline check",
    description: "A short speaking check to personalise your plan.",
  },
};

export const GOALS = [
  { value: "build_sentences", label: "Build sentences with confidence" },
  { value: "uk_clients", label: "Talk to UK clients and colleagues" },
  { value: "job_interviews", label: "Prepare for job interviews" },
  { value: "meetings", label: "Speak up in meetings" },
  { value: "pronunciation", label: "Clearer pronunciation" },
  { value: "fluency", label: "Speak more fluently" },
  { value: "everyday", label: "Everyday conversation" },
] as const;

export type GoalValue = (typeof GOALS)[number]["value"];
export const GOAL_VALUES = GOALS.map((g) => g.value) as [GoalValue, ...GoalValue[]];
