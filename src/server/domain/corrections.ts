import type { ErrorCategory } from "@prisma/client";
import { z } from "zod";

/**
 * Structured correction contract between the language model and the app.
 *
 * The model can only report *language* issues it can see in text. The
 * PRONUNCIATION category is deliberately absent from the model schema:
 * pronunciation findings come exclusively from an acoustic assessment
 * provider (see pronunciation.ts). RECOGNITION_UNCERTAINTY lets the model say
 * "this looks like a speech-recognition slip" instead of correcting the learner.
 */
export const LLM_CORRECTION_CATEGORIES = [
  "GRAMMAR",
  "VERB_TENSE",
  "SUBJECT_VERB_AGREEMENT",
  "ARTICLES_PREPOSITIONS",
  "WORD_CHOICE",
  "WORD_ORDER",
  "NATURALNESS",
  "BRITISH_USAGE",
  "RECOGNITION_UNCERTAINTY",
] as const satisfies readonly ErrorCategory[];

export const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  GRAMMAR: "Grammar",
  VERB_TENSE: "Verb tense",
  SUBJECT_VERB_AGREEMENT: "Subject–verb agreement",
  ARTICLES_PREPOSITIONS: "Articles and prepositions",
  WORD_CHOICE: "Word choice",
  WORD_ORDER: "Word order",
  NATURALNESS: "Sounding natural",
  BRITISH_USAGE: "British usage",
  PRONUNCIATION: "Pronunciation",
  RECOGNITION_UNCERTAINTY: "Possible recognition slip",
};

export const rawCorrectionSchema = z.object({
  category: z.enum(LLM_CORRECTION_CATEGORIES),
  kind: z.enum(["error", "suggestion"]),
  original: z.string(),
  corrected: z.string(),
  explanation: z.string(),
  explanation_urdu: z.string().nullable(),
  british_alternative: z.string().nullable(),
  practice_instruction: z.string(),
  confidence: z.number(),
});

export const rawFeedbackSchema = z.object({
  is_acceptable: z.boolean(),
  corrected_sentence: z.string(),
  meaning_preserved: z.boolean(),
  possible_recognition_issue: z.boolean(),
  corrections: z.array(rawCorrectionSchema),
  encouragement: z.string(),
});

export type RawFeedback = z.infer<typeof rawFeedbackSchema>;

/** JSON Schema sent to the model (structured outputs). Kept to the widely supported subset. */
export const feedbackJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_acceptable",
    "corrected_sentence",
    "meaning_preserved",
    "possible_recognition_issue",
    "corrections",
    "encouragement",
  ],
  properties: {
    is_acceptable: {
      type: "boolean",
      description: "True when the sentence is grammatical and natural enough; optional style ideas may still be listed as suggestions.",
    },
    corrected_sentence: {
      type: "string",
      description: "The learner's sentence with only genuine errors fixed. Identical to the original if nothing is wrong.",
    },
    meaning_preserved: { type: "boolean", description: "True if the corrected sentence keeps the learner's meaning." },
    possible_recognition_issue: {
      type: "boolean",
      description: "True if parts of the transcript look like speech-recognition mistakes rather than learner mistakes.",
    },
    corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "category",
          "kind",
          "original",
          "corrected",
          "explanation",
          "explanation_urdu",
          "british_alternative",
          "practice_instruction",
          "confidence",
        ],
        properties: {
          category: { type: "string", enum: [...LLM_CORRECTION_CATEGORIES] },
          kind: {
            type: "string",
            enum: ["error", "suggestion"],
            description: "'error' = grammatically wrong or unclear; 'suggestion' = optional, more natural wording.",
          },
          original: { type: "string", description: "Exact fragment from the learner's sentence." },
          corrected: { type: "string", description: "Replacement for that fragment." },
          explanation: { type: "string", description: "One or two short sentences at the learner's level." },
          explanation_urdu: {
            type: ["string", "null"],
            description: "Urdu explanation when requested, otherwise null.",
          },
          british_alternative: {
            type: ["string", "null"],
            description: "A natural British English way to say it, when useful.",
          },
          practice_instruction: { type: "string", description: "One short instruction to practise this." },
          confidence: { type: "number", description: "0 to 1: how sure you are this is a real issue." },
        },
      },
    },
    encouragement: { type: "string", description: "One short, honest, encouraging sentence." },
  },
} as const;

