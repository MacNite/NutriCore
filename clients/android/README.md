# NutriCore Sync for Android

A small app that reads weight, body fat and height out of Health Connect and
posts them to your own NutriCore instance, on a schedule, without you doing
anything.

It exists because Health Connect cannot be read from a browser. There is no web
API and no scriptable surface, so the NutriCore web app — installed to the home
screen or not — cannot see a single one of these records. Reading them needs
native code on the phone. This is that native code, and nothing else: no
account, no analytics, no server of its own. It talks to the address you give it
and to Health Connect, and that is all it can do.

## What it syncs

| Metric | Health Connect record |
| --- | --- |
| `weightKg` | `WeightRecord` |
| `bodyFatPct` | `BodyFatRecord` |
| `heightCm` | `HeightRecord` |

**Not waist circumference.** Health Connect has no record type for it — the API
had `WaistCircumferenceRecord` briefly and removed it in 1.0.0-alpha08 — so
there is nothing on this platform to read. Type waist measurements into
NutriCore directly; a value entered by hand is never overwritten by an import.

Nothing is written back to Health Connect. This app reads and does not write,
and holds no write permission with which it could change its mind.

## Building it

You need Android Studio (or a JDK 17 and a Gradle 8.9), and nothing else. There
is no Play Store listing and no signing key to obtain: this is an app one person
builds and installs on their own phone.

```sh
cd clients/android
gradle wrapper --gradle-version 8.9   # once; this repository ships no binaries,
                                      # so the wrapper JAR is not committed
./gradlew assembleDebug
./gradlew test                        # the rules that decide what gets sent
```

The APK lands in `app/build/outputs/apk/debug/app-debug.apk`. Install it over
ADB (`adb install -r app-debug.apk`), or copy it to the phone and open it —
Android will ask whether to allow installing from that source.

Opening the folder in Android Studio works too, and gets you the wrapper without
the first command.

A debug build is signed with the local debug key, which is fine for a phone you
control and is not fine for handing to anyone else. If you want to serve the APK
from your own instance for other people, build a release and sign it with a key
of your own.

## Setting it up

1. In NutriCore: **Settings → Sync from a phone automatically**. Name the phone,
   choose **Health Connect (Android)**, create the token. It is shown once and
   stored only as a hash, so copy it now; if it gets away from you, revoke the
   device and make another.
2. In the app: paste the sync address and the token, then **Save**. The address
   is the one shown under the new token — pasting just `nutricore.example` works
   too, the path is filled in.
3. **Grant access.** Health Connect asks about weight, body fat and height in
   one sheet.
4. **Additional access → Access data in the background.** Health Connect keeps
   this on a separate screen and does not offer it in the first sheet. Without
   it, a scheduled sync is refused the moment nobody is looking at the phone,
   which is every sync. The app links straight to that screen while it is
   missing.
5. Leave **Dry run** on and press **Sync now**. It reports exactly what a real
   sync would do and writes nothing.
6. Turn Dry run off, then turn on **Sync automatically**.

### Reading more than the last 30 days

Health Connect gives an app the last 30 days unless it also holds the history
permission, which the app requests in the same sheet. Granted, a first sync
reaches back ten years; refused, it reaches back 30 days and everything older
has to come in through the file import in NutriCore's settings, once.

Note that Health Connect measures those 30 days from when permission was first
granted, and reinstalling the app starts that clock again.

## How it behaves

A sync is the sequence `docs/HEALTH_SYNC.md` asks of any client:

1. `GET` the cursor and note `latestDate` per metric. It is **inclusive**: the
   app starts reading at the beginning of that day, not after it, because
   somebody who weighs themselves twice in a day would otherwise lose the second
   reading permanently.
2. Read Health Connect from there, page by page.
3. Convert to kilograms, percent and centimetres, round to the two decimals the
   database stores, and drop anything outside the plausible range.
4. Collapse to the last reading of each metric on each day.
5. `POST`, in batches of 2 000.

Four times a day, over any network, through WorkManager. Retries are its
business, not this app's, except for deciding what is worth retrying:

| Answer | What the app does |
| --- | --- |
| `200` | Records the totals and shows them on the setup screen |
| `401` | Stops, and says so in a notification. A refused token stays refused, and retrying spends the limit that exists to stop exactly that |
| `413`, `422` | Stops. Nothing about waiting makes a rejected payload valid |
| `429` | Retries later, after the backoff WorkManager applies |
| `5xx`, no network | Retries later. The import is idempotent, so a retry cannot double-count |

`skipManual` in the totals counts readings that fell on a day you had already
recorded by hand. Those were left alone. It is not an error, and the app does
not treat it as one.

## Where the token lives

In app-private preferences, excluded from cloud backup and device transfer.
That is the whole of it: another app cannot read it, and somebody holding your
unlocked phone can. The answer to a lost phone is the same as the answer to a
lost token — revoke that device in NutriCore's settings, where revoking one
leaves the others working.

## Permissions, and why each one is there

| Permission | Why |
| --- | --- |
| `health.READ_WEIGHT`, `READ_BODY_FAT`, `READ_HEIGHT` | The three metrics. No write permission is requested for any of them |
| `health.READ_HEALTH_DATA_IN_BACKGROUND` | A scheduled read is a background read, and Health Connect refuses those without it |
| `health.READ_HEALTH_DATA_HISTORY` | Reaching past the last 30 days on a first sync |
| `INTERNET` | Posting to the address you entered |
| `POST_NOTIFICATIONS` | Saying "sync stopped, and here is why". Only for states that stay broken until you act |

## When something is wrong

| What you see | What it means |
| --- | --- |
| "Health Connect is not available on this phone" | Needs Android 9 or newer. It is part of the system from Android 14; before that it is an app from the Play Store |
| "Health Connect refused the read" | The background permission is missing. Health Connect → App permissions → NutriCore Sync → Additional access |
| "The token was refused" | Revoked, mistyped, or the account was deactivated. Create a new token and paste it again |
| "Nothing new to send" | Health Connect has nothing the server does not already have. Normal, and what most syncs report |
| Totals that are all `unchanged` | Also normal. It means the server already had every reading |

If a sync says nothing at all is there, check that whatever writes your weight —
the scale's own app, usually — is allowed to write to Health Connect. Health
Connect holds only what other apps have put into it, and an empty store reads as
an empty sync.

## Changing the package name

`app.nutricore.sync` is a placeholder, chosen because an application id has to
be something. If you would rather it carried your own domain, change
`namespace` and `applicationId` in `app/build.gradle.kts` and the `package`
line at the top of each Kotlin file. Nothing else depends on it.
