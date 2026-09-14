# NutriCore Sync on iPhone, with a Shortcut

Apple Health cannot be read from a browser. HealthKit has no web API, so the
NutriCore web app — installed to the home screen or not — cannot see your weight
even with the Health app open next to it. Reading it needs something running on
the phone with permission.

On an iPhone that something does **not** have to be an app. Shortcuts can read
the Health store and post JSON, and a personal automation can run it every
morning. No Apple Developer Program, no Xcode, no App Store review: the phone is
doing something it can already do.

This is the recipe. Build it once; it takes about fifteen minutes.

## Before you start

1. In NutriCore: **Settings → Sync from a phone automatically**. Name the phone,
   choose **Apple Health (iPhone)**, and create the token.
2. Copy **the token** and **the sync address** shown under it. The token is
   shown once and stored only as a hash — if it gets away from you, revoke the
   device and make a new one. The address looks like
   `https://nutricore.example/api/health/samples`.

You need iOS 16 or newer for a personal automation that runs without asking.

## Part 1 — the weight sync

Start with weight alone and get it working. The other two metrics are the same
block again, and copying a block that works beats debugging three at once.

Open Shortcuts, tap **+**, and add these actions in order. *Set Variable* is its
own action: add it after the action whose result you are naming.

**Getting ready**

| # | Action | Settings |
| --- | --- | --- |
| 1 | **Text** | Your sync address, e.g. `https://nutricore.example/api/health/samples` |
| 2 | **Set Variable** | Name it `URL` |
| 3 | **Text** | Your token, `nch_…` |
| 4 | **Set Variable** | Name it `Token` |
| 5 | **Dictionary** | Four Number entries: `kg` → `1`, `g` → `0.001`, `lb` → `0.45359237`, `st` → `6.35029318` |
| 6 | **Set Variable** | Name it `MassToKg` |

Action 5 is how the shortcut avoids the one mistake nothing downstream can
catch. The Health app reports weight in whatever unit you read it in, so the
same history is kilograms for one person and pounds for another — and the server
accepts `180` as 180 kg quite happily, because that is a plausible weight. A
sample whose unit is not in this dictionary is skipped rather than guessed at.

**Reading the samples**

| # | Action | Settings |
| --- | --- | --- |
| 7 | **Find Health Samples** | Sample Type: **Weight**. Sort by **Start Date**, **Oldest First**. Add filter: **Start Date** — *is in the last* — **30** *days* |
| 8 | **Repeat with Each** | Input: the **Health Samples** from action 7 |

Everything from here to action 29 goes *inside* the repeat.

| # | Action | Settings |
| --- | --- | --- |
| 9 | **Get Details of Health Sample** | Detail: **Value**, Input: **Repeat Item** |
| 10 | **Set Variable** | `Value` |
| 11 | **Get Details of Health Sample** | Detail: **Unit**, Input: **Repeat Item** |
| 12 | **Set Variable** | `Unit` |
| 13 | **Get Details of Health Sample** | Detail: **Start Date**, Input: **Repeat Item** |
| 14 | **Set Variable** | `When` |
| 15 | **Get Details of Health Sample** | Detail: **Source**, Input: **Repeat Item** |
| 16 | **Set Variable** | `Source` |
| 17 | **Get Dictionary Value** | Get **Value** for key `Unit` in `MassToKg` |
| 18 | **Set Variable** | `Factor` |
| 19 | **If** | `Factor` **has any value** |

Inside the If:

| # | Action | Settings |
| --- | --- | --- |
| 20 | **Calculate** | `Value` **×** `Factor` |
| 21 | **Set Variable** | `Kg` |
| 22 | **Format Date** | Date: `When`. Format: **Custom**, `yyyy-MM-dd` |
| 23 | **Set Variable** | `Day` |
| 24 | **Format Date** | Date: `When`. Format: **ISO 8601**, Include Time: **on** |
| 25 | **Set Variable** | `Recorded` |
| 26 | **Text** | `ios-weightKg-` then insert the `Day` variable |
| 27 | **Set Variable** | `Id` |
| 28 | **Dictionary** | Six entries — see below |
| 29 | **Add to Variable** | `Samples` |

The dictionary in action 28:

| Key | Type | Value |
| --- | --- | --- |
| `metric` | Text | `weightKg` |
| `date` | Text | the `Day` variable |
| `recordedAt` | Text | the `Recorded` variable |
| `value` | Number | the `Kg` variable |
| `externalId` | Text | the `Id` variable |
| `source` | Text | the `Source` variable |

Then close the If and the Repeat.

**Sending it**

| # | Action | Settings |
| --- | --- | --- |
| 30 | **If** | `Samples` **has any value** |
| 31 | **Get Contents of URL** | See below |
| 32 | **Get Dictionary Value** | **Value** for key `totals` |
| 33 | **Show Result** | The value from action 32 |

Action 31, expanded:

- **URL**: the `URL` variable
- **Method**: `POST`
- **Headers**:
  - `Authorization` → type `Bearer ` (with the trailing space) then insert the `Token` variable
  - `Content-Type` → `application/json`