export interface Correction {
  category: ErrorCategory;
  kind: "ERROR" | "SUGGESTION";
  original: string;
  corrected: string;
  explanation: string;
  explanationUrdu: string | null;
  britishAlternative: string | null;
  practiceInstruction: string;
  confidence: number;
  uncertain: boolean;
}

export interface Feedback {
  originalText: string;
  correctedText: string;
  isAcceptable: boolean;
  meaningPreserved: boolean;
  possibleRecognitionIssue: boolean;
  corrections: Correction[];
  encouragement: string;
}

export interface PostProcessOptions {
  /** Exercise explicitly requires British spelling/usage (otherwise American variants are accepted). */
  requireBritish: boolean;
  /** Include Urdu explanations. */
  includeUrdu: boolean;
  /** Speech-to-text confidence for the turn (0-1), if known. */
  sttConfidence?: number | null;
  maxCorrections?: number;
}

const LOW_CONFIDENCE = 0.55;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const comparable = (s: string) => clean(s).toLowerCase().replace(/[.,!?;:'"]/g, "");

/**
 * Turn raw model output into feedback we are willing to show:
 *  - drop no-op or empty corrections and fragments that are not in the learner's text,
 *  - never "correct" American English unless the exercise requires British usage,
 *  - downgrade low-confidence findings to clearly marked suggestions,
 *  - refuse a rewrite that changes meaning (fall back to the original sentence),
 *  - when the recogniser was unsure, frame findings as possible recognition slips.
 */
export function postProcessFeedback(
  originalText: string,
  raw: RawFeedback,
  options: PostProcessOptions,
): Feedback {
  const original = clean(originalText);
  const lowStt = options.sttConfidence != null && options.sttConfidence < 0.6;
  const seen = new Set<string>();
  const corrections: Correction[] = [];

  for (const c of raw.corrections) {
    const fragment = clean(c.original);
    const replacement = clean(c.corrected);
    if (!fragment || comparable(fragment) === comparable(replacement)) continue;
    if (!comparable(original).includes(comparable(fragment))) continue;
    const key = `${c.category}:${comparable(fragment)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let kind: Correction["kind"] = c.kind === "error" ? "ERROR" : "SUGGESTION";
    let category: ErrorCategory = c.category;
    let confidence = Math.max(0, Math.min(1, Number.isFinite(c.confidence) ? c.confidence : 0));

    if (category === "BRITISH_USAGE" && !options.requireBritish) kind = "SUGGESTION";
    if (lowStt && kind === "ERROR") {
      // The words may not be what the learner said; don't assert an error.
      category = "RECOGNITION_UNCERTAINTY";
      kind = "SUGGESTION";
      confidence = Math.min(confidence, 0.5);
    }
    const uncertain = confidence < LOW_CONFIDENCE || category === "RECOGNITION_UNCERTAINTY";
    if (uncertain && kind === "ERROR") kind = "SUGGESTION";

    corrections.push({
      category,
      kind,
      original: fragment,
      corrected: replacement,
      explanation: clean(c.explanation),
      explanationUrdu: options.includeUrdu && c.explanation_urdu ? clean(c.explanation_urdu) : null,
      britishAlternative: c.british_alternative ? clean(c.british_alternative) : null,
      practiceInstruction: clean(c.practice_instruction),
      confidence: Math.round(confidence * 100) / 100,
      uncertain,
    });
  }

  // Errors first, then by confidence.
  corrections.sort((a, b) =>
    a.kind === b.kind ? b.confidence - a.confidence : a.kind === "ERROR" ? -1 : 1,
  );
  const limited = corrections.slice(0, options.maxCorrections ?? 4);
  const hasErrors = limited.some((c) => c.kind === "ERROR");

  const correctedText =
    raw.meaning_preserved && hasErrors && clean(raw.corrected_sentence) ? clean(raw.corrected_sentence) : original;

  return {
    originalText: original,
    correctedText,
    isAcceptable: !hasErrors,
    meaningPreserved: raw.meaning_preserved,
    possibleRecognitionIssue: raw.possible_recognition_issue || lowStt,
    corrections: limited,
    encouragement: clean(raw.encouragement),
  };
}

/** Stable key used to detect a recurring mistake across sessions. */
export function correctionPatternKey(c: Pick<Correction, "category" | "original" | "corrected">): string {
  return `${c.category.toLowerCase()}:${comparable(c.original)}->${comparable(c.corrected)}`.slice(0, 200);
}
