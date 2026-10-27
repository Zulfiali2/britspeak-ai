/**
 * Provider response fixtures shaped like the documented Azure AI Speech REST
 * output. They exist to test parsing and normalisation; they are not evidence
 * that a live provider behaves this way (see docs/testing.md).
 */

export function azureFlatResponse() {
  return {
    RecognitionStatus: "Success",
    Offset: 500000,
    Duration: 21000000,
    DisplayText: "I think this is very good.",
    NBest: [
      {
        Confidence: 0.91,
        Lexical: "i think this is very good",
        ITN: "i think this is very good",
        MaskedITN: "i think this is very good",
        Display: "I think this is very good.",
        AccuracyScore: 74,
        FluencyScore: 90,
        CompletenessScore: 100,
        PronScore: 78.4,
        Words: [
          { Word: "i", AccuracyScore: 96, ErrorType: "None", Phonemes: [{ Phoneme: "aɪ", AccuracyScore: 96 }] },
          {
            Word: "think",
            AccuracyScore: 42,
            ErrorType: "Mispronunciation",
            Phonemes: [
              { Phoneme: "θ", AccuracyScore: 18 },
              { Phoneme: "ɪ", AccuracyScore: 80 },
              { Phoneme: "ŋ", AccuracyScore: 70 },
              { Phoneme: "k", AccuracyScore: 88 },
            ],
          },
          {
            Word: "this",
            AccuracyScore: 81,
            ErrorType: "None",
            Phonemes: [
              { Phoneme: "ð", AccuracyScore: 64 },
              { Phoneme: "ɪ", AccuracyScore: 90 },
              { Phoneme: "s", AccuracyScore: 92 },
            ],
          },
          { Word: "is", AccuracyScore: 95, ErrorType: "None", Phonemes: [{ Phoneme: "ɪ", AccuracyScore: 95 }, { Phoneme: "z", AccuracyScore: 94 }] },
          {
            Word: "very",
            AccuracyScore: 61,
            ErrorType: "None",
            Phonemes: [
              { Phoneme: "v", AccuracyScore: 35 },
              { Phoneme: "e", AccuracyScore: 85 },
              { Phoneme: "ɹ", AccuracyScore: 70 },
              { Phoneme: "i", AccuracyScore: 80 },
            ],
          },
          { Word: "good", AccuracyScore: 93, ErrorType: "None", Phonemes: [{ Phoneme: "g", AccuracyScore: 93 }] },
        ],
      },
    ],
  };
}

export function azureNestedResponse() {
  return {
    RecognitionStatus: "Success",
    DisplayText: "Very good.",
    NBest: [
      {
        Confidence: 0.88,
        Display: "Very good.",
        PronunciationAssessment: {
          AccuracyScore: 80,
          FluencyScore: 95,
          CompletenessScore: 100,
          PronScore: 88,
          ProsodyScore: 81.5,
        },
        Words: [
          {
            Word: "very",
            PronunciationAssessment: { AccuracyScore: 70, ErrorType: "None" },
            Phonemes: [{ Phoneme: "v", PronunciationAssessment: { AccuracyScore: 55 } }],
          },
          { Word: "good", PronunciationAssessment: { AccuracyScore: 92, ErrorType: "None" } },
        ],
      },
    ],
  };
}

/** Build a 16 kHz mono 16-bit WAV with a sine tone (or silence). */
export function makeWav(seconds: number, options: { amplitude?: number; sampleRate?: number; channels?: number } = {}) {
  const sampleRate = options.sampleRate ?? 16_000;
  const channels = options.channels ?? 1;
  const amplitude = options.amplitude ?? 0.3;
  const samples = Math.round(seconds * sampleRate);
  const dataBytes = samples * channels * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude * 32767);
    for (let c = 0; c < channels; c++) buf.writeInt16LE(v, 44 + (i * channels + c) * 2);
  }
  return new Uint8Array(buf);
}
