package app.nutricore.sync

/**
 * Turning what somebody pasted into something that can be called.
 *
 * The settings page shows the whole endpoint under a new token, and that is
 * what most people will paste. Some will paste the address of their instance
 * instead, because that is the thing they know. Both are unambiguous, so both
 * are accepted rather than answered with a validation error about a suffix.
 */

private const val SYNC_PATH = "/api/health/samples"

fun normaliseSyncUrl(entered: String): String {
    val trimmed = entered.trim().trimEnd('/')
    if (trimmed.isEmpty()) return ""

    val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
    return if (withScheme.endsWith(SYNC_PATH)) withScheme else withScheme + SYNC_PATH
}

/**
 * Whether a string could be a sync token.
 *
 * Only a shape check, and it exists for one reason: a token pasted with a
 * trailing newline or half-selected fails with the same 401 as a revoked one,
 * and that is a miserable thing to debug on a phone. The server decides whether
 * the token is real.
 */
fun tokenLooksValid(token: String): Boolean = Regex("^nch_[A-Za-z0-9_-]{43}$").matches(token.trim())
