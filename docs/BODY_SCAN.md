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
4. `silhouetteFrom` estimates the background colour from a ring of border
   pixels, thresholds every pixel against it, keeps the largest connected
   component and fills enclosed holes.
5. `assessCapture` decides whether the capture is usable at all. A rejected
   capture produces **no numbers**, only reasons to retake.
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

## Capture conditions

The estimator reads a silhouette, so the conditions are not advice — a capture
that ignores them is rejected rather than quietly wrong:

- a plain, uncluttered wall in even light;
- close-fitting clothing (loose clothing is measured instead of the body);
- whole body in frame with room on both sides;
- upright, feet together, **arms slightly away from the body** so a gap is
  visible between each arm and the torso;
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
