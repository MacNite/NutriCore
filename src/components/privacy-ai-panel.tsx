"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveAiSettingsAction, type FormState } from "@/server/profile-actions";

/**
 * The AI consent switches, as their own panel.
 *
 * They used to sit on the settings page next to the language selector; they are
 * administration now, so they moved to /admin. They still act on the signed-in
 * account's own profile - the flags are per user, and nothing here reaches
 * anyone else's settings.
 */
export function PrivacyAiPanel({
  aiEnabled,
  researchEnabled,
  autoApproveAi,
  autoApplyEnrichment,
}: {
  aiEnabled: boolean;
  researchEnabled: boolean;
  autoApproveAi: boolean;
  autoApplyEnrichment: boolean;
}) {
  const t = useTranslations("settings");
  const errors = useTranslations("errors");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<FormState, FormData>(saveAiSettingsAction, {});

  return (
    <section className="card" id="privacy-ai">
      <h2>{t("privacy")}</h2>
      <form action={action}>
        {state.ok ? (
          <div className="notice" role="status" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">✓</span>
            <span>{t("saved")}</span>
          </div>
        ) : null}
        {state.error ? (
          <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">!</span>
            <span>{errors("validation")}</span>
          </div>
        ) : null}

        <div className="checkbox">
          <input id="aiEnabled" name="aiEnabled" type="checkbox" defaultChecked={aiEnabled} aria-describedby="ai-hint" />
          <div>
            <label htmlFor="aiEnabled">{t("aiEnabled")}</label>
            <div className="hint" id="ai-hint">{t("aiEnabledHint")}</div>
          </div>
        </div>

        <div className="checkbox">
          <input
            id="researchEnabled"
            name="researchEnabled"
            type="checkbox"
            defaultChecked={researchEnabled}
            aria-describedby="research-hint"
          />
          <div>
            <label htmlFor="researchEnabled">{t("researchEnabled")}</label>
            <div className="hint" id="research-hint">{t("researchEnabledHint")}</div>
          </div>
        </div>

        <div className="checkbox">
          <input
            id="autoApproveAi"
            name="autoApproveAi"
            type="checkbox"
            defaultChecked={autoApproveAi}
            aria-describedby="auto-approve-hint"
          />
          <div>
            <label htmlFor="autoApproveAi">{t("autoApproveAi")}</label>
            <div className="hint" id="auto-approve-hint">{t("autoApproveAiHint")}</div>
          </div>
        </div>

        <div className="checkbox">
          <input
            id="autoApplyEnrichment"
            name="autoApplyEnrichment"
            type="checkbox"
            defaultChecked={autoApplyEnrichment}
            aria-describedby="auto-apply-enrichment-hint"
          />
          <div>
            <label htmlFor="autoApplyEnrichment">{t("autoApplyEnrichment")}</label>
            <div className="hint" id="auto-apply-enrichment-hint">{t("autoApplyEnrichmentHint")}</div>
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? common("loading") : common("save")}
        </button>
      </form>
    </section>
  );
}
