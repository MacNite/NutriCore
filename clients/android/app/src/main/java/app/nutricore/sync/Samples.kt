package app.nutricore.sync

import org.json.JSONObject

/**
 * What the endpoint accepts, and the rules for deciding what is worth sending.
 *
 * These mirror `src/lib/health-import.ts` and `src/server/health-import-ingest.ts`
 * in the NutriCore repository. Mirroring is not the same as trusting: the server
 * applies every one of them again, because a client running on somebody's phone
 * is not a place where rules can be enforced. What they buy here is a payload
 * that does not get rejected in one lump over one bad reading, and a sync that
 * stays quiet when nothing has changed.
 */

/**
 * The metrics this client can supply.
 *
 * `waistCm` is missing on purpose. NutriCore stores it and the file import can
 * carry it, but Health Connect has no waist circumference record type - it was
 * removed from the API in 1.0.0-alpha08 and never came back - so there is
 * nothing on this platform to read. Waist measurements are typed into NutriCore
 * by hand, and a value somebody typed is never overwritten by an import anyway.
 */
enum class Metric(val key: String, private val min: Double, private val max: Double) {
    WEIGHT_KG("weightKg", 20.0, 400.0),
    BODY_FAT_PCT("bodyFatPct", 1.0, 80.0),
    HEIGHT_CM("heightCm", 50.0, 260.0);

    /**
     * Whether a reading is plausible enough to send.
     *
     * A scale reports 0 kg during a firmware fault. Dropping that here means
     * the rest of the batch still lands: the endpoint rejects a payload whole,
     * so one absurd reading would otherwise cost the entire sync.
     */
    fun accepts(value: Double): Boolean = value.isFinite() && value >= min && value <= max
}

/**
 * One reading, in the shape the endpoint reads.
 *
 * `date` is the calendar day as this phone saw it, decided from the offset the
 * record itself carries. The server has no idea what timezone anyone is in and
 * deliberately does not guess, so this is the one field a client has to get
 * right on its own.
 */
data class Sample(
    val metric: Metric,
    val date: String,
    val recordedAt: String,
    val value: Double,
    val externalId: String,
    val source: String?,
) {
    fun toJson(): JSONObject =
        JSONObject()
            .put("metric", metric.key)
            .put("date", date)
            .put("recordedAt", recordedAt)
            .put("value", value)
            .put("externalId", externalId)
            .put("source", source ?: JSONObject.NULL)
}

/**
 * Two decimals, which is what the column holds.
 *
 * Health Connect stores mass in micrograms and length in metres, so a reading a
 * scale wrote as 82.4 kg comes back as 82.40000000000001, and a height of 1.8 m
 * becomes 180.00000000000003 cm. Sent as they are, those never equal the value
 * already stored, so every sync would rewrite every row it had written before
 * and report the busywork as changes. Rounding to the precision the database
 * keeps is what lets an unchanged reading read as unchanged.
 */
fun roundToStoredPrecision(value: Double): Double = Math.round(value * 100.0) / 100.0

/**
 * One sample per metric per day: the last one recorded.
 *
 * The server does this too, and does it whatever the client sends. Doing it
 * before the request is what keeps a decade of history inside one payload
 * rather than one entry per time somebody stood on a scale.
 *
 * Ties on the same instant are broken by external id, so the result does not
 * depend on the order Health Connect happened to return its pages in.
 */
fun lastPerDay(samples: List<Sample>): List<Sample> {
    val best = LinkedHashMap<Pair<String, String>, Sample>()

    for (sample in samples) {
        val key = sample.metric.key to sample.date
        val held = best[key]
        val better = held == null ||
            sample.recordedAt > held.recordedAt ||
            (sample.recordedAt == held.recordedAt && sample.externalId > held.externalId)
        if (better) best[key] = sample
    }

    return best.values.sortedWith(compareBy({ it.date }, { it.metric.key }))
}
