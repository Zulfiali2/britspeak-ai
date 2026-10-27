import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "@/server/config/env";
import { callProvider, httpError } from "../resilience";
import { ProviderError, type LlmJsonRequest, type LlmJsonResult, type LlmProvider } from "../types";

/**
 * Claude adapter using structured outputs (`output_config.format`) so every
 * response is JSON that matches the requested schema; it is still validated
 * with zod before use.
 *
 * - Thinking is adaptive on current Opus models; `effort` keeps tutoring
 *   replies fast and inexpensive (LLM_EFFORT, default "low").
 * - `fallbacks: "default"` (beta) re-runs a request on Anthropic's recommended
 *   fallback model if the primary model declines it.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly config: AppConfig) {
    this.model = config.ANTHROPIC_MODEL;
    this.client = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
      baseURL: config.ANTHROPIC_BASE_URL,
      timeout: config.LLM_TIMEOUT_MS,
      // Retries are owned by callProvider so they are counted and metered.
      maxRetries: 0,
    });
  }

  async generateJson<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const { value, latencyMs, retries } = await callProvider(
      { provider: this.id, operation: "messages", timeoutMs: this.config.LLM_TIMEOUT_MS, maxRetries: 2 },
      async (signal) => {
        try {
          return await this.client.beta.messages.create(
            {
              model: this.model,
              max_tokens: request.maxTokens,
              system: request.system,
              messages: request.messages,
              output_config: {
                effort: this.config.LLM_EFFORT,
                format: { type: "json_schema", schema: request.jsonSchema },
              },
              ...(this.config.ANTHROPIC_SERVER_FALLBACK
                ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
                : {}),
            },
            { signal },
          );
        } catch (error) {
          if (error instanceof Anthropic.APIError && typeof error.status === "number") {
            throw httpError(this.id, error.status, error.message);
          }
          throw error;
        }
      },
    );

    if (value.stop_reason === "refusal") {
      throw new ProviderError(this.id, "refused", "The language model declined this request.", false);
    }
    if (value.stop_reason === "max_tokens") {
      throw new ProviderError(this.id, "invalid_response", "The model response was cut off.", false);
    }
    const text = value.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProviderError(this.id, "invalid_response", "The model did not return valid JSON.", false);
    }
    const result = request.validator.safeParse(parsed);
    if (!result.success) {
      throw new ProviderError(this.id, "invalid_response", "The model response failed validation.", false);
    }
    return {
      data: result.data,
      model: value.model,
      inputTokens:
        value.usage.input_tokens +
        (value.usage.cache_read_input_tokens ?? 0) +
        (value.usage.cache_creation_input_tokens ?? 0),
      outputTokens: value.usage.output_tokens,
      latencyMs,
      retries,
    };
  }
}
