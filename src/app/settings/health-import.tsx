"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { HealthFileError, readHealthFile, type HealthFileResult } from "@/lib/health-file";
import type { HealthMetric } from "@/lib/health-import";
import { applyHealthImportAction, previewHealthImportAction, type ImportState } from "@/server/health-import-actions";
import type { ImportPlan } from "@/server/health-import";

/**
 * Import a health export, in two steps.
 *
 * The file is read here in the page rather than uploaded, which is what lets an
 * Apple export of several hundred megabytes work at all: only the metrics
 * NutriCore stores are sent, and the rest of the file - everything from heart
 * rate to clinical documents - never leaves the device.
 *
 * The preview is not decoration. Units are inferred from an export that states
 * none, and the first time somebody should find out that a column was read at
 * the wrong scale is before three thousand rows are in their weight log, not
 * after.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string; bytesRead: number; found: number }
  | { kind: "planned"; file: HealthFileResult; plan: ImportPlan }
  | { kind: "importing" }
  | { kind: "imported"; plan: ImportPlan }
  | { kind: "error"; message: string };

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function HealthImport() {
  const t = useTranslations("healthImport");
  const common = useTranslations("common");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);

  const fail = (message: string) => setPhase({ kind: "error", message });

  const stateError = (state: Extract<ImportState, { status: "error" }>) =>
    fail(t(`errors.${state.error}` as "errors.validation"));

  async function pick(file: File) {
    setPhase({ kind: "reading", fileName: file.name, bytesRead: 0, found: 0 });

    let result: HealthFileResult;
    try {
      result = await readHealthFile(file, (progress) =>
        setPhase({ kind: "reading", fileName: file.name, bytesRead: progress.bytesRead, found: progress.found }),
      );
    } catch (error) {
      fail(error instanceof HealthFileError ? t(`errors.${error.kind}` as "errors.unrecognised") : t("errors.unreadable"));
      return;
    }

    const state = await previewHealthImportAction({ platform: result.platform, samples: result.samples });
    if (state.status === "error") return stateError(state);
    if (state.status === "planned") setPhase({ kind: "planned", file: result, plan: state.plan });
  }

  async function confirm(file: HealthFileResult) {
    setPhase({ kind: "importing" });
    const state = await applyHealthImportAction({ platform: file.platform, samples: file.samples });
    if (state.status === "error") return stateError(state);
    if (state.status === "imported") setPhase({ kind: "imported", plan: state.plan });
  }

  function reset() {
    if (input.current) input.current.value = "";
    setPhase({ kind: "idle" });
  }

  return (
    <section className="card">
      <h2>{t("title")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        {t("hint")}
      </p>

      {phase.kind === "idle" || phase.kind === "error" ? (
        <>
          {phase.kind === "error" ? (
            <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
              <span className="notice-icon" aria-hidden="true">
                !
              </span>
              <span>{phase.message}</span>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="health-file">{t("chooseFile")}</label>
            <input
              ref={input}
              id="health-file"
              type="file"
              accept=".zip,.xml,.db,.sqlite,.sqlite3"
              aria-describedby="health-file-hint"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void pick(file);
              }}
            />
            <div className="hint" id="health-file-hint">
              {t("chooseFileHint")}
            </div>
          </div>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13.5 }}>{t("howTo.title")}</summary>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 8 }}>
              <p style={{ margin: "0 0 8px" }}>
                <strong>{t("howTo.appleTitle")}</strong> {t("howTo.apple")}
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <strong>{t("howTo.androidTitle")}</strong> {t("howTo.android")}
              </p>
              {/* The two things people actually get stuck on: an export that
                  comes back empty because no app writes to Health Connect, and
                  reaching for Takeout, which holds Google Fit data instead. */}
              <p style={{ margin: "0 0 8px" }}>{t("howTo.androidNote")}</p>
              <p style={{ margin: 0 }}>{t("howTo.androidFormat")}</p>
            </div>
          </details>
        </>
      ) : null}

      {phase.kind === "reading" ? (
        <div role="status" aria-live="polite">
          <p style={{ marginBottom: 4 }}>{t("reading", { file: phase.fileName })}</p>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            {t("readingProgress", { size: megabytes(phase.bytesRead), found: phase.found })}
          </p>
        </div>
      ) : null}

      {phase.kind === "importing" ? (
        <p role="status" aria-live="polite">
          {common("loading")}
        </p>
      ) : null}

      {phase.kind === "planned" ? (
        <>
          <PlanTable plan={phase.plan} />

          <p className="muted" style={{ fontSize: 13.5 }}>
            {t("readFrom", {
              platform: t(`platform.${phase.file.platform}` as "platform.APPLE_HEALTH"),
              read: phase.file.readCount,
              kept: phase.file.samples.length,
            })}
          </p>

          {phase.file.skippedTables.length > 0 ? (
            <div className="notice notice-warn" role="status" style={{ marginBottom: 14 }}>
              <span className="notice-icon" aria-hidden="true">
                !
              </span>
              <span>{t("skippedTables", { tables: phase.file.skippedTables.join(", ") })}</span>
            </div>
          ) : null}

          {phase.plan.totals.skipManual > 0 ? (
            <p className="muted" style={{ fontSize: 13.5 }}>{t("manualProtected", { count: phase.plan.totals.skipManual })}</p>
          ) : null}

          <div className="stack" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={phase.plan.totals.create + phase.plan.totals.update === 0}
              onClick={() => void confirm(phase.file)}
            >
              {t("confirm", { count: phase.plan.totals.create + phase.plan.totals.update })}
            </button>
            <button type="button" className="btn" onClick={reset}>
              {common("cancel")}
            </button>
          </div>
        </>
      ) : null}

      {phase.kind === "imported" ? (
        <>
          <div className="notice" role="status" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">
              ✓
            </span>
            <span>{t("done", { count: phase.plan.totals.create + phase.plan.totals.update })}</span>
          </div>
          <PlanTable plan={phase.plan} />
          <button type="button" className="btn" onClick={reset}>
            {t("importAnother")}
          </button>
        </>
      ) : null}
    </section>
  );
}

function PlanTable({ plan }: { plan: ImportPlan }) {
  const t = useTranslations("healthImport");

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13.5 }}>
      <caption className="muted" style={{ captionSide: "top", textAlign: "left", paddingBottom: 6, fontSize: 13.5 }}>
        {t("planCaption")}
      </caption>
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: "left" }}>{t("columns.metric")}</th>
          <th scope="col" style={{ textAlign: "right" }}>{t("columns.new")}</th>
          <th scope="col" style={{ textAlign: "right" }}>{t("columns.updated")}</th>
          <th scope="col" style={{ textAlign: "right" }}>{t("columns.kept")}</th>
        </tr>
      </thead>
      <tbody>
        {plan.metrics.map((metric) => (
          <tr key={metric.metric}>
            <th scope="row" style={{ textAlign: "left", fontWeight: 400 }}>
              {t(`metric.${metric.metric}` as `metric.${HealthMetric}`)}
              {metric.firstDate ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {metric.firstDate === metric.lastDate ? metric.firstDate : `${metric.firstDate} – ${metric.lastDate}`}
                </div>
              ) : null}
            </th>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{metric.create}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{metric.update}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{metric.skipManual + metric.unchanged}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
