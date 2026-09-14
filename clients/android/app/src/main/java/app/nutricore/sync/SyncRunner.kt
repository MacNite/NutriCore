package app.nutricore.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * One sync, from cursor to totals.
 *
 * The shape is the one `docs/HEALTH_SYNC.md` asks of any client: ask where to
 * resume, read from there, convert, collapse to one reading per day, send, and
 * do something sensible about the answer. The endpoint is idempotent, so the
 * worst this can do by running twice is waste a request.
 */

/**
 * How far back to read when the server has nothing for a metric yet.
 *
 * Health Connect gives an app the last 30 days unless it holds the history
 * permission, so asking for ten years without it is not a bigger sync, just a
 * failed one. Ten years with it is past any real history and stays inside a
 * single request once the day collapse has run.
 */
private const val BACKFILL_DAYS_WITH_HISTORY = 3650L
private const val BACKFILL_DAYS_WITHOUT_HISTORY = 30L

sealed interface SyncReport {
    /** Everything that could be sent was sent, or planned when `dryRun`. */
    data class Done(val totals: Totals, val sent: Int, val dryRun: Boolean) : SyncReport

    data object NothingToSend : SyncReport

    /** No endpoint, no token, or no Health Connect on this phone. */
    data class NeedsSetup(val reason: String) : SyncReport

    data class NeedsPermission(val reason: String) : SyncReport

    /** The server said no in a way that will not change on its own. */
    data class Stopped(val reason: String) : SyncReport

    data class TryLater(val reason: String) : SyncReport
}

/** One line, for the setup screen and for a notification that has to fit. */
fun SyncReport.summary(): String = when (this) {
    is SyncReport.Done -> {
        val prefix = if (dryRun) "Dry run: " else ""
        prefix + "$sent sent - ${totals.create} new, ${totals.update} updated, " +
            "${totals.unchanged} already known, ${totals.skipManual} left alone (entered by hand)"
    }

    SyncReport.NothingToSend -> "Nothing new to send"
    is SyncReport.NeedsSetup -> reason
    is SyncReport.NeedsPermission -> reason
    is SyncReport.Stopped -> reason
    is SyncReport.TryLater -> reason
}

class SyncRunner(private val context: Context) {

    suspend fun run(dryRun: Boolean? = null): SyncReport = withContext(Dispatchers.IO) {
        val settings = SyncSettings(context)
        if (!settings.configured) return@withContext SyncReport.NeedsSetup("Add the sync address and token first")

        when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> Unit
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                return@withContext SyncReport.NeedsSetup("Health Connect needs updating before it can be read")

            else -> return@withContext SyncReport.NeedsSetup("Health Connect is not available on this phone")
        }

        val healthConnect = HealthConnectClient.getOrCreate(context)
        val granted = healthConnect.permissionController.getGrantedPermissions()
        if (!granted.containsAll(READ_PERMISSIONS)) {
            return@withContext SyncReport.NeedsPermission("Health Connect has not granted access to weight, body fat and height")
        }

        val api = NutriCoreClient(settings.endpoint, settings.token)

        val cursor = when (val reply = api.cursor()) {
            is Reply.Ok -> reply.value
            else -> return@withContext reply.asReport()
        }

        val now = Instant.now()
        val backfill = if (granted.contains(PERMISSION_HISTORY)) BACKFILL_DAYS_WITH_HISTORY else BACKFILL_DAYS_WITHOUT_HISTORY
        val reader = HealthConnectReader(healthConnect)

        val samples = mutableListOf<Sample>()
        for (metric in Metric.entries) {
            val from = resumeFrom(cursor[metric.key], now, backfill)
            try {
                samples += reader.read(metric, from, now)
            } catch (denied: SecurityException) {
                /* Reading in the background is a permission of its own, and the
                   only way to discover it is missing is to be refused. */
                return@withContext SyncReport.NeedsPermission(
                    "Health Connect refused the read. Grant \"Access data in the background\" under Additional access",
                )
            }
        }

        val collapsed = lastPerDay(samples)
        if (collapsed.isEmpty()) return@withContext SyncReport.NothingToSend

        when (val reply = api.send(collapsed, dryRun ?: settings.dryRun)) {
            is Reply.Ok -> SyncReport.Done(reply.value, collapsed.size, dryRun ?: settings.dryRun)
            else -> reply.asReport()
        }
    }

    /**
     * Where to start reading one metric.
     *
     * The cursor date is the last day already imported and is inclusive, so
     * this starts at the beginning of that day rather than after it. Somebody
     * who weighs themselves twice in a day would otherwise lose the second
     * reading permanently, and re-reading a day costs nothing: the server
     * recognises what it already has.
     */
    private fun resumeFrom(latestDate: String?, now: Instant, backfillDays: Long): Instant {
        val zone = ZoneId.systemDefault()
        val parsed = latestDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        return parsed?.atStartOfDay(zone)?.toInstant() ?: now.minus(Duration.ofDays(backfillDays))
    }
}

/**
 * What a refusal means for the schedule.
 *
 * The line between these is whether waiting helps. A 401 will be a 401 next
 * time, and every retry spends a slot of the unknown-token limit that exists to
 * stop exactly that; a 500 or a lost connection is worth another go later.
 */
private fun Reply<*>.asReport(): SyncReport = when (this) {
    is Reply.Unauthorised -> SyncReport.Stopped("The token was refused. Create a new one in NutriCore and paste it here")
    is Reply.Refused -> when (error) {
        "tooMany" -> SyncReport.Stopped("The server refused the payload as too large (HTTP $status)")
        else -> SyncReport.Stopped("The server rejected the readings as invalid (HTTP $status)")
    }

    is Reply.RateLimited -> SyncReport.TryLater("Rate limited; trying again in about ${retryAfterSeconds / 60 + 1} minutes")
    is Reply.Unreachable -> SyncReport.TryLater("Could not reach the server: $reason")
    is Reply.Ok -> SyncReport.NothingToSend
}
