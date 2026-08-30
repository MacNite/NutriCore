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
  USDA_ENABLED: bool(false),
  USDA_API_KEY: z.string().optional(),
  AI_ENABLED: bool(true),
  AI_PROVIDER: z.string().default("ollama"),
  OLLAMA_BASE_URL: z.string().default("http://ollama:11434"),
  OLLAMA_MODEL: z.string().default("deepseek-r1"),
  RESEARCH_ENABLED: bool(false),
  RESEARCH_PROVIDER: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Parsed once per process. Secrets are read here and never re-exported, so no
 * caller can enumerate `process.env`.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when a secret is configured, without ever revealing the value. */
export const hasSecret = (name: string) => Boolean(process.env[name]?.trim());
