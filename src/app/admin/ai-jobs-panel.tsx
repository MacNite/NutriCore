"use client";

import { useMemo, useRef, useState } from "react";
import {
  AI_JOB_DESTRUCTIVE_OPERATIONS,
  AI_JOB_SELECTION_OPERATIONS,
  type AiJobOperation,
  type AiJobStatusName,
} from "@/server/ai-types";

/**
 * One attempt as the admin page needs it: a reason, when it happened, how long
 * it took. Serialised by the server component, so times arrive pre-formatted.
 */
export interface JobAttemptRow {
  id: string;
  attempt: number;
  kind: string;
  message: string;
  detail: string | null;
  durationMs: number | null;
  at: string;
}

export interface JobRow {
  id: string;
  entityType: string;
  entityId: string;
  /** The food, recipe, dish or meal text the job is about; null when it is gone. */
  entityName: string | null;
  /** What a finished job produced, as already-translated label/value pairs. */
  result: { label: string; value: string }[];
  status: AiJobStatusName;
  retryCount: number;
  maxRetries: number;
  model: string | null;
  failureKind: string | null;
  errorMessage: string | null;
  errorDetail: string | null;
  createdAt: string;
  durationSeconds: number | null;
  /** Set once the job has been RUNNING long enough to count as abandoned. */
  stuck: boolean;
  /** The user's own words for a quick meal, where there are any. */
  input: string | null;
  sourceUrl: string | null;
  reviewStatus: string | null;
  attempts: JobAttemptRow[];
}

export interface JobLabels {
  entity: string;
  status: string;
  created: string;
  retries: string;
  model: string;
  reason: string;
  statusLabels: Record<AiJobStatusName, string>;
  operations: Record<AiJobOperation, string>;
  kinds: Record<string, string>;
  hints: Record<string, string>;
  selectAll: string;
  selectNone: string;
  selectedLabel: string;
  selectRow: string;
  filterAll: string;
  onSelection: string;
  sweeps: string;
  details: string;
  attemptHistory: string;
  attemptLabel: string;
  noAttempts: string;
  input: string;
  source: string;
  review: string;
  stuck: string;
  confirmDelete: string;
  noJobs: string;
  jobId: string;
  pageStatus: string;
  previousPage: string;
  nextPage: string;
}

const SWEEPS: AiJobOperation[] = ["requeueAllFailed", "unstickRunning", "deleteFailed", "deleteCompleted"];

const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`);

/** `/admin?jobs=<status>&jobsPage=<n>#ai-jobs`, leaving out what is default. */
function jobsHref(filter: string, page: number) {
  const query = new URLSearchParams();
  if (filter) query.set("jobs", filter);
  if (page > 1) query.set("jobsPage", String(page));
  return `/admin${query.size ? `?${query}` : ""}#ai-jobs`;
}

