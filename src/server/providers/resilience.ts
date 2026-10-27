import "server-only";
import { ProviderError, type ProviderFailure } from "./types";

/**
 * Per-instance circuit breaker. After `threshold` consecutive failures the
 * circuit opens for `cooldownMs`, failing fast instead of piling more paid,
 * slow calls onto a provider that is down.
 */
interface BreakerState {
  failures: number;
  openUntil: number;
}
const breakers = new Map<string, BreakerState>();
const THRESHOLD = 5;
const COOLDOWN_MS = 30_000;

export function breakerStatus(key: string): "closed" | "open" {
  const state = breakers.get(key);
  return state && state.openUntil > Date.now() ? "open" : "closed";
}

function recordSuccess(key: string) {
  breakers.set(key, { failures: 0, openUntil: 0 });
}

function recordFailure(key: string) {
  const state = breakers.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= THRESHOLD) state.openUntil = Date.now() + COOLDOWN_MS;
  breakers.set(key, state);
}

export function resetBreakersForTests() {
  breakers.clear();
}

export interface ResilienceOptions {
  provider: string;
  operation: string;
  timeoutMs: number;
  /** Only idempotent calls should retry. */
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Run a provider call with a timeout, exponential-backoff retries on
 * retryable failures (429/5xx/network/timeout) and the circuit breaker.
 */
export async function callProvider<T>(
  options: ResilienceOptions,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<{ value: T; latencyMs: number; retries: number }> {
  const key = `${options.provider}:${options.operation}`;
  if (breakerStatus(key) === "open") {
    throw new ProviderError(options.provider, "circuit_open", `${options.provider} is temporarily unavailable`, false);
  }
  const maxRetries = options.maxRetries ?? 1;
  const baseDelay = options.baseDelayMs ?? 400;
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const value = await fn(controller.signal);
      recordSuccess(key);
      return { value, latencyMs: Date.now() - started, retries: attempt };
    } catch (raw) {
      const error = toProviderError(options.provider, raw, controller.signal.aborted);
      if (error.retryable && attempt < maxRetries) {
        attempt += 1;
        const jitter = Math.random() * baseDelay;
        await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1) + jitter));
        continue;
      }
      if (error.category !== "bad_request" && error.category !== "refused") recordFailure(key);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function toProviderError(provider: string, raw: unknown, timedOut = false): ProviderError {
  if (raw instanceof ProviderError) return raw;
  if (timedOut) return new ProviderError(provider, "timeout", `${provider} did not respond in time`, true);
  const message = raw instanceof Error ? raw.message : String(raw);
  return new ProviderError(provider, "network", message.slice(0, 200), true);
}

export function categoryForStatus(status: number): { category: ProviderFailure; retryable: boolean } {
  if (status === 401 || status === 403) return { category: "auth", retryable: false };
  if (status === 429) return { category: "rate_limited", retryable: true };
  if (status === 408) return { category: "timeout", retryable: true };
  if (status >= 500) return { category: "unavailable", retryable: true };
  return { category: "bad_request", retryable: false };
}

export function httpError(provider: string, status: number, detail?: string): ProviderError {
  const { category, retryable } = categoryForStatus(status);
  return new ProviderError(
    provider,
    category,
    `${provider} returned HTTP ${status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
    retryable,
    status,
  );
}
