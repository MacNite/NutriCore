# Sync clients

NutriCore's settings page issues a device token and `/api/health/samples` takes
the readings. Neither of those is a client: something has to run on the phone,
read the health store and post. This directory holds the two that do.

| | What it is | Effort |
| --- | --- | --- |
| [`ios-shortcut/`](ios-shortcut/) | A recipe for a Shortcut, built by hand in the Shortcuts app | About fifteen minutes of tapping. No app, no Xcode, no developer account |
| [`android/`](android/) | A small Kotlin app | Build it in Android Studio and install the APK on your own phone |

Neither is required. The settings page imports an export file and does it well;
these exist so nobody has to do that by hand every week.

## Why a phone needs native code at all

Because neither health store can be read from a browser. HealthKit has no web
API; Health Connect has no web API and no scriptable surface. A page served by
NutriCore — installed to the home screen or not — cannot see a single weight
reading. Apple leaves a door open in Shortcuts, which is why the iPhone side is
a recipe rather than an app. Android leaves none, which is why the other side is
an app.

## What both clients agree on

The endpoint is documented in full in [`docs/HEALTH_SYNC.md`](../docs/HEALTH_SYNC.md).
The parts that shape a client:

- **A token belongs to one platform**, fixed when it was issued. A token from an
  iPhone cannot write Health Connect records.
- **Kilograms, percent, centimetres.** Units are converted on the device. A
  weight of `180` is accepted as 180 kg because that is plausible, so this is
  the one mistake nothing downstream catches — both clients therefore refuse to
  guess at a unit they do not recognise.
- **The day is the client's to decide.** The server has no idea what timezone
  anyone is in, so `date` is the calendar day as the phone saw it.
- **Re-sending is free.** The import is idempotent on `externalId`, so a client
  may re-send its whole history at any time. Both of these do re-send: the
  iPhone recipe a rolling month, the Android app from the cursor.
- **A value you typed is never overwritten.** Readings landing on a day you
  recorded by hand are reported as `skipManual` and left alone.
- **Waist circumference only comes from an iPhone.** Apple Health holds one;
  Health Connect removed the record type, so the Android app syncs three
  metrics rather than four. On Android it stays a typed-in value, which the
  import will not overwrite.

## Writing a third one

The endpoint is ordinary HTTP with a bearer token, so anything can talk to it —
a cron job on a laptop, a Garmin bridge, a script beside a smart scale.
`docs/HEALTH_SYNC.md` has the request and response shapes, the status codes and
what a client should do about each, and a curl example to try first. Test
against `dryRun` before writing anything: it reports exactly what a real call
would do, and does not count as the device having synced.

## A note on what is verified

The Android app's rules for what gets sent — the day collapse, the plausibility
ranges, the rounding, the address and token parsing — are covered by unit tests
(`./gradlew test`). The parts that need a device with Health Connect on it, and
the iPhone recipe, are verified the way the endpoint offers: point them at a
real instance with the dry run on, which reports exactly what a real sync would
do and writes nothing.
