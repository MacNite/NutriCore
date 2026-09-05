/**
 * Turns whatever a job threw into something an administrator can act on.
 *
 * The worker used to store `error.message` and nothing else, which is how a
 * connection refused, a DNS failure and a request that ran past the HTTP client's
 * own deadline all ended up in the log as the same three words: "Ollama request
 * failed". The real cause is always one level further down the `cause` chain, so
 * that chain is flattened here and classified into a small, stable set of kinds.
 *
 * Pure on purpose: no Prisma, no fetch, no environment. The worker records what
 * this returns, the admin page renders it, and both can be tested without either.
 */

export type AiFailureKind =
  | "MODEL_TIMEOUT"
  | "MODEL_UNREACHABLE"
  | "MODEL_MISSING"
  | "MODEL_HTTP_ERROR"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_TRUNCATED"
  | "MODEL_VISION_UNSUPPORTED"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_BLOCKED"
  | "SOURCE_UNAVAILABLE"
  | "SEARCH_UNAVAILABLE"
  | "RESEARCH_NOT_PERMITTED"
  | "RATE_LIMITED"
  | "DATA_MISSING"
  | "IMAGE_UNREADABLE"
  | "CONFIG_INVALID"
  | "UNKNOWN";

export const AI_FAILURE_KINDS: AiFailureKind[] = [
  "MODEL_TIMEOUT",
  "MODEL_UNREACHABLE",
  "MODEL_MISSING",
  "MODEL_HTTP_ERROR",
  "MODEL_OUTPUT_INVALID",
  "MODEL_OUTPUT_TRUNCATED",
  "MODEL_VISION_UNSUPPORTED",
  "SOURCE_TOO_LARGE",
  "SOURCE_BLOCKED",
  "SOURCE_UNAVAILABLE",
  "SEARCH_UNAVAILABLE",
  "RESEARCH_NOT_PERMITTED",
  "RATE_LIMITED",
  "DATA_MISSING",
  "IMAGE_UNREADABLE",
  "CONFIG_INVALID",
  "UNKNOWN",
];

/**
 * Kinds that will fail again for exactly the same reason on the next attempt.
 * A page that is too large stays too large; a blocked address stays blocked.
 * Retrying those only delays every other job behind them in the queue.
 */
const PERMANENT: ReadonlySet<AiFailureKind> = new Set<AiFailureKind>([
  "SOURCE_TOO_LARGE",
  "SOURCE_BLOCKED",
  "DATA_MISSING",
  "MODEL_MISSING",
  "MODEL_VISION_UNSUPPORTED",
  // Bytes that could not be decoded once decode identically the next time.
  "IMAGE_UNREADABLE",
  // A missing or malformed setting is the same on every attempt, and burning the
  // retry budget on it only delays every other job behind it.
  "CONFIG_INVALID",
  // A switch that is off, or consent that was not given, is a decision rather
  // than a fault: it will read the same on every attempt until somebody changes
  // it, and retrying only hides it behind two more failures.
  "RESEARCH_NOT_PERMITTED",
]);

export const isPermanentFailure = (kind: AiFailureKind) => PERMANENT.has(kind);

/** Node/undici codes that mean "no answer in time" rather than "no route". */
const TIMEOUT_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "ETIMEDOUT",
  "ERR_CANCELED",
]);

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown; issues?: unknown };

/**
 * Walks `cause` to the bottom. Node's `fetch` reports every transport problem as
 * a bare `TypeError: fetch failed` and puts the useful part underneath, so the
 * whole chain has to be read, not just the top frame.
 */
export function causeChain(error: unknown, limit = 6): { name: string; message: string; code?: string }[] {
  const chain: { name: string; message: string; code?: string }[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && chain.length < limit && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "string") {
      chain.push({ name: "Error", message: current });
      break;
    }
    if (typeof current !== "object") break;
    const like = current as ErrorLike;
    const name = typeof like.name === "string" ? like.name : "Error";
    const message = typeof like.message === "string" ? like.message : "";
    const code = typeof like.code === "string" ? like.code : undefined;
    if (message || code) chain.push({ name, message, code });
    current = like.cause;
  }

  return chain;
}

