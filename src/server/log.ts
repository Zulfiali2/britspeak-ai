import "server-only";

/**
 * Structured JSON logger. One line per event so any log drain (Vercel, Datadog,
 * Better Stack, CloudWatch) can index fields.
 *
 * Never log: raw audio, passwords, tokens, provider secrets, full transcripts.
 * Keys matching SENSITIVE_KEYS are redacted defensively.
 */

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEYS =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|audio|transcript|text|email/i;

function threshold(): number {
  const level = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return ORDER[level] ?? ORDER.info;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // Lengths/counts are useful and safe; values are not.
      if (SENSITIVE_KEYS.test(key) && !/(length|count|chars|status|id)$/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold() || process.env.LOG_SILENT === "true") return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as Record<string, unknown>),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
