import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : value === "true" || value === "1"));

const schema = z.object({
  APP_URL: z.string().default("http://localhost:3000"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  DEFAULT_LOCALE: z.enum(["de", "en"]).default("de"),
  OPENFOODFACTS_ENABLED: bool(true),
  OPENFOODFACTS_BASE_URL: z.string().default("https://world.openfoodfacts.org"),
  OPENFOODFACTS_USER_AGENT: z.string().default("NutriCore/0.1 (self-hosted)"),
  OPENFOODFACTS_SEARCH_URL: z.string().default("https://search.openfoodfacts.org"),
  OPENFOODFACTS_SEARCH_BACKEND: z.enum(["search-a-licious", "legacy"]).default("search-a-licious"),
  USDA_ENABLED: bool(false),
  USDA_API_KEY: z.string().optional(),
  AI_ENABLED: bool(true),
  AI_PROVIDER: z.string().default("ollama"),
  // Always present: resolved by `resolveAiBaseUrl`/`resolveAiModel` below.
  AI_BASE_URL: z.string(),
  AI_MODEL: z.string(),
  AI_FALLBACK_MODEL: z.string().optional(),
  AI_CONFIDENCE_THRESHOLD: z.enum(["high", "medium", "low"]).default("medium"),
  SEARXNG_URL: z.string().optional(),
  SEARXNG_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  INVITATION_EXPIRY_HOURS: z.coerce.number().positive().default(48),
  OLLAMA_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(600),
  RESEARCH_ENABLED: bool(false),
  RESEARCH_PROVIDER: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const AI_BASE_URL_DEFAULT = "http://ollama:11434";
export const AI_MODEL_DEFAULT = "qwen3.5:4b";

const configured = (...values: (string | undefined)[]) => values.map((value) => value?.trim()).find(Boolean);

/**
 * Where the model lives is decided here and nowhere else. `OLLAMA_BASE_URL` and
 * `OLLAMA_MODEL` are the superseded spelling, still honoured so an existing
 * deployment keeps working; no other module reads them, which is what used to
 * let the diagnostics page and the AI client disagree about the same instance.
 */
export const resolveAiBaseUrl = (source: Record<string, string | undefined> = process.env) =>
  configured(source.AI_BASE_URL, source.OLLAMA_BASE_URL) ?? AI_BASE_URL_DEFAULT;

export const resolveAiModel = (source: Record<string, string | undefined> = process.env) =>
  configured(source.AI_MODEL, source.OLLAMA_MODEL) ?? AI_MODEL_DEFAULT;

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Parsed once per process. Secrets are read here and never re-exported, so no
 * caller can enumerate `process.env`.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({ ...process.env, AI_BASE_URL: resolveAiBaseUrl(), AI_MODEL: resolveAiModel() });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when a secret is configured, without ever revealing the value. */
export const hasSecret = (name: string) => Boolean(process.env[name]?.trim());
