const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const SECRET_KEY = /(secret|password|token|api_?key|authorization|cookie)/i;

/** Redacts anything that looks like a credential before it can reach stdout. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SECRET_KEY.test(key) ? "[redacted]" : redact(inner),
      ]),
    );
  }
  return value;
}

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  const configured = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  if (LEVELS[level] < (LEVELS[configured] ?? LEVELS.info)) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...(redact(context ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
