import { z } from "zod";
import { guideForPhoneme, normalizeSymbol, type SoundGuide } from "./phoneme-guide";

/**
 * Provider-neutral pronunciation assessment. Every metric is nullable: a
 * provider that does not measure something must leave it null so the UI can
 * mark it "not available" instead of inventing a number.
 */
export const wordErrorTypes = [
  "none",
  "mispronunciation",
  "omission",
  "insertion",
  "unexpected_break",
  "missing_break",
  "monotone",
  "unknown",
] as const;
export type WordErrorType = (typeof wordErrorTypes)[number];

export const normalizedAssessmentSchema = z.object({
  provider: z.string(),
  locale: z.string(),
  referenceText: z.string(),
  recognizedText: z.string(),
  overallScore: z.number().min(0).max(100).nullable(),
  accuracyScore: z.number().min(0).max(100).nullable(),
  fluencyScore: z.number().min(0).max(100).nullable(),
  completenessScore: z.number().min(0).max(100).nullable(),
  prosodyScore: z.number().min(0).max(100).nullable(),
  recognitionConfidence: z.number().min(0).max(1).nullable(),
  phonemeAlphabet: z.enum(["IPA", "SAPI"]).nullable(),
  words: z.array(
    z.object({
      word: z.string(),
      accuracyScore: z.number().min(0).max(100).nullable(),
      errorType: z.enum(wordErrorTypes),
      phonemes: z.array(
        z.object({ phoneme: z.string(), accuracyScore: z.number().min(0).max(100).nullable() }),
      ),
    }),
  ),
  reliable: z.boolean(),
  limitations: z.array(z.string()),
});

export type NormalizedAssessment = z.infer<typeof normalizedAssessmentSchema>;

// ─── Azure AI Speech normalisation ───────────────────────────────────────────

const num = z.number().finite().optional().nullable();
const azurePa = z
  .object({
    AccuracyScore: num,
    FluencyScore: num,
    CompletenessScore: num,
    PronScore: num,
    ProsodyScore: num,
    ErrorType: z.string().optional().nullable(),
  })
  .partial();
const azurePhoneme = z.object({ Phoneme: z.string().optional(), AccuracyScore: num, PronunciationAssessment: azurePa.optional() });
const azureWord = z.object({
  Word: z.string(),
  AccuracyScore: num,
  ErrorType: z.string().optional().nullable(),
  PronunciationAssessment: azurePa.optional(),
  Phonemes: z.array(azurePhoneme).optional(),
});
const azureNBest = z
  .object({
    Confidence: num,
    Lexical: z.string().optional(),
    Display: z.string().optional(),
    AccuracyScore: num,
    FluencyScore: num,
    CompletenessScore: num,
    PronScore: num,
    ProsodyScore: num,
    PronunciationAssessment: azurePa.optional(),
    Words: z.array(azureWord).optional(),
  })
  .passthrough();
export const azureDetailedResultSchema = z
  .object({
    RecognitionStatus: z.string(),
    DisplayText: z.string().optional(),
    NBest: z.array(azureNBest).optional(),
  })
  .passthrough();
export type AzureDetailedResult = z.infer<typeof azureDetailedResultSchema>;

const clampScore = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v * 10) / 10)) : null;

function mapErrorType(value: string | null | undefined): WordErrorType {
  switch ((value ?? "None").toLowerCase()) {
    case "none":
      return "none";
    case "mispronunciation":
      return "mispronunciation";
    case "omission":
      return "omission";
    case "insertion":
      return "insertion";
    case "unexpectedbreak":
      return "unexpected_break";
    case "missingbreak":
      return "missing_break";
    case "monotone":
      return "monotone";
    default:
      return "unknown";
  }
}

/**
 * Azure returns scores either flat on NBest/Word (REST short-audio API) or
 * nested under `PronunciationAssessment` (Speech SDK JSON). Accept both.
 */
