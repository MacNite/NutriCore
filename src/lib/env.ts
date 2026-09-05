import { z } from "zod";

/** The one reading of a boolean switch, shared by the schema and `flag()`. */
const readBool = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === "" ? fallback : value === "true" || value === "1";

const bool = (fallback: boolean) => z.string().optional().transform((value) => readBool(value, fallback));

/**
 * Reads one switch without parsing the whole configuration.
 *
 * `env()` validates everything at once, `APP_SECRET` included. The worker signs
 * no sessions and has no use for that secret, so making it read one boolean
 * through the full schema meant a deployment that gave the secret only to the web
 * process failed every quick meal with "APP_SECRET: expected string, received
 * undefined" - after the model call had already succeeded.
 *
 * Same reading as the schema, because both go through `readBool`.
 */
export type BooleanFlag =
  | "RESEARCH_ENABLED"
  | "AI_ENABLED"
  | "OPENFOODFACTS_ENABLED"
  | "BLS_ENABLED"
  | "USDA_ENABLED"
  | "FATSECRET_ENABLED";

export const flag = (name: BooleanFlag, fallback: boolean) => readBool(process.env[name], fallback);

/** Whether this deployment allows fetching pages from the open web at all. */
export const researchEnabled = () => flag("RESEARCH_ENABLED", false);

/**
 * Who may create an account without an invitation.
 *
 * `bootstrap` is the default and the only one most deployments want: the very
 * first account can be created from the sign-up page and becomes the
 * administrator, and every account after it has to be invited. `open` is the
 * explicit opt-in for a deployment that really does want public sign-up, and
 * `disabled` refuses self-registration outright, including the first account,
 * for an instance whose administrator is provisioned some other way.
 *
 * There is deliberately no separate "invite" mode: `bootstrap` already becomes
 * invitation-only the moment the first account exists, and a mode that closed
 * registration before any administrator existed would lock the operator out of
 * their own new instance.
 */
export const REGISTRATION_MODES = ["bootstrap", "open", "disabled"] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/**
 * Read on its own rather than through `env()`, for the same reason as `flag()`:
 * the registration policy must be answerable without every other setting - and
 * without `APP_SECRET` - being valid. An unrecognised value falls back to the
 * safest mode rather than to the most permissive one.
 */
export function registrationMode(value = process.env.REGISTRATION_MODE): RegistrationMode {
  const normalized = value?.trim().toLowerCase();
  return REGISTRATION_MODES.find((mode) => mode === normalized) ?? "bootstrap";
}

const schema = z.object({
  APP_URL: z.string().default("http://localhost:3000"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  DEFAULT_LOCALE: z.enum(["de", "en"]).default("de"),
  OPENFOODFACTS_ENABLED: bool(true),
  OPENFOODFACTS_BASE_URL: z.string().default("https://world.openfoodfacts.org"),
  OPENFOODFACTS_USER_AGENT: z.string().default("NutriCore/0.1 (self-hosted)"),
  OPENFOODFACTS_SEARCH_URL: z.string().default("https://search.openfoodfacts.org"),
  OPENFOODFACTS_SEARCH_BACKEND: z.enum(["search-a-licious", "legacy"]).default("search-a-licious"),
  /**
   * BLS 4.0 is bundled with the application and answers from PostgreSQL, so it
   * is on unless a deployment turns it off. It needs no credentials and makes
   * no network request.
   */
  BLS_ENABLED: bool(true),
  /**
   * USDA FoodData Central. Also bundled - the Foundation and SR Legacy
   * downloads are imported locally - which is why this now defaults to on
   * where it used to default to off. The *API* half additionally needs
   * USDA_API_KEY and stays unavailable without one.
   */
  USDA_ENABLED: bool(true),
  USDA_API_KEY: z.string().optional(),
  USDA_BASE_URL: z.string().default("https://api.nal.usda.gov/fdc/v1"),
  /**
   * FatSecret is an optional external fallback. Off by default and never
   * required: an installation that configures nothing here behaves exactly as
   * it did before the provider existed.
   */
  FATSECRET_ENABLED: bool(false),
  FATSECRET_CLIENT_ID: z.string().optional(),
  FATSECRET_CLIENT_SECRET: z.string().optional(),
  /** Premier-plan localisation. Left empty on a basic plan. */
  FATSECRET_REGION: z.string().optional(),
  FATSECRET_LANGUAGE: z.string().optional(),
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
  /** Hard ceiling on generated tokens; see `ollamaMaxOutputTokens`. */
  OLLAMA_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2048),
  RESEARCH_ENABLED: bool(false),
  RESEARCH_PROVIDER: z.string().optional(),
  REGISTRATION_MODE: z.enum(REGISTRATION_MODES).default("bootstrap"),
  /**
   * How many reverse proxies sit in front of this deployment. See `clientKey`
   * in `auth-actions`: 0 means `X-Forwarded-For` is not trusted at all, which
   * is correct for the default Compose stack that publishes its own port.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
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

/**
 * Refuses to start a production deployment whose `APP_URL` is neither HTTPS nor
 * local.
 *
 * `Secure` on the session cookie is derived from `APP_URL`, which is the right
 * trade for a self-hosted instance on a plain-HTTP LAN - it has to be able to
 * sign in at all. The failure mode is a public HTTPS deployment whose `APP_URL`
 * was left at its `http://localhost:3000` default: everything works, and the
 * session cookie quietly loses `Secure` and travels wherever the browser is
 * willing to send it. Nothing anywhere said so.
 *
 * A loopback or private-range host is still allowed over plain HTTP, because
 * that is the deployment the trade-off exists for. `ALLOW_INSECURE_APP_URL=true`
 * is the escape hatch for anything else, e.g. TLS terminated by a sidecar that
 * the app cannot see.
 */
export function assertSecureDeployment(source: Record<string, string | undefined> = process.env) {
  if (source.NODE_ENV !== "production") return;
  if (source.ALLOW_INSECURE_APP_URL === "true") return;

  const raw = source.APP_URL ?? "http://localhost:3000";
  if (raw.startsWith("https://")) return;

  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error(`APP_URL is not a valid URL: ${raw}`);
  }

  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (local) return;

  throw new Error(
    `APP_URL is ${raw}, which is neither HTTPS nor a local address. The session cookie's Secure flag is derived ` +
      "from it, so this deployment would issue session cookies over plain HTTP to a public host. Set an https:// " +
      "APP_URL, or set ALLOW_INSECURE_APP_URL=true if TLS is terminated somewhere this application cannot see.",
  );
}

/** True when a secret is configured, without ever revealing the value. */
export const hasSecret = (name: string) => Boolean(process.env[name]?.trim());
