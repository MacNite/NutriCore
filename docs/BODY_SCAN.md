# Body scanning

A guided two-view capture estimates body circumferences from a front and a side
photograph. It runs on an ordinary CPU, needs no GPU, no model weights, no
network and no third party.

**It is not a measurement.** It estimates the outline of a body and reports what
that outline implies, with an interval. Nothing about body fat, muscle mass,
body water, bone or visceral fat can be read from a photograph, and none of them
is produced here.

## Status

Shipped as an opt-in way to fill in a check-in. **The accuracy of the estimator
has not been validated against a tape measure or a reference scanner.** The
intervals in `RELATIVE_UNCERTAINTY` (`src/lib/body-scan.ts`) are reasoned
guesses, not measured limits of agreement. Before any of this is described as
accurate anywhere a user can read it, it needs the study in
[Validation](#validation-before-any-accuracy-claim) below.

Treat a change across several scans taken the same way as more meaningful than
any single number.

## How it works

1. The user photographs themselves from the front and from the side against a
   plain wall, in close-fitting clothes, whole body in frame.
2. Both images are stored on the scan row and a `BODY_SCAN` job is queued. The
   images are never re-served to the browser and never logged.
3. The worker decodes each image with `sharp` at up to 1024 px on the longest
   edge, applying and then discarding EXIF orientation.
4. `silhouetteFrom` (`src/lib/silhouette.ts`) estimates the background colour as
   the median of a ring of border pixels, thresholds every pixel against it,
   keeps the largest connected component and fills enclosed holes. It is pure
   and free of `sharp`, so it is tested on pixel arrays directly — and it is the
   seam a segmentation model would replace, since everything after it is
   geometry that does not care where the mask came from.
5. `assessCapture` decides whether the capture is usable at all, and which
   individual levels the arms have spoiled. A rejected capture produces **no
   numbers**, only reasons to retake; an accepted one may still omit a level,
   and says which and why.
6. `estimateCircumferences` reads the body's width at each landmark level in the
   front view and its depth at the same level in the side view, scales both by
   the declared height, and takes the perimeter of the ellipse through those two
   axes.
7. The estimates are stored and **the images are deleted in the same
   transaction**.
8. The user reviews each value beside what is already recorded and chooses which
   to keep. Nothing reaches a `BodyMeasurement` before that.

### Why an ellipse

A front view gives breadth; a side view gives depth. The cross-section through
those two axes is closer to an ellipse than to either a circle or a flat plane,
and Ramanujan's approximation is exact enough that its error is orders of
magnitude below everything else in the pipeline.

### Landmarks

Levels come from `BODY_LANDMARKS` in `src/lib/body-visualization.ts` — the same
fractions of stature the drawn body figure is built from. A scan and the figure
it feeds are answerable to one model of where a waist is, rather than two that
can drift apart. Changing a landmark is a claim about anatomy and changes both.

### Measuring through the arms

A row across the waist also crosses the arms, so the distance from the leftmost
foreground pixel to the rightmost is the span of the arms, not the width of the
torso. Torso levels therefore use the contiguous run through the body's centre
line (`centralRunWidth`). Leg levels use the filled pixel count halved, since
that row crosses two legs and the gap between them must not be counted.

That only works where the arm is separated from the trunk by background. Where
it is not — an upper arm resting against the ribcage — the centre run is the
torso *plus* both arms, and no later check would catch the inflated number. So
`armClearance` decides, per level, whether the arms leave it readable:

- a level above the shoulder line, or below a whole arm's reach, has no arm on
  it whatever the pose;
- arms held out and up clear every torso level below them at once, recognised
  from the shoulder line being far wider than the chest;
- otherwise the level needs a real background gap either side of its trunk run,
  measured as the clearance from the arm's inner edge and scaled to stature
  rather than to the frame.

How far down the arms reach is read from the mask — the lowest row a gap appears
on — not assumed from arm length. Arms held out reach much less far down than
arms hanging, and assuming the latter reports a hip as obscured by an arm that
ends above it.

A level the arms spoil is **left out and named**, not fixed up and not fatal to
the scan: the other levels came off the same mask and are no worse for it. Only
arms flat against the body all the way down — no gap at the chest, the waist or
the hip — rejects the capture, because then there is no trunk width anywhere.

A hand hanging beside a thigh is the same problem in the other direction: the
row is halved, so a hand is counted as leg. A leg level therefore has to cross
the two legs and nothing else.

**This check used to be one boolean at one row**, halfway between the shoulder
and the armpit — which is *above* the armpit, where an arm is joined to the
deltoid at any pose short of holding it out horizontally. In practice only an
exaggerated T-pose passed, a natural stance with the arms visibly clear of the
body was rejected as "arms touching", and a *perfect* T-pose failed too, because
arms held level leave that row entirely and it reads as a bare torso. The test
that covered it drew two arms parallel to the torso with a constant strip of
background from shoulder to hip — a body nobody has — so it looked correct.

### What is deliberately not estimated

**Upper arms.** A front view crosses the arms and the torso at the same height,
and the torso width at that level is not observable. Inferring it from a level
below the armpit fails on any body whose chest is wider than its shoulders,
which is most of them. A number that cannot be defended is worse than a missing
one, so the arm is left to the tape measure.

**Body composition.** Body fat, muscle, water and bone are not derived from a
scan. Body fat continues to come from the existing RFM estimator, which is
labelled an estimate and derived from waist and height.

**Left versus right.** A silhouette does not say which leg is which, so a paired
estimate fills both columns with the same value. The review screen says so.

## Privacy

Two near-unclothed photographs are the most sensitive bytes this application
ever holds, and the design follows from that.

- The images live on the `BodyScan` row, because this deployment has no object
  storage — the whole stack is Postgres, an app container and a worker.
- They are read exactly once and cleared in the transaction that stores the
  estimates.
- `imagesExpireAt` is a ten-minute deadline. The worker sweeps past-deadline
  images every 60 seconds, so a crash between reading and writing still loses
  them within about a minute.
- A scan that expires before it was processed becomes `EXPIRED`: without its
  images it can never be processed.
- If nothing is running to do any of that — a stopped or crash-looping worker —
  the review page ends the scan itself: past the same deadline, a scan still
  `QUEUED` or `PROCESSING` is recorded as `TIMED_OUT` and its images cleared on
  the read path. The write path is the thing that is not running, so the
  backstop cannot live there. The update is conditional on the scan still being
  unprocessed, so a worker finishing at that moment wins.
- Failure paths clear the images too, and the job is given `maxRetries: 0` —
  the images are gone after one attempt, so a retry has nothing to read.
- Nothing is sent to the AI provider. Body images never touch Ollama, and the
  scan pipeline shares no code with it.
- A mesh, if a future provider returns one, is discarded. Retaining a
  reconstructed body needs its own consent, not a provider upgrade.
- Account deletion cascades. The JSON export includes estimates, decisions and
  the consent version — never the images, which are gone long before.

### The backup caveat

A `pg_dump` taken while a scan is waiting for the worker contains those images.
The window is minutes, and the same is true of meal and recipe-import photos.
This is the cost of having no object storage; it is stated rather than hidden.
If it matters for your deployment, take backups on a schedule rather than while
scans are running, or encrypt them at rest.

## Every scan ends

`QUEUED` and `PROCESSING` are transient, and every scan reaches exactly one of
`AWAITING_REVIEW`, `ACCEPTED`, `REJECTED`, `FAILED`, `EXPIRED` or `TIMED_OUT`.
The last is the app's own backstop, described under [Privacy](#privacy): it is
what stops a stopped worker showing "processing your scan" indefinitely.

`TIMED_OUT` is kept distinct from `EXPIRED` because they point somewhere
different. `EXPIRED` is "the sweeper cleared the images before the worker read
them", which is a slow queue. `TIMED_OUT` is "nothing picked this up at all",
which is an operator problem, and the copy says so.

The review page reports which of the two waits a scan is in — queued, or being
read — and every ending offers a retake.

## Capture conditions

The estimator reads a silhouette, so the conditions are not advice — a capture
that ignores them is rejected rather than quietly wrong. The camera is optional:
each view offers a camera button and a file-picker button, and on a plain-HTTP
LAN deployment (where a browser refuses camera access) both open the picker and
nothing else changes. A height in the profile is required, because it is the
only thing that sets the scale.

- a plain, uncluttered wall in even light;
- close-fitting clothing (loose clothing is measured instead of the body);
- whole body in frame with room on both sides;
- upright, feet together, **arms roughly a hand's width out from the sides** so
  a gap is visible between each arm and the torso, hands clear of the thighs (a
  natural stance is enough; there is no T-pose to hold);
- the same spot, distance and clothing every time.

Skin against a similarly toned wall defeats the threshold. That fails to an
empty or merged mask, which a quality check rejects — not to a plausible wrong
answer.

## Performance

Roughly **80 ms for two 720×1280 images** on an ordinary x86 core, single
threaded, including PNG decode. Cost is linear in pixels and capped by the
1024 px working edge. There is no GPU anywhere in this feature and no model to
load.

The work still runs in the queued worker rather than in the request. That is a
house rule about page interactions, not a statement about how long it takes.

## Replacing the estimator

`BodyScanProvider` in `src/providers/body-scan.ts` is the seam. A provider takes
two images, a height and a weight, and returns measurements with intervals plus
its own name, model and version. A future mesh-fitting, learned or vendor
provider satisfies the same interface and may additionally return a `mesh`.

Nothing downstream requires a mesh. The progress figure is drawn from
circumferences by `body-visualization.ts`, so the avatar never depended on 3D
reconstruction — which is why the expensive half of a conventional body-scan
pipeline could be left out without losing a user-facing feature.

If you add a provider:

- bump the version, and expect the trend chart to need a discontinuity marker
  where the method changed;
- keep returning intervals — a bare decimal is not an acceptable output here;
- re-run the validation below. Accuracy does not transfer between estimators.

An ONNX or PyTorch provider will not run in the current image: it is Alpine, and
neither ships musl builds. That means moving the runtime stage to a glibc base
(`node:22-slim`) or running the provider in a sidecar.

## Validation before any accuracy claim

Nothing here has been validated. A defensible claim needs, at minimum:

1. each measurement plane and the intended population defined in advance;
2. comparison against repeated expert tape measures or a calibrated scanner;
3. bias, MAE/RMSE and **95% limits of agreement** — not correlation;
4. same-session test/retest and between-day repeatability, captured by users at
   home rather than by trained staff;
5. subgroup results across body size, age, sex, skin tone, clothing and mobility;
6. the failed-capture rate, which is a product outcome and not a footnote;
7. a frozen, recorded estimator version.

The product gate is that repeatability is clearly smaller than the change the UI
claims to show. Until that exists, the wording stays as it is: an estimate, with
a range, that the user chooses to keep or discard.
