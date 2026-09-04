import Link from "next/link";
import { retryAiRunAction } from "@/server/ai-placeholder-actions";
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
  retry: string;
  /** Shown instead of the button when the input the run needs is gone. */
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
 * It says so, names the reason - "Ollama nicht erreichbar" is the common one -
 * and carries the button that queues the same input again, so recovering does
 * not mean re-typing the submission or finding an administrator.
 */
export function AiPlaceholderRow({
  placeholder,
  labels,
  returnTo,
}: {
  placeholder: AiPlaceholder;
  labels: AiPlaceholderLabels;
  /** Where the re-run button comes back to: the list this row is rendered in. */
  returnTo: "/" | "/foods";
}) {
  const failed = placeholder.status === "FAILED";

  return (
    <div className={`row clickable-row ai-placeholder${failed ? " ai-placeholder-failed" : ""}`}>
      <Link className="row-main-link" href={placeholder.href}>
        <div className="row-body">
          <strong>{failed ? labels.failedName : labels.name}</strong>
          {/* The submitted input, or - while the run is going - what it is
              doing. A failed run says why instead: "still working on it" would
              be untrue of a run that has already given up. */}
          {placeholder.source || !failed ? <span>{placeholder.source || labels.hint}</span> : null}
          {failed ? <span className="ai-placeholder-reason">{labels.reasons[placeholder.reason ?? "OTHER"]}</span> : null}
          {placeholder.retryable === false ? <span>{labels.retryUnavailable}</span> : null}
        </div>
        <span className="ai-placeholder-tags">
          <span className="badge badge-ai">{labels.tagAi}</span>
          <span className="badge">{labels.tagDraft}</span>
        </span>
        {/* Text, not a spinner: the state has to survive a page that is only
            refreshed every few seconds, and be readable by a screen reader. */}
        <span className={`ai-state${failed ? " ai-failed" : ""}`} aria-live="polite">
          {failed ? labels.failed : placeholder.status === "RUNNING" ? labels.running : labels.queued}
        </span>
      </Link>
      {/* Outside the link, or it would be a button nested in an anchor: the row
          still leads to the review, and the re-run is its own submission next to
          it. A run whose only input was a photo has nothing left to run on -
          the photo is deleted when the job fails - and says so in the row
          instead of offering a button that could only fail again. */}
      {failed && placeholder.retryable !== false ? (
        <form action={retryAiRunAction} className="ai-placeholder-retry">
          <input type="hidden" name="jobId" value={placeholder.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="btn" type="submit">{labels.retry}</button>
        </form>
      ) : null}
    </div>
  );
}
