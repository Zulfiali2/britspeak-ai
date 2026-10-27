import { describe, expect, it } from "vitest";
import { parseWav, validateSpeechWav, WavError } from "@/server/domain/wav";
import { makeWav } from "../support/fixtures";

const limits = { minSeconds: 0.5, maxSeconds: 45 };

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof WavError ? e.reason : "other";
  }
  return undefined;
}

describe("WAV upload validation", () => {
  it("accepts 16 kHz mono 16-bit speech", () => {
    const info = validateSpeechWav(makeWav(2), limits);
    expect(info).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(info.durationSeconds).toBeCloseTo(2, 2);
  });

  it("rejects files that are not WAV", () => {
    expect(reason(() => parseWav(new TextEncoder().encode("<html>not audio</html>".padEnd(64, " "))))).toBe("not_wav");
  });

  it("rejects other sample rates and stereo", () => {
    expect(reason(() => validateSpeechWav(makeWav(2, { sampleRate: 44100 }), limits))).toBe("unsupported_format");
    expect(reason(() => validateSpeechWav(makeWav(2, { channels: 2 }), limits))).toBe("unsupported_format");
  });

  it("enforces minimum and maximum duration", () => {
    expect(reason(() => validateSpeechWav(makeWav(0.2), limits))).toBe("too_short");
    expect(reason(() => validateSpeechWav(makeWav(47), limits))).toBe("too_long");
  });

  it("rejects silent recordings", () => {
    expect(reason(() => validateSpeechWav(makeWav(2, { amplitude: 0 }), limits))).toBe("silent");
  });

  it("rejects truncated uploads", () => {
    const wav = makeWav(2);
    expect(reason(() => parseWav(wav.subarray(0, wav.length - 1000)))).toBe("truncated");
  });
});
