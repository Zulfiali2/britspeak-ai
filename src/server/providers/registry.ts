import "server-only";
import { getConfig, providerAvailability, type FeatureKey } from "@/server/config/env";
import { AppError } from "@/server/http/errors";
import { AnthropicLlmProvider } from "./llm/anthropic";
import { AzurePronunciationProvider, AzureSttProvider, AzureTtsProvider } from "./speech/azure";
import { OpenAiRealtimeProvider, OpenAiSttProvider, OpenAiTtsProvider } from "./speech/openai";
import type { LlmProvider, PronunciationProvider, RealtimeProvider, SttProvider, TtsProvider } from "./types";

/**
 * Provider selection is configuration-driven. Learning and business logic
 * depend only on the interfaces in ./types, so swapping a vendor means adding
 * an adapter here — nothing else changes.
 */

const MESSAGES: Record<FeatureKey, string> = {
  llm: "The AI tutor is not available right now. You can still review lessons and practise with text.",
  stt: "Speech recognition is not available right now. Please type your answer instead.",
  tts: "Generated audio is not available right now.",
  pronunciation: "Pronunciation assessment is not available right now.",
  realtime: "Live voice conversation is not available right now.",
  billing: "Billing is not configured.",
  email: "Email delivery is not configured.",
};

function ensure(feature: FeatureKey) {
  const status = providerAvailability()[feature];
  if (!status.available) {
    throw new AppError("provider_unavailable", MESSAGES[feature], { feature, provider: status.provider });
  }
  return status.provider;
}

export function getLlm(): LlmProvider {
  ensure("llm");
  return new AnthropicLlmProvider(getConfig());
}

export function getStt(): SttProvider {
  return ensure("stt") === "openai" ? new OpenAiSttProvider(getConfig()) : new AzureSttProvider(getConfig());
}

export function getTts(): TtsProvider {
  return ensure("tts") === "openai" ? new OpenAiTtsProvider(getConfig()) : new AzureTtsProvider(getConfig());
}

export function getPronunciation(): PronunciationProvider {
  ensure("pronunciation");
  return new AzurePronunciationProvider(getConfig());
}

export function getRealtime(): RealtimeProvider {
  ensure("realtime");
  return new OpenAiRealtimeProvider(getConfig());
}