export function normalizeAzureAssessment(
  raw: unknown,
  referenceText: string,
  locale: string,
  phonemeAlphabet: "IPA" | "SAPI",
): NormalizedAssessment {
  const parsed = azureDetailedResultSchema.parse(raw);
  const limitations: string[] = [];
  const best = parsed.NBest?.[0];
  if (parsed.RecognitionStatus !== "Success" || !best) {
    return {
      provider: "azure",
      locale,
      referenceText,
      recognizedText: "",
      overallScore: null,
      accuracyScore: null,
      fluencyScore: null,
      completenessScore: null,
      prosodyScore: null,
      recognitionConfidence: null,
      phonemeAlphabet: null,
      words: [],
      reliable: false,
      limitations: [
        parsed.RecognitionStatus === "NoMatch" || parsed.RecognitionStatus === "InitialSilenceTimeout"
          ? "No speech was recognised in the recording."
          : `The speech service could not assess this recording (${parsed.RecognitionStatus}).`,
      ],
    };
  }
  const pa = best.PronunciationAssessment ?? {};
  const pick = (flat: number | null | undefined, nested: number | null | undefined) => clampScore(flat ?? nested);

  const words = (best.Words ?? []).map((w) => {
    const wpa = w.PronunciationAssessment ?? {};
    return {
      word: w.Word,
      accuracyScore: pick(w.AccuracyScore, wpa.AccuracyScore),
      errorType: mapErrorType(w.ErrorType ?? wpa.ErrorType),
      phonemes: (w.Phonemes ?? [])
        .filter((p) => p.Phoneme)
        .map((p) => ({
          phoneme: p.Phoneme!,
          accuracyScore: pick(p.AccuracyScore, p.PronunciationAssessment?.AccuracyScore),
        })),
    };
  });

  const hasPhonemes = words.some((w) => w.phonemes.length > 0);
  if (!hasPhonemes) limitations.push("Sound-level (phoneme) scores were not returned for this locale or recording.");
  const prosody = pick(best.ProsodyScore, pa.ProsodyScore);
  if (prosody === null) limitations.push("Stress and intonation (prosody) scoring is not available for this assessment.");

  const completeness = pick(best.CompletenessScore, pa.CompletenessScore);
  const recognizedText = (best.Display ?? best.Lexical ?? parsed.DisplayText ?? "").trim();
  const confidence = typeof best.Confidence === "number" ? Math.max(0, Math.min(1, best.Confidence)) : null;

  let reliable = recognizedText.length > 0;
  if (completeness !== null && completeness < 50) {
    reliable = false;
    limitations.push("Less than half of the sentence was heard, so the scores are not reliable. Please try again.");
  }
  if (confidence !== null && confidence < 0.4) {
    reliable = false;
    limitations.push("The recognition confidence was low (background noise or a quiet microphone?).");
  }

  return normalizedAssessmentSchema.parse({
    provider: "azure",
    locale,
    referenceText,
    recognizedText,
    overallScore: pick(best.PronScore, pa.PronScore),
    accuracyScore: pick(best.AccuracyScore, pa.AccuracyScore),
    fluencyScore: pick(best.FluencyScore, pa.FluencyScore),
    completenessScore: completeness,
    prosodyScore: prosody,
    recognitionConfidence: confidence,
    phonemeAlphabet: hasPhonemes ? phonemeAlphabet : null,
    words,
    reliable,
    limitations,
  });
}

// ─── Feedback derived from an assessment ─────────────────────────────────────

export interface DifficultSound {
  phoneme: string;
  averageScore: number;
  words: string[];
  guide: SoundGuide | null;
}

/** Sounds the provider scored low, worst first. Empty when no phoneme data exist. */
export function difficultSounds(assessment: NormalizedAssessment, threshold = 60, limit = 3): DifficultSound[] {
  if (!assessment.reliable) return [];
  const bySound = new Map<string, { scores: number[]; words: Set<string> }>();
  for (const word of assessment.words) {
    for (const p of word.phonemes) {
      if (p.accuracyScore === null || p.accuracyScore >= threshold) continue;
      const key = normalizeSymbol(p.phoneme);
      const entry = bySound.get(key) ?? { scores: [], words: new Set<string>() };
      entry.scores.push(p.accuracyScore);
      entry.words.add(word.word);
      bySound.set(key, entry);
    }
  }
  return [...bySound.entries()]
    .map(([phoneme, e]) => ({
      phoneme,
      averageScore: Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length),
      words: [...e.words].slice(0, 4),
      guide: guideForPhoneme(phoneme),
    }))
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, limit);
}

/** Words to practise, from provider word-level results only. */
export function wordsToPractise(assessment: NormalizedAssessment, threshold = 70): string[] {
  if (!assessment.reliable) return [];
  return assessment.words
    .filter(
      (w) =>
        w.errorType === "mispronunciation" ||
        w.errorType === "omission" ||
        (w.accuracyScore !== null && w.accuracyScore < threshold),
    )
    .map((w) => w.word)
    .slice(0, 6);
}

export interface AttemptComparison {
  metric: "overallScore" | "accuracyScore" | "fluencyScore" | "completenessScore" | "prosodyScore";
  previous: number;
  current: number;
  change: number;
}

/** Compare two attempts on the metrics both actually measured. */
export function compareAttempts(previous: NormalizedAssessment, current: NormalizedAssessment): AttemptComparison[] {
  if (!previous.reliable || !current.reliable) return [];
  const metrics = ["overallScore", "accuracyScore", "fluencyScore", "completenessScore", "prosodyScore"] as const;
  const out: AttemptComparison[] = [];
  for (const metric of metrics) {
    const a = previous[metric];
    const b = current[metric];
    if (a === null || b === null) continue;
    out.push({ metric, previous: a, current: b, change: Math.round((b - a) * 10) / 10 });
  }
  return out;
}

/** Strip the payload to what we store: no provider dumps, only normalised fields. */
export function minimizeForStorage(a: NormalizedAssessment) {
  return {
    words: a.words.map((w) => ({
      word: w.word,
      accuracyScore: w.accuracyScore,
      errorType: w.errorType,
      phonemes: w.phonemes,
    })),
    recognitionConfidence: a.recognitionConfidence,
    phonemeAlphabet: a.phonemeAlphabet,
    reliable: a.reliable,
    limitations: a.limitations,
  };
}
