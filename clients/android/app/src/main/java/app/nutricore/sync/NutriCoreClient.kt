package app.nutricore.sync

import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

/**
 * The two calls this client makes, and what it does about being told no.
 *
 * Everything is blocking; callers are expected to already be off the main
 * thread. `SyncRunner` is the only caller and runs on `Dispatchers.IO`.
 */

/** How many samples go in one request. The endpoint allows 50 000. */
private const val BATCH = 2_000

private const val CONNECT_TIMEOUT_MS = 15_000
private const val READ_TIMEOUT_MS = 60_000

data class Totals(val create: Int, val update: Int, val skipManual: Int, val unchanged: Int) {
    operator fun plus(other: Totals) =
        Totals(create + other.create, update + other.update, skipManual + other.skipManual, unchanged + other.unchanged)

    companion object {
        val NONE = Totals(0, 0, 0, 0)
    }
}

/**
 * What came back, in the four shapes a caller can actually act on.
 *
 * The distinction that matters is between `Unreachable` and `Refused`: one is
 * worth trying again in an hour and the other will be refused identically until
 * somebody changes something. A client that retried a 422 on a schedule would
 * spend its rate limit discovering that it is still wrong.
 */
sealed interface Reply<out T> {
    data class Ok<T>(val value: T) : Reply<T>

    /** Absent, malformed, revoked, or the account was deactivated. Stop. */
    data object Unauthorised : Reply<Nothing>

    data class RateLimited(val retryAfterSeconds: Long) : Reply<Nothing>

    /** 413 or 422: this payload is wrong and will stay wrong. */
    data class Refused(val status: Int, val error: String) : Reply<Nothing>

    /** No answer, or one from a server having a bad day. Try later. */
    data class Unreachable(val reason: String) : Reply<Nothing>
}

class NutriCoreClient(private val endpoint: String, private val token: String) {

    /**
     * Where to resume from, per metric.
     *
     * The dates are inclusive - they name the last day already imported, not
     * the day after - so a reader starts at the beginning of that day and lets
     * the server recognise what it already has. Somebody who weighs themselves
     * in the morning and again at night would otherwise lose the second
     * reading forever.
     */
    fun cursor(): Reply<Map<String, String?>> =
        request("GET", null) { body ->
            val metrics = body.optJSONArray("metrics") ?: JSONArray()
            buildMap {
                for (index in 0 until metrics.length()) {
                    val entry = metrics.getJSONObject(index)
                    put(entry.getString("metric"), if (entry.isNull("latestDate")) null else entry.getString("latestDate"))
                }
            }
        }

    /**
     * Send samples, in batches, stopping at the first refusal.
     *
     * Stopping matters: the batches after a 401 would all get the same 401, and
     * the unknown-token limiter counts every one of them.
     */
    fun send(samples: List<Sample>, dryRun: Boolean): Reply<Totals> {
        var totals = Totals.NONE

        for (batch in samples.chunked(BATCH)) {
            val payload = JSONObject()
                .put("dryRun", dryRun)
                .put("samples", JSONArray().apply { batch.forEach { put(it.toJson()) } })

            when (val reply = request("POST", payload) { body -> body.getJSONObject("totals").toTotals() }) {
                is Reply.Ok -> totals += reply.value
                else -> return reply
            }
        }

        return Reply.Ok(totals)
    }

    private fun <T> request(method: String, payload: JSONObject?, read: (JSONObject) -> T): Reply<T> {
        val connection: HttpURLConnection
        try {
            connection = URL(endpoint).openConnection() as HttpURLConnection
        } catch (error: Exception) {
            return Reply.Unreachable(error.message ?: "The address could not be opened")
        }

        try {
            connection.requestMethod = method
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")

            if (payload != null) {
                val bytes = payload.toString().toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                /* Declare the length rather than letting Android choose chunked
                   encoding: the endpoint refuses an oversized body by reading
                   `Content-Length` before it buffers anything, and a chunked
                   request is one it has to take on trust. */
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }

            val status = connection.responseCode
            val body = (if (status in 200..299) connection.inputStream else connection.errorStream)?.readText().orEmpty()

            return when {
                status in 200..299 -> try {
                    Reply.Ok(read(JSONObject(body)))
                } catch (error: Exception) {
                    Reply.Unreachable("The server answered with something that was not the expected JSON")
                }

                status == 401 -> Reply.Unauthorised
                status == 429 -> Reply.RateLimited(retryAfter(connection, body))
                status == 413 || status == 422 -> Reply.Refused(status, errorCode(body))
                else -> Reply.Unreachable("HTTP $status")
            }
        } catch (error: IOException) {
            return Reply.Unreachable(error.message ?: "The server could not be reached")
        } finally {
            connection.disconnect()
        }
    }

    /** `Retry-After` if the server sent one, else the body's own figure, else a minute. */
    private fun retryAfter(connection: HttpURLConnection, body: String): Long {
        connection.getHeaderField("Retry-After")?.toLongOrNull()?.let { return it.coerceAtLeast(1) }
        return runCatching { JSONObject(body).getLong("retryAfterSeconds") }.getOrDefault(60L).coerceAtLeast(1)
    }

    private fun errorCode(body: String): String =
        runCatching { JSONObject(body).getString("error") }.getOrDefault("unknown")
}

private fun InputStream.readText(): String = bufferedReader(Charsets.UTF_8).use { it.readText() }

private fun JSONObject.toTotals() =
    Totals(optInt("create"), optInt("update"), optInt("skipManual"), optInt("unchanged"))
