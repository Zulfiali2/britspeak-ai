import type { UsageOperation } from "@prisma/client";
import { z } from "zod";

/**
 * Cost estimation. No prices are hard-coded: operators enter the provider
 * rates that apply to their contract in PROVIDER_RATES_JSON (see
 * docs/cost-model.md). When no rate is configured the cost is `null`
 * ("unknown"), never a guessed number.
 *
 * Rates are USD per unit, keyed by "<provider>:<operation>" with an optional
 * ":<model>" suffix for model-specific rates, e.g.
 *   { "azure:STT": { "perUnit": 0.000278, "unitType": "seconds" },
 *     "anthropic:LLM:claude-opus-5-5": { "perInputToken": 0.000004, "perOutputToken": 0.00002 } }
 */
const rateSchema = z.object({
  unitType: z.string().optional(),
  perUnit: z.number().nonnegative().optional(),
  perInputToken: z.number().nonnegative().optional(),
  perOutputToken: z.number().nonnegative().optional(),
});
export const ratesSchema = z.record(z.string(), rateSchema);
export type ProviderRates = z.infer<typeof ratesSchema>;

export function parseRates(json?: string): ProviderRates {
  if (!json) return {};
  return ratesSchema.parse(JSON.parse(json));
}

export interface UsageQuantity {
  provider: string;
  operation: UsageOperation;
  model?: string | null;
  units: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/** Returns micro-USD (integer) or null when the rate is unknown. */
export function estimateCostMicros(rates: ProviderRates, usage: UsageQuantity): number | null {
  const base = `${usage.provider}:${usage.operation}`;
  const rate = (usage.model ? rates[`${base}:${usage.model}`] : undefined) ?? rates[base];
  if (!rate) return null;
  let usd = 0;
  let priced = false;
  if (rate.perInputToken !== undefined && usage.inputTokens != null) {
    usd += rate.perInputToken * usage.inputTokens;
    priced = true;
  }
  if (rate.perOutputToken !== undefined && usage.outputTokens != null) {
    usd += rate.perOutputToken * usage.outputTokens;
    priced = true;
  }
  if (rate.perUnit !== undefined) {
    usd += rate.perUnit * usage.units;
    priced = true;
  }
  return priced ? Math.round(usd * 1_000_000) : null;
}

export function microsToUsd(micros: number | null | undefined): number | null {
  return micros == null ? null : micros / 1_000_000;
}