- **Request Body**: **JSON**, with two fields:
  - `dryRun` — Boolean — **true** (for now)
  - `samples` — Array — the `Samples` variable

Name the shortcut **NutriCore Sync**.

## Part 2 — the first run

Run it from the Shortcuts app. iOS asks once for access to Health and once to
contact your server; both have to be allowed.

`dryRun` is `true`, so nothing is written. What comes back is exactly what a real
sync would do:

```json
{ "create": 3, "update": 0, "skipManual": 1, "unchanged": 26 }
```

- **create** — days that were not in NutriCore
- **update** — days whose value changed
- **unchanged** — days already stored with this value. Most of a healthy sync
- **skipManual** — days you had already recorded by hand. Those are left alone;
  this is not an error and not something to retry

If those numbers look like your last month, go back to action 31 and set
`dryRun` to **false**. Run it once more, and check the weight chart.

### If it fails instead

| What you see | What it means |
| --- | --- |
| An error, or `{"error":"unauthorized"}` | The token. Check it copied whole, and that the device has not been revoked |
| `{"error":"validation"}` | Some field is not what it should be. Almost always action 22 or 24: `date` must be `yyyy-MM-dd` and `recordedAt` must be the full ISO 8601 timestamp |
| `{"error":"empty"}` | No samples matched. Widen the 30 days in action 7, or check that the Health app actually holds weight in that window |
| Everything is `skipManual` | You have been typing those days in by hand. The import will not overwrite them, by design |
| Nothing at all happens | The `If` at action 19 skipped every sample: your Health unit is not one of the four in action 5 |

## Part 3 — the automation

Shortcuts tab → **Automation** → **+** → **Time of Day**.

- **Time**: something after you would normally weigh yourself. 09:00 is fine
- **Repeat**: Daily
- **Run Immediately**, and turn **Notify When Run** off
- Choose the **NutriCore Sync** shortcut

That is the whole of it. The phone now posts yesterday's readings every morning.

## Part 4 — body fat and height

Both are the weight block again with three changes. Add them after the weight
block and before action 30, so everything still goes in one request.

**Body fat percentage** — no unit dictionary, because a percentage has only one
unit, but it does need the fraction check: HealthKit stores percentages as a
fraction, and exports have been seen both ways.

- Action 7 → **Find Health Samples**, Sample Type: **Body Fat Percentage**
- Replace actions 17–21 (the dictionary lookup, the `If Factor has any value`
  and the multiplication) with:
  - **If** `Value` **is greater than** `1` → **Set Variable** `Pct` to `Value`
  - **Otherwise** → **Calculate** `Value` **×** `100` → **Set Variable** `Pct`
  - **End If**, then carry on at action 22. Actions 22–29 sit *after* this If
    rather than inside it: there is no unrecognised unit to skip here
- In the dictionary: `metric` → `bodyFatPct`, `value` → the `Pct` variable
- In action 26: `ios-bodyFatPct-`

Nobody has 0.23 % body fat and nobody has 2300 %, which is what makes this
decidable rather than a guess.

**Height** — the same as weight with a different dictionary:

- Action 5 → `cm` → `1`, `mm` → `0.1`, `m` → `100`, `in` → `2.54`, `ft` → `30.48`
- Action 7 → Sample Type: **Height**
- In the dictionary: `metric` → `heightCm`
- In action 26: `ios-heightCm-`

Height changes about never, so the 30-day window costs one sample or none.

**Waist** is not in this list because Apple Health does not hold one. Type those
into NutriCore directly; anything entered by hand is never overwritten.

## Why the recipe is shaped this way

**Why a fixed 30 days instead of asking where to resume.** The endpoint offers a
cursor — `GET` it and it says the last day already imported per metric — and a
native client should use it. In Shortcuts, reading it back costs more actions
than it saves, and it is not needed: the import is idempotent, so re-sending a
month every morning is recognised rather than duplicated. Thirty days of one
metric is about thirty samples. The cursor exists for clients moving years.

**Why `externalId` is the day.** Health samples do not expose their UUID to
Shortcuts, so the identity has to be derived — and the rule is that reading the
same history twice must produce the same id. `ios-weightKg-2026-09-05` does
that, survives travelling across timezones, and lines up with how the server
stores things anyway: one reading per metric per day. Two weigh-ins on one day
collapse to the later one, which is the number you would have quoted.

**Why the date is computed on the phone.** The server has no idea what timezone
anyone is in and deliberately does not guess. `date` is the day as your phone
saw it, which is why action 22 formats the sample's own start date rather than
sending an instant and hoping.

**Why not a ready-made `.shortcut` file.** A shortcut downloaded from the
internet is a shortcut you have not read, running with access to your health
records and carrying a credential. Fifteen minutes of tapping buys you knowing
exactly what it does — and a thing you can change when you want it to do
something else.

## Backfilling years of history

Don't do it with this. Widening action 7 to `3650` days makes the repeat loop
walk every reading you have ever taken, one at a time, on a phone.

Use the file import instead: **Settings → Import from Apple Health or Health
Connect** in NutriCore takes the `export.xml` from the Health app's own export
and parses it in your browser. Once, for the history; this shortcut for keeping
up.
