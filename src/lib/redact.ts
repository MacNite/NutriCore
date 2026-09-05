/**
 * Scrubs credential-shaped substrings out of free text.
 *
 * The logger's redaction works on object *keys*, which covers structured
 * context and nothing else. Diagnostics are not structured: `AiJob.errorMessage`,
 * `AiJob.errorDetail` and `AiJobAttempt.message`/`detail` are free strings built
 * from whatever an HTTP client, a model adapter or an upstream service threw,
 * and they are written to the database and shown on the admin page.
 *
 * An undici error naming the request it failed on, a provider quoting the URL it
 * rejected, a misconfiguration error echoing the value it could not parse: any
 * of them can carry an API key in a query string or credentials in a URL. Those
 * strings then persist indefinitely, which is exactly the combination worth
 * avoiding.
 *
 * This is deliberately pattern-based and therefore not a guarantee. It removes
 * the shapes credentials actually take in error text; it is the last line, not
 * the only one - the real protection is that secrets are read from the
 * environment and never interpolated into messages in the first place.
 */

/** Query or form parameters whose value is a credential. */
const SECRET_PARAM = /\b(api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|client[-_]?secret|auth[-_]?token|password|passwd|secret|signature|token|sig)\b(\s*[=:]\s*)(["']?)([^\s"'&,;)}\]]+)/gi;

/** `Authorization: Bearer …`, and the `Basic …` form with it. */
const AUTH_HEADER = /\b(bearer|basic)\s+([A-Za-z0-9._~+/=-]{8,})/gi;

/** Credentials embedded in a URL: `https://user:pass@host`. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

/**
 * Replaces credential-shaped substrings with `[redacted]` and caps the result.
 *
 * The cap matters as much as the redaction: these columns are unbounded strings,
 * and an upstream service is free to answer with a body of any size.
 */
export function redactSecrets(text: string, maxLength = 800): string {
  return text
    .replace(URL_CREDENTIALS, "$1[redacted]:[redacted]@")
    .replace(AUTH_HEADER, "$1 [redacted]")
    .replace(SECRET_PARAM, "$1$2$3[redacted]")
    .slice(0, maxLength);
}

/** Convenience for an optional field, so callers need no ternary of their own. */
export const redactOptional = (text: string | undefined | null, maxLength = 800): string | undefined =>
  text === undefined || text === null ? undefined : redactSecrets(text, maxLength);
