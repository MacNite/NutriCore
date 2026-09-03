"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Opens what a finished run produced, for the reader who watched it finish.
 *
 * Every AI submission lands on a status page that polls until the worker is
 * done. For a run whose result is a recipe, saying "done" on that page is not
 * enough: the reader asked for a recipe and has been waiting here for it, and
 * until now the run ended by quietly filling a form or by offering a link they
 * had to notice. `href` is the job's own completion destination, so nothing is
 * decided here - this only follows it.
 *
 * Only ever for the reader who was watching. `armed` is captured on mount, so
 * opening a finished run's page later - from the dashboard, from the recipe
 * list, from a link someone kept - never bounces anywhere. That is what keeps
 * the review page readable at all: a redirect that fired on every render would
 * make the proposal behind it unreachable.
 *
 * The grace poll covers the gap between "the job is complete" and "the recipe
 * is stored". The worker marks a meal job complete before it keeps the recipe,
 * deliberately - the recipe is a follow-up that must never put a finished
 * extraction back in the queue - and the page stops its own polling the moment
 * the job is no longer running. Without this the destination would arrive after
 * the last refresh and the reader would sit on a finished page for ever. It is
 * strictly bounded: one destination, or `graceMs`, whichever comes first.
 */
export function CompletionRedirect({
  href,
  watching,
  intervalMs = 2000,
  graceMs = 30_000,
}: {
  /** The run's destination, or null while it has produced nothing to open. */
  href: string | null;
  /** Whether the run was still going when this reader arrived. */
  watching: boolean;
  intervalMs?: number;
  graceMs?: number;
}) {
  const router = useRouter();
  const armed = useRef(watching);
  const until = useRef(0);

  useEffect(() => {
    if (!armed.current) return;
    if (href) {
      // Exactly once, and replace rather than push: the status page is not
      // somewhere "back" should return to.
      armed.current = false;
      router.replace(href);
      return;
    }
    // Still running: the page is doing its own polling, so leave it to it.
    if (watching) return;

    if (!until.current) until.current = Date.now() + graceMs;
    const timer = setInterval(() => {
      if (Date.now() > until.current) {
        armed.current = false;
        clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [href, watching, router, intervalMs, graceMs]);

  return null;
}
