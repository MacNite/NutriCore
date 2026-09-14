package app.nutricore.sync

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.Metadata
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.reflect.KClass

/**
 * Reading the three metrics out of Health Connect.
 *
 * Health Connect is the only reason this app exists rather than a shortcut: it
 * has no web API and no scriptable surface, so a page in a browser - installed
 * to the home screen or not - cannot see a single one of these records.
 */

/** Reading the records themselves. Granted once, in the Health Connect sheet. */
val READ_PERMISSIONS: Set<String> = setOf(
    HealthPermission.getReadPermission(WeightRecord::class),
    HealthPermission.getReadPermission(BodyFatRecord::class),
    HealthPermission.getReadPermission(HeightRecord::class),
)

/*
 * Spelled out rather than taken from `HealthPermission`, which is where the
 * constants for these live in recent versions of the library. They are platform
 * permission strings, already written out in the manifest, and writing them
 * here too means this file compiles against whichever version of the client
 * library somebody's build resolves.
 */

/** Without this, a read from a scheduled job throws instead of returning rows. */
const val PERMISSION_BACKGROUND = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"

/** Without this, Health Connect hands out the last 30 days and nothing older. */
const val PERMISSION_HISTORY = "android.permission.health.READ_HEALTH_DATA_HISTORY"

/** What the setup screen asks for in one sheet. */
val ALL_PERMISSIONS: Set<String> = READ_PERMISSIONS + PERMISSION_BACKGROUND + PERMISSION_HISTORY

class HealthConnectReader(private val client: HealthConnectClient) {

    /**
     * Every reading of one metric between two instants, as samples.
     *
     * Readings the server would refuse are dropped rather than sent: the
     * endpoint rejects a payload whole, so one implausible number would cost
     * the whole sync.
     */
    suspend fun read(metric: Metric, from: Instant, to: Instant): List<Sample> = when (metric) {
        Metric.WEIGHT_KG -> readAll(WeightRecord::class, from, to) { record ->
            sample(metric, record.time, record.zoneOffset, record.metadata, record.weight.inKilograms)
        }

        Metric.BODY_FAT_PCT -> readAll(BodyFatRecord::class, from, to) { record ->
            sample(metric, record.time, record.zoneOffset, record.metadata, record.percentage.value)
        }

        Metric.HEIGHT_CM -> readAll(HeightRecord::class, from, to) { record ->
            sample(metric, record.time, record.zoneOffset, record.metadata, record.height.inMeters * 100.0)
        }
    }

    private suspend fun <T : Record> readAll(
        type: KClass<T>,
        from: Instant,
        to: Instant,
        map: (T) -> Sample?,
    ): List<Sample> {
        val samples = mutableListOf<Sample>()
        var pageToken: String? = null

        do {
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType = type,
                    timeRangeFilter = TimeRangeFilter.between(from, to),
                    pageToken = pageToken,
                ),
            )
            for (record in response.records) map(record)?.let(samples::add)
            pageToken = response.pageToken
        } while (pageToken != null)

        return samples
    }

    /**
     * One record, as the endpoint wants it.
     *
     * The day comes from the offset the record carries, not from this phone's
     * current one. A reading taken in Tokyo belongs to the day it was taken in
     * Tokyo, and stays there after the flight home.
     *
     * The identity is Health Connect's own row id, which is what makes a
     * re-read recognised instead of duplicated - and it is why this client can
     * re-send anything at any time without doing harm.
     */
    private fun sample(
        metric: Metric,
        time: Instant,
        offset: ZoneOffset?,
        metadata: Metadata,
        raw: Double,
    ): Sample? {
        val value = roundToStoredPrecision(raw)
        if (!metric.accepts(value)) return null

        val zone: ZoneId = offset ?: ZoneId.systemDefault()

        return Sample(
            metric = metric,
            date = time.atZone(zone).toLocalDate().toString(),
            recordedAt = time.toString(),
            value = value,
            externalId = metadata.id,
            source = metadata.dataOrigin.packageName.ifBlank { null },
        )
    }
}