export function AiJobsPanel({
  jobs,
  counts,
  filter,
  page,
  pageCount,
  labels,
  action,
}: {
  jobs: JobRow[];
  counts: Record<AiJobStatusName | "ALL", number>;
  filter: string;
  page: number;
  pageCount: number;
  labels: JobLabels;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useMemo(() => jobs.map((job) => job.id), [jobs]);

  const toggle = (id: string, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  /**
   * One form, one hidden operation field. The buttons are type="button" and set
   * that field before submitting, so a destructive sweep can still be stopped by
   * the confirmation without having already posted.
   */
  const submit = (operation: AiJobOperation) => {
    if (AI_JOB_DESTRUCTIVE_OPERATIONS.includes(operation) && !window.confirm(labels.confirmDelete)) return;
    const form = formRef.current;
    if (!form) return;
    const field = form.elements.namedItem("operation") as HTMLInputElement | null;
    if (field) field.value = operation;
    form.requestSubmit();
  };

  return (
    <form action={action} ref={formRef}>
      <input type="hidden" name="operation" defaultValue="requeue" />
      <input type="hidden" name="filter" value={filter} />

      <div className="job-filters" role="group" aria-label={labels.status}>
        <FilterLink current={filter} value="" label={`${labels.filterAll} (${counts.ALL})`} />
        {(Object.keys(labels.statusLabels) as AiJobStatusName[]).map((status) => (
          <FilterLink
            key={status}
            current={filter}
            value={status}
            label={`${labels.statusLabels[status]} (${counts[status]})`}
          />
        ))}
      </div>

      <div className="job-toolbar">
        <div className="job-toolbar-group">
          <span className="job-toolbar-label">{labels.onSelection}</span>
          <button type="button" className="btn btn-quiet" onClick={() => setSelected(new Set(ids))}>
            {labels.selectAll}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setSelected(new Set())}>
            {labels.selectNone}
          </button>
          {AI_JOB_SELECTION_OPERATIONS.map((operation) => (
            <button
              key={operation}
              type="button"
              className={operation === "delete" ? "btn btn-danger" : "btn"}
              disabled={selected.size === 0}
              onClick={() => submit(operation)}
            >
              {labels.operations[operation]}
            </button>
          ))}
          <span className="muted" aria-live="polite">
            {labels.selectedLabel}: {selected.size}
          </span>
        </div>

        <div className="job-toolbar-group">
          <span className="job-toolbar-label">{labels.sweeps}</span>
          {SWEEPS.map((operation) => (
            <button
              key={operation}
              type="button"
              className={AI_JOB_DESTRUCTIVE_OPERATIONS.includes(operation) ? "btn btn-danger" : "btn"}
              onClick={() => submit(operation)}
            >
              {labels.operations[operation]}
            </button>
          ))}
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="muted">{labels.noJobs}</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    aria-label={labels.selectAll}
                    checked={allSelected}
                    onChange={(event) => setSelected(event.target.checked ? new Set(ids) : new Set())}
                  />
                </th>
                <th>{labels.entity}</th>
                <th>{labels.status}</th>
                <th>{labels.created}</th>
                <th className="num">{labels.retries}</th>
                <th>{labels.reason}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <input
                      type="checkbox"
                      name="jobId"
                      value={job.id}
                      aria-label={`${labels.selectRow} ${job.entityType}`}
                      checked={selected.has(job.id)}
                      onChange={(event) => toggle(job.id, event.target.checked)}
                    />
                  </td>
                  <td>
                    {job.entityType}
                    {/* The name is what makes a row recognisable; the id stays
                        below it because it is what the logs and the API use. */}
                    {job.entityName ? <> — <strong>{job.entityName}</strong></> : null}
                    <br />
                    <code className="muted">{job.entityId}</code>
                  </td>
                  <td>
                    {labels.statusLabels[job.status]}
                    {job.stuck ? (
                      <>
                        <br />
                        <span className="badge badge-ai">{labels.stuck}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {job.createdAt}
                    <br />
                    <span className="muted">{job.durationSeconds === null ? "—" : `${job.durationSeconds}s`}</span>
                  </td>
                  <td className="num">
                    {job.retryCount} / {job.maxRetries}
                  </td>
                  <td>
                    <JobReason job={job} labels={labels} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Links rather than buttons: the page belongs in the URL for the same
          reason the filter does, and a link still works inside this form. */}
      <div className="job-pager">
        {/* Hidden rather than removed, so the three grid tracks - and the
            centred status between them - do not move on the first page. */}
        <a className={`btn btn-quiet${page <= 1 ? " is-hidden" : ""}`} href={jobsHref(filter, page - 1)}>
          <span aria-hidden="true">‹</span> {labels.previousPage}
        </a>
        <span className="muted" aria-live="polite">{labels.pageStatus}</span>
        <a className={`btn btn-quiet${page >= pageCount ? " is-hidden" : ""}`} href={jobsHref(filter, page + 1)}>
          {labels.nextPage} <span aria-hidden="true">›</span>
        </a>
      </div>
    </form>
  );
}

/**
 * The reason cell is the point of the whole panel: the classified kind, what to
 * do about it, and - folded away - the full cause chain plus every attempt. Three
 * retries that failed three different ways used to be indistinguishable from
 * three that failed the same way, because only the last message was kept.
 */
function JobReason({ job, labels }: { job: JobRow; labels: JobLabels }) {
  const kind = job.failureKind;
  const hint = kind ? labels.hints[kind] : undefined;
  const hasDetail = Boolean(job.errorDetail || job.attempts.length || job.input || job.sourceUrl);
  // What the job produced. A failure explains itself through its kind; a
  // success used to explain nothing, so this is the whole content of the cell
  // for the rows that worked.
  const result = job.result.length ? (
    <dl className="job-result">
      {job.result.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  ) : null;

  if (!kind && !job.errorMessage) {
    return (
      <div className="job-reason">
        {result}
        {result ? null : (
          <span className="muted">{job.reviewStatus ? `${labels.review}: ${job.reviewStatus}` : "—"}</span>
        )}
        {result && job.reviewStatus ? <p className="muted job-reason-hint">{labels.review}: {job.reviewStatus}</p> : null}
      </div>
    );
  }

  return (
    <div className="job-reason">
      {kind ? <span className="badge badge-ai">{labels.kinds[kind] ?? kind}</span> : null}
      {result}
      {job.errorMessage ? <div className="job-reason-message">{job.errorMessage}</div> : null}
      {hint ? <p className="muted job-reason-hint">{hint}</p> : null}
      {hasDetail ? (
        <details className="job-details">
          <summary>{labels.details}</summary>
          <dl className="job-detail-list">
            <dt>{labels.jobId}</dt>
            <dd>
              <code>{job.id}</code>
            </dd>
            {job.model ? (
              <>
                <dt>{labels.model}</dt>
                <dd>{job.model}</dd>
              </>
            ) : null}
            {job.input ? (
              <>
                <dt>{labels.input}</dt>
                <dd>{job.input}</dd>
              </>
            ) : null}
            {job.sourceUrl ? (
              <>
                <dt>{labels.source}</dt>
                <dd className="job-detail-break">{job.sourceUrl}</dd>
              </>
            ) : null}
            {job.errorDetail ? (
              <>
                <dt>{labels.reason}</dt>
                <dd className="job-detail-break">
                  <code>{job.errorDetail}</code>
                </dd>
              </>
            ) : null}
          </dl>

          <h4 className="job-detail-heading">{labels.attemptHistory}</h4>
          {job.attempts.length === 0 ? (
            <p className="muted">{labels.noAttempts}</p>
          ) : (
            <ol className="job-attempts">
              {job.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <strong>
                    {labels.attemptLabel} {attempt.attempt + 1}
                    {" · "}
                    {labels.kinds[attempt.kind] ?? attempt.kind}
                  </strong>
                  <span className="muted">
                    {" "}
                    {attempt.at} {"·"} {seconds(attempt.durationMs)}
                  </span>
                  <div>{attempt.message}</div>
                  {attempt.detail ? (
                    <div className="job-detail-break">
                      <code className="muted">{attempt.detail}</code>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </details>
      ) : null}
    </div>
  );
}

/**
 * A link rather than a select: the filter lives in the URL, so a filtered view
 * can be bookmarked and survives the redirect that follows a bulk operation.
 */
function FilterLink({ current, value, label }: { current: string; value: string; label: string }) {
  const active = current === value;
  return (
    // A link is not a toggle, so the selected filter is marked with
    // aria-current rather than with aria-pressed.
    <a className="progress-chip" href={jobsHref(value, 1)} aria-current={active ? "page" : undefined}>
      {label}
    </a>
  );
}
