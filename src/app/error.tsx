"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  const common = useTranslations("common");

  useEffect(() => {
    // The digest is the only safe correlator; the message may contain detail
    // that does not belong in the browser console.
    console.error("Unhandled error", error.digest);
  }, [error]);

  return (
    <div className="auth-shell">
      <main className="auth-card card" style={{ textAlign: "center" }} role="alert">
        <h1 style={{ fontSize: 21 }}>{t("title")}</h1>
        <p className="muted">{t("generic")}</p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          {common("retry")}
        </button>
      </main>
    </div>
  );
}
