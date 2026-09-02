import Link from "next/link";
import type { AiPlaceholder } from "@/server/ai-placeholders";

export interface AiPlaceholderLabels {
  /** The stand-in's name, the same wherever it is listed. */
  name: string;
  hint: string;
  queued: string;
  running: string;
  /** The two tags it is shown under: a machine wrote it, and it is not final. */
  tagAi: string;
  tagDraft: string;
}

/**
 * One entry standing in for an AI run that has not finished.
 *
 * The whole row is a link to that run's review page and does nothing else: it
 * cannot be logged, edited or deleted, because there is nothing there yet - it
 * is a signpost to the work in progress, and it disappears by itself once the
 * real entry exists. The two tags say so before the row is read: made by AI,
 * and not a confirmed entry.
 */
export function AiPlaceholderRow({ placeholder, labels }: { placeholder: AiPlaceholder; labels: AiPlaceholderLabels }) {
  return (
    <div className="row clickable-row ai-placeholder">
      <Link className="row-main-link" href={placeholder.href}>
        <div className="row-body">
          <strong>{labels.name}</strong>
          <span>{placeholder.source || labels.hint}</span>
        </div>
        <span className="ai-placeholder-tags">
          <span className="badge badge-ai">{labels.tagAi}</span>
          <span className="badge">{labels.tagDraft}</span>
        </span>
        {/* Text, not a spinner: the state has to survive a page that is only
            refreshed every few seconds, and be readable by a screen reader. */}
        <span className="ai-state" aria-live="polite">
          {placeholder.status === "RUNNING" ? labels.running : labels.queued}
        </span>
      </Link>
    </div>
  );
}
