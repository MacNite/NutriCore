import { writeFile } from "node:fs/promises";
import { processNextAiJob, reclaimStaleJobs } from "./server/ai-jobs";
import { prisma } from "./lib/db";
import { logger } from "./lib/logger";
import { flag, researchEnabled, resolveAiBaseUrl, resolveAiModel } from "./lib/env";
import { ollamaMaxOutputTokens, ollamaTimeoutMs } from "./providers/ollama";
import { cleanupExpiredMealImages } from "./server/meal-image";
import { cleanupExpiredScanImages } from "./server/body-scan";
import { pruneExpiredProviderFoods } from "./server/foods";
import { sweepRetention } from "./server/retention";
import { pruneRateLimitBuckets } from "./server/durable-rate-limit";
import { importAllDatasets } from "./server/food-datasets/import";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pollMs = () => {
  const configured = Number(process.env.AI_WORKER_POLL_MS ?? 2000);
  return Number.isFinite(configured) && configured > 0 ? configured : 2000;
};

const heartbeatFile = () => process.env.NUTRICORE_HEARTBEAT_FILE ?? "/tmp/nutricore-worker.heartbeat";

/**
 * Liveness for the container healthcheck. The worker serves no HTTP, so without
 * this the image's HTTP healthcheck could never pass and the container stayed in
 * "starting" until it was declared unhealthy - which is what made a working
 * worker hold the whole stack in "Deploying". Written before each poll, so the
 * timestamp reflects the loop and not merely the process being alive.
 */
