/**
 * Strict validation of uploaded WAV audio. The browser client always sends
 * 16 kHz, mono, 16-bit PCM WAV (see src/lib/audio/wav-encoder.ts); anything
 * else is rejected before it reaches a paid provider.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
  dataOffset: number;
}

export type WavValidationError =
  | "not_wav"
  | "unsupported_format"
  | "too_short"
  | "too_long"
  | "silent"
  | "truncated";

export class WavError extends Error {
  constructor(
    public readonly reason: WavValidationError,
    message: string,
  ) {
    super(message);
    this.name = "WavError";
  }
}

export const ACCEPTED_SAMPLE_RATE = 16_000;

export function parseWav(buf: Uint8Array): WavInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ascii = (offset: number, len: number) =>
    String.fromCharCode(...buf.subarray(offset, offset + len));
  if (buf.byteLength < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new WavError("not_wav", "The recording is not a WAV file.");
  }
  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (offset + 8 <= buf.byteLength) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > buf.byteLength) throw new WavError("truncated", "Malformed WAV header.");
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new WavError("not_wav", "WAV data chunk appears before the format chunk.");
      const available = buf.byteLength - body;
      if (size > available) throw new WavError("truncated", "The recording upload was incomplete.");
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bits / 8);
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        dataBytes: size,
        dataOffset: body,
        durationSeconds: bytesPerSecond > 0 ? size / bytesPerSecond : 0,
      };
    }
    offset = body + size + (size % 2);
  }
  throw new WavError("not_wav", "The WAV file has no audio data.");
}

export interface WavLimits {
  minSeconds: number;
  maxSeconds: number;
}

export function validateSpeechWav(buf: Uint8Array, limits: WavLimits): WavInfo {
  const info = parseWav(buf);
  if (info.channels !== 1 || info.bitsPerSample !== 16 || info.sampleRate !== ACCEPTED_SAMPLE_RATE) {
    throw new WavError(
      "unsupported_format",
      "Audio must be 16 kHz mono 16-bit PCM. Please record again in the app.",
    );
  }
  if (info.durationSeconds < limits.minSeconds) {
    throw new WavError("too_short", "The recording is too short. Please speak for at least a second.");
  }
  if (info.durationSeconds > limits.maxSeconds + 0.5) {
    throw new WavError("too_long", `Recordings are limited to ${limits.maxSeconds} seconds.`);
  }
  if (isSilent(buf, info)) {
    throw new WavError("silent", "We could not hear any speech. Check your microphone and try again.");
  }
  return info;
}

/** Peak-amplitude silence check (-50 dBFS). */
export function isSilent(buf: Uint8Array, info: WavInfo): boolean {
  const view = new DataView(buf.buffer, buf.byteOffset + info.dataOffset, info.dataBytes);
  const threshold = 32768 * 0.00316; // -50 dBFS
  let loudSamples = 0;
  for (let i = 0; i + 1 < info.dataBytes; i += 2) {
    if (Math.abs(view.getInt16(i, true)) > threshold) {
      loudSamples++;
      if (loudSamples > 160) return false; // ~10 ms of non-silent audio
    }
  }
  return true;
}
