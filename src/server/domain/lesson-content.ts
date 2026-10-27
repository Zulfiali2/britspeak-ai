import { z } from "zod";

/** Validated structure of `Lesson.content`. */
export const lessonContentSchema = z.object({
  intro: z.string().min(1),
  /** First thing the tutor says when the speaking part starts. */
  openingLine: z.string().min(1),
  /** Private instructions for the AI tutor: scenario, role, what to practise. */
  tutorBrief: z.string().min(1),
  requireBritish: z.boolean().default(false),
  vocabulary: z
    .array(
      z.object({
        term: z.string(),
        meaning: z.string(),
        example: z.string(),
        meaningUrdu: z.string().optional(),
      }),
    )
    .default([]),
  /** Sentences for listen-and-repeat practice. */
  modelSentences: z.array(z.string().min(1)).default([]),
  speakingPrompts: z.array(z.object({ prompt: z.string(), hint: z.string().optional() })).default([]),
  listening: z
    .array(
      z.object({
        text: z.string(),
        question: z.string(),
        options: z.array(z.string()).min(2).max(5),
        answerIndex: z.number().int().min(0),
      }),
    )
    .default([]),
  roleplay: z
    .object({
      aiRole: z.string(),
      learnerRole: z.string(),
      situation: z.string(),
      goals: z.array(z.string()),
    })
    .optional(),
});

export type LessonContent = z.infer<typeof lessonContentSchema>;

export function parseLessonContent(value: unknown): LessonContent {
  const content = lessonContentSchema.parse(value);
  for (const item of content.listening) {
    if (item.answerIndex >= item.options.length) {
      throw new Error(`Listening answerIndex out of range for question "${item.question}"`);
    }
  }
  return content;
}
