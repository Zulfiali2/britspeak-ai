import "server-only";
import { z } from "zod";

/**
 * Central, validated configuration. Every server module reads configuration
 * through `getConfig()` so that missing or malformed values produce one
 * actionable error instead of failing deep inside a provider call.
 *
 * Optional providers are allowed to be absent: the corresponding feature is
 * reported as unavailable (see `providerAvailability()`), and the UI falls
 * back to text practice.
 */

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true" || v === "1"));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const optionalUrl = optionalString.pipe(z.url().optional());

const intWithDefault = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (PostgreSQL connection string)"),
  APP_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TRUST_PROXY_HEADERS: bool(true),

  REQUIRE_EMAIL_VERIFICATION: bool(true),
  EMAIL_PROVIDER: z.enum(["resend", "console"]).default("console"),
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default("BritSpeak AI <no-reply@example.com>"),

  LLM_PROVIDER: z.enum(["anthropic", "none"]).default("anthropic"),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_BASE_URL: optionalUrl,
  LLM_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  // Server-side refusal fallback (beta). If a request is declined by the
  // primary model's safety classifiers, Anthropic re-runs it on its
  // recommended fallback model inside the same call.
  ANTHROPIC_SERVER_FALLBACK: bool(true),
  AZURE_ENABLE_PROSODY: bool(false),
  LLM_TIMEOUT_MS: intWithDefault(45_000, 5_000, 300_000),

  STT_PROVIDER: z.enum(["azure", "openai", "none"]).default("azure"),
  TTS_PROVIDER: z.enum(["azure", "openai", "none"]).default("azure"),
  PRONUNCIATION_PROVIDER: z.enum(["azure", "none"]).default("azure"),
  REALTIME_PROVIDER: z.enum(["openai", "none"]).default("none"),

  AZURE_SPEECH_KEY: optionalString,
  AZURE_SPEECH_REGION: optionalString,
  AZURE_SPEECH_STT_BASE_URL: optionalUrl,
  AZURE_SPEECH_TTS_BASE_URL: optionalUrl,
  AZURE_TTS_DEFAULT_VOICE: z.string().default("en-GB-SoniaNeural"),

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalUrl,
  OPENAI_STT_MODEL: z.string().default("gpt-4o-transcribe"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: z.string().default("fable"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime"),
  OPENAI_REALTIME_VOICE: z.string().default("marin"),

  SPEECH_TIMEOUT_MS: intWithDefault(20_000, 2_000, 120_000),
  MAX_RECORDING_SECONDS: intWithDefault(45, 5, 60),
  MAX_TTS_CHARACTERS: intWithDefault(600, 50, 3000),
  MAX_TURN_CHARACTERS: intWithDefault(1200, 100, 5000),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PRICE_PRO_MONTHLY: optionalString,
  STRIPE_PRICE_PRO_YEARLY: optionalString,
  STRIPE_PRICE_PREMIUM_MONTHLY: optionalString,
  STRIPE_PRICE_PREMIUM_YEARLY: optionalString,

  PLAN_LIMITS_JSON: optionalString,
  PROVIDER_RATES_JSON: optionalString,
  MONTHLY_BUDGET_ALERT_USD: optionalString
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().positive().optional()),

  CRON_SECRET: optionalString,
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  const config = result.data;
  const problems = productionProblems(config);
  if (config.NODE_ENV === "production" && problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
}

/** Settings that are mandatory for a production deployment. */
export function productionProblems(config: AppConfig): string[] {
  const problems: string[] = [];
  if (!config.APP_URL.startsWith("https://")) {
    problems.push("APP_URL must be an https:// URL in production");
  }
  if (config.EMAIL_PROVIDER === "console") {
    problems.push(
      "EMAIL_PROVIDER=console only logs emails; set EMAIL_PROVIDER=resend and RESEND_API_KEY in production",
    );
  }
  if (config.EMAIL_PROVIDER === "resend" && !config.RESEND_API_KEY) {
    problems.push("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
  }
  if (config.STRIPE_SECRET_KEY && !config.STRIPE_WEBHOOK_SECRET) {
    problems.push("STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set");
  }
  return problems;
}

export function getConfig(): AppConfig {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}

/** For tests only. */
export function resetConfigForTests(): void {
  cached = undefined;
}

export type FeatureKey = "llm" | "stt" | "tts" | "pronunciation" | "realtime" | "billing" | "email";

export interface FeatureAvailability {
  available: boolean;
  provider: string;
  reason?: string;
}

/** Which optional integrations are configured. Never exposes secret values. */
export function providerAvailability(
  config: AppConfig = getConfig(),
): Record<FeatureKey, FeatureAvailability> {
  const azureReady = Boolean(config.AZURE_SPEECH_KEY && config.AZURE_SPEECH_REGION);
  const openaiReady = Boolean(config.OPENAI_API_KEY);

  const speech = (provider: "azure" | "openai" | "none"): FeatureAvailability => {
    if (provider === "none") return { available: false, provider, reason: "Disabled by configuration" };
    if (provider === "azure")
      return azureReady
        ? { available: true, provider }
        : { available: false, provider, reason: "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are not set" };
    return openaiReady
      ? { available: true, provider }
      : { available: false, provider, reason: "OPENAI_API_KEY is not set" };
  };

  return {
    llm:
      config.LLM_PROVIDER === "none"
        ? { available: false, provider: "none", reason: "Disabled by configuration" }
        : config.ANTHROPIC_API_KEY
          ? { available: true, provider: "anthropic" }
          : { available: false, provider: "anthropic", reason: "ANTHROPIC_API_KEY is not set" },
    stt: speech(config.STT_PROVIDER),
    tts: speech(config.TTS_PROVIDER),
    pronunciation:
      config.PRONUNCIATION_PROVIDER === "none"
        ? { available: false, provider: "none", reason: "Disabled by configuration" }
        : azureReady
          ? { available: true, provider: "azure" }
          : {
              available: false,
              provider: "azure",
              reason: "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are not set",
            },
    realtime:
      config.REALTIME_PROVIDER === "none"
        ? { available: false, provider: "none", reason: "Disabled by configuration" }
        : openaiReady
          ? { available: true, provider: "openai" }
          : { available: false, provider: "openai", reason: "OPENAI_API_KEY is not set" },
    billing:
      config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
        ? { available: true, provider: "stripe" }
        : {
            available: false,
            provider: "stripe",
            reason: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are not set",
          },
    email:
      config.EMAIL_PROVIDER === "resend"
        ? config.RESEND_API_KEY
          ? { available: true, provider: "resend" }
          : { available: false, provider: "resend", reason: "RESEND_API_KEY is not set" }
        : { available: true, provider: "console", reason: "Development only: emails are logged" },
  };
}
