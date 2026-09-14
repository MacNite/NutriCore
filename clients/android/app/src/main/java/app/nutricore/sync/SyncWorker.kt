package app.nutricore.sync

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * The part that happens when nobody is looking.
 *
 * Four times a day rather than hourly: new readings appear when somebody stands
 * on a scale, which is once a day at most, and the endpoint allows sixty
 * requests an hour per token - a budget worth leaving unspent for the retries
 * that matter.
 */
class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result {
        val report = SyncRunner(applicationContext).run()
        SyncSettings(applicationContext).lastResult = report.summary()

        return when (report) {
            /* Worth another go: a lost connection, a rate limit, a server
               having a bad day. WorkManager backs off between attempts. */
            is SyncReport.TryLater -> Result.retry()

            /* Nothing will change until somebody does something, so say so once
               and stop. Retrying a refused token on a schedule is how an
               account spends its unknown-token budget on nothing. */
            is SyncReport.Stopped, is SyncReport.NeedsPermission, is SyncReport.NeedsSetup -> {
                notifyStopped(applicationContext, report.summary())
                Result.failure()
            }

            is SyncReport.Done, SyncReport.NothingToSend -> Result.success()
        }
    }

    companion object {
        private const val PERIODIC = "nutricore-sync-periodic"
        private const val ONE_OFF = "nutricore-sync-now"

        fun schedule(context: Context, hours: Long = 6) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(hours, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
                .build()

            /* UPDATE rather than KEEP: someone changing the interval expects the
               change to take, not to be quietly kept on the old schedule. */
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }

        /** The "sync now" button, run through the same worker as the schedule. */
        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(ONE_OFF, ExistingWorkPolicy.REPLACE, request)
        }
    }
}

private const val CHANNEL = "sync-stopped"

/**
 * Tell somebody their sync has stopped.
 *
 * Only for the states that stay broken until a person acts. A sync that failed
 * because a train went into a tunnel is not news, and a client that said so
 * would be a client whose notifications get turned off - along with the one
 * that mattered.
 *
 * The permission is checked immediately below; lint cannot always follow an
 * early return through a version check, so it is told so explicitly.
 */
@SuppressLint("MissingPermission")
private fun notifyStopped(context: Context, text: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
        return
    }

    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Sync stopped", NotificationManager.IMPORTANCE_DEFAULT),
    )

    val notification = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle("NutriCore sync stopped")
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .build()

    NotificationManagerCompat.from(context).notify(1, notification)
}
