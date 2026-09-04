import Link from "next/link";
import { discardAiRunAction, retryAiRunAction } from "@/server/ai-placeholder-actions";
import { AI_PLACEHOLDER_REASONS, type AiPlaceholder, type AiPlaceholderReason } from "@/server/ai-placeholders";

export interface AiPlaceholderLabels {
  /** The stand-in's name, the same wherever it is listed. */
  name: string;
  hint: string;
  queued: string;
  running: string;
  /** The two tags it is shown under: a machine wrote it, and it is not final. */
  tagAi: string;
  tagDraft: string;
  /** What the same row says once the run failed instead of finishing. */
  failedName: string;
  failed: string;
  /** Why it failed, in the few readings a submitter can act on. */
  reasons: Record<AiPlaceholderReason, string>;
  /** The two actions on a failed row, named for the icons that carry them. */
  retry: string;
  discard: string;
  /** Shown instead of the re-run when the input that run needs is gone. */
  retryUnavailable: string;
}

/** Builds the labels from a namespace translator, so no page assembles them by hand. */
export function aiPlaceholderLabels(t: (key: string) => string): AiPlaceholderLabels {
  return {
    name: t("name"),
    hint: t("hint"),
    queued: t("queued"),
    running: t("running"),
    tagAi: t("tagAi"),
    tagDraft: t("tagDraft"),
    failedName: t("failedName"),
    failed: t("failed"),
    reasons: Object.fromEntries(AI_PLACEHOLDER_REASONS.map((reason) => [reason, t(`reasons.${reason}`)])) as Record<AiPlaceholderReason, string>,
    retry: t("retry"),
    discard: t("discard"),
    retryUnavailable: t("retryUnavailable"),
  };
}

/**
 * One entry standing in for an AI run that has not produced its entry.
 *
 * While the run is going the whole row is a link to its review page and does
 * nothing else: it cannot be logged, edited or deleted, because there is nothing
 * there yet - it is a signpost to the work in progress, and it disappears by
 * itself once the real entry exists. The two tags say so before the row is read:
 * made by AI, and not a confirmed entry.
 *
 * A run that failed keeps the row rather than vanishing from the list, which is
 * what made a failed extraction look like work that was silently thrown away.
 * It says so, names the reason - "Ollama nicht erreichbar" is the common one,
 * with the run's own error line on the tag's tooltip for the failures those few
 * reasons cannot tell apart - and carries the two things that can be done about
 * it: ↻ queues the same input again, so recovering does not mean re-typing the
 * submission or finding an administrator, and × throws the run away for a
 * submitter who is done with it.
 */
export function AiPlaceholderRow({
  placeholder,
  labels,
  returnTo,
}: {
  placeholder: AiPlaceholder;
  labels: AiPlaceholderLabels;
  /** Where the row's own buttons come back to: the list it is rendered in. */
  returnTo: "/" | "/foods";
}) {
  const failed = placeholder.status === "FAILED";
  const reason = failed ? labels.reasons[placeholder.reason ?? "OTHER"] : null;
  // What the tag says when it is pointed at: the reason, and behind the dash the
  // run's own line where it has one, the way the import page reports the same
  // failure. The tag is the only place for it - the row is one line high and the
  // detail can be a sentence of model output - so it repeats the reason too,
  // rather than being a dangling fragment for anyone reading it on its own.
  const tagTitle = reason && placeholder.detail ? `${reason} — ${placeholder.detail}` : reason;

  return (
    <div className={`row clickable-row ai-placeholder${failed ? " ai-placeholder-failed" : ""}`}>
      <Link className="row-main-link" href={placeholder.href}>
        <div className="row-body">
          <strong>{failed ? labels.failedName : labels.name}</strong>
          {/* The submitted input, or - while the run is going - what it is
              doing. A failed run says why instead: "still working on it" would
              be untrue of a run that has already given up. */}
          {placeholder.source || !failed ? <span>{placeholder.source || labels.hint}</span> : null}
          {failed ? (
            <span className="ai-placeholder-reason">
              {reason}
              {/* A tooltip is a mouse's affordance, and there is no keyboard or
                  screen-reader equivalent of hovering; the same detail is read
                  out here instead of being lost to anyone not using a pointer. */}
              {placeholder.detail ? <span className="sr-only"> — {placeholder.detail}</span> : null}
            </span>
          ) : null}
          {placeholder.retryable === false ? <span>{labels.retryUnavailable}</span> : null}
        </div>
        <span className="ai-placeholder-tags">
          <span className="badge badge-ai">{labels.tagAi}</span>
          <span className="badge">{labels.tagDraft}</span>
        </span>
        {/* Text, not a spinner: the state has to survive a page that is only
            refreshed every few seconds, and be readable by a screen reader. */}
        <span className={`ai-state${failed ? " ai-failed" : ""}`} aria-live="polite" title={tagTitle ?? undefined}>
          {failed ? labels.failed : placeholder.status === "RUNNING" ? labels.running : labels.queued}
        </span>
      </Link>
      {/* Outside the link, or these would be buttons nested in an anchor: the
          row still leads to the review, and each action is its own submission
          beside it. Icons rather than words, as the diary's own rows do it, so
          two actions fit on a phone next to the text they act on; each carries
          the wording as its accessible name and its tooltip, and the line under
          the list names them too, since an icon alone is a guess.

          A run whose only input was a photo has nothing left to run on - the
          photo is deleted when the job fails - so it is offered no re-run that
          could only fail again. Discarding it stays possible: a row that cannot
          be retried is exactly the one worth being able to clear away. */}
      {failed ? (
        <div className="row-actions ai-placeholder-actions">
          {placeholder.retryable === false ? null : (
            <form action={retryAiRunAction}>
              <input type="hidden" name="jobId" value={placeholder.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="btn btn-quiet" type="submit" aria-label={labels.retry} title={labels.retry}>
                <span aria-hidden="true">↻</span>
              </button>
            </form>
          )}
          <form action={discardAiRunAction}>
            <input type="hidden" name="jobId" value={placeholder.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="btn btn-quiet ai-discard" type="submit" aria-label={labels.discard} title={labels.discard}>
              <span aria-hidden="true">×</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
