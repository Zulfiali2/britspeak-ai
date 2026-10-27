import "server-only";
import OpenAI, { toFile } from "openai";
import type { AppConfig } from "@/server/config/env";
import { callProvider, httpError } from "../resilience";
import {
  ProviderError,
  type RealtimeClientSecret,
  type RealtimeProvider,
  type SttProvider,
  type SynthesisResult,
  type TranscriptionResult,
  type TtsProvider,
  type VoiceInfo,
  type CallMeta,
} from "../types";

const PROVIDER = "openai";

function client(config: AppConfig) {
  return new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL,
    timeout: config.SPEECH_TIMEOUT_MS,
    maxRetries: 0,
  });
}

function rethrow(error: unknown): never {
  if (error instanceof OpenAI.APIError && typeof error.status === "number") {
    throw httpError(PROVIDER, error.status, error.message);
  }
  throw error;
}

export class OpenAiSttProvider implements SttProvider {
  readonly id = PROVIDER;
  private readonly client: OpenAI;
  constructor(private readonly config: AppConfig) {
    this.client = client(config);
  }

  async transcribe(audio: Uint8Array): Promise<TranscriptionResult> {
    const model = this.config.OPENAI_STT_MODEL;
    const verbose = model === "whisper-1";
    const { value, latencyMs, retries } = await callProvider(
      { provider: PROVIDER, operation: "stt", timeoutMs: this.config.SPEECH_TIMEOUT_MS, maxRetries: 1 },
      async (signal) => {
        try {
          const file = await toFile(Buffer.from(audio), "speech.wav", { type: "audio/wav" });
          if (verbose) {
            return await this.client.audio.transcriptions.create(
              {
                file,
                model,
                language: "en",
                response_format: "verbose_json",
                timestamp_granularities: ["word"],
              },
              { signal },
            );
          }
          return await this.client.audio.transcriptions.create(
            { file, model, language: "en", response_format: "json", include: ["logprobs"] },
            { signal },
          );
        } catch (error) {
          rethrow(error);
        }
      },
    );
    const text = (value.text ?? "").trim();
    // Confidence: mean token probability when log-probabilities are returned.
    let confidence: number | null = null;
    const logprobs = "logprobs" in value ? value.logprobs : undefined;
    if (Array.isArray(logprobs) && logprobs.length > 0) {
      const probs = logprobs.map((l) => Math.exp(l.logprob ?? -Infinity)).filter(Number.isFinite);
      if (probs.length) confidence = Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 100) / 100;
    }
    const words =
      "words" in value && Array.isArray(value.words)
        ? value.words.map((w) => ({
            word: w.word,
            startMs: Math.round(w.start * 1000),
            endMs: Math.round(w.end * 1000),
            confidence: null,
          }))
        : [];
    return { text, confidence, words, provider: PROVIDER, model, noSpeech: text.length === 0, latencyMs, retries };
  }
}

export class OpenAiTtsProvider implements TtsProvider {
  readonly id = PROVIDER;
  private readonly client: OpenAI;
  constructor(private readonly config: AppConfig) {
    this.client = client(config);
  }

  /**
   * OpenAI voices are not tied to a locale, so none is marked as a verified
   * British voice. The UI states that the accent is not guaranteed.
   */
  async listVoices(): Promise<VoiceInfo[]> {
    return [
      {
        id: this.config.OPENAI_TTS_VOICE,
        name: `${this.config.OPENAI_TTS_VOICE} (accent not guaranteed)`,
        locale: null,
        gender: null,
        britishVerified: false,
      },
    ];
  }

  async synthesize(text: string, options: { voice?: string | null; rate: number }): Promise<SynthesisResult> {
    const voice = this.config.OPENAI_TTS_VOICE;
    const { value, latencyMs, retries } = await callProvider(
      { provider: PROVIDER, operation: "tts", timeoutMs: this.config.SPEECH_TIMEOUT_MS, maxRetries: 1 },
      async (signal) => {
        try {
          const res = await this.client.audio.speech.create(
            {
              model: this.config.OPENAI_TTS_MODEL,
              voice,
              input: text,
              instructions: "Speak clearly, at a calm teaching pace, in a standard British English accent.",
              response_format: "mp3",
              speed: Math.max(0.5, Math.min(1.5, options.rate)),
            },
            { signal },
          );
          return new Uint8Array(await res.arrayBuffer());
        } catch (error) {
          rethrow(error);
        }
      },
    );
    if (value.byteLength === 0) throw new ProviderError(PROVIDER, "invalid_response", "Empty audio returned");
    return { audio: value, contentType: "audio/mpeg", voice, provider: PROVIDER, latencyMs, retries };
  }
}

/**
 * OpenAI Realtime (GA interface): the server mints a short-lived client secret;
 * the browser uses it once to exchange a WebRTC SDP offer with
 * https://api.openai.com/v1/realtime/calls. The API key never leaves the server.
 */
export class OpenAiRealtimeProvider implements RealtimeProvider {
  readonly id = PROVIDER;
  private readonly client: OpenAI;
  constructor(private readonly config: AppConfig) {
    this.client = client(config);
  }

  async createClientSecret(options: { instructions: string; voice?: string }): Promise<RealtimeClientSecret & CallMeta> {
    const model = this.config.OPENAI_REALTIME_MODEL;
    const { value, latencyMs, retries } = await callProvider(
      { provider: PROVIDER, operation: "realtime_secret", timeoutMs: this.config.SPEECH_TIMEOUT_MS, maxRetries: 1 },
      async (signal) => {
        try {
          return await this.client.realtime.clientSecrets.create(
            {
              expires_after: { anchor: "created_at", seconds: 60 },
              session: {
                type: "realtime",
                model,
                instructions: options.instructions,
                max_output_tokens: 600,
                audio: {
                  input: {
                    transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
                    turn_detection: { type: "server_vad", silence_duration_ms: 700 },
                  },
                  output: { voice: options.voice ?? this.config.OPENAI_REALTIME_VOICE },
                },
              },
            },
            { signal },
          );
        } catch (error) {
          rethrow(error);
        }
      },
    );
    return {
      provider: PROVIDER,
      model,
      clientSecret: value.value,
      expiresAt: value.expires_at,
      sdpUrl: "https://api.openai.com/v1/realtime/calls",
      latencyMs,
      retries,
    };
  }
}
