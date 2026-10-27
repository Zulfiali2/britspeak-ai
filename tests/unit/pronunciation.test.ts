import { describe, expect, it } from "vitest";
import {
  compareAttempts,
  difficultSounds,
  minimizeForStorage,
  normalizeAzureAssessment,
  wordsToPractise,
} from "@/server/domain/pronunciation";
import { guideForPhoneme } from "@/server/domain/phoneme-guide";
import { azureFlatResponse, azureNestedResponse } from "../support/fixtures";

describe("Azure pronunciation normalisation", () => {
  it("normalises the flat REST format", () => {
    const a = normalizeAzureAssessment(azureFlatResponse(), "I think this is very good", "en-GB", "IPA");
    expect(a).toMatchObject({
      provider: "azure",
      locale: "en-GB",
      overallScore: 78.4,
      accuracyScore: 74,
      fluencyScore: 90,
      completenessScore: 100,
      prosodyScore: null,
      reliable: true,
      phonemeAlphabet: "IPA",
    });
    expect(a.recognizedText).toBe("I think this is very good.");
    expect(a.words.find((w) => w.word === "think")).toMatchObject({ errorType: "mispronunciation", accuracyScore: 42 });
    expect(a.limitations.some((l) => /prosody/i.test(l))).toBe(true);
  });

  it("normalises the nested SDK format", () => {
    const a = normalizeAzureAssessment(azureNestedResponse(), "very good", "en-GB", "IPA");
    expect(a.overallScore).toBe(88);
    expect(a.prosodyScore).toBe(81.5);
    expect(a.words[0]!.accuracyScore).toBe(70);
    expect(a.words[0]!.phonemes[0]).toEqual({ phoneme: "v", accuracyScore: 55 });
  });

  it("marks every metric unavailable when nothing was recognised — never invents scores", () => {
    const a = normalizeAzureAssessment({ RecognitionStatus: "NoMatch" }, "hello", "en-GB", "IPA");
    expect(a.reliable).toBe(false);
    expect([a.overallScore, a.accuracyScore, a.fluencyScore, a.completenessScore, a.prosodyScore]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(a.words).toEqual([]);
    expect(difficultSounds(a)).toEqual([]);
  });

  it("flags low completeness as unreliable", () => {
    const raw = azureFlatResponse();
    raw.NBest[0]!.CompletenessScore = 30;
    const a = normalizeAzureAssessment(raw, "I think this is very good", "en-GB", "IPA");
    expect(a.reliable).toBe(false);
    expect(wordsToPractise(a)).toEqual([]);
  });

  it("clamps out-of-range provider scores", () => {
    const raw = azureFlatResponse();
    raw.NBest[0]!.FluencyScore = 140;
    expect(normalizeAzureAssessment(raw, "x", "en-GB", "IPA").fluencyScore).toBe(100);
  });

  it("reports missing phoneme data as a limitation, not as zero", () => {
    const raw = azureFlatResponse();
    for (const w of raw.NBest[0]!.Words) delete (w as { Phonemes?: unknown }).Phonemes;
    const a = normalizeAzureAssessment(raw, "I think this is very good", "en-GB", "IPA");
    expect(a.phonemeAlphabet).toBeNull();
    expect(a.limitations.some((l) => /phoneme/i.test(l))).toBe(true);
    expect(difficultSounds(a)).toEqual([]);
  });
});

describe("feedback from assessments", () => {
  it("finds difficult sounds with articulation guidance", () => {
    const a = normalizeAzureAssessment(azureFlatResponse(), "I think this is very good", "en-GB", "IPA");
    const sounds = difficultSounds(a);
    expect(sounds[0]).toMatchObject({ phoneme: "θ", words: ["think"] });
    expect(sounds[0]!.guide?.howTo).toMatch(/tongue/i);
    expect(sounds.map((s) => s.phoneme)).toContain("v");
  });

  it("lists words to practise from provider word results", () => {
    const a = normalizeAzureAssessment(azureFlatResponse(), "I think this is very good", "en-GB", "IPA");
    expect(wordsToPractise(a)).toEqual(["think", "very"]);
  });

  it("compares only metrics both attempts measured", () => {
    const first = normalizeAzureAssessment(azureFlatResponse(), "I think this is very good", "en-GB", "IPA");
    const raw = azureFlatResponse();
    raw.NBest[0]!.PronScore = 85;
    const second = normalizeAzureAssessment(raw, "I think this is very good", "en-GB", "IPA");
    const diff = compareAttempts(first, second);
    expect(diff.find((d) => d.metric === "overallScore")).toMatchObject({ previous: 78.4, current: 85, change: 6.6 });
    expect(diff.find((d) => d.metric === "prosodyScore")).toBeUndefined();
  });

  it("stores a minimised payload", () => {
    const a = normalizeAzureAssessment(azureFlatResponse(), "I think this is very good", "en-GB", "IPA");
    const stored = minimizeForStorage(a);
    expect(Object.keys(stored).sort()).toEqual(["limitations", "phonemeAlphabet", "recognitionConfidence", "reliable", "words"]);
  });

  it("maps IPA variants with length marks to a guide", () => {
    expect(guideForPhoneme("iː")?.symbol).toBe("i");
    expect(guideForPhoneme("ɜː")?.name).toMatch(/work/);
    expect(guideForPhoneme("q")).toBeNull();
  });
});
