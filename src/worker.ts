import { writeFile } from "node:fs/promises";
import { processNextAiJob, reclaimStaleJobs } from "./server/ai-jobs";
import { prisma } from "./lib/db";
import { logger } from "./lib/logger";
import { flag, researchEnabled, resolveAiBaseUrl, resolveAiModel } from "./lib/env";
import { ollamaMaxOutputTokens, ollamaTimeoutMs } from "./providers/ollama";

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
  let sinceReclaim = 0;

  while (running) {
    const processed = await processNextAiJob();
    await beat();
    if (processed) continue; // Drain a busy queue back to back.
    if (!running) break;
    if (++sinceReclaim * pollMs() >= RECLAIM_EVERY_MS) {
      sinceReclaim = 0;
      await reclaimStaleJobs();
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
