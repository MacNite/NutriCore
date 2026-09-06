# Syncing health data from a device

The settings page imports an Apple Health or Health Connect export file, and it
needs a person for every step: export the file, find it, pick it, confirm the
preview. This document describes the other way in — an endpoint a phone posts to
on its own, so weight and body readings arrive without anybody doing anything.

It is the same import. Samples are validated by the same schema, decided by the
same rules and written by the same planner as the file path
(`src/server/health-import-ingest.ts`); what differs is only how the caller
proves who it is. In particular **a value somebody typed is never overwritten**,
and re-posting a sample that has already been stored is recognised rather than
duplicated. A client may re-send its whole history at any time without harm.

Nothing is written back to the phone. This instance reads and does not write;
see [ARCHITECTURE.md](ARCHITECTURE.md#importing-from-apple-health-and-health-connect)
for why.

## Pairing a device

**Settings → Sync from a phone automatically → Create token.**

Give the device a name and say where its readings come from. The token is shown
**once**: it is stored only as a SHA-256 hash and cannot be recovered. If it is
lost, revoke the device and issue a new one.

The platform is fixed when the token is issued rather than sent with each
request. A token lifted from an iPhone therefore cannot write records under
Health Connect's identity, which matters because a sample's `externalId` is only
unique within a platform.

An account may hold up to ten tokens. Revoking one leaves the others working.

## Authentication

    Authorization: Bearer nch_...

Every response to a token that does not resolve is `401` with no detail: a
caller learns that the token did not work, never whether it was absent,
malformed, revoked, or belongs to a deactivated account.

## `GET /api/health/samples` — where to resume

```json
{
  "device": { "name": "My iPhone", "platform": "APPLE_HEALTH" },
  "metrics": [
    { "metric": "weightKg",   "latestDate": "2026-09-05", "count": 412 },
    { "metric": "bodyFatPct", "latestDate": "2026-09-05", "count": 402 },
    { "metric": "heightCm",   "latestDate": null,         "count": 0 },
    { "metric": "waistCm",    "latestDate": null,         "count": 0 }
  ]
}
```

`latestDate` is the last day already imported, and it is **inclusive**: read
from that day, not the day after it. Somebody who weighs themselves in the
morning and again at night produces two samples on one day, and the second must
not be missed because the first was already stored. Re-reading that day costs
nothing — the importer recognises what it has seen.

`null` means nothing has been imported for that metric yet, so read as far back
as the client is willing to.

## `POST /api/health/samples` — send readings

```json
{
  "dryRun": false,
  "samples": [
    {
      "metric": "weightKg",
      "date": "2026-09-05",
      "recordedAt": "2026-09-05T07:14:00.000Z",
      "value": 82.4,
      "externalId": "5a1e...",
      "source": "Withings"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `metric` | One of `weightKg`, `bodyFatPct`, `heightCm`, `waistCm`. Anything else is rejected |
| `date` | `YYYY-MM-DD`, the calendar day **as the device saw it** |
| `recordedAt` | ISO 8601 instant. Used only to order samples within a day |
| `value` | Kilograms, percent or centimetres. Converted on the device, never guessed here |
| `externalId` | Stable identity for this reading, ≤128 characters. Re-sending the same id updates rather than duplicates |
| `source` | The app or scale that wrote it, ≤120 characters, or `null`. Shown to the user, never trusted |
| `dryRun` | Optional. `true` reports what would happen and writes nothing |

`date` is decided by the client because the server has no idea what timezone
anyone is in — there is no such field on a profile, and a date is treated
throughout as an opaque day key. A client that guessed differently from the
export it read would produce a second, disagreeing answer to "what day is it".

`externalId` should be whatever the platform already calls the reading: Health
Connect rows carry a UUID; HealthKit samples carry a `UUID` too. Derive one
from the reading's own fields only if there is nothing to use, and derive it so
that reading the same history twice yields the same id.

Units are the client's responsibility. Send kilograms and centimetres. A weight
of `180` is accepted as 180 kg because it is inside the plausible range, so a
client that sends pounds will silently record a plausible wrong number — this is
the one place where a mistake is not caught for you.

At most 50 000 samples and 16 MiB per request, whichever is reached first.
Collapse to one reading per metric per day before sending: the importer does
this anyway, and it is what keeps a decade of history inside one request. A
first sync of a very long history is better sent in batches of a few thousand —
there is no ordering requirement, so batch however is convenient.

### Response

```json
{
  "dryRun": false,
  "platform": "APPLE_HEALTH",
  "totals": { "create": 3, "update": 0, "skipManual": 1, "unchanged": 408 },
  "metrics": [
    { "metric": "weightKg", "create": 3, "update": 0, "skipManual": 1,
      "unchanged": 408, "firstDate": "2025-08-01", "lastDate": "2026-09-05" }
  ]
}
```

`skipManual` counts readings that fell on a day the user had recorded by hand.
Those entries were left alone. It is not an error and a client should not retry
on it — a sync log is the right place for it.

Per-sample decisions are not returned; they run to tens of thousands of entries
and no client has a use for them.

### Status codes

| Code | Meaning | What a client should do |
| --- | --- | --- |
| `200` | Applied, or planned when `dryRun` | Record the totals |
| `401` | Token absent, malformed, revoked, or the account is deactivated | Stop and ask the user to re-pair. Never retry on a schedule |
| `413` | More than 50 000 samples, or a body over 16 MiB | Send fewer days, in batches |
| `422` | Body is not JSON, is the wrong shape, or a sample is invalid | Fix the client. Retrying will not help |
| `429` | Rate limited | Honour `Retry-After` |

A `422` reports `validation`, or `empty` for a request with no samples in it.
Neither says which sample was wrong, deliberately.

### Rate limits

Sixty requests an hour per token, which is far more than a daily sync needs and
enough for a client retrying a failed one every few minutes for an hour.
Presenting a token that resolves to nothing is limited separately and much more
tightly, per address, and that limit is counted in PostgreSQL so it survives a
restart.

## Writing a client

The shape of a well-behaved sync, whatever it is written in:

1. `GET` the cursor. Note `latestDate` per metric.
2. Read the platform's own store from that day forward.
3. Convert to kilograms, percent and centimetres. Drop anything implausible.
4. Collapse to the last reading of each metric on each day.
5. `POST`. On `401`, stop and tell the user. On `429`, back off. On `5xx`,
   retry later — the import is idempotent, so a retry cannot double-count.
6. Log the totals. `create` and `update` are what changed; `unchanged` and
   `skipManual` are normal.

Test against a `dryRun` first. It reports exactly what a real call would do and
writes nothing, and it does not count as the device having synced.

### iPhone, without an app

Shortcuts can do all of the above: **Find Health Samples** reads the store,
**Get Contents of URL** posts JSON with the `Authorization` header, and a
personal automation runs it daily. No Apple Developer Program, no Xcode, and no
App Store review — the phone is doing something it can already do.

### Android

Health Connect is reachable only from a native app: there is no web API and no
scriptable surface, so a wrapped PWA cannot read it. A small Kotlin app using
`androidx.health.connect.client` with a `WorkManager` periodic job is the whole
requirement. It needs no Play Store listing — an APK served from the instance
itself is enough, and suits a self-hosted application better.

## Curl

```sh
TOKEN=nch_...
URL=https://nutricore.example/api/health/samples

curl -s -H "Authorization: Bearer $TOKEN" "$URL"

curl -s -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true,"samples":[{"metric":"weightKg","date":"2026-09-05",
       "recordedAt":"2026-09-05T07:14:00.000Z","value":82.4,
       "externalId":"demo-1","source":"curl"}]}'
```
