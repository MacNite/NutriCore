# "The Last 20 Seconds" — infomercial prompt for ChatGPT

A copy-paste prompt that makes ChatGPT write the full infomercial package for
NutriCore: a timecoded script, four scenes with motivated people, at least six
PWA screen previews, every shipped feature covered including the body scan, and
generation prompts for the shots.

The creative concept is **"The Last 20 Seconds"** — the closing twenty seconds
of a meal, a workout or a check-in, when the logging happens. The film is built
so its final twenty seconds also stand alone as a hero cut.

Everything in the product brief below is taken from this repository. The
guardrails are not decoration: the body scan is an unvalidated estimate, and the
script must never call it a measurement.

---

Copy everything inside the block into ChatGPT.

```text
You are a creative director and copywriter for direct-response health-tech
video. Write the complete infomercial package for a product called NutriCore,
under the campaign concept "The Last 20 Seconds".

=====================================================================
1. THE PRODUCT (all facts below are true; do not invent features)
=====================================================================

NutriCore is a privacy-first, self-hosted food, calorie and nutrition tracker.
It is a responsive PWA (installable, works in a browser, bottom navigation on
mobile, light/dark/system themes, full German and English with locale-correct
number formatting: "1.234,5 kcal" / "1,234.5 kcal").

Positioning: it runs on your own server. No ads, no analytics, no subscription,
no external identity provider. Product tagline in the app: "Private nutrition,
clearly sourced." Nutrition data carries explicit provenance, and a value that
is unknown stays unknown instead of silently becoming zero.

Shipped features, grouped as the film should treat them:

A. Fast logging
   - Daily diary: breakfast, lunch, dinner, snacks; add, edit, remove, move an
     entry to another meal, copy a meal, copy yesterday, day-by-day navigation,
     per-meal and per-day totals.
   - Quick add, food search, favourites, recently and frequently used.
   - Barcode scanner using the phone camera; the search starts automatically
     once the code is read.
   - Food search is local-first with a deterministic order: barcode, exact
     match, favourites, recent/frequent, custom foods, cached external,
     fuzzy, then remote. Every result wears a source badge.
   - Open Food Facts lookup and free-text search, cached locally, with full
     provenance and graceful degradation when it is unreachable.
   - Custom foods with an explicit basis (per 100 g / per serving), servings
     and optional density. Empty fields stay unknown, never zero.
   - Every logged entry freezes its nutrition values at the moment of logging,
     so a later database update cannot rewrite your history.

B. AI that stays on your machine
   - "Quick meal with AI": describe a meal in plain language ("2 slices rye
     bread with butter, 2 fried eggs and 1 banana"), or add a photo of the
     plate, or paste a recipe URL. It saves straight away and enrichment runs
     in a background worker.
   - AI food search: when a search finds nothing, a local Ollama model
     reconstructs the dish, its ingredients are matched against the local
     database, and the result is reviewed and confirmed by the user before
     anything is stored. Nothing is written without that confirmation, and
     there is an opt-in setting to auto-log recognised meals.
   - Recipes: build them from existing foods, or fill them with AI from text,
     a link or a photo. Inspect nutrition per serving and per 100 g with data
     coverage; log an immutable recipe snapshot. AI imports land as a draft
     that only becomes loggable once the user confirms it.
   - Optional web research, off by default: a run may be given public source
     URLs, fetched through an SSRF guard and sanitised before the model sees
     them. Sources, assumptions and confidence are shown on the result.
   - A review screen shows every ingredient match, what was matched outright
     and what needed the AI's help, and lets the user accept or reject.
   - The AI toggle is honest: with AI off, no request ever leaves the server
     for AI purposes.

C. Targets and numbers you can audit
   - Calorie target from the Mifflin-St Jeor equation, with every component
     shown, never just the final number: BMR, activity multiplier, TDEE, goal
     adjustment, calculated target, and an optional manual override.
   - Macro targets, micronutrient summary, an energy ring for the day, and a
     coverage note that missing values are not counted as zero.
   - Sport and activity logging (walking, running, cycling, hiking, strength,
     calisthenics, HIIT, swimming, rowing, more) with intensity, duration and
     estimated active calories.

D. Progress
   - Weight log with a chart, a 7-day moving average and a goal line, plus an
     accessible text summary and a data table.
   - Nutrition progress over time: daily achievement of calorie, macro and
     micronutrient targets, with a balanced band at 90-110% of target.
   - Body check-in: enter what you measured with a tape - neck, chest, waist,
     hips, upper arm, thigh, calf, left and right - plus optional body
     composition values from a smart scale, each tagged with its source
     (manual, BIA, estimate, derived, device, scan).
   - Body progress views: a four-axis composition outline, a schematic body
     figure you can style (silhouette or measure figure, neutral / masculine /
     feminine presentation), a regional change map where increase is filled
     and decrease is hatched, measurements over time against a chosen
     reference session, and key figures: BMI, waist-to-height ratio,
     waist-to-hip ratio and relative fat mass, each with an explanation.

E. Body scan (the hero feature - handle it exactly as described)
   - Two guided photos, one from the front and one from the side, become
     estimated body circumferences at the same landmark levels the drawn
     figure uses.
   - It runs on an ordinary CPU in about 80 milliseconds per scan. No GPU, no
     downloaded model weights, no third-party service, nothing leaves the
     server.
   - Your height, from your profile, is the only thing that sets the scale.
   - Capture guidance in the app: a plain uncluttered wall, even light,
     close-fitting clothes ("loose clothing is measured instead of you"), the
     whole body in frame, standing upright with feet together and arms about a
     hand's width out from the sides, and the same spot, distance and clothing
     every time.
   - Consent is an explicit checkbox before anything is processed.
   - The photos are held only until the worker has read them, at most ten
     minutes, and are deleted in the same transaction that stores the
     estimates. They are never re-served to the browser and never logged.
   - The result screen shows each estimate beside the value already recorded,
     with the range it could plausibly be, and the user ticks which ones to
     keep. Nothing is recorded until they do. A capture that is too poor to
     read produces no numbers at all, only reasons to retake.
   - HARD LIMITS, and the script must respect them: it is an estimate of the
     outline of a body, not a measurement; it is not validated against a tape
     measure or a reference scanner; and no body-fat, muscle-mass, body-water
     or bone value is ever produced from a photo.

F. Ownership and control
   - Local accounts with Argon2id password hashing, session tokens stored only
     as hashes, HTTP-only cookies, logout, and account deletion that really
     deletes.
   - Export everything: versioned JSON of all personal records, diary as CSV,
     weight history as CSV. Credentials are excluded.
   - Administration for the admin role: single-use invite links, batch
     invites, activate and deactivate accounts, watch the background AI job
     queue with its retries and errors, and check service reachability.
   - Deploys with Docker Compose or on TrueNAS SCALE; health endpoint at
     /api/health; the first registered account becomes the administrator.

Visual identity:
   - Accent green #1f6b48 on an off-white #f4f7f3 in light mode; accent
     #5cc490 on near-black in dark mode. Calm, clinical-but-warm, generous
     white space, rounded cards, real numbers on screen.
   - Bottom navigation labels: Today, Diary, Foods, Recipes, Progress,
     Settings.

=====================================================================
2. THE CONCEPT: "THE LAST 20 SECONDS"
=====================================================================

Every meal, every workout, every check-in has a last twenty seconds - the part
where most people stop paying attention. NutriCore is what happens in those
twenty seconds. Open the line ("Your last twenty seconds decide the day") and
pay it off at the end.

Structure the film so the final 20 seconds work as a standalone hero cut: same
audio bed, same closing card, no dangling references to earlier shots.

=====================================================================
3. WHAT TO DELIVER
=====================================================================

Deliverable 1 - Master script, 90 seconds, in a timecoded table.
Columns: TIME (0:00-0:03 style), SCENE, SHOT (framing and camera move),
ON-SCREEN UI (which app screen, and what is visibly on it), VO (English),
ON-SCREEN TEXT (English), SFX/MUSIC.
Rules:
   - Voice-over must be speakable inside its timecode: about 2.5 words per
     second. Count it and keep it honest.
   - Every feature group A-F appears. The body scan gets its own beat of at
     least 15 seconds, with its privacy promise on screen.
   - At least six PWA screen previews, each specified precisely enough that a
     designer could mock it up (see deliverable 4).
   - No feature is named without being shown.

Deliverable 2 - Four scenes with motivated people. Real, specific, unglamorous
people, each with a name, an age, a situation and a reason they track. Suggested
cast, adapt freely but keep the range:
   1. A shift-working nurse who logs dinner at 23:40 with the barcode scanner
      and "copy yesterday", because decisions at that hour should be small.
   2. A father cooking for a family who fills a recipe with AI from a photo of
      a handwritten card, then logs one serving.
   3. A woman eighteen months into strength training who takes her weekly body
      scan against the same bedroom wall and keeps two of the four estimates.
   4. A self-hoster in his fifties who runs NutriCore for his household on a
      NAS in a cupboard, invites his partner with a single-use link, and
      exports the year as JSON because it is his data.
For each: two lines of backstory, what they do on camera, the one line of
dialogue or VO they carry, and the emotional beat. Motivated, not desperate. No
shame, no before/after body-transformation framing, no scale-victory tears.

Deliverable 3 - Cutdowns, each fully timecoded, not summarised:
   - 60 s broadcast cut
   - 30 s social cut (feature-led)
   - 20 s "Last 20 Seconds" hero cut
   - 6 s bumper, one feature, one line
Say explicitly which master shots each cutdown reuses.

Deliverable 4 - PWA preview shot list. Pick at least six screens from this set
and specify each one: Today (energy ring, kcal consumed of target, quick add,
barcode, recent), Diary (four meals, day total, snapshot note), Quick meal with
AI (text field with the rye-bread example, photo attached, servings stepper),
Foods search (mid-typing, results with source badges: OFF, My food, Recipe, AI
estimate), Recipe with AI fill (ingredient matches and coverage), AI review
(ingredient list, accept/reject), Progress (weight chart with 7-day average and
goal line), Nutrition progress (targets over time, 90-110% band), Body
check-in (tape measurements, source per value), Body scan capture (front/side
slots, conditions list, consent checkbox, retention line), Body scan result
(estimate, range, current value, per-row "Keep" toggles), Body progress
(composition outline, figure, regional change map, BMI/WHtR/WHR/RFM), Settings
(AI toggle with "no request ever leaves this server", export buttons),
Administration (invites, job queue).
For each screen give: the device frame (phone portrait or tablet), light or
dark mode, the state shown, three to five specific labels and numbers visible
(plausible values, e.g. "1.847 of 2.150 kcal"), the transition in and out, and
how long it holds. Include at least one German-language screen and at least one
dark-mode screen, and show the install-to-home-screen moment once.

Deliverable 5 - Generation prompts. For every live-action shot, a ready-to-use
text-to-video prompt (Sora / Veo / Runway style): subject, wardrobe, location,
lens and framing, camera move, lighting, mood, duration, and a negative
prompt. For every UI shot, a mockup brief a designer or an image model can
execute using the palette above. Keep casting descriptions free of stereotype
shorthand.

Deliverable 6 - Audio and post: music direction (genre, BPM, arc, where it
drops for the body-scan beat), SFX list, VO casting notes (two options, warm
and plain-spoken, not hype-announcer), and burned-in-subtitle direction.

Deliverable 7 - Localisation. Provide the full German voice-over and on-screen
text alongside the English. German must be idiomatic marketing German, not a
translation, and must use German number formatting.

Deliverable 8 - Claims-compliance pass. A table of every claim the script
makes, and for each: the feature it rests on, and a verdict of SAFE or
REWRITE-REQUIRED. Flag anything you had to soften.

=====================================================================
4. GUARDRAILS - non-negotiable
=====================================================================

   - Never call the body scan a measurement. It estimates. It is not
     validated. Use words like "estimate", "range", "you decide what to keep".
   - Never claim NutriCore produces body fat, muscle mass, body water or bone
     values from a photo. It does not.
   - No medical claims, no weight-loss promises, no timelines ("lose 5 kg in
     a month"), no "clinically proven", no doctor-in-a-white-coat authority
     shot.
   - No fabricated testimonials, no fake ratings, no invented download or
     user counts, no invented awards or press quotes. The four people are
     openly illustrative composites; label them as such in the cast notes.
   - No calorie-counting-as-self-punishment tone. No body shaming. No
     "cheat day" guilt. The product's honesty about unknown values is the
     emotional core: it does not pretend to know things it cannot know.
   - Do not imply a cloud service, an app-store app, a free trial or a
     subscription. It is self-hosted software you install.
   - Keep the privacy claims exactly as scoped: photos deleted within ten
     minutes and in the same transaction as the estimates, no third-party
     service, nothing leaves the server for AI when AI is off.
   - Accessibility is part of the product, so show it: mention that charts
     carry text summaries and tables, and keep on-screen text high-contrast
     and large enough to read on a phone.

=====================================================================
5. OUTPUT FORMAT
=====================================================================

Use markdown. One "##" section per deliverable, in order, with the tables as
specified. Put the master script table first. Do not summarise a deliverable
or say you will provide it later - write all eight. Do not ask clarifying
questions before writing; where something is genuinely open, make a decision,
write it, and note the assumption in one line at the end.
```

---

## Notes on using it

- If the model truncates, ask for deliverables 1-4 first, then 5-8 in a second
  turn; the prompt is written so the halves stand alone.
- Swap the cast in deliverable 2 for real people only with their consent, and
  drop the "composite" label if you do.
- If anything in the product brief changes, update it here rather than patching
  the generated script — the brief is the part that has to stay true.
