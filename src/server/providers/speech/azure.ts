import "server-only";
import { z } from "zod";
import type { AppConfig } from "@/server/config/env";
import { normalizeAzureAssessment, type NormalizedAssessment } from "@/server/domain/pronunciation";
import { callProvider, httpError } from "../resilience";
import {
  ProviderError,
  type CallMeta,
  type PronunciationProvider,
  type SttProvider,
  type SynthesisResult,
  type TranscriptionResult,
  type TtsProvider,
  type VoiceInfo,
} from "../types";

/**
 * Azure AI Speech over REST (no SDK dependency):
 *  - Speech-to-text, short audio:  POST https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
 *  - Pronunciation assessment: same endpoint with a `Pronunciation-Assessment` header
 *  - Text-to-speech:  POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1 (SSML)
 *  - Voice list:      GET  https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list
 *
 * The short-audio REST API accepts up to 60 s of audio (30 s for pronunciation
 * assessment). Audio is sent as 16 kHz mono PCM WAV and is not retained by us.
 */
const PROVIDER = "azure";
const WAV_CONTENT_TYPE = "audio/wav; codecs=audio/pcm; samplerate=16000";

function sttBase(config: AppConfig) {
  return config.AZURE_SPEECH_STT_BASE_URL ?? `https://${config.AZURE_SPEECH_REGION}.stt.speech.microsoft.com`;
}
function ttsBase(config: AppConfig) {
  return config.AZURE_SPEECH_TTS_BASE_URL ?? `https://${config.AZURE_SPEECH_REGION}.tts.speech.microsoft.com`;
}

async function recognize(
  config: AppConfig,
  audio: Uint8Array,
  locale: string,
  operation: string,
  extraHeaders: Record<string, string> = {},
) {
  const url = new URL("/speech/recognition/conversation/cognitiveservices/v1", sttBase(config));
  url.searchParams.set("language", locale);
  url.searchParams.set("format", "detailed");
  url.searchParams.set("profanity", "masked");
  return callProvider(
    { provider: PROVIDER, operation, timeoutMs: config.SPEECH_TIMEOUT_MS, maxRetries: 1 },
    async (signal) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": config.AZURE_SPEECH_KEY!,
          "Content-Type": WAV_CONTENT_TYPE,
          Accept: "application/json",
          ...extraHeaders,
        },
        body: Buffer.from(audio),
        signal,
      });
      if (!res.ok) throw httpError(PROVIDER, res.status, await res.text().catch(() => ""));
      return (await res.json()) as unknown;
    },
  );
}

