package app.nutricore.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules that decide what leaves the phone.
 *
 * Only the parts that are plain Kotlin are tested here: reading Health Connect
 * needs a device with Health Connect on it, and talking to NutriCore needs a
 * NutriCore. Those are exercised by pointing the app at a real instance with
 * the dry-run switch on, which reports exactly what a real sync would do and
 * writes nothing.
 */
class SamplesTest {

    private fun sample(
        metric: Metric = Metric.WEIGHT_KG,
        date: String = "2026-09-05",
        recordedAt: String = "2026-09-05T07:14:00Z",
        value: Double = 82.4,
        externalId: String = "a",
    ) = Sample(metric, date, recordedAt, value, externalId, "com.example.scale")

    @Test
    fun `keeps the last reading of a day`() {
        val kept = lastPerDay(
            listOf(
                sample(recordedAt = "2026-09-05T07:14:00Z", value = 82.4, externalId = "morning"),
                sample(recordedAt = "2026-09-05T21:02:00Z", value = 83.1, externalId = "evening"),
            ),
        )

        assertEquals(1, kept.size)
        assertEquals("evening", kept.first().externalId)
    }

    @Test
    fun `breaks a tie on the same instant by external id, not by arrival order`() {
        val one = listOf(sample(externalId = "a"), sample(externalId = "b"))
        val other = listOf(sample(externalId = "b"), sample(externalId = "a"))

        assertEquals("b", lastPerDay(one).single().externalId)
        assertEquals("b", lastPerDay(other).single().externalId)
    }

    @Test
    fun `keeps metrics and days apart`() {
        val kept = lastPerDay(
            listOf(
                sample(metric = Metric.WEIGHT_KG, date = "2026-09-05", externalId = "w1"),
                sample(metric = Metric.BODY_FAT_PCT, date = "2026-09-05", value = 21.0, externalId = "f1"),
                sample(metric = Metric.WEIGHT_KG, date = "2026-09-06", externalId = "w2"),
            ),
        )

        assertEquals(3, kept.size)
        // Sorted by day, then metric, so a batch reads in the order it happened.
        assertEquals(listOf("2026-09-05", "2026-09-05", "2026-09-06"), kept.map { it.date })
    }

    @Test
    fun `drops readings no body has produced`() {
        // 0 kg is what a scale reports during a firmware fault.
        assertFalse(Metric.WEIGHT_KG.accepts(0.0))
        assertFalse(Metric.WEIGHT_KG.accepts(500.0))
        assertTrue(Metric.WEIGHT_KG.accepts(82.4))

        // The same number, plausible for one metric and not the other.
        assertTrue(Metric.HEIGHT_CM.accepts(180.0))
        assertFalse(Metric.BODY_FAT_PCT.accepts(180.0))

        assertFalse(Metric.WEIGHT_KG.accepts(Double.NaN))
        assertFalse(Metric.WEIGHT_KG.accepts(Double.POSITIVE_INFINITY))
    }

    @Test
    fun `rounds to the precision the database keeps`() {
        // What 82.4 kg and 1.8 m actually come back as.
        assertEquals(82.4, roundToStoredPrecision(82.40000000000001), 0.0)
        assertEquals(180.0, roundToStoredPrecision(180.00000000000003), 0.0)
        assertEquals(21.35, roundToStoredPrecision(21.345678), 0.0)
    }

    @Test
    fun `accepts either thing somebody might paste as the address`() {
        val endpoint = "https://nutricore.example/api/health/samples"

        assertEquals(endpoint, normaliseSyncUrl(endpoint))
        assertEquals(endpoint, normaliseSyncUrl("  $endpoint/  "))
        assertEquals(endpoint, normaliseSyncUrl("https://nutricore.example"))
        assertEquals(endpoint, normaliseSyncUrl("nutricore.example"))
        assertEquals("http://192.168.1.10:3000/api/health/samples", normaliseSyncUrl("http://192.168.1.10:3000"))
        assertEquals("", normaliseSyncUrl("   "))
    }

    @Test
    fun `knows a whole token from half of one`() {
        val token = "nch_" + "a".repeat(43)

        assertTrue(tokenLooksValid(token))
        assertTrue(tokenLooksValid("  $token\n"))
        assertFalse(tokenLooksValid(token.dropLast(1)))
        assertFalse(tokenLooksValid("nch_"))
        assertFalse(tokenLooksValid("what I pasted by mistake"))
    }
}
