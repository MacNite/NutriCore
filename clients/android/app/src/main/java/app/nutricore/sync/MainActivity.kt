package app.nutricore.sync

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import kotlinx.coroutines.launch

/**
 * Setting the thing up, and nothing else.
 *
 * This screen is also what Health Connect opens when somebody taps the privacy
 * link in its permission sheet, which is why it says plainly at the top what is
 * read and where it goes. A rationale screen that appears at the moment of
 * granting access should answer the question being asked.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    SetupScreen()
                }
            }
        }
    }
}

@Composable
private fun SetupScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val settings = remember { SyncSettings(context) }

    var endpoint by remember { mutableStateOf(settings.endpoint) }
    var token by remember { mutableStateOf(settings.token) }
    var dryRun by remember { mutableStateOf(settings.dryRun) }
    var automatic by remember { mutableStateOf(settings.automatic) }
    var status by remember { mutableStateOf(settings.lastResult) }
    var busy by remember { mutableStateOf(false) }
    var granted by remember { mutableStateOf(emptySet<String>()) }
    var refresh by remember { mutableIntStateOf(0) }

    val availability = remember { HealthConnectClient.getSdkStatus(context) }
    val installed = availability == HealthConnectClient.SDK_AVAILABLE

    LaunchedEffect(refresh) {
        if (installed) {
            granted = HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
        }
    }

    val askHealth = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract()) {
        refresh += 1
    }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("NutriCore Sync", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Reads weight, body fat and height from Health Connect and sends them to your own NutriCore " +
                "instance. Nothing else is read, nothing is written back to Health Connect, and the readings " +
                "go nowhere except the address you enter below.",
            style = MaterialTheme.typography.bodyMedium,
        )

        Section("Where to send it") {
            OutlinedTextField(
                value = endpoint,
                onValueChange = { endpoint = it },
                label = { Text("Sync address") },
                placeholder = { Text("https://nutricore.example/api/health/samples") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("Device token") },
                placeholder = { Text("nch_...") },
                singleLine = true,
                isError = token.isNotBlank() && !tokenLooksValid(token),
                supportingText = {
                    Text(
                        if (token.isNotBlank() && !tokenLooksValid(token)) {
                            "That does not look like a whole token. Copy it again from Settings."
                        } else {
                            "Settings → Sync from a phone automatically → Create token. Shown once."
                        },
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    settings.endpoint = endpoint
                    settings.token = token
                    endpoint = settings.endpoint
                    status = "Saved"
                },
                enabled = endpoint.isNotBlank() && token.isNotBlank(),
            ) {
                Text("Save")
            }
        }

        Section("Health Connect") {
            Text(
                when (availability) {
                    HealthConnectClient.SDK_AVAILABLE -> "Available on this phone."
                    HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                        "Installed, but too old to be read. Update Health Connect in the Play Store."

                    else -> "Not available on this phone. Health Connect needs Android 9 or newer."
                },
                style = MaterialTheme.typography.bodyMedium,
            )

            if (installed) {
                Text(permissionSummary(granted), style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = { askHealth.launch(ALL_PERMISSIONS) }) {
                    Text(if (granted.containsAll(READ_PERMISSIONS)) "Review access" else "Grant access")
                }
                if (!granted.contains(PERMISSION_BACKGROUND)) {
                    Text(
                        "Background access is granted separately, in Health Connect under App permissions → " +
                            "NutriCore Sync → Additional access. Without it a scheduled sync is refused.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = { openHealthConnectSettings(context) }) {
                        Text("Open Health Connect settings")
                    }
                }
            }
        }

        Section("Syncing") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(
                    checked = dryRun,
                    onCheckedChange = {
                        dryRun = it
                        settings.dryRun = it
                    },
                )
                Text("  Dry run — report what would happen, write nothing", style = MaterialTheme.typography.bodyMedium)
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(
                    checked = automatic,
                    onCheckedChange = { wanted ->
                        automatic = wanted
                        settings.automatic = wanted
                        if (wanted) {
                            SyncWorker.schedule(context)
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                            }
                        } else {
                            SyncWorker.cancel(context)
                        }
                    },
                    enabled = settings.configured,
                )
                Text("  Sync automatically, four times a day", style = MaterialTheme.typography.bodyMedium)
            }

            Button(
                onClick = {
                    busy = true
                    status = "Working…"
                    scope.launch {
                        val report = SyncRunner(context).run()
                        status = report.summary()
                        settings.lastResult = status
                        busy = false
                        refresh += 1
                    }
                },
                enabled = !busy && settings.configured,
            ) {
                Text("Sync now")
            }

            if (status.isNotBlank()) Text(status, style = MaterialTheme.typography.bodyMedium)
        }

        Text(
            "Waist measurements are not synced: Health Connect has no record type for them. Type those into " +
                "NutriCore directly — anything entered by hand is never overwritten by a sync.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/**
 * Health Connect's own settings, where "Additional access" lives.
 *
 * Two actions, because Health Connect was an app before it was part of the
 * system and both are still in the field. Neither is guaranteed to resolve, so
 * a phone that answers to neither is left alone rather than crashed.
 */
private fun openHealthConnectSettings(context: Context) {
    val actions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        listOf("android.health.connect.action.HEALTH_HOME_SETTINGS", "androidx.health.ACTION_HEALTH_CONNECT_SETTINGS")
    } else {
        listOf("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS", "android.health.connect.action.HEALTH_HOME_SETTINGS")
    }

    for (action in actions) {
        val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(context.packageManager) != null) {
            context.startActivity(intent)
            return
        }
    }
}

private fun permissionSummary(granted: Set<String>): String {
    val readable = READ_PERMISSIONS.count(granted::contains)
    val history = if (granted.contains(PERMISSION_HISTORY)) "with history" else "last 30 days only"
    val background = if (granted.contains(PERMISSION_BACKGROUND)) "background allowed" else "background not allowed"
    return "$readable of ${READ_PERMISSIONS.size} metrics readable, $history, $background."
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}
