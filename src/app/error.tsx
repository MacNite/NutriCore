"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { lastActionFailure } from "@/lib/last-action-failure";

/**
 * One line a reader can pass on, since this screen is otherwise the same for
 * every failure.
 *
 * A server error reaches the browser already redacted to its digest, so that is
 * all it can show. A client error - a request that never reached the server,
 * or an answer from a proxy instead of the app - has nothing server-side to
 * look up, and its message ("Failed to fetch", "An unexpected response was
 * received from the server") is the only record of what happened. Both leave
 * the server log empty, which is exactly when a reader needs this line.
 */
function detailOf(error: Error & { digest?: string }) {
  if (error.digest) return `digest ${error.digest}`;
  const response = lastActionFailure();
  const text = [`${error.name}: ${error.message}`.trim(), response].filter(Boolean).join(" - ");
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

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
        <p className="muted" style={{ fontSize: 12, wordBreak: "break-word" }}>
          {t("detail")}: <code>{detailOf(error)}</code>
        </p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          {common("retry")}
        </button>
      </main>
    </div>
  );
}
