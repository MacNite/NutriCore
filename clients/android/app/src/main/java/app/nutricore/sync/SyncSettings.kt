package app.nutricore.sync

import android.content.Context

/**
 * Where the endpoint, the token and the last result are kept.
 *
 * Plain app-private preferences, excluded from cloud backup and device
 * transfer by `data_extraction_rules.xml`. That is the honest description of
 * the protection: another app cannot read this, and somebody holding an
 * unlocked or rooted phone can. The answer to a lost phone is the same as the
 * answer to a lost token - revoke the device in NutriCore's settings, where
 * revoking one leaves the others working.
 */
class SyncSettings(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("sync", Context.MODE_PRIVATE)

    var endpoint: String
        get() = prefs.getString(KEY_ENDPOINT, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_ENDPOINT, normaliseSyncUrl(value)).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_TOKEN, value.trim()).apply()

    /** Report what would happen and write nothing. Off once somebody trusts it. */
    var dryRun: Boolean
        get() = prefs.getBoolean(KEY_DRY_RUN, false)
        set(value) = prefs.edit().putBoolean(KEY_DRY_RUN, value).apply()

    var automatic: Boolean
        get() = prefs.getBoolean(KEY_AUTOMATIC, false)
        set(value) = prefs.edit().putBoolean(KEY_AUTOMATIC, value).apply()

    /** The last thing that happened, in the words the setup screen shows. */
    var lastResult: String
        get() = prefs.getString(KEY_LAST_RESULT, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_LAST_RESULT, value).putLong(KEY_LAST_RESULT_AT, System.currentTimeMillis()).apply()

    val lastResultAt: Long
        get() = prefs.getLong(KEY_LAST_RESULT_AT, 0L)

    val configured: Boolean
        get() = endpoint.isNotBlank() && token.isNotBlank()

    private companion object {
        const val KEY_ENDPOINT = "endpoint"
        const val KEY_TOKEN = "token"
        const val KEY_DRY_RUN = "dryRun"
        const val KEY_AUTOMATIC = "automatic"
        const val KEY_LAST_RESULT = "lastResult"
        const val KEY_LAST_RESULT_AT = "lastResultAt"
    }
}
