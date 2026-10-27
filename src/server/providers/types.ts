import type { ZodType } from "zod";
import type { NormalizedAssessment } from "@/server/domain/pronunciation";

export type ProviderFailure =
  | "timeout"
  | "rate_limited"
  | "auth"
  | "bad_request"
  | "unavailable"
  | "refused"
  | "invalid_response"
  | "circuit_open"
  | "network";

/** A provider call failed. `retryable` drives the retry policy. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly category: ProviderFailure,
    message: string,
    public readonly retryable = false,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface CallMeta {
  latencyMs: number;
  retries: number;
}

// ─── Language model ─────────────────────────────────────────────────────────

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmJsonRequest<T> {
  system: string;
  messages: LlmMessage[];
  /** JSON Schema for structured output. */
  jsonSchema: Record<string, unknown>;
  /** Runtime validator applied to the parsed output. */
  validator: ZodType<T>;
  maxTokens: number;
}

export interface LlmJsonResult<T> extends CallMeta {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  generateJson<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
}

// ─── Speech to text ─────────────────────────────────────────────────────────

export interface TranscriptWord {
  word: string;
  startMs: number | null;
  endMs: number | null;
  confidence: number | null;
}

export interface TranscriptionResult extends CallMeta {
  text: string;
  /** 0-1 when the provider exposes it; null otherwise. */
  confidence: number | null;
  words: TranscriptWord[];
  provider: string;
  model: string | null;
  noSpeech: boolean;
}

export interface SttProvider {
  readonly id: string;
  transcribe(audio: Uint8Array, options: { locale: string; durationSeconds: number }): Promise<TranscriptionResult>;
}

// ─── Text to speech ─────────────────────────────────────────────────────────

export interface VoiceInfo {
  id: string;
  name: string;
  locale: string | null;
  gender: string | null;
  /** True only when the provider itself lists this voice under an en-GB locale. */
  britishVerified: boolean;
}

export interface SynthesisResult extends CallMeta {
  audio: Uint8Array;
  contentType: string;
  voice: string;
  provider: string;
}

export interface TtsProvider {
  readonly id: string;
  listVoices(locale: string): Promise<VoiceInfo[]>;
  synthesize(text: string, options: { voice?: string | null; rate: number; locale: string }): Promise<SynthesisResult>;
}

// ─── Pronunciation assessment ───────────────────────────────────────────────

export interface PronunciationProvider {
  readonly id: string;
  /** Upper bound on audio length the provider accepts for assessment. */
  readonly maxSeconds: number;
  assess(
    audio: Uint8Array,
    options: { referenceText: string; locale: string },
  ): Promise<NormalizedAssessment & CallMeta>;
}

// ─── Real-time voice ────────────────────────────────────────────────────────

export interface RealtimeClientSecret {
  provider: string;
  model: string;
  clientSecret: string;
  expiresAt: number;
  /** Where the browser sends its WebRTC SDP offer. */
  sdpUrl: string;
}

export interface RealtimeProvider {
  readonly id: string;
  createClientSecret(options: { instructions: string; voice?: string }): Promise<RealtimeClientSecret & CallMeta>;
}