const sttResponseSchema = z
  .object({
    RecognitionStatus: z.string(),
    DisplayText: z.string().optional(),
    NBest: z
      .array(
        z
          .object({
            Confidence: z.number().optional(),
            Display: z.string().optional(),
            Lexical: z.string().optional(),
            Words: z
              .array(
                z.object({
                  Word: z.string(),
                  Offset: z.number().optional(),
                  Duration: z.number().optional(),
                  Confidence: z.number().optional(),
                }),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export class AzureSttProvider implements SttProvider {
  readonly id = PROVIDER;
  constructor(private readonly config: AppConfig) {}

  async transcribe(audio: Uint8Array, options: { locale: string }): Promise<TranscriptionResult> {
    const { value, latencyMs, retries } = await recognize(this.config, audio, options.locale, "stt");
    const parsed = sttResponseSchema.safeParse(value);
    if (!parsed.success) throw new ProviderError(PROVIDER, "invalid_response", "Unexpected speech-to-text response");
    const r = parsed.data;
    const noSpeech = r.RecognitionStatus === "NoMatch" || r.RecognitionStatus === "InitialSilenceTimeout";
    if (!noSpeech && r.RecognitionStatus !== "Success") {
      throw new ProviderError(PROVIDER, "bad_request", `Recognition failed: ${r.RecognitionStatus}`);
    }
    const best = r.NBest?.[0];
    // Azure offsets/durations are in 100-nanosecond ticks.
    const ticksToMs = (t?: number) => (typeof t === "number" ? Math.round(t / 10_000) : null);
    return {
      text: (best?.Display ?? r.DisplayText ?? "").trim(),
      confidence: typeof best?.Confidence === "number" ? best.Confidence : null,
      words: (best?.Words ?? []).map((w) => ({
        word: w.Word,
        startMs: ticksToMs(w.Offset),
        endMs: w.Offset !== undefined && w.Duration !== undefined ? ticksToMs(w.Offset + w.Duration) : null,
        confidence: w.Confidence ?? null,
      })),
      provider: PROVIDER,
      model: null,
      noSpeech,
      latencyMs,
      retries,
    };
  }
}

export class AzurePronunciationProvider implements PronunciationProvider {
  readonly id = PROVIDER;
  readonly maxSeconds = 30;
  constructor(private readonly config: AppConfig) {}

  async assess(
    audio: Uint8Array,
    options: { referenceText: string; locale: string },
  ): Promise<NormalizedAssessment & CallMeta> {
    const params: Record<string, unknown> = {
      ReferenceText: options.referenceText,
      GradingSystem: "HundredMark",
      Granularity: "Phoneme",
      Dimension: "Comprehensive",
      EnableMiscue: true,
      PhonemeAlphabet: "IPA",
    };
    if (this.config.AZURE_ENABLE_PROSODY) params.EnableProsodyAssessment = true;
    const header = Buffer.from(JSON.stringify(params), "utf8").toString("base64");
    const { value, latencyMs, retries } = await recognize(this.config, audio, options.locale, "pronunciation", {
      "Pronunciation-Assessment": header,
    });
    try {
      return { ...normalizeAzureAssessment(value, options.referenceText, options.locale, "IPA"), latencyMs, retries };
    } catch {
      throw new ProviderError(PROVIDER, "invalid_response", "Unexpected pronunciation assessment response");
    }
  }
}

const voiceListSchema = z.array(
  z
    .object({
      ShortName: z.string(),
      DisplayName: z.string().optional(),
      LocalName: z.string().optional(),
      Locale: z.string(),
      Gender: z.string().optional(),
      Status: z.string().optional(),
    })
    .passthrough(),
);

let voiceCache: { at: number; voices: z.infer<typeof voiceListSchema> } | undefined;
const VOICE_CACHE_MS = 6 * 60 * 60 * 1000;

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export class AzureTtsProvider implements TtsProvider {
  readonly id = PROVIDER;
  constructor(private readonly config: AppConfig) {}

  private async fetchVoices() {
    if (voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_MS) return voiceCache.voices;
    const { value } = await callProvider(
      { provider: PROVIDER, operation: "voices", timeoutMs: this.config.SPEECH_TIMEOUT_MS, maxRetries: 1 },
      async (signal) => {
        const res = await fetch(new URL("/cognitiveservices/voices/list", ttsBase(this.config)), {
          headers: { "Ocp-Apim-Subscription-Key": this.config.AZURE_SPEECH_KEY! },
          signal,
        });
        if (!res.ok) throw httpError(PROVIDER, res.status);
        return voiceListSchema.parse(await res.json());
      },
    );
    voiceCache = { at: Date.now(), voices: value };
    return value;
  }

  /** Voices come from the provider's live list — never a hard-coded claim. */
  async listVoices(locale: string): Promise<VoiceInfo[]> {
    const voices = await this.fetchVoices();
    return voices
      .filter((v) => v.Locale.toLowerCase() === locale.toLowerCase() && (v.Status ?? "GA") !== "Deprecated")
      .map((v) => ({
        id: v.ShortName,
        name: v.LocalName ?? v.DisplayName ?? v.ShortName,
        locale: v.Locale,
        gender: v.Gender ?? null,
        britishVerified: v.Locale.toLowerCase() === "en-gb",
      }));
  }

  async synthesize(
    text: string,
    options: { voice?: string | null; rate: number; locale: string },
  ): Promise<SynthesisResult> {
    const voices = await this.listVoices(options.locale);
    const requested = options.voice && voices.find((v) => v.id === options.voice);
    const fallback = voices.find((v) => v.id === this.config.AZURE_TTS_DEFAULT_VOICE) ?? voices[0];
    const voice = requested || fallback;
    if (!voice) {
      throw new ProviderError(PROVIDER, "unavailable", `No ${options.locale} voices are available from Azure`);
    }
    const ratePercent = Math.round((Math.max(0.5, Math.min(1.5, options.rate)) - 1) * 100);
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(options.locale)}">` +
      `<voice name="${escapeXml(voice.id)}"><prosody rate="${ratePercent >= 0 ? "+" : ""}${ratePercent}%">` +
      `${escapeXml(text)}</prosody></voice></speak>`;
    const { value, latencyMs, retries } = await callProvider(
      { provider: PROVIDER, operation: "tts", timeoutMs: this.config.SPEECH_TIMEOUT_MS, maxRetries: 1 },
      async (signal) => {
        const res = await fetch(new URL("/cognitiveservices/v1", ttsBase(this.config)), {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": this.config.AZURE_SPEECH_KEY!,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "britspeak-ai",
          },
          body: ssml,
          signal,
        });
        if (!res.ok) throw httpError(PROVIDER, res.status);
        const contentType = res.headers.get("content-type") ?? "audio/mpeg";
        return { audio: new Uint8Array(await res.arrayBuffer()), contentType };
      },
    );
    if (value.audio.byteLength === 0) throw new ProviderError(PROVIDER, "invalid_response", "Empty audio returned");
    return { ...value, voice: voice.id, provider: PROVIDER, latencyMs, retries };
  }
}

export function resetAzureVoiceCacheForTests() {
  voiceCache = undefined;
}
