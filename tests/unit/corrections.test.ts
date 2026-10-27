import { describe, expect, it } from "vitest";
import {
  correctionPatternKey,
  postProcessFeedback,
  rawFeedbackSchema,
  type RawFeedback,
} from "@/server/domain/corrections";

const correction = (over: Partial<RawFeedback["corrections"][number]> = {}) => ({
  category: "VERB_TENSE" as const,
  kind: "error" as const,
  original: "I go",
  corrected: "I went",
  explanation: "Use the past simple for finished actions yesterday.",
  explanation_urdu: "کل کی بات کے لیے ماضی کا صیغہ استعمال کریں۔",
  british_alternative: null,
  practice_instruction: "Say three things you did yesterday.",
  confidence: 0.9,
  ...over,
});

const raw = (over: Partial<RawFeedback> = {}): RawFeedback => ({
  is_acceptable: false,
  corrected_sentence: "Yesterday I went to the office.",
  meaning_preserved: true,
  possible_recognition_issue: false,
  corrections: [correction()],
  encouragement: "Good sentence structure.",
  ...over,
});

const opts = { requireBritish: false, includeUrdu: false };

describe("correction response validation", () => {
  it("rejects malformed model output", () => {
    expect(rawFeedbackSchema.safeParse({ corrections: "none" }).success).toBe(false);
    expect(
      rawFeedbackSchema.safeParse({ ...raw(), corrections: [{ ...correction(), category: "PRONUNCIATION" }] }).success,
    ).toBe(false);
    expect(rawFeedbackSchema.safeParse(raw()).success).toBe(true);
  });

  it("keeps a genuine error and the corrected sentence", () => {
    const fb = postProcessFeedback("Yesterday I go to the office.", raw(), opts);
    expect(fb.isAcceptable).toBe(false);
    expect(fb.correctedText).toBe("Yesterday I went to the office.");
    expect(fb.corrections).toHaveLength(1);
    expect(fb.corrections[0]).toMatchObject({ kind: "ERROR", category: "VERB_TENSE", uncertain: false });
    expect(fb.corrections[0]!.explanationUrdu).toBeNull();
  });

  it("includes Urdu only when requested", () => {
    const fb = postProcessFeedback("Yesterday I go to the office.", raw(), { ...opts, includeUrdu: true });
    expect(fb.corrections[0]!.explanationUrdu).toContain("ماضی");
  });

  it("drops no-op corrections and fragments not present in the learner's text", () => {
    const fb = postProcessFeedback(
      "Yesterday I go to the office.",
      raw({
        corrections: [
          correction({ original: "office", corrected: "office" }),
          correction({ original: "she goes", corrected: "she went" }),
        ],
      }),
      opts,
    );
    expect(fb.corrections).toHaveLength(0);
    expect(fb.isAcceptable).toBe(true);
    expect(fb.correctedText).toBe("Yesterday I go to the office.");
  });

  it("does not penalise American English unless the exercise requires British usage", () => {
    const american = raw({
      corrected_sentence: "I will organise the programme.",
      corrections: [
        correction({ category: "BRITISH_USAGE", original: "organize", corrected: "organise", confidence: 0.95 }),
      ],
    });
    const relaxed = postProcessFeedback("I will organize the program.", american, opts);
    expect(relaxed.corrections[0]!.kind).toBe("SUGGESTION");
    expect(relaxed.isAcceptable).toBe(true);
    expect(relaxed.correctedText).toBe("I will organize the program.");

    const strict = postProcessFeedback("I will organize the program.", american, { ...opts, requireBritish: true });
    expect(strict.corrections[0]!.kind).toBe("ERROR");
  });

  it("downgrades low-confidence errors to uncertain suggestions", () => {
    const fb = postProcessFeedback("Yesterday I go to the office.", raw({ corrections: [correction({ confidence: 0.3 })] }), opts);
    expect(fb.corrections[0]).toMatchObject({ kind: "SUGGESTION", uncertain: true });
    expect(fb.isAcceptable).toBe(true);
  });

  it("refuses a rewrite that changes the learner's meaning", () => {
    const fb = postProcessFeedback(
      "Yesterday I go to the office.",
      raw({ meaning_preserved: false, corrected_sentence: "Tomorrow I will stay at home." }),
      opts,
    );
    expect(fb.correctedText).toBe("Yesterday I go to the office.");
  });

  it("treats findings as possible recognition slips when STT confidence is low", () => {
    const fb = postProcessFeedback("Yesterday I go to the office.", raw(), { ...opts, sttConfidence: 0.4 });
    expect(fb.possibleRecognitionIssue).toBe(true);
    expect(fb.corrections[0]).toMatchObject({ category: "RECOGNITION_UNCERTAINTY", kind: "SUGGESTION" });
  });

  it("orders errors before suggestions and limits the number shown", () => {
    const text = "Yesterday I go to office and I very like it";
    const fb = postProcessFeedback(
      text,
      raw({
        corrections: [
          correction({ category: "NATURALNESS", kind: "suggestion", original: "I very like it", corrected: "I really like it", confidence: 0.8 }),
          correction(),
          correction({ category: "ARTICLES_PREPOSITIONS", original: "to office", corrected: "to the office" }),
        ],
      }),
      { ...opts, maxCorrections: 2 },
    );
    expect(fb.corrections.map((c) => c.kind)).toEqual(["ERROR", "ERROR"]);
  });

  it("builds stable pattern keys for recurring mistakes", () => {
    expect(correctionPatternKey({ category: "VERB_TENSE", original: "I go.", corrected: "I went" })).toBe(
      "verb_tense:i go->i went",
    );
  });
});