/** `TypeError: fetch failed → Error: connect ECONNREFUSED 10.8.0.4:11434 (ECONNREFUSED)` */
export function formatChain(chain: { name: string; message: string; code?: string }[]) {
  return chain
    .map((frame) => `${frame.name}: ${frame.message}${frame.code ? ` (${frame.code})` : ""}`)
    .join(" → ")
    .slice(0, 800);
}

export interface FailureDescription {
  kind: AiFailureKind;
  /** Short line kept on the job, unchanged from `error.message` where present. */
  message: string;
  /** The flattened cause chain: the part that names the actual problem. */
  detail?: string;
  /** True when another attempt cannot plausibly succeed. */
  permanent: boolean;
}

export function describeFailure(error: unknown): FailureDescription {
  const chain = causeChain(error);
  const top = chain[0];
  const message = (top?.message || "AI processing failed").slice(0, 500);
  const detail = chain.length > 1 || top?.code ? formatChain(chain) : undefined;
  const kind = classify(error, chain, message);
  return { kind, message, detail, permanent: isPermanentFailure(kind) };
}

function classify(
  error: unknown,
  chain: { name: string; message: string; code?: string }[],
  message: string,
): AiFailureKind {
  const named = (error as ErrorLike | null)?.name;
  const codes = chain.map((frame) => frame.code).filter((code): code is string => Boolean(code));
  const names = chain.map((frame) => frame.name);
  const text = chain.map((frame) => `${frame.name} ${frame.message}`).join(" ");

  // Structured-output rejection is reported by the adapter as its own class, and
  // the message already carries the failing paths.
  if (named === "AIVisionUnsupportedError") return "MODEL_VISION_UNSUPPORTED";
  if (named === "AIOutputTruncatedError" || /output was cut off/i.test(message)) return "MODEL_OUTPUT_TRUNCATED";
  if (named === "AIInvalidOutputError" || /failed validation/i.test(message)) return "MODEL_OUTPUT_INVALID";

  // Named before the generic checks: the message quotes the offending variable.
  if (/Invalid environment configuration/i.test(message)) return "CONFIG_INVALID";
  // Named before them too, so the "not found" catch-all below cannot claim it.
  if (/^research-not-permitted:/.test(message)) return "RESEARCH_NOT_PERMITTED";

  if (/^unsafe-source:/.test(message)) return "SOURCE_BLOCKED";
  if (message === "source-too-large") return "SOURCE_TOO_LARGE";
  if (["source-redirect-limit", "source-unsupported-content", "source-no-ingredients"].includes(message) || /^source-http-/.test(message)) return "SOURCE_UNAVAILABLE";
  if (/rate limit/i.test(message)) return "RATE_LIMITED";
  if (/source search unavailable/i.test(message)) return "SEARCH_UNAVAILABLE";
  if (named === "BodyScanImageError") return "IMAGE_UNREADABLE";
  // A scan reads its images once and clears them with the result, so a second
  // attempt has nothing left to read: this is permanent by construction.
  if (["scan-not-found", "scan-images-gone"].includes(message)) return "DATA_MISSING";
  if (/not found|no diary target|Unsupported AI job entity/i.test(message)) return "DATA_MISSING";
  if (/is not available/i.test(message)) return "MODEL_MISSING";

  // An HTTP status from Ollama is a different problem than not reaching it.
  if (/responded with \d{3}/.test(message)) return "MODEL_HTTP_ERROR";

  if (codes.some((code) => TIMEOUT_CODES.has(code))) return "MODEL_TIMEOUT";
  if (names.includes("TimeoutError") || names.includes("AbortError")) return "MODEL_TIMEOUT";
  if (/timeout|timed out|aborted/i.test(text)) return "MODEL_TIMEOUT";

  if (codes.some((code) => CONNECTION_CODES.has(code))) return "MODEL_UNREACHABLE";
  if (named === "AIUnavailableError" || /fetch failed|unreachable|request failed/i.test(text))
    return "MODEL_UNREACHABLE";

  return "UNKNOWN";
}