async function beat() {
  try {
    await writeFile(heartbeatFile(), `${Math.floor(Date.now() / 1000)}\n`, "utf8");
  } catch (error) {
    // A read-only /tmp must not stop the queue; the healthcheck will report it.
    logger.warn("Could not write the worker heartbeat", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

const RECLAIM_EVERY_MS = 5 * 60 * 1000;

/**
 * Uploaded images are swept on their own, faster cadence than stale jobs are
 * reclaimed. Their retention window is the window a database dump can catch one
 * in, so the sweep interval is part of the privacy promise rather than a
 * housekeeping detail, and it should stay well under the shortest TTL.
 */
const SWEEP_EVERY_MS = 60 * 1000;

/**
 * Clears every kind of upload whose deadline has passed.
 *
 * Both ingestion paths write to one table now, so one sweeper covers the quick
 * meal and the recipe import; body scans keep their own because they expire on
 * a shorter deadline and their state machine has to be moved on as well.
 *
 * A sweep failure must not stop the queue: these are all deletions that will be
 * retried a minute later, and a worker that exits over one leaves the images it
 * was trying to remove exactly where they are.
 */
async function sweepExpiredImages() {
  try {
    await Promise.all([cleanupExpiredMealImages(), cleanupExpiredScanImages()]);
  } catch (error) {
    logger.warn("Could not sweep expired images", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Removes the foods a cache-limited provider supplied, once they have expired.
 *
 * This is what makes `CACHE_WITH_TTL` mean something: a provider whose terms
 * allow a live cache but not a copy of its database - FatSecret - must not
 * accumulate here. Swept on the slower cadence, because an expiry is measured
 * in hours and a food still referenced by a diary entry is kept regardless.
 */
async function pruneExpiredFoods() {
  try {
    await pruneExpiredProviderFoods();
  } catch (error) {
    logger.warn("Could not prune expired provider foods", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Applies the retention policy to the records that carry no expiry of their own:
 * ingestion text, finished job diagnostics and settled invitations.
 *
 * On the slow cadence beside `pruneExpiredFoods`, because these windows are
 * measured in days rather than the minutes an uploaded image is kept - running
 * it every minute would be a table scan a minute for nothing.
 *
 * A failure here is logged and dropped for the same reason a sweep failure is:
 * the next pass retries, and a worker that exits over a deletion leaves exactly
 * the data it was trying to remove.
 */
async function applyRetention() {
  try {
    await sweepRetention();
    // Expired windows reset themselves on next use, so this is only about
    // keeping the table from holding rows for keys nobody touches again.
    await pruneRateLimitBuckets();
  } catch (error) {
    logger.warn("Could not apply the retention policy", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Imports the bundled food databases, in the background, on worker startup.
 *
 * This is what makes a fresh installation arrive with BLS 4.0 and the USDA
 * releases already searchable, rather than waiting for somebody to notice a
 * button. It runs here rather than in the entrypoint or the web process for
 * two reasons: the first import takes about a minute, which would push the web
 * container past its healthcheck start period, and it is not awaited, so it
 * cannot delay the queue either. Every later start compares one checksum and
 * does nothing.
 */
function importBundledFoodDatasets() {
  void importAllDatasets()
    .then(({ outcomes, failures }) => {
      const changed = outcomes.filter((outcome) => outcome.changed);
      if (changed.length > 0) {
        logger.info("Bundled food databases are up to date", {
          imported: changed.map((outcome) => `${outcome.key}@${outcome.version}`),
        });
      }
      for (const failure of failures) {
        logger.error("Could not import a bundled food database", failure);
      }
    })
    .catch((error) => {
      // A missing or unreadable artifact must never stop the worker: food
      // search still works, with whatever is already stored.
      logger.error("Bundled food database import failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    });
}

let running = true;

/**
 * What this process will actually use, logged once at startup.
 *
 * The worker and the web app are separate containers with separate environments,
 * and nothing makes them agree. A worker that silently disagrees shows up much
 * later as an inexplicably failing job - so the settings it resolved are printed
 * where an operator can compare them against the app's. Values only, never
 * secrets: the worker needs none.
 */
function startupConfiguration() {
  const host = (value: string) => {
    try {
      return new URL(value).host;
    } catch {
      return "invalid URL";
    }
  };
  return {
    pollMs: pollMs(),
    heartbeat: heartbeatFile(),
    aiEnabled: flag("AI_ENABLED", true),
    aiHost: host(resolveAiBaseUrl()),
    model: resolveAiModel(),
    timeoutSeconds: Math.round(ollamaTimeoutMs() / 1000),
    maxOutputTokens: ollamaMaxOutputTokens(),
    // Without both of these, a component nothing local or Open Food Facts knows
    // cannot be resolved from the web at all.
    webResearchEnabled: researchEnabled(),
    searxngConfigured: Boolean(process.env.SEARXNG_URL?.trim()),
  };
}

async function main() {
  logger.info("AI worker started", startupConfiguration());
  await beat();
  // A worker killed mid-job left it RUNNING for ever, because a claim is
  // conditional on QUEUED. Reclaim on startup, then periodically for the case
  // where a second worker died while this one kept going.
  await reclaimStaleJobs();
  await sweepExpiredImages();
  await pruneExpiredFoods();
  await applyRetention();
  importBundledFoodDatasets();
  let sinceReclaim = 0;
  let lastSweep = Date.now();

  while (running) {
    const processed = await processNextAiJob();
    await beat();
    /* The sweep is time-based rather than counted in polls, so draining a busy
       queue back to back cannot postpone it indefinitely. */
    if (Date.now() - lastSweep >= SWEEP_EVERY_MS) {
      lastSweep = Date.now();
      await sweepExpiredImages();
    }
    if (processed) continue; // Drain a busy queue back to back.
    if (!running) break;
    if (++sinceReclaim * pollMs() >= RECLAIM_EVERY_MS) {
      sinceReclaim = 0;
      await reclaimStaleJobs();
      await pruneExpiredFoods();
      await applyRetention();
    }
    await delay(pollMs());
  }
  logger.info("AI worker stopped");
}

/**
 * A container stop sends SIGTERM. Finishing the job in flight and then leaving
 * keeps Docker from having to SIGKILL the process ten seconds later.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (!running) return;
    logger.info("AI worker shutting down", { signal });
    running = false;
  });
}

main()
  .catch((error) => {
    logger.error("AI worker stopped unexpectedly", { reason: error instanceof Error ? error.message : "unknown" });
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
