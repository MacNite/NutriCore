# “The Last 20 Seconds” — infomercial prompt for ChatGPT

A copy-paste prompt that makes ChatGPT write the full infomercial package for
NutriCore: a timecoded script, four scenes with motivated people, at least six
PWA screen previews, every shipped feature covered including the body scan, and
generation prompts for the shots.

The creative concept is **“The Last 20 Seconds”** — the closing twenty seconds
of a meal, a workout or a check-in, when the logging happens. The film is built
so its final twenty seconds also stand alone as a hero cut.

Everything in the product brief below is taken from this repository. The
guardrails are not decoration: the body scan is an unvalidated estimate, and the
script must never call it a measurement.

## Copy everything inside this block into ChatGPT

```text
You are a senior direct-response creative director, film writer, storyboard
artist, PWA product marketer, and advertising claims editor. Build a complete,
production-ready infomercial package for NutriCore from the locked brief below.
Do not ask follow-up questions. Make sensible creative choices, state them, and
complete every deliverable.

CAMPAIGN
Title/concept: “The Last 20 Seconds”
Core observation: the habit is won in the closing twenty seconds of a real
moment — after a meal, after a workout, or during a check-in — when a person
records what actually happened.
Film architecture: write one 80-second master film. Its final 20 seconds
(01:00–01:20) must also work, unchanged and without missing context, as a
standalone 20-second hero cut. The hero cut must identify NutriCore, show the
product, communicate its useful difference, include an honest call to action,
and obey every claims guardrail.

AUDIENCE AND TONE
- Audience: adults who want useful nutrition and progress data without ads,
  surveillance, subscriptions, or pretending uncertain data is exact.
- Tone: human, motivated, calm, capable, specific, warm, lightly cinematic.
- Show effort without shame, punishment, miracle language, or transformation
  clichés. People are living their lives, not performing “before” and “after.”
- Direct-response clarity with premium restraint. No hard sell, fake urgency,
  medical framing, or promises of weight loss or health outcomes.
- Use natural English for spoken copy. UI may show English. Note where a German
  localisation version would need alternate inserts.

CAST AND SCENES
Use four fictional composite people. Label every person “fictional composite”
in the cast table so nobody is presented as a real customer or testimonial.
Give each person a specific, non-medical motivation, an everyday environment,
and a small completed action. Keep the group varied in age, body shape, gender
presentation, skin tone, mobility, and household context without tokenising
anyone.

The four intercut story scenes are:
1. The last 20 seconds of a meal: quick meal logging from text and/or a meal
   image, then a visible queued/review state and provenance rather than magic.
2. The last 20 seconds of a workout: log activity type, intensity, and duration;
   show the estimated active calories as their own record. Whether they are
   added to that day's calorie target is the person's setting (on by default),
   so show it as a choice they made, never as a promise that exercise “earns”
   food.
3. The last 20 seconds of a manual body check-in: enter weight and selected body
   circumferences, then see progress in charts/table and the body visualisation.
4. The last 20 seconds of a guided optical body scan: front and side capture,
   processing, ranges on the review screen, and the person choosing whether to
   accept, edit, or discard each estimate. The person wears close-fitting,
   non-revealing athletic clothes against a plain wall; the filming is dignified
   and non-objectifying.

LOCKED PRODUCT BRIEF — SHIPPED NOW
NutriCore is a privacy-first, self-hosted food, calorie, nutrition, activity,
weight, and body-progress tracker for a private server. It is a responsive PWA.
It has no ads, analytics, or subscription. Do not call it a cloud service or
imply that NutriCore hosts the viewer’s data.

Accounts and setup
- Local email/password accounts; onboarding/profile includes display name,
  language, date of birth, height, weight, biological sex, activity level, and
  goal.
- A transparent Mifflin–St Jeor calorie target shows BMR, activity multiplier,
  TDEE, goal adjustment, calculated target, and any manual override — not only
  one unexplained number.
- Settings include profile, calorie-target override, language, optional AI and
  web-research controls, light/dark/system theme, exports, password/account
  controls, and invitations where enabled.
- German and English are supported with locale-correct number formatting.

Daily food and nutrition
- Today/daily diary with breakfast, lunch, dinner, and snacks; add, edit,
  remove, copy previous day, navigate days, and see meal/day totals.
- Energy and macro summaries, micronutrients, and nutrition coverage. Unknown
  nutrition stays unknown rather than silently becoming zero.
- Every diary entry freezes its nutrition snapshot at logging time so later
  provider changes do not rewrite history.
- Food search is local-first and includes barcode, exact matches, favourites,
  recent/frequent foods, custom foods, cached external foods, fuzzy matching,
  then remote results. Ranking is deterministic and source badges are visible.
- Two generic food databases ship with the application and answer without any
  network request: the Bundeslebensmittelschlüssel (BLS) 4.0 for German, and
  USDA FoodData Central (Foundation and SR Legacy) for English. Which is asked
  first follows the interface language. A USDA API key is optional and only
  extends the search online.
- Open Food Facts powers optional barcode and text lookup with caching,
  provenance, and graceful failure when unreachable.
- A barcode can be scanned with the device camera from the search field and the
  recipe form, and typed by hand as well. A live camera needs an HTTPS origin.
- Users can create custom foods with serving/basis information and optional
  density; empty nutrient fields remain unknown.
- Recipes can be created and edited from foods, show nutrition per serving and
  per 100 g with coverage, and log immutable recipe snapshots.
- A recipe can be published to the other members of the same installation, and
  another member can save it as their own independent copy. This is
  instance-local only: no public access, no federation, no feed, no profiles, no
  comments and no ranking. Do not present it as social networking or as sharing
  beyond the private server.

Optional local AI and research
- AI features are optional and use a separately operated local Ollama service;
  do not imply AI is required or that NutriCore bundles/runs the model.
- Quick meal input can use free text, an image, a public recipe URL, or a
  combination. It runs asynchronously. The UI shows a queued/running
  placeholder while work is in progress.
- The model decomposes a meal into components; NutriCore resolves those against
  known foods and calculates totals. Sources and estimates remain visible.
- With automatic AI meal logging enabled, resolved components may be applied
  when processing finishes. With it disabled, the proposal waits for human
  acceptance. Users can review matches; unresolved components are skipped, not
  logged as zero.
- AI can import a recipe from text, an image, or a public URL as a reviewable
  draft. It can also research missing food data when enabled and consented.
  Web research is off by default, source URLs remain visible, and nothing is
  silently accepted as fact.

Activity and progress
- A daily activity log records activity, intensity, and duration, from a curated
  library of 21 activities with intensity variants. Active-calorie estimates use
  a MET value from the 2024 Adult Compendium of Physical Activities, snapshotted
  per entry with its compendium code and the body weight used, so an old entry
  never silently changes.
- Adding those calories to that day's calorie target is a per-user setting in
  Settings, on by default. The stored Mifflin–St Jeor target is never rewritten:
  the addition happens when the day is read, so turning the setting off restores
  the plain target without touching any history. Always call the active-calorie
  figure an estimate.
- Weight tracking includes entries, notes, a chart, seven-day moving average,
  goal line, accessible text summary, and table.
- Nutrition progress charts use diary history and the applicable target.
- Manual body check-ins can record body circumferences. Progress can be shown
  through history, key figures/table, and a configurable drawn body figure;
  provenance distinguishes manual values from accepted optical estimates.

Optical body scan — exact truth and mandatory language
- This is an opt-in, guided two-view capture from front and side photographs.
  It estimates selected body circumferences from silhouette geometry on an
  ordinary CPU. It uses no learned model, GPU, third party, or Ollama, and body
  images never reach the AI provider.
- THE ESTIMATOR HAS NOT BEEN VALIDATED against a tape measure or reference
  scanner. Its uncertainty intervals are reasoned estimates, not measured limits
  of agreement. It is not known to be accurate.
- It returns estimates with ranges. Rejected captures produce no numbers, only
  retake reasons. Some obscured levels may be omitted. Upper arms are not
  estimated. Left/right paired values may be the same because a silhouette
  cannot distinguish them.
- It does not estimate body fat, muscle mass, body water, bone, visceral fat, or
  any diagnosis. Body-fat display, if mentioned at all, is a separate RFM
  estimate derived from waist and height.
- A scan writes no body measurement directly. On review, the user chooses each
  value to keep or discard. Accepted values carry optical-scan provenance; an
  edited value is manual.
- Images are transient: normally read once and deleted in the same transaction
  that stores estimates; they expire after ten minutes, with cleanup/backstops
  for failures. A database backup taken during that short window can contain
  them, so do not claim “never stored.”
- Describe repeated, similarly captured scans as potentially more useful for
  seeing a trend than a single estimate, but make no accuracy or outcome claim.

Privacy, ownership, administration, and portability
- Self-hosted/private-server positioning; no ads, analytics, or subscription.
- Nutrition data has visible provenance; unknown values remain unknown.
- Personal JSON export is versioned; diary and weight CSV exports are available;
  credentials are excluded.
- Admin-only tools include single-use invitations and batch invitations,
  account activation/deactivation, AI job queue/retry/error controls, and service
  diagnostics. Mention these as operator capabilities, not consumer benefits.
- The responsive PWA supports mobile bottom navigation plus desktop layouts and
  a PWA manifest.

NOT SHIPPED — NEVER PRESENT AS AVAILABLE
- AI research does not find its own sources. Source URLs for a research run are
  supplied by hand; do not show automatic source discovery on that screen.
- There is no fallback model. A low-confidence answer is reported as
  low-confidence; it is not silently retried against a larger model.
- Activity entries are not yet part of the JSON export. Do not show them in it.
- Do not invent wearables, Apple Health, Google Fit, step tracking, coaching,
  public or cross-instance social sharing, streaks, push notifications, cloud
  sync, multi-device sync, offline data entry, automatic food recognition
  without review, or medical advice.

NON-NEGOTIABLE CLAIMS GUARDRAILS
1. Never call the optical body scan a “measurement,” “3D scan,” “accurate,”
   “precise,” “validated,” “clinical,” or “AI body scan.” Use “optical estimate,”
   “two-view estimate,” “silhouette-based estimate,” or “estimated range.”
2. Never say “your photos never leave your device.” Processing is on the
   self-hosted server. Accurate phrasing: “processed on your private server,”
   “not sent to the AI provider or a third party,” and “cleared after processing
   or expiry,” with the brief backup caveat in long-form copy.
3. Never imply that calorie, active-calorie, body-composition, or circumference
   estimates are facts. Make “estimate” visible in VO or on-screen copy wherever
   ambiguity could arise.
4. No medical, diagnostic, therapeutic, guaranteed-result, rapid-change, or
   universal-accuracy claims. No invented statistics or customer quotes.
5. Do not imply the app removes the need for judgment. Show review, provenance,
   unknown values, ranges, and user choice as strengths.
6. Do not invent UI controls or screens. Mockups may simplify layout, but every
   visible action and state must map to the locked brief.
7. Do not put sensitive real personal data on screen. Use clearly fictional,
   internally consistent demo names and plausible but non-diagnostic values.

VISUAL DIRECTION
- Contemporary documentary realism, practical locations, natural light, gentle
  handheld or restrained dolly movement, tactile end-of-action sounds.
- The recurring visual motif is a 20-second circular countdown/progress arc that
  resolves into NutriCore’s daily energy ring. It may be an editorial graphic,
  not an invented in-app timer.
- Product UI is legible and central, filmed as clean device inserts or built as
  faithful screen replacements. Prefer a phone for logging and a laptop/tablet
  for review/admin/progress views.
- Avoid green “health halo” clichés, neon holograms, floating impossible UI,
  gym intimidation, food moralising, tape measures snapping around bodies, and
  voyeuristic body-scan imagery.
- Sound motif: plate set down, workout timer ending, keyboard/tap confirmation,
  quiet breath; these clicks form the rhythm entering the final 20 seconds.

REQUIRED PWA SCREEN PREVIEWS
Specify at least ten distinct, production-ready previews. Include all of these:
1. Today dashboard with energy/macros, meal sections, micronutrient coverage,
   source badges, and recent foods.
2. Food search/results with local-first ordering, barcode route, source badges,
   favourites/recent/custom/Open Food Facts examples, and unknown values shown
   as unknown — not zero.
3. Quick meal input (text/image/public URL) plus queued/running placeholder.
4. AI meal review showing resolved source, a clearly badged estimate, a skipped
   unresolved component, and accept/reject or review controls as applicable.
5. Recipe editor/nutrition coverage plus AI-imported draft review.
6. Activity editor with activity, intensity, duration, and estimated active
   calories visibly separate from the daily allowance.
7. Progress view with the measurement series over time, its trailing average
   and goal line, nutrition trend, accessible summary/table cue, and the
   weight entry log.
8. Manual body check-in and body-progress visualisation/history.
9. Body-scan capture guidance: front/side, plain wall, close-fitting clothing,
   full body, arms about a hand’s width from the torso, and consent/expiry copy.
10. Body-scan review with estimated ranges, omitted-level/retake state, prior
    values, per-value keep/edit/discard, and provenance wording.
11. Transparent calorie-target breakdown and manual override.
12. Settings/export/admin montage: English/German, theme, AI/research toggles,
    JSON/CSV export, invitations, queue, and diagnostics; clearly separate
    ordinary-user settings from admin-only screens.

DELIVERABLES — OUTPUT IN THIS EXACT ORDER

1. CREATIVE NORTH STAR
In 250 words or fewer: single-minded proposition, audience tension, campaign
promise, reason to believe, tone, visual motif, sound motif, and one-line CTA.
Flag any phrase that should be legal/claims-reviewed.

2. FOUR-SCENE CAST AND STORY MATRIX
Make a table with one row per fictional composite. Columns: person and
“fictional composite” label; non-medical motivation; location/time; opening
action; exact last-20-seconds logging action; PWA screens seen; feature burden;
emotional turn; accessibility/wardrobe/consent notes. Then explain in 100 words
how the stories intercut without making the app feel frantic.

3. 80-SECOND MASTER FILM — TIMECODED SCRIPT
Use a table with continuous timecodes from 00:00 to 01:20. Columns: time;
picture/action; camera/edit; exact UI shown; dialogue/VO; on-screen copy;
sound/music; claims/continuity note. Cover all four people and all major
consumer-facing shipped capabilities without turning the VO into a list.
The final section must begin exactly at 01:00 and be labelled HERO CUT BEGINS.
Keep spoken copy realistically performable at about 2–2.5 words per second.

4. STANDALONE 20-SECOND HERO CUT
Reprint 01:00–01:20 verbatim as its own table — no rewritten lines or substitute
shots. Then add a pass/fail checklist confirming it independently contains:
NutriCore’s name, product view, self-hosted/privacy difference, useful action,
honest estimate language if the scan appears, CTA, and a clean opening/ending.

5. PWA SCREEN PREVIEW BIBLE
Provide at least the twelve required previews above. For each give: preview ID;
screen/state; device and orientation; purpose in the story; exact visible UI
modules and controls; exact sample data/copy; provenance/unknown/estimate labels;
interaction before and after the frame; master-film timecode; safe-area and
legibility notes; dark/light theme; and a wireframe-style layout description a
designer could reproduce. Keep fictional data consistent across every preview.

6. SHOT LIST AND GENERATION PROMPTS
For every live-action shot and every clean UI insert, provide:
- shot ID and linked timecode;
- duration, framing, lens feel, camera movement, lighting, production design,
  performance beat, transition, and required continuity;
- one self-contained text-to-image keyframe prompt;
- one self-contained image-to-video/video-generation prompt describing only
  visible motion, camera motion, timing, and stable elements;
- a negative prompt covering anatomy, hands, device geometry, text gibberish,
  logos, impossible reflections, unwanted body transformation, and invented UI;
- aspect-ratio/crop guidance for 16:9 master plus 9:16 and 1:1 adaptations.
Generation prompts must identify people as fictional composites and must never
ask an image model to render readable final UI text. Use blank/tracked screens
for compositing; provide the corresponding preview ID for post-production.

7. COPY, CTA, AND CLAIMS PACK
Provide: final VO as one read; all supers/end cards; CTA variants (self-host,
GitHub/source, and neutral “learn more”); a 60-word description; a 150-word
description; six headlines; six social captions; alt text for each hero frame;
captions/subtitle file in WebVTT for the master; and a claims table with columns
claim, evidence from locked brief, required qualifier, risk level, approved
wording, prohibited shorthand. Include the body-scan backup caveat in the
long-form description or a clearly linked disclosure.

8. FEATURE-COVERAGE AND PRODUCTION QA
Make a row-by-row matrix mapping every bullet in the locked shipped brief to at
least one script timecode and/or preview ID. Separately list every not-shipped
item and confirm it is absent. Finish with checks for: exactly four scenes;
continuous 80 seconds; identical final/standalone 20 seconds; at least twelve
screen previews; all composite labels present; body scan always called an
estimate and never a measurement; active calories not added to allowance;
unknown nutrients never shown as zero; no invented integrations; readable
mobile UI; caption coverage; safe crops; and sample-data consistency. If any
check fails, revise the affected earlier deliverable before presenting the final
answer, then mark it PASS.

OUTPUT RULES
- Be concrete enough to hand directly to a director, editor, UI designer,
  motion designer, and generation artist.
- Use Markdown headings and tables. Do not collapse required fields into prose.
- Do not use placeholders such as “TBD,” “etc.,” “show app,” or “more features.”
- Keep product facts inside the locked brief. When a creative detail is not a
  product fact, label it “creative direction.”
- If output length becomes a constraint, complete deliverables 1–4 first and
  stop after a clear divider that says “CONTINUE WITH DELIVERABLES 5–8.” On the
  next turn, continue from deliverable 5 without revising 1–4 unless asked.
```

## Notes on using it

- If the model truncates, ask for deliverables 1–4 first, then 5–8 in a second
  turn; the prompt is written so the halves stand alone.
- Swap the cast in deliverable 2 for real people only with their consent, and
  drop the “fictional composite” label if you do.
- If anything in the product brief changes, update it here rather than patching
  the generated script — the brief is the part that has to stay true.
